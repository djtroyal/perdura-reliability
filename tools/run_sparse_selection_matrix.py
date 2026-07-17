#!/usr/bin/env python3
"""Run reproducible sparse-selection validation profiles and emit JSON."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path

from reliability.Regression import sparse_selection_validation_matrix


PROFILES = {
    "pr": {
        "sample_feature_sizes": [(100, 20), (60, 100)],
        "correlations": [0.0, 0.9],
        "signal_multipliers": [0.5, 2.0],
        "n_replicates": 1,
        "test_size": 100,
        "n_pairs": 2,
        "n_lambdas": 3,
        "lambda_min_ratio": 0.1,
        "max_iter": 10000,
        "tol": 1e-5,
    },
    "nightly": {
        "sample_feature_sizes": [(100, 20), (60, 100)],
        "correlations": [0.0, 0.9],
        "signal_multipliers": [0.5, 2.0],
        "n_replicates": 30,
        "test_size": 300,
        "n_pairs": 5,
        "n_lambdas": 6,
        "lambda_min_ratio": 0.05,
        "max_iter": 3000,
        "tol": 1e-5,
    },
    "release": {
        "sample_feature_sizes": [(100, 20), (60, 100), (100, 500)],
        "correlations": [0.0, 0.9],
        "signal_multipliers": [0.5, 2.0],
        "n_replicates": 100,
        "test_size": 500,
        "n_pairs": 10,
        "n_lambdas": 8,
        "lambda_min_ratio": 0.05,
        "max_iter": 5000,
        "tol": 1e-6,
    },
}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Evaluate lasso/elastic-net support stability over reproducible "
            "null, sparse-signal, dimensionality, and correlation regimes."
        )
    )
    parser.add_argument("--profile", choices=PROFILES, default="pr")
    parser.add_argument("--seed", type=int, default=20260713)
    parser.add_argument("--replicates", type=int)
    parser.add_argument("--pairs", type=int)
    parser.add_argument("--lambdas", type=int)
    parser.add_argument("--model", choices=("lasso", "elastic_net"), default="lasso")
    parser.add_argument("--l1-ratio", type=float)
    parser.add_argument("--selection-threshold", type=float, default=0.9)
    parser.add_argument("--plug-in-pfer-target", type=float, default=1.0)
    parser.add_argument("--shard-count", type=int, default=1)
    parser.add_argument("--shard-index", type=int, default=0)
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Omit per-replicate details from the JSON artifact.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Write JSON to this path instead of standard output.",
    )
    return parser


def _wilson_interval(successes: int, total: int, z: float = 1.959964) -> list[float]:
    """Two-sided Wilson interval for a binomial Monte Carlo proportion."""
    estimate = successes / total
    z2 = z * z
    denominator = 1.0 + z2 / total
    center = (estimate + z2 / (2.0 * total)) / denominator
    radius = (
        z
        * math.sqrt(
            estimate * (1.0 - estimate) / total + z2 / (4.0 * total ** 2)
        )
        / denominator
    )
    return [max(0.0, center - radius), min(1.0, center + radius)]


def _classify_evidence(result: dict, profile: str) -> dict:
    """Attach truthful functional-versus-Monte-Carlo evidence labels."""
    cells = result["cells"]
    if profile == "pr":
        functional_ok = bool(cells) and all(
            cell["metrics"]["complete_replicate_rate"] == 1.0
            and cell["metrics"]["support_eligibility_rate"] == 1.0
            and cell["metrics"]["mean_plug_in_pfer_diagnostic"] <= 1.0 + 1e-12
            for cell in cells
        )
        for cell in cells:
            cell["evidence"] = {
                "classification": "functional_guard",
                "performance_acceptance_applied": False,
            }
        return {
            "role": "deterministic_functional_guard",
            "status": "pass" if functional_ok else "fail",
            "performance_acceptance_applied": False,
            "note": (
                "The PR seed corpus checks execution, q-budgeting, convergence, "
                "and serialization. It is not Monte Carlo performance evidence."
            ),
        }

    if not cells:
        return {
            "role": "monte_carlo_acceptance",
            "status": "deficient",
            "performance_acceptance_applied": True,
            "note": "The requested shard contains no matrix cells.",
        }

    counts = {"accepted": 0, "deficient": 0, "inconclusive": 0,
              "characterization_only": 0}
    for cell in cells:
        total = int(cell["n_replicates"])
        metrics = cell["metrics"]
        complete = int(round(metrics["complete_replicate_rate"] * total))
        completion_interval = _wilson_interval(complete, total)
        convergence_status = (
            "deficient" if completion_interval[1] < 0.95
            else "inconclusive" if completion_interval[0] < 0.90
            else "accepted"
        )

        if cell["support_mode"] == "null":
            false_selections = total - int(round(
                metrics["exact_support_rate"] * total))
            interval = _wilson_interval(false_selections, total)
            method_status = (
                "accepted" if interval[1] <= 0.10
                else "deficient" if interval[0] > 0.10
                else "inconclusive"
            )
            criterion = {
                "metric": "probability_of_any_false_selection",
                "estimate": false_selections / total,
                "wilson_95": interval,
                "acceptance_target": "upper Wilson endpoint <= 0.10",
            }
        elif float(cell["signal_multiplier"]) >= 2.0:
            exact = int(round(metrics["exact_support_rate"] * total))
            interval = _wilson_interval(exact, total)
            method_status = (
                "accepted" if interval[0] >= 0.70
                else "deficient" if interval[1] < 0.70
                else "inconclusive"
            )
            criterion = {
                "metric": "exact_support_recovery_probability",
                "estimate": exact / total,
                "wilson_95": interval,
                "acceptance_target": "lower Wilson endpoint >= 0.70",
            }
        else:
            method_status = "characterization_only"
            criterion = {
                "metric": "near_detection_boundary_characterization",
                "acceptance_target": None,
            }

        if convergence_status == "deficient":
            classification = "deficient"
        elif method_status == "characterization_only":
            classification = method_status
        elif convergence_status == "inconclusive" or method_status == "inconclusive":
            classification = "inconclusive"
        else:
            classification = method_status
        counts[classification] += 1
        cell["evidence"] = {
            "classification": classification,
            "criterion": criterion,
            "completion_probability_wilson_95": completion_interval,
            "completion_target": 0.95,
        }

    if counts["deficient"]:
        status = "deficient"
    elif counts["inconclusive"]:
        status = "inconclusive"
    elif counts["accepted"]:
        status = "accepted"
    else:
        status = "characterization_only"
    return {
        "role": "monte_carlo_acceptance",
        "status": status,
        "performance_acceptance_applied": True,
        "cell_classification_counts": counts,
        "scope": (
            "this shard"
            if result["configuration"]["shard_count"] > 1
            else "full matrix"
        ),
    }


def main() -> int:
    args = _parser().parse_args()
    config = dict(PROFILES[args.profile])
    if args.replicates is not None:
        config["n_replicates"] = args.replicates
    if args.pairs is not None:
        config["n_pairs"] = args.pairs
    if args.lambdas is not None:
        config["n_lambdas"] = args.lambdas

    result = sparse_selection_validation_matrix(
        **config,
        model=args.model,
        l1_ratio=args.l1_ratio,
        selection_threshold=args.selection_threshold,
        plug_in_pfer_target=args.plug_in_pfer_target,
        random_seed=args.seed,
        include_replicates=not args.summary_only,
        shard_count=args.shard_count,
        shard_index=args.shard_index,
    )
    result["validation_profile"] = args.profile
    result["evidence_classification"] = _classify_evidence(result, args.profile)
    result["provenance"] = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "tool": "tools/run_sparse_selection_matrix.py",
        "validation_profile": args.profile,
    }
    encoded = json.dumps(result, indent=2, allow_nan=False) + "\n"

    if args.output is None:
        print(encoded, end="")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    return 1 if result["evidence_classification"]["status"] in {
        "fail", "deficient"
    } else 0


if __name__ == "__main__":
    raise SystemExit(main())
