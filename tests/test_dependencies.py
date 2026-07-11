"""Reference checks for common-cause dependency decomposition."""

import pytest

from reliability.Dependencies import beta_factor_decomposition


def test_beta_factor_decomposition_preserves_member_marginals():
    result = beta_factor_decomposition(
        {"A": 0.1, "B": 0.1},
        {
            "A": {"group": "G", "beta": 0.2},
            "B": {"group": "G", "beta": 0.2},
        },
    )
    q_common = result["common_cause_probabilities"]["G"]
    for member in ("A", "B"):
        q_individual = result["individual_failure_probabilities"][member]
        reconstructed = 1 - (1 - q_common) * (1 - q_individual)
        assert reconstructed == pytest.approx(0.1)
    assert result["diagnostics"]["model"] == "beta_factor"


def test_beta_factor_rejects_nonexchangeable_group():
    with pytest.raises(ValueError, match="equal marginal"):
        beta_factor_decomposition(
            {"A": 0.1, "B": 0.2},
            {
                "A": {"group": "G", "beta": 0.1},
                "B": {"group": "G", "beta": 0.1},
            },
        )


def test_single_member_common_cause_group_is_rejected():
    with pytest.raises(ValueError, match="at least two"):
        beta_factor_decomposition(
            {"A": 0.1}, {"A": {"group": "G", "beta": 0.1}}
        )
