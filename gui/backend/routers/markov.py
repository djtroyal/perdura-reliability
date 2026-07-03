"""Markov chain reliability analysis router."""

import sys
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
    """Run Markov chain analysis (steady-state + time-dependent)."""
    if not req.states:
        raise HTTPException(status_code=400, detail="At least one state is required.")
    if not req.transitions:
        raise HTTPException(status_code=400, detail="At least one transition is required.")

    mc = MarkovChain()
    # ValueError from add_state/add_transition → 400 via the global handler.
    for s in req.states:
        mc.add_state(MarkovState(s.id, s.name, s.state_type, s.description))
    for t in req.transitions:
        mc.add_transition(MarkovTransition(t.from_state, t.to_state, t.rate, t.label))

    initial = None
    if req.initial_state and req.initial_state in mc._state_index:
        import numpy as np
        initial = np.zeros(mc.n_states)
        initial[mc._state_index[req.initial_state]] = 1.0

    times = req.times
    if times is None:
        mttf = mc.mttf()
        t_max = mttf * 5 if mttf and mttf > 0 else 10000
        times = [t_max * i / 99 for i in range(100)]

    try:
        result = mc.analyze(times=times, initial=initial)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    for key in ('availability_ss', 'unavailability_ss', 'mttf', 'mtbf', 'mut', 'mttr',
                'failure_frequency', 'repair_frequency'):
        v = result['system_params'].get(key)
        if v is not None:
            result['system_params'][key] = round(v, 8)

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
             'description': s.description}
            for s in mc.states
        ],
        'transitions': [
            {'from': t.from_state, 'to': t.to_state, 'rate': t.rate,
             'label': t.label}
            for t in mc.transitions
        ],
    }
