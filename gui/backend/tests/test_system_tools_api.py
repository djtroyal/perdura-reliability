"""Diagram-connected system tools and initial-mixture contracts."""
import math
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from routers import system_tools as tools, markov
from schemas import MarkovRequest


def diagram(kind="rbd", **data):
    component = {"distribution": "exponential", "dist_params": {"lambda": .001}, **data}
    if kind == "rbd":
        nodes = [{"id":"s","type":"source","data":{}}, {"id":"c","type":"component","data":component}, {"id":"z","type":"sink","data":{}}]
        edges = [{"source":"s","target":"c"},{"source":"c","target":"z"}]
    else:
        nodes = [{"id":"top","type":"or","data":{}}, {"id":"c","type":"basic","data":component}]
        edges = [{"source":"top","target":"c"}]
    return tools.Diagram(kind=kind,nodes=nodes,edges=edges,source_signature="source-revision-7")


def test_rbd_and_fta_use_same_lifetimes_and_stable_export():
    for kind in ["rbd", "fta"]:
        model = diagram(kind)
        renewal = tools.analyze_renewal(tools.RenewalRequest(diagram=model))
        states = tools.analyze_states(tools.StateRequest(diagram=model))
        assert renewal["mttf"] == pytest.approx(1000)
        assert states["success_probability"] == pytest.approx(math.exp(-1))
        namespace = {}
        exec(states["python_expression"], namespace)
        assert namespace["R"](1000) == pytest.approx(states["success_probability"])
        assert namespace["f"](1000) == pytest.approx(.001*math.exp(-1))
        assert namespace["h"](1000) == pytest.approx(.001)
        assert states["csv"].startswith("state_id,c,success,probability")
        assert states["source_signature"] == "source-revision-7" and len(states["input_sha256"]) == 64
        model.overrides = {0: True}
        updated = tools.analyze_states(tools.StateRequest(diagram=model))
        assert updated["input_sha256"] != states["input_sha256"]
        assert updated["evaluated_overrides"] == {0: True}


def test_source_error_unexpanded_subsystem_and_dynamic_fta_fail_closed():
    for data in [{"sourceError": "adopted source is stale"}, {"linkedAnalysisId": "other"}, {"ccf_group": "shock"}]:
        with pytest.raises(HTTPException) as caught:
            tools.analyze_simulation(tools.SimulationRequest(diagram=diagram(**data)))
        assert caught.value.status_code == 422
    model = diagram("fta")
    model.nodes[0]["type"] = "pand"
    model.nodes.append({"id":"d","type":"basic","data":{"distribution":"exponential","dist_params":{"lambda":.001}}})
    model.edges.append({"source":"top","target":"d","order":1})
    model.edges[0]["order"] = 0
    with pytest.raises(HTTPException) as caught:
        tools.analyze_simulation(tools.SimulationRequest(diagram=model))
    assert "dynamic" in str(caught.value).lower()


def test_real_support_state_probability_is_not_silently_conditioned_or_clipped():
    model = diagram(distribution="normal", dist_params={"mu":1000,"sigma":1000})
    states = tools.analyze_states(tools.StateRequest(diagram=model))
    assert states["success_probability"] == pytest.approx(.5)
    namespace = {}; exec(states["python_expression"], namespace)
    assert namespace["R"](0) < 1
    with pytest.raises(HTTPException, match="conditioning"):
        tools.analyze_simulation(tools.SimulationRequest(diagram=model,replications=20))
    result = tools.analyze_simulation(tools.SimulationRequest(diagram=model,replications=20,condition_positive_lifetimes=True))
    assert 0 < result["availability"]["mean"] <= 1


def test_state_table_retains_tiny_failure_mass():
    model = diagram(dist_params={"lambda": 1e-23})
    states = tools.analyze_states(tools.StateRequest(diagram=model))
    assert states["rows"][0]["probability"] == pytest.approx(1e-20, rel=1e-12, abs=0)


def test_builder_initial_mixture_survives_markov_endpoint():
    built = tools.build_redundancy(tools.RedundancyRequest(mode="standby",total=3,coverage=.5,switching="common",repair_rate=0,switch_repair_rate=0))
    request = MarkovRequest(states=built["states"],transitions=built["transitions"],initial_probabilities=built["initial_probabilities"],times=[0,1000])
    result = markov.analyze(request)
    expected = math.exp(-1)*(1+.5+.5/2)
    assert result["time_dependent"][1]["reliability"] == pytest.approx(expected)
    assert result["system_params"]["mttf"] == pytest.approx(2000)
    assert not [issue for issue in result["validation"]["issues"] if issue["code"] == "UNREACHABLE_STATE"]
    for bad in [{"absent":1}, {next(iter(built["initial_probabilities"])):-1}, {next(iter(built["initial_probabilities"])):.9}]:
        with pytest.raises(ValidationError):
            MarkovRequest(states=built["states"],transitions=built["transitions"],initial_probabilities=bad)
    with pytest.raises(ValidationError):
        MarkovRequest(states=built["states"],transitions=built["transitions"],initial_state=built["states"][0]["id"],initial_probabilities=built["initial_probabilities"])


def test_zero_rate_builder_can_be_analyzed_as_absorbing():
    built = tools.build_redundancy(tools.RedundancyRequest(failure_rate=0))
    result = markov.analyze(MarkovRequest(states=built["states"],transitions=[],initial_probabilities=built["initial_probabilities"],times=[0,100]))
    assert [row["reliability"] for row in result["time_dependent"]] == [1,1]
    assert result["system_params"]["mttf"] is None


@pytest.mark.parametrize("field,value", [("replications",0),("horizon",-1),("repair_crews",1.5),("confidence",1),("seed",-1)])
def test_simulation_boundary_rejects_invalid_configuration(field,value):
    with pytest.raises(ValidationError):
        tools.SimulationRequest(diagram=diagram(),**{field:value})
