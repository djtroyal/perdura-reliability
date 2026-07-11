"""Dependency models shared by fault-tree and RBD calculations.

The beta-factor model implemented here represents a common-cause group with
one latent shock event plus one independent failure event per member.  The
latent variables are independent, while the member failures are dependent
because every member includes the same shock event.  This representation can
be evaluated exactly by the Boolean reliability engine.

For a member with requested marginal failure probability ``q`` and beta
factor ``beta``::

    q_common = beta * q
    q_individual = (q - q_common) / (1 - q_common)

The second expression preserves the requested marginal exactly:
``q = 1 - (1-q_common)*(1-q_individual)``.  A beta-factor group therefore
requires exchangeable members with equal marginal failure probabilities.
"""

from collections import defaultdict
import math


def beta_factor_decomposition(failure_probabilities, assignments,
                              *, relative_tolerance=1e-6,
                              absolute_tolerance=1e-12):
    """Decompose marginal failures into independent and common-cause events.

    Parameters
    ----------
    failure_probabilities : mapping[hashable, float]
        Requested marginal failure probability for every modeled member.
    assignments : mapping[hashable, mapping]
        Members participating in a group.  Each value must contain ``group``
        and ``beta``.  A member may belong to at most one group.

    Returns
    -------
    dict
        ``individual_failure_probabilities``, ``common_cause_probabilities``,
        ``membership``, and a JSON-ready ``diagnostics`` block.

    Notes
    -----
    This is a probability-level beta-factor model for one all-members shock
    per group.  It does not implement partial-group multiplicities (MGL or
    alpha-factor models), staggered repair, or uncertainty in beta.
    """
    probabilities = {}
    for member, value in failure_probabilities.items():
        q = float(value)
        if not math.isfinite(q) or not 0.0 <= q <= 1.0:
            raise ValueError(
                f"Failure probability for {member!r} must be finite and between 0 and 1."
            )
        probabilities[member] = q

    individual = dict(probabilities)
    membership = {}
    grouped = defaultdict(list)
    betas = defaultdict(list)

    for member, assignment in assignments.items():
        if member not in probabilities:
            raise ValueError(
                f"Common-cause assignment references unknown member {member!r}."
            )
        group = str(assignment.get("group", "")).strip()
        if not group:
            raise ValueError(
                f"Common-cause member {member!r} requires a non-empty group id."
            )
        try:
            beta = float(assignment.get("beta"))
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"Common-cause group {group!r} requires a numeric beta factor."
            ) from exc
        if not math.isfinite(beta) or not 0.0 <= beta <= 1.0:
            raise ValueError(
                f"Beta factor for common-cause group {group!r} must be between 0 and 1."
            )
        membership[member] = group
        grouped[group].append(member)
        betas[group].append(beta)

    common = {}
    group_diagnostics = []
    for group in sorted(grouped):
        members = sorted(set(grouped[group]), key=str)
        if len(members) < 2:
            raise ValueError(
                f"Common-cause group {group!r} must contain at least two distinct members."
            )

        beta_values = betas[group]
        beta = beta_values[0]
        if any(not math.isclose(value, beta, rel_tol=0.0,
                                abs_tol=absolute_tolerance)
               for value in beta_values[1:]):
            raise ValueError(
                f"All members of common-cause group {group!r} must use the same beta factor."
            )

        marginals = [probabilities[member] for member in members]
        q_reference = marginals[0]
        if any(not math.isclose(q, q_reference,
                                rel_tol=relative_tolerance,
                                abs_tol=absolute_tolerance)
               for q in marginals[1:]):
            raise ValueError(
                f"Beta-factor group {group!r} requires equal marginal failure "
                "probabilities (exchangeable members). Use separate groups or "
                "align the member reliability models."
            )

        q_common = beta * q_reference
        common[group] = q_common
        for member in members:
            q = probabilities[member]
            if q_common >= 1.0:
                q_individual = 0.0
            else:
                q_individual = (q - q_common) / (1.0 - q_common)
            # Only tiny round-off excursions are possible after the checks.
            individual[member] = max(0.0, min(1.0, q_individual))

        preserved = [
            1.0 - (1.0 - q_common) * (1.0 - individual[member])
            for member in members
        ]
        group_diagnostics.append({
            "group_id": group,
            "members": members,
            "member_count": len(members),
            "beta": beta,
            "common_cause_probability": q_common,
            "individual_failure_probability": individual[members[0]],
            "requested_marginal_probability": q_reference,
            "reconstructed_marginal_probabilities": preserved,
        })

    if group_diagnostics:
        model = "beta_factor"
        assumption = (
            "Independent latent member failures plus one shared all-members "
            "common-cause shock per beta-factor group."
        )
    else:
        model = "independent"
        assumption = "All modeled basic/component events are statistically independent."

    return {
        "individual_failure_probabilities": individual,
        "common_cause_probabilities": common,
        "membership": membership,
        "diagnostics": {
            "model": model,
            "assumption": assumption,
            "groups": group_diagnostics,
            "limitations": (
                "Beta-factor groups require exchangeable marginals and model one "
                "shock that affects every group member; partial-group MGL/alpha-factor "
                "multiplicities and beta uncertainty are not included."
                if group_diagnostics else
                "No common-cause, conditional, load-sharing, or environmental dependence is modeled."
            ),
        },
    }
