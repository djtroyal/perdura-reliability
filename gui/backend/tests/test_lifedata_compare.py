"""Contract tests for model-preserving LDA common-family comparisons."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

import numpy as np

from routers import life_data
from schemas import CompareRequest


def _request() -> CompareRequest:
    rng = np.random.default_rng(217)
    first = (90 * rng.weibull(2.1, 24)).tolist()
    second = (105 * rng.weibull(2.3, 24)).tolist()
    return CompareRequest(
        folios=[
            {"name": "Baseline", "failures": first},
            {"name": "Redesign", "failures": second},
        ],
        distribution="Weibull_2P",
        CI=0.95,
    )


def test_common_family_test_is_valid_when_all_fits_are_eligible():
    out = life_data.compare_folios(_request())

    assert out["test_status"] == "valid"
    assert out["test_reasons"] == []
    assert out["lr_test"] is not None
    assert out["pooled_fit"]["fit_eligible"] is True
    assert all(fit["fit_eligible"] for fit in out["folios"])
    assert all("BIC" in fit and "AD" in fit for fit in out["folios"])


class _FakeFit:
    def __init__(self, *, eligible: bool, reason: str = ""):
        self.loglik = -10.0
        self.AICc = 25.0
        self.BIC = 26.0
        self.AD = 0.2
        self.eta = 100.0
        self.beta = 2.0
        self.eta_lower = 80.0
        self.eta_upper = 120.0
        self.beta_lower = 1.5
        self.beta_upper = 2.5
        self.converged = eligible
        self.fit_eligible = eligible
        self.aicc_eligible = eligible
        self.eligibility_reasons = [] if eligible else [reason]
        self.fit_diagnostics = {"converged": eligible, "optimizer": "test"}


def test_common_family_lr_is_withheld_when_one_analysis_fit_is_ineligible(monkeypatch):
    calls = 0

    def fake_fitter(**_kwargs):
        nonlocal calls
        calls += 1
        return _FakeFit(
            eligible=calls != 2,
            reason="optimizer did not converge",
        )

    monkeypatch.setitem(life_data._FITTER_MAP, "Weibull_2P", fake_fitter)
    monkeypatch.setattr(life_data, "_contour_grid", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(life_data, "_compare_extras", lambda *_args, **_kwargs: {})

    out = life_data.compare_folios(_request())

    assert out["test_status"] == "withheld"
    assert out["lr_test"] is None
    assert out["folios"][1]["fit_eligible"] is False
    assert any("Redesign" in reason for reason in out["test_reasons"])
    assert any("optimizer did not converge" in reason for reason in out["test_reasons"])


def test_common_family_lr_is_withheld_when_pooled_fit_is_ineligible(monkeypatch):
    calls = 0

    def fake_fitter(**_kwargs):
        nonlocal calls
        calls += 1
        return _FakeFit(
            eligible=calls != 3,
            reason="pooled optimum is on a parameter boundary",
        )

    monkeypatch.setitem(life_data._FITTER_MAP, "Weibull_2P", fake_fitter)
    monkeypatch.setattr(life_data, "_contour_grid", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(life_data, "_compare_extras", lambda *_args, **_kwargs: {})

    out = life_data.compare_folios(_request())

    assert out["test_status"] == "withheld"
    assert out["lr_test"] is None
    assert out["pooled_fit"]["fit_eligible"] is False
    assert any(reason.startswith("Pooled data:") for reason in out["test_reasons"])


def test_failed_temporary_analysis_fit_returns_a_structured_withheld_result(monkeypatch):
    calls = 0

    def fake_fitter(**_kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise ValueError("internal stack detail /srv/private/model.py:417")
        return _FakeFit(eligible=True)

    monkeypatch.setitem(life_data._FITTER_MAP, "Weibull_2P", fake_fitter)
    monkeypatch.setattr(life_data, "_contour_grid", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(life_data, "_compare_extras", lambda *_args, **_kwargs: {})

    out = life_data.compare_folios(_request())

    failed = out["folios"][1]
    assert out["test_status"] == "withheld"
    assert out["lr_test"] is None
    assert failed["fit_eligible"] is False
    assert failed["log_likelihood"] is None
    assert failed["eligibility_reasons"] == ["temporary_fit_failed"]
    assert "internal stack detail" not in str(out)


def test_failed_temporary_pooled_fit_does_not_expose_exception_text(monkeypatch):
    calls = 0
    secret = "internal pooled trace /srv/private/optimizer.py:91"

    def fake_fitter(**_kwargs):
        nonlocal calls
        calls += 1
        if calls == 3:
            raise RuntimeError(secret)
        return _FakeFit(eligible=True)

    monkeypatch.setitem(life_data._FITTER_MAP, "Weibull_2P", fake_fitter)
    monkeypatch.setattr(life_data, "_contour_grid", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(life_data, "_compare_extras", lambda *_args, **_kwargs: {})

    out = life_data.compare_folios(_request())

    assert out["test_status"] == "withheld"
    assert out["pooled_fit"]["eligibility_reasons"] == [
        "temporary_pooled_fit_failed",
    ]
    assert secret not in str(out)
