"""Markov chain reliability analysis router."""

import sys
import numpy as np
from fastapi import APIRouter, HTTPException
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.Markov import (
    MarkovChain, MarkovState, MarkovTransition,
    EXAMPLE_MODELS,
)
from schemas import MarkovRequest

router = APIRouter()


def _issue(severity: str, code: str, message: str, **context):
    return {
        "severity": severity,
        "code": code,
        "message": message,
        **{key: value for key, value in context.items() if value is not None},
    }


def _reachable(start: str, adjacency: dict[str, set[str]]) -> set[str]:
    visited = {start}
    frontier = [start]
    while frontier:
        current = frontier.pop()
        for target in adjacency.get(current, set()):
            if target not in visited:
                visited.add(target)
                frontier.append(target)
    return visited


def validate_model(req: MarkovRequest) -> dict:
    """Return actionable structural and interpretation diagnostics."""
    issues = []
    state_ids = [state.id for state in req.states]
    state_id_set = set(state_ids)
    for state in req.states:
        if not state.id.strip():
            issues.append(_issue(
                "error", "EMPTY_STATE_ID", "Every state requires a non-empty ID."
            ))
        if not state.name.strip():
            issues.append(_issue(
                "warning", "EMPTY_STATE_NAME",
                f"State {state.id!r} has no display name.", state_id=state.id,
            ))
    duplicate_states = sorted({item for item in state_ids if state_ids.count(item) > 1})
    for state_id in duplicate_states:
        issues.append(_issue(
            "error", "DUPLICATE_STATE_ID",
            f"State ID {state_id!r} is used more than once.", state_id=state_id,
        ))

    if not req.states:
        issues.append(_issue("error", "NO_STATES", "Add at least one state."))
    if not req.transitions:
        issues.append(_issue(
            "error", "NO_TRANSITIONS", "Add at least one transition between states."
        ))

    transition_ids = [
        transition.id or f"tr{index + 1}"
        for index, transition in enumerate(req.transitions)
    ]
    duplicate_transitions = sorted({
        item for item in transition_ids if transition_ids.count(item) > 1
    })
    for transition_id in duplicate_transitions:
        issues.append(_issue(
            "error", "DUPLICATE_TRANSITION_ID",
            f"Transition ID {transition_id!r} is used more than once.",
            transition_id=transition_id,
        ))

    adjacency = {state_id: set() for state_id in state_id_set}
    pair_ids: dict[tuple[str, str], list[str]] = {}
    for index, transition in enumerate(req.transitions):
        transition_id = transition_ids[index]
        missing = []
        if transition.from_state not in state_id_set:
            missing.append(transition.from_state)
        if transition.to_state not in state_id_set:
            missing.append(transition.to_state)
        if missing:
            issues.append(_issue(
                "error", "UNKNOWN_TRANSITION_STATE",
                f"Transition {transition_id!r} references missing state(s): "
                f"{', '.join(repr(item) for item in missing)}.",
                transition_id=transition_id,
            ))
            continue
        if transition.from_state == transition.to_state:
            issues.append(_issue(
                "error", "SELF_TRANSITION",
                f"Transition {transition_id!r} loops back to the same state; a CTMC "
                "self-transition does not change state.",
                state_id=transition.from_state, transition_id=transition_id,
            ))
        if transition.rate == 0:
            issues.append(_issue(
                "warning", "ZERO_TRANSITION_RATE",
                f"Transition {transition_id!r} has zero rate and is inactive.",
                transition_id=transition_id,
            ))
            if transition.rate_cv > 0:
                issues.append(_issue(
                    "warning", "ZERO_RATE_UNCERTAINTY",
                    f"Transition {transition_id!r} has a rate CV but its zero rate "
                    "cannot be varied by the uncertainty model.",
                    transition_id=transition_id,
                ))
        elif transition.from_state != transition.to_state:
            adjacency[transition.from_state].add(transition.to_state)
        pair_ids.setdefault((transition.from_state, transition.to_state), []).append(
            transition_id)

    for (source, target), ids in pair_ids.items():
        if len(ids) > 1:
            issues.append(_issue(
                "warning", "PARALLEL_TRANSITIONS_COMBINED",
                f"{len(ids)} transitions run from {source!r} to {target!r}; their "
                "rates are added in the generator matrix.",
                transition_id=ids[0],
            ))

    up_states = [
        state for state in req.states
        if state.state_type in ("operational", "degraded")
    ]
    failed_states = [state for state in req.states if state.state_type == "failed"]
    if req.states and not up_states:
        issues.append(_issue(
            "error", "NO_UP_STATE",
            "At least one Operational or Degraded state is required to define availability."
        ))
    if req.states and not failed_states:
        issues.append(_issue(
            "warning", "NO_FAILED_STATE",
            "No Failed state is defined; mission reliability remains one and MTTF is not identifiable."
        ))

    initial_state = req.initial_state or (state_ids[0] if state_ids else None)
    if req.initial_state and req.initial_state not in state_id_set:
        issues.append(_issue(
            "error", "UNKNOWN_INITIAL_STATE",
            f"Initial state {req.initial_state!r} does not exist.",
            state_id=req.initial_state,
        ))
    elif initial_state in state_id_set:
        reachable = _reachable(initial_state, adjacency)
        for state in req.states:
            if state.id not in reachable:
                issues.append(_issue(
                    "warning", "UNREACHABLE_STATE",
                    f"State {state.name!r} cannot be reached from initial state "
                    f"{initial_state!r} through positive-rate transitions.",
                    state_id=state.id,
                ))

    for state in req.states:
        outgoing = adjacency.get(state.id, set())
        if state.dwell_model == "erlang" and not outgoing:
            issues.append(_issue(
                "warning", "ERLANG_ABSORBING_STATE",
                f"State {state.name!r} is absorbing, so its Erlang dwell shape has no effect.",
                state_id=state.id,
            ))
        if state.state_type in ("operational", "degraded") and not outgoing:
            issues.append(_issue(
                "warning", "ABSORBING_UP_STATE",
                f"Up state {state.name!r} has no positive-rate departure; once entered, "
                "availability remains up indefinitely.",
                state_id=state.id,
            ))

    if req.times is not None:
        if not req.times:
            issues.append(_issue(
                "warning", "EMPTY_TIME_GRID",
                "The transient time grid is empty; only steady-state metrics will be returned."
            ))
        if len(req.times) > 2000:
            issues.append(_issue(
                "error", "TIME_GRID_TOO_LARGE",
                "At most 2,000 transient time points are supported."
            ))
        if any(not np.isfinite(time) or time < 0 for time in req.times):
            issues.append(_issue(
                "error", "INVALID_TIME_GRID",
                "Transient times must be finite and non-negative."
            ))
        elif any(right < left for left, right in zip(req.times, req.times[1:])):
            issues.append(_issue(
                "error", "UNSORTED_TIME_GRID",
                "Transient times must be sorted in ascending order."
            ))

    return {
        "valid": not any(issue["severity"] == "error" for issue in issues),
        "issues": issues,
        "summary": {
            "states": len(req.states),
            "transitions": len(req.transitions),
            "up_states": len(up_states),
            "failed_states": len(failed_states),
            "initial_state": initial_state,
        },
    }


@router.post("/validate")
def validate(req: MarkovRequest):
    return validate_model(req)


@router.post("/analyze")
def analyze(req: MarkovRequest):
    """Run CTMC or Erlang phase-type analysis with optional rate uncertainty."""
    validation = validate_model(req)
    if not validation["valid"]:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "MARKOV_VALIDATION",
                "message": "Resolve the Markov model issues before analysis.",
                "issues": validation["issues"],
            },
        )

    mc = MarkovChain()
    # ValueError from add_state/add_transition → 400 via the global handler.
    for s in req.states:
        mc.add_state(MarkovState(
            s.id, s.name, s.state_type, s.description,
            s.dwell_model, s.dwell_shape,
        ))
    for t in req.transitions:
        mc.add_transition(MarkovTransition(
            t.from_state, t.to_state, t.rate, t.label, t.rate_cv,
        ))

    initial = None
    if req.initial_state:
        initial = np.zeros(mc.n_states)
        initial[mc._state_index[req.initial_state]] = 1.0

    times = req.times
    if times is None:
        mttf = mc.mttf()
        t_max = mttf * 5 if mttf and np.isfinite(mttf) and mttf > 0 else 10000
        times = [t_max * i / 99 for i in range(100)]

    try:
        result = mc.analyze(times=times, initial=initial)
        for index, transition in enumerate(result.get('transitions', [])):
            transition['id'] = req.transitions[index].id or f"tr{index + 1}"
        has_rate_uncertainty = any(t.rate_cv > 0 for t in mc.transitions)
        if has_rate_uncertainty and req.uncertainty_samples > 0:
            mission_time = max(times) if times else None
            result['parameter_uncertainty'] = mc.analyze_rate_uncertainty(
                mission_time=mission_time,
                initial=initial,
                n_samples=req.uncertainty_samples,
                ci=req.uncertainty_ci,
                seed=req.uncertainty_seed,
            )
        elif has_rate_uncertainty:
            result['parameter_uncertainty'] = {
                'status': 'disabled',
                'reason': 'Set uncertainty_samples above zero to propagate rate CVs.',
                'warnings': [],
            }
        else:
            result['parameter_uncertainty'] = {
                'status': 'not_requested',
                'reason': 'Enter a transition-rate CV to propagate parameter uncertainty.',
                'warnings': [],
            }
        result['model_contract']['rate_uncertainty_status'] = (
            result['parameter_uncertainty']['status']
        )
        result['validation'] = validation
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    return result


@router.get("/examples")
def examples():
    """List available pre-built Markov models."""
    return {
        key: {
            'name': info['name'],
            'description': info['description'],
            'default_params': info['default_params'],
        }
        for key, info in EXAMPLE_MODELS.items()
    }


@router.get("/examples/{model_id}")
def get_example(model_id: str):
    """Get a pre-built example model with its full state/transition definition."""
    if model_id not in EXAMPLE_MODELS:
        raise HTTPException(status_code=404,
                            detail=f"Unknown model '{model_id}'. "
                                   f"Available: {list(EXAMPLE_MODELS)}")

    info = EXAMPLE_MODELS[model_id]
    mc = info['builder']()

    return {
        'name': info['name'],
        'description': info['description'],
        'states': [
            {'id': s.id, 'name': s.name, 'type': s.state_type,
             'description': s.description, 'dwell_model': s.dwell_model,
             'dwell_shape': s.effective_dwell_shape}
            for s in mc.states
        ],
        'transitions': [
            {'id': f"tr{index + 1}", 'from': t.from_state, 'to': t.to_state, 'rate': t.rate,
             'label': t.label, 'rate_cv': t.rate_cv}
            for index, t in enumerate(mc.transitions)
        ],
    }
