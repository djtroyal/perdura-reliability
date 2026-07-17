#!/usr/bin/env python3
"""Validate the scientific model-assurance inventory.

The default mode validates structure and prevents unsupported certification
claims.  ``--strict`` additionally requires every inventoried calculation domain
and model to be certified with no blockers; it is the release-certification gate,
not the incremental-development gate.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MATRIX = ROOT / "docs" / "audit" / "model-assurance-matrix.json"
VALID_STATUSES = {"verified", "verified_with_caveats", "needs_revision", "not_assessed"}
CERTIFIED = {"verified", "verified_with_caveats"}
VALID_EVIDENCE_KINDS = {
    "published_benchmark",
    "independent_identity",
    "estimating_equation",
    "simulation_calibration",
    "numerical_stress",
    "integration_test",
    "consistency_test",
    "saved_artifact",
}
VALID_INDEPENDENCE = {"independent", "consistency", "integration"}
VALID_LAYERS = {
    "core", "backend", "frontend", "persistence", "plot", "export", "report",
}
VALID_PROFILES = {"unit", "pr", "release", "analytic", "manual"}
VALID_RUN_STATUSES = {"passed", "failed", "not_run"}
VALID_APPLICABILITY = {"supported", "not_applicable"}
VALIDATION_KINDS = {
    "published_benchmarks": "published_benchmark",
    "independent_identities": "independent_identity",
    "estimating_equation_checks": "estimating_equation",
    "calibration_evidence": "simulation_calibration",
    "numerical_stress": "numerical_stress",
    "end_to_end": "integration_test",
}
INDEPENDENT_VALIDATION_FIELDS = {
    "published_benchmarks", "independent_identities",
    "estimating_equation_checks", "calibration_evidence", "numerical_stress",
}


def _nonempty_list(value) -> bool:
    return isinstance(value, list) and bool(value)


def _repo_reference_path(reference: Any) -> Path | None:
    """Resolve the file portion of a repository evidence reference.

    Implementation and evidence references may append a Python symbol or a
    pytest node id after ``::``.  Certification evidence must remain inside
    the repository so an arbitrary absolute path cannot satisfy the gate.
    """
    if not isinstance(reference, str) or not reference.strip():
        return None
    raw_path = reference.split("::", 1)[0].strip()
    if not raw_path:
        return None
    candidate = Path(raw_path)
    if candidate.is_absolute():
        return None
    resolved = (ROOT / candidate).resolve()
    try:
        resolved.relative_to(ROOT.resolve())
    except ValueError:
        return None
    return resolved


def _validate_file_references(
    references: Any, *, model_id: str, field: str, errors: list[str],
) -> None:
    if not isinstance(references, list):
        errors.append(f"model {model_id}: {field} must be a list")
        return
    for reference in references:
        path = _repo_reference_path(reference)
        if path is None:
            errors.append(
                f"model {model_id}: {field} has invalid repository reference "
                f"{reference!r}"
            )
        elif not path.is_file():
            errors.append(
                f"model {model_id}: {field} reference does not exist: "
                f"{reference!r}"
            )


def _string_list(value: Any, *, allow_empty: bool = True) -> bool:
    return (
        isinstance(value, list)
        and (allow_empty or bool(value))
        and all(isinstance(item, str) and bool(item.strip()) for item in value)
        and len(value) == len(set(value))
    )


def _validate_evidence_registry(
    evidence: Any,
    *,
    model_id: str,
    claim_ids: set[str],
    required_regimes: set[str],
    errors: list[str],
) -> dict[str, dict]:
    """Validate and index schema-v2 typed evidence records."""
    if not isinstance(evidence, list):
        errors.append(f"model {model_id}: evidence must be a list")
        return {}
    records: dict[str, dict] = {}
    for record in evidence:
        if not isinstance(record, dict):
            errors.append(f"model {model_id}: every evidence entry must be an object")
            continue
        evidence_id = record.get("id")
        if not isinstance(evidence_id, str) or not evidence_id.strip():
            errors.append(f"model {model_id}: evidence entry has invalid id")
            continue
        if evidence_id in records:
            errors.append(f"model {model_id}: duplicate evidence id {evidence_id!r}")
            continue
        records[evidence_id] = record

        procedure_id = record.get("procedure_id")
        if procedure_id != model_id:
            errors.append(
                f"model {model_id}: evidence {evidence_id} procedure_id must "
                f"equal its owning model id, got {procedure_id!r}"
            )

        path_reference = record.get("path")
        if isinstance(path_reference, str) and "::" in path_reference:
            errors.append(
                f"model {model_id}: evidence {evidence_id} must put a node in "
                "the separate node field"
            )
        path = _repo_reference_path(path_reference)
        if path is None:
            errors.append(
                f"model {model_id}: evidence {evidence_id} has invalid "
                "repository path"
            )
        elif not path.is_file():
            errors.append(
                f"model {model_id}: evidence {evidence_id} path does not exist: "
                f"{path_reference!r}"
            )
        node = record.get("node")
        if node is not None and (
                not isinstance(node, str) or not node.strip()):
            errors.append(
                f"model {model_id}: evidence {evidence_id} node must be a "
                "non-empty string when supplied"
            )
        kind = record.get("kind")
        if kind not in VALID_EVIDENCE_KINDS:
            errors.append(
                f"model {model_id}: evidence {evidence_id} has invalid kind {kind!r}"
            )
        independence = record.get("independence")
        if independence not in VALID_INDEPENDENCE:
            errors.append(
                f"model {model_id}: evidence {evidence_id} has invalid "
                f"independence {independence!r}"
            )
        mapped_claims = record.get("claim_ids")
        if not _string_list(mapped_claims, allow_empty=False):
            errors.append(
                f"model {model_id}: evidence {evidence_id} claim_ids must be a "
                "non-empty unique string list"
            )
            mapped_claims = []
        unknown_claims = sorted(set(mapped_claims) - claim_ids)
        if unknown_claims:
            errors.append(
                f"model {model_id}: evidence {evidence_id} maps unknown claims "
                f"{unknown_claims}"
            )
        regimes = record.get("regimes")
        if not _string_list(regimes, allow_empty=False):
            errors.append(
                f"model {model_id}: evidence {evidence_id} regimes must be a "
                "non-empty unique string list"
            )
            regimes = []
        unknown_regimes = sorted(set(regimes) - required_regimes)
        if unknown_regimes:
            errors.append(
                f"model {model_id}: evidence {evidence_id} maps unknown regimes "
                f"{unknown_regimes}"
            )
        layers = record.get("layers")
        if not _string_list(layers, allow_empty=False):
            errors.append(
                f"model {model_id}: evidence {evidence_id} layers must be a "
                "non-empty unique string list"
            )
            layers = []
        invalid_layers = sorted(set(layers) - VALID_LAYERS)
        if invalid_layers:
            errors.append(
                f"model {model_id}: evidence {evidence_id} has invalid layers "
                f"{invalid_layers}"
            )
        run_status = record.get("run_status")
        if run_status not in VALID_RUN_STATUSES:
            errors.append(
                f"model {model_id}: evidence {evidence_id} has invalid "
                f"run_status {run_status!r}"
            )
        profile = record.get("profile")
        if profile is not None and profile not in VALID_PROFILES:
            errors.append(
                f"model {model_id}: evidence {evidence_id} has invalid "
                f"profile {profile!r}"
            )
        if kind == "simulation_calibration" and profile is None:
            errors.append(
                f"model {model_id}: simulation evidence {evidence_id} requires "
                "a profile"
            )
    return records


def _load_model_inventory(path: Path, errors: list[str]) -> set[str]:
    """Load model ids from a CSV or JSON assurance inventory."""
    if not path.is_file():
        errors.append(f"model inventory source does not exist: {path}")
        return set()
    try:
        if path.suffix.lower() == ".csv":
            with path.open(newline="", encoding="utf-8") as handle:
                reader = csv.DictReader(handle)
                if not reader.fieldnames or "model_id" not in reader.fieldnames:
                    errors.append(
                        "model inventory CSV must contain a model_id column"
                    )
                    return set()
                values = [row.get("model_id", "").strip() for row in reader]
        elif path.suffix.lower() == ".json":
            payload = json.loads(path.read_text(encoding="utf-8"))
            entries = payload.get("models") if isinstance(payload, dict) else payload
            if not isinstance(entries, list):
                errors.append(
                    "model inventory JSON must be a list or contain a models list"
                )
                return set()
            values = [
                entry.get("id", "").strip()
                if isinstance(entry, dict) else str(entry).strip()
                for entry in entries
            ]
        else:
            errors.append("model inventory source must be CSV or JSON")
            return set()
    except (OSError, csv.Error, json.JSONDecodeError) as exc:
        errors.append(f"could not read model inventory source: {exc}")
        return set()
    if any(not value for value in values):
        errors.append("model inventory source contains an empty model id")
    nonempty = [value for value in values if value]
    if len(nonempty) != len(set(nonempty)):
        errors.append("model inventory source contains duplicate model ids")
    if not nonempty:
        errors.append("model inventory source must contain at least one model id")
    return set(nonempty)


def validate(matrix_path: Path, *, strict: bool = False) -> dict:
    matrix = json.loads(matrix_path.read_text(encoding="utf-8"))
    errors: list[str] = []
    warnings: list[str] = []

    if matrix.get("schema_version") != 2:
        errors.append("schema_version must be 2")

    inventory_complete = matrix.get("model_inventory_complete")
    if not isinstance(inventory_complete, bool):
        errors.append("model_inventory_complete must be a boolean")
    elif not inventory_complete:
        warnings.append(
            "per-model inventory is incomplete; global scientific "
            "certification is not permitted"
        )

    inventory_path = ROOT / matrix.get("inventory_source", "")
    if not inventory_path.is_file():
        errors.append(f"inventory source does not exist: {inventory_path}")
        inventory_domains: set[str] = set()
    else:
        with inventory_path.open(newline="", encoding="utf-8") as handle:
            inventory_domains = {row["api_domain"] for row in csv.DictReader(handle)}

    domains = matrix.get("domains")
    if not isinstance(domains, list):
        errors.append("domains must be a list")
        domains = []
    domain_ids = [row.get("id") for row in domains if isinstance(row, dict)]
    if len(domain_ids) != len(set(domain_ids)):
        errors.append("domain ids must be unique")
    missing_domains = sorted(inventory_domains - set(domain_ids))
    extra_domains = sorted(set(domain_ids) - inventory_domains)
    if missing_domains:
        errors.append(f"assurance inventory omits domains: {missing_domains}")
    if extra_domains:
        errors.append(f"assurance inventory has unknown domains: {extra_domains}")
    for row in domains:
        if not isinstance(row, dict):
            errors.append("each domain entry must be an object")
            continue
        status = row.get("status")
        if status not in VALID_STATUSES:
            errors.append(f"domain {row.get('id')}: invalid status {status!r}")
        if status not in CERTIFIED:
            warnings.append(f"domain {row.get('id')} is {status}")

    models = matrix.get("models")
    if not isinstance(models, list) or not models:
        errors.append("models must be a non-empty list")
        models = []
    model_ids = [row.get("id") for row in models if isinstance(row, dict)]
    if len(model_ids) != len(set(model_ids)):
        errors.append("model ids must be unique")

    inventoried_model_ids: set[str] | None = None
    if inventory_complete is True:
        source_reference = matrix.get("model_inventory_source")
        source_path = _repo_reference_path(source_reference)
        if source_path is None:
            errors.append(
                "model_inventory_complete requires a repository-relative "
                "model_inventory_source"
            )
        else:
            inventoried_model_ids = _load_model_inventory(source_path, errors)
            missing_models = sorted(inventoried_model_ids - set(model_ids))
            extra_models = sorted(set(model_ids) - inventoried_model_ids)
            if missing_models:
                errors.append(
                    f"assurance matrix omits inventoried models: {missing_models}"
                )
            if extra_models:
                errors.append(
                    f"assurance matrix has models absent from model inventory: "
                    f"{extra_models}"
                )

    global_evidence_ids: dict[str, str] = {}
    evidence_location_owners: dict[tuple[str, str], str] = {}

    for model in models:
        if not isinstance(model, dict):
            errors.append("each model entry must be an object")
            continue
        model_id = model.get("id", "<missing>")
        status = model.get("status")
        if status not in VALID_STATUSES:
            errors.append(f"model {model_id}: invalid status {status!r}")
            continue
        if model.get("domain") not in inventory_domains:
            errors.append(f"model {model_id}: unknown domain {model.get('domain')!r}")
        for field in ("implementation", "authorities", "claims", "required_regimes"):
            if not _nonempty_list(model.get(field)):
                errors.append(f"model {model_id}: {field} must be non-empty")
        _validate_file_references(
            model.get("implementation"), model_id=model_id,
            field="implementation", errors=errors,
        )

        required_regime_values = model.get("required_regimes", [])
        if not _string_list(required_regime_values, allow_empty=False):
            errors.append(
                f"model {model_id}: required_regimes must contain unique "
                "non-empty strings"
            )
            required_regime_values = [
                value for value in required_regime_values
                if isinstance(value, str) and value.strip()
            ] if isinstance(required_regime_values, list) else []
        required_regimes = set(required_regime_values)

        claims = model.get("claims", [])
        claim_ids = [
            claim.get("id") for claim in claims if isinstance(claim, dict)
        ]
        if len(claim_ids) != len(set(claim_ids)):
            errors.append(f"model {model_id}: claim ids must be unique")
        evidence_applicability_links: dict[str, set[tuple[str, str]]] = {}
        for claim in claims:
            if not isinstance(claim, dict):
                errors.append(f"model {model_id}: every claim must be an object")
                continue
            for field in ("id", "formula", "source_locator"):
                if not claim.get(field):
                    errors.append(f"model {model_id}: claim missing {field}")

        evidence_records = _validate_evidence_registry(
            model.get("evidence"), model_id=model_id,
            claim_ids=set(claim_ids), required_regimes=required_regimes,
            errors=errors,
        )
        for evidence_id, evidence in evidence_records.items():
            previous_id_owner = global_evidence_ids.get(evidence_id)
            if previous_id_owner is not None and previous_id_owner != model_id:
                errors.append(
                    f"model {model_id}: evidence id {evidence_id!r} is already "
                    f"owned by procedure {previous_id_owner}"
                )
            else:
                global_evidence_ids[evidence_id] = model_id

            # A path/node pair is the smallest executable evidence unit in the
            # schema.  Reusing it for another statistical procedure permits a
            # passing Crow check, for example, to masquerade as MCF evidence.
            # Shared files remain allowed when they expose distinct test or
            # report nodes for each procedure.
            path = evidence.get("path")
            node = evidence.get("node") or "<whole-file>"
            if isinstance(path, str):
                location = (path, node)
                previous_location_owner = evidence_location_owners.get(location)
                if (previous_location_owner is not None
                        and previous_location_owner != model_id):
                    errors.append(
                        f"model {model_id}: evidence location {path}::{node} "
                        "is already owned by procedure "
                        f"{previous_location_owner}; use a procedure-specific "
                        "evidence node"
                    )
                else:
                    evidence_location_owners[location] = model_id

        required_integration_layers = model.get("required_integration_layers")
        if not _string_list(required_integration_layers, allow_empty=False):
            errors.append(
                f"model {model_id}: required_integration_layers must be a "
                "non-empty unique string list"
            )
            required_integration_layers = []
        invalid_required_layers = sorted(
            set(required_integration_layers) - VALID_LAYERS)
        if invalid_required_layers:
            errors.append(
                f"model {model_id}: required_integration_layers contains "
                f"invalid layers {invalid_required_layers}"
            )

        for claim in claims:
            if not isinstance(claim, dict):
                continue
            claim_id = claim.get("id")
            applicability = claim.get("applicability")
            if not isinstance(applicability, list):
                errors.append(
                    f"model {model_id}: claim {claim_id} applicability must "
                    "be a list"
                )
                applicability = []
            seen_regimes: set[str] = set()
            supported_regimes: set[str] = set()
            for entry in applicability:
                if not isinstance(entry, dict):
                    errors.append(
                        f"model {model_id}: claim {claim_id} applicability "
                        "entries must be objects"
                    )
                    continue
                regime = entry.get("regime")
                if regime not in required_regimes:
                    errors.append(
                        f"model {model_id}: claim {claim_id} applicability "
                        f"uses unknown regime {regime!r}"
                    )
                    continue
                if regime in seen_regimes:
                    errors.append(
                        f"model {model_id}: claim {claim_id} repeats "
                        f"applicability regime {regime!r}"
                    )
                seen_regimes.add(regime)
                applicability_status = entry.get("status")
                if applicability_status not in VALID_APPLICABILITY:
                    errors.append(
                        f"model {model_id}: claim {claim_id} regime {regime} "
                        f"has invalid applicability {applicability_status!r}"
                    )
                reason = entry.get("reason")
                if not isinstance(reason, str) or not reason.strip():
                    errors.append(
                        f"model {model_id}: claim {claim_id} regime {regime} "
                        "requires a reason"
                    )
                evidence_ids = entry.get("evidence_ids", [])
                if not _string_list(evidence_ids):
                    errors.append(
                        f"model {model_id}: claim {claim_id} regime {regime} "
                        "evidence_ids must be a unique string list"
                    )
                    evidence_ids = []
                if applicability_status == "not_applicable" and evidence_ids:
                    errors.append(
                        f"model {model_id}: claim {claim_id} regime {regime} "
                        "is not_applicable but cites evidence"
                    )
                if applicability_status == "supported":
                    supported_regimes.add(regime)
                for evidence_id in evidence_ids:
                    evidence = evidence_records.get(evidence_id)
                    if evidence is None:
                        errors.append(
                            f"model {model_id}: claim {claim_id} regime {regime} "
                            f"references unknown evidence {evidence_id!r}"
                        )
                        continue
                    evidence_applicability_links.setdefault(
                        evidence_id, set()).add((claim_id, regime))
                    if claim_id not in evidence.get("claim_ids", []):
                        errors.append(
                            f"model {model_id}: evidence {evidence_id} does not "
                            f"map back to claim {claim_id}"
                        )
                    if regime not in evidence.get("regimes", []):
                        errors.append(
                            f"model {model_id}: evidence {evidence_id} does not "
                            f"map back to regime {regime}"
                        )
                if status in CERTIFIED and applicability_status == "supported":
                    if not evidence_ids:
                        errors.append(
                            f"model {model_id}: certified claim {claim_id} "
                            f"regime {regime} lacks mapped evidence"
                        )
                    independent_passed = [
                        evidence_id for evidence_id in evidence_ids
                        if evidence_records.get(evidence_id, {}).get("independence")
                        == "independent"
                        and evidence_records.get(evidence_id, {}).get("run_status")
                        == "passed"
                        and (
                            evidence_records.get(evidence_id, {}).get("kind")
                            != "simulation_calibration"
                            or evidence_records.get(evidence_id, {}).get("profile")
                            == "release"
                        )
                    ]
                    if not independent_passed:
                        errors.append(
                            f"model {model_id}: certified claim {claim_id} "
                            f"regime {regime} lacks passed independent evidence"
                        )
            if status in CERTIFIED:
                if not supported_regimes:
                    errors.append(
                        f"model {model_id}: certified claim {claim_id} has no "
                        "supported regime"
                    )
                missing_applicability = sorted(required_regimes - seen_regimes)
                if missing_applicability:
                    errors.append(
                        f"model {model_id}: certified claim {claim_id} has no "
                        f"applicability decision for {missing_applicability}"
                    )

        for evidence_id, evidence in evidence_records.items():
            links = evidence_applicability_links.get(evidence_id, set())
            linked_claims = {claim_id for claim_id, _ in links}
            linked_regimes = {regime for _, regime in links}
            declared_claims = set(evidence.get("claim_ids", []))
            declared_regimes = set(evidence.get("regimes", []))
            if declared_claims != linked_claims:
                errors.append(
                    f"model {model_id}: evidence {evidence_id} claim mapping "
                    f"does not match applicability links; declared "
                    f"{sorted(declared_claims)}, linked {sorted(linked_claims)}"
                )
            if declared_regimes != linked_regimes:
                errors.append(
                    f"model {model_id}: evidence {evidence_id} regime mapping "
                    f"does not match applicability links; declared "
                    f"{sorted(declared_regimes)}, linked {sorted(linked_regimes)}"
                )

        validation = model.get("validation", {})
        capabilities = model.get("capabilities", {})
        blockers = model.get("blockers", [])
        validation_fields = (
            "published_benchmarks", "independent_identities",
            "estimating_equation_checks", "calibration_evidence",
            "numerical_stress", "end_to_end",
        )
        if not isinstance(validation, dict):
            errors.append(f"model {model_id}: validation must be an object")
            validation = {}
        for field in validation_fields:
            evidence_ids = validation.get(field, [])
            if not _string_list(evidence_ids):
                errors.append(
                    f"model {model_id}: validation.{field} must be a unique "
                    "evidence-id list"
                )
                continue
            expected_kind = VALIDATION_KINDS[field]
            for evidence_id in evidence_ids:
                evidence = evidence_records.get(evidence_id)
                if evidence is None:
                    errors.append(
                        f"model {model_id}: validation.{field} references "
                        f"unknown evidence {evidence_id!r}"
                    )
                    continue
                if evidence.get("kind") != expected_kind:
                    errors.append(
                        f"model {model_id}: validation.{field} evidence "
                        f"{evidence_id} must have kind {expected_kind!r}"
                    )
                if (field in INDEPENDENT_VALIDATION_FIELDS
                        and evidence.get("independence") != "independent"):
                    errors.append(
                        f"model {model_id}: validation.{field} evidence "
                        f"{evidence_id} must be independent"
                    )

        if not isinstance(capabilities, dict):
            errors.append(f"model {model_id}: capabilities must be an object")
            capabilities = {}
        required_capabilities = capabilities.get("required")
        implemented_capabilities = capabilities.get("implemented")
        gaps = capabilities.get("explicit_gaps")
        if not _nonempty_list(required_capabilities):
            errors.append(
                f"model {model_id}: capabilities.required must be non-empty"
            )
            required_capabilities = []
        if not _nonempty_list(implemented_capabilities):
            errors.append(
                f"model {model_id}: capabilities.implemented must be non-empty"
            )
            implemented_capabilities = []
        if not isinstance(gaps, list):
            errors.append(
                f"model {model_id}: capabilities.explicit_gaps must be a list"
            )
            gaps = []
        for name, values in (
            ("required", required_capabilities),
            ("implemented", implemented_capabilities),
            ("explicit_gaps", gaps),
        ):
            if any(not isinstance(value, str) or not value.strip()
                   for value in values):
                errors.append(
                    f"model {model_id}: capabilities.{name} must contain "
                    "non-empty strings"
                )
            if len(values) != len(set(values)):
                errors.append(
                    f"model {model_id}: capabilities.{name} contains duplicates"
                )
        if status in CERTIFIED:
            for authority in model.get("authorities", []):
                if (not isinstance(authority, dict) or not authority.get("url")
                        or not _nonempty_list(authority.get("locators"))):
                    errors.append(f"model {model_id}: certified authority lacks URL/locators")
            for field in validation_fields:
                if not _nonempty_list(validation.get(field)):
                    errors.append(f"model {model_id}: certified validation lacks {field}")
                for evidence_id in validation.get(field, []):
                    evidence = evidence_records.get(evidence_id, {})
                    if evidence.get("run_status") != "passed":
                        errors.append(
                            f"model {model_id}: certified validation.{field} "
                            f"evidence {evidence_id} has not passed"
                        )
                    if (field == "calibration_evidence"
                            and evidence.get("profile") != "release"):
                        errors.append(
                            f"model {model_id}: calibration evidence "
                            f"{evidence_id} must use the release profile"
                        )
            end_to_end_layers: set[str] = set()
            for evidence_id in validation.get("end_to_end", []):
                end_to_end_layers.update(
                    evidence_records.get(evidence_id, {}).get("layers", []))
            missing_layers = sorted(
                set(required_integration_layers) - end_to_end_layers)
            if missing_layers:
                errors.append(
                    f"model {model_id}: certified end-to-end evidence omits "
                    f"layers {missing_layers}"
                )
            if blockers:
                errors.append(
                    f"model {model_id}: a certified record cannot have material blockers"
                )
            required_set = set(required_capabilities)
            implemented_set = set(implemented_capabilities)
            gap_set = set(gaps)
            if implemented_set & gap_set:
                errors.append(
                    f"model {model_id}: capabilities cannot be both implemented "
                    f"and gaps: {sorted(implemented_set & gap_set)}"
                )
            unaccounted = required_set - implemented_set - gap_set
            if unaccounted:
                errors.append(
                    f"model {model_id}: certified capability accounting omits "
                    f"{sorted(unaccounted)}"
                )
            unscoped = (implemented_set | gap_set) - required_set
            if unscoped:
                errors.append(
                    f"model {model_id}: capability accounting contains items "
                    f"not in required scope: {sorted(unscoped)}"
                )
            if status == "verified" and gaps:
                errors.append(f"model {model_id}: verified record cannot have gaps")
            if status == "verified_with_caveats" and not gaps:
                errors.append(
                    f"model {model_id}: verified_with_caveats requires explicit gaps"
                )
        elif not blockers:
            errors.append(f"model {model_id}: uncertified record must explain blockers")

        if status not in CERTIFIED:
            warnings.append(f"model {model_id} is {status}")

    models_by_domain: dict[str, list[dict]] = {}
    for model in models:
        if isinstance(model, dict):
            models_by_domain.setdefault(model.get("domain"), []).append(model)
    for domain in domains:
        if not isinstance(domain, dict) or domain.get("status") not in CERTIFIED:
            continue
        domain_id = domain.get("id")
        domain_models = models_by_domain.get(domain_id, [])
        uncertified = [
            model.get("id") for model in domain_models
            if model.get("status") not in CERTIFIED
        ]
        if uncertified:
            errors.append(
                f"domain {domain_id}: cannot be certified while models are "
                f"uncertified: {uncertified}"
            )
        if domain.get("status") == "verified":
            caveated = [
                model.get("id") for model in domain_models
                if model.get("status") == "verified_with_caveats"
            ]
            if caveated:
                errors.append(
                    f"domain {domain_id}: cannot be verified while models are "
                    f"verified_with_caveats: {caveated}"
                )
        if inventory_complete is True and not domain_models:
            errors.append(
                f"domain {domain_id}: certified domain has no inventoried models"
            )

    if strict:
        if inventory_complete is not True:
            errors.append("strict gate: per-model inventory is incomplete")
        uncertified_domains = [
            row.get("id") for row in domains
            if isinstance(row, dict) and row.get("status") not in CERTIFIED
        ]
        uncertified_models = [
            row.get("id") for row in models
            if isinstance(row, dict) and row.get("status") not in CERTIFIED
        ]
        if uncertified_domains:
            errors.append(f"strict gate: uncertified domains: {uncertified_domains}")
        if uncertified_models:
            errors.append(f"strict gate: uncertified models: {uncertified_models}")

    try:
        display_path = str(matrix_path.relative_to(ROOT))
    except ValueError:
        display_path = str(matrix_path)
    return {
        "matrix": display_path,
        "strict": strict,
        "domain_count": len(domains),
        "model_count": len(models),
        "errors": errors,
        "warnings": warnings,
        "passed": not errors,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX)
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args(argv)
    report = validate(args.matrix.resolve(), strict=args.strict)
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
