"""Dedicated FMEA API contract checks."""

import sys
from pathlib import Path

import pytest


BACKEND = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(ROOT / "src"))

from routers.fmea import profiles
from schemas import (
    AIAGVDAFMEAAnalysis,
    FMEAAttestation,
    FMEAFailureChain,
    FMEDAFailureMode,
    FMEDASource,
)


def test_method_profile_discovery_is_explicit_about_verification():
    methods = profiles()
    assert any(item["status"] == "preview_public_alignment"
               for item in methods)
    assert any(item["status"] == "reference_gated" for item in methods)
    assert all(len(item["checksum"]) == 64 for item in methods)


def test_fmeda_and_attestation_schema_boundaries():
    source = FMEDASource(
        id="R1", label="Resistor", failure_rate_per_hour=1e-7,
        lower_rate_per_hour=0.8e-7, upper_rate_per_hour=1.2e-7,
    )
    assert source.allocation_complete is True
    mode = FMEDAFailureMode(
        id="FM-1", source_id="R1", mode_fraction=0.5,
        classification="single_point", diagnostic_coverage=0.9,
    )
    assert mode.diagnostic_coverage == 0.9
    local = FMEAAttestation(
        id="ATT-1", role="approver", name="Reviewer", decision="approved",
        statement="Reviewed.", timestamp="2026-07-25T00:00:00Z",
        identity_assurance="named_local",
    )
    assert local.identity_provider is None


def test_structured_cause_language_and_structure_reference_contract():
    chain = FMEAFailureChain(
        id="FC-1",
        effect="Output lost",
        failure_mode="No output",
        cause="connector contact opens",
        cause_noun="connector contact",
        cause_structure_node_id="ST-1",
        cause_mechanism_verb="opens",
        severity=8,
        occurrence=3,
        detection=4,
    )
    analysis = AIAGVDAFMEAAnalysis(
        id="DFMEA-1",
        name="Connector DFMEA",
        kind="dfmea",
        structure_nodes=[{
            "id": "ST-1", "name": "Connector contact", "level": "focus",
        }],
        failure_chains=[chain],
    )
    assert analysis.failure_chains[0].cause_noun == "connector contact"

    with pytest.raises(
        ValueError,
        match="cause_structure_node_id must reference a structure node",
    ):
        AIAGVDAFMEAAnalysis(
            id="DFMEA-2",
            name="Invalid cause reference",
            kind="dfmea",
            structure_nodes=[{
                "id": "ST-1", "name": "Connector contact", "level": "focus",
            }],
            failure_chains=[
                chain.model_copy(update={"cause_structure_node_id": "ST-X"}),
            ],
        )
