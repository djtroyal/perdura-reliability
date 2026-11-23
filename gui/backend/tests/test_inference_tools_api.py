"""HTTP contracts for explicit-design testing tools."""
import sys
from pathlib import Path
import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'src'))
from routers import inference_tools
app = FastAPI()
app.include_router(inference_tools.router, prefix='/inference-tools')
@app.exception_handler(ValueError)
def invalid(request: Request, error: ValueError):
    return JSONResponse({'detail': str(error)}, status_code=400)
client = TestClient(app)
@pytest.mark.parametrize('route,payload,field', [
    ('mtbf-interval', {'failures':0,'total_exposure':800,'sides':'lower'}, 'mtbf_lower'),
    ('binomial-interval', {'trials':20,'count':20,'sides':'lower'}, 'lower'),
    ('normal-mean-interval', {'mean':100,'standard_deviation':10,'sample_size':31}, 'lower'),
    ('discrete-probability', {'sample_size':30,'probability':.05,'threshold':2}, 'probability_accept'),
    ('bernoulli-sprt', {'good_probability':.01,'bad_probability':.1,'horizon':10}, 'oc_curve'),
    ('exponential-sprt', {'good_mtbf':1000,'bad_mtbf':100,'horizon':10,'simulations':200,'oc_points':3}, 'oc_curve'),
    ('growth-plan', {'current_test_time':1000,'current_mtbf':50,'target_mtbf':110,'growth_rate':.23,
                     'baseline_basis':'initial_phase_average','phase_durations':[1500,2500,2000,3000]}, 'phase_table'),
])
def test_endpoints_return_serializable_evidence(route,payload,field):
    result=client.post('/inference-tools/'+route,json=payload)
    assert result.status_code==200,result.text
    assert field in result.json()
    assert 'NaN' not in result.text and 'Infinity' not in result.text
@pytest.mark.parametrize('route,payload', [
    ('bernoulli-sprt', {'good_probability':.01,'bad_probability':.1,'alpha':.8,'beta':.8}),
    ('exponential-sprt', {'good_mtbf':100,'bad_mtbf':100}),
    ('mtbf-interval', {'failures':0,'total_exposure':800,'termination':'failure'}),
    ('normal-mean-interval', {'mean':100,'standard_deviation':10,'sample_size':1}),
    ('discrete-probability', {'sample_size':20,'model':'hypergeometric','lot_size':10,'lot_defects':5}),
    ('discrete-probability', {'sample_size':20,'model':'hypergeometric'}),
    ('discrete-probability', {'sample_size':20,'event':'between'}),
])
def test_invalid_designs_return_actionable_errors(route,payload):
    result=client.post('/inference-tools/'+route,json=payload)
    assert result.status_code==400
    assert isinstance(result.json()['detail'],str)
def test_request_models_do_not_silently_ignore_wrong_fields():
    response=client.post('/inference-tools/mtbf-interval',json={'failures':1,'total_exposure':100,'failure_terminated':True})
    assert response.status_code==422
