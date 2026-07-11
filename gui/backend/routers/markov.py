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


@router.post("/analyze")
def analyze(req: MarkovRequest):
    """Run CTMC or Erlang phase-type analysis with optional rate uncertainty."""
    if not req.states:
        raise HTTPException(status_code=400, detail="At least one state is required.")
    if not req.transitions:
        raise HTTPException(status_code=400, detail="At least one transition is required.")

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
        if req.initial_state not in mc._state_index:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown initial state '{req.initial_state}'.",
            )
        initial = np.zeros(mc.n_states)
        initial[mc._state_index[req.initial_state]] = 1.0

    times = req.times
    if times is None:
        mttf = mc.mttf()
        t_max = mttf * 5 if mttf and np.isfinite(mttf) and mttf > 0 else 10000
        times = [t_max * i / 99 for i in range(100)]
    elif len(times) > 2000:
        raise HTTPException(
            status_code=400,
            detail="At most 2,000 transient time points are supported.",
        )

    try:
        result = mc.analyze(times=times, initial=initial)
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
            {'from': t.from_state, 'to': t.to_state, 'rate': t.rate,
             'label': t.label, 'rate_cv': t.rate_cv}
            for t in mc.transitions
        ],
    }
