"""Shared requirement, evidence and verification record contracts.

Physical FMEA, Reliability Program and the canonical System Model use the same
base fields. Process FMEA keeps the original records in its own analysis scope.
"""
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class FMEAFunctionalRequirement(BaseModel):
    """Auditable requirement snapshot used by one or more functions."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=128)
    statement: str = ""
    requirement_type: Literal[
        "functional", "performance", "interface", "safety", "regulatory",
        "customer", "process", "other",
    ] = "functional"
    measure: str = ""
    target: str = ""
    unit: str = ""
    acceptance_criteria: str = ""
    operating_condition: str = ""
    source: str = ""
    owner: str = ""
    confidence: str = ""
    verification_method: str = ""
    verification_method_id: Optional[str] = Field(None, max_length=128)
    evidence_ids: list[str] = Field(default_factory=list, max_length=100)
    special_characteristic: str = ""
    linked_program_requirement_id: Optional[str] = Field(None, max_length=128)
    source_checksum: Optional[str] = Field(None, max_length=128)


class FMEAEvidenceLink(BaseModel):
    """Typed evidence; blank draft details remain serializable until review."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=128)
    target_id: str = Field(default="", max_length=128)
    source_module: Literal[
        "prediction", "life_data", "pof", "reliability_testing", "warranty",
        "fracas", "testability", "fault_tree", "rbd", "markov", "doe",
        "msa", "spc", "requirements", "external",
    ]
    source_analysis_id: str = Field(default="", max_length=128)
    source_record_id: Optional[str] = Field(None, max_length=256)
    source_revision: Optional[str] = Field(None, max_length=128)
    source_checksum: Optional[str] = Field(
        None, pattern=r"^(?:[a-f0-9]{64})?$")
    evidence_kind: Literal[
        "rate", "distribution", "test_result", "requirement", "hazard",
        "incident", "control_effectiveness", "diagnostic_coverage",
        "verification", "rationale", "other",
    ] = "other"
    claim: str = Field(default="", max_length=4000)
    locator: str = Field(default="", max_length=2000)
    units: Optional[str] = Field(None, max_length=128)
    mission_context: Optional[str] = Field(None, max_length=2000)
    captured_at: str = Field(default="", max_length=64)
    stale: bool = False
    stale_reason: Optional[str] = Field(None, max_length=2000)
    rating_dimension: Optional[Literal[
        "severity", "occurrence", "detection", "frequency", "monitoring",
    ]] = None
    rating_value: Optional[int] = Field(None, ge=1, le=10)

    @model_validator(mode="after")
    def validate_rating_proposal(self):
        if (self.rating_dimension is None) != (self.rating_value is None):
            raise ValueError(
                "Evidence rating_dimension and rating_value must be supplied together.")
        return self


class FMEAVerificationPlanRow(BaseModel):
    """DVP&R draft; semantic review, not presence in a plan, establishes an outcome."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=128)
    objective: str = Field(default="", max_length=4000)
    requirement_ids: list[str] = Field(default_factory=list, max_length=1000)
    failure_chain_ids: list[str] = Field(default_factory=list, max_length=1000)
    method: str = Field(default="", max_length=2000)
    level: str = Field(default="", max_length=1000)
    sample_size: str = Field(default="", max_length=1000)
    acceptance_criteria: str = Field(default="", max_length=4000)
    owner: str = Field(default="", max_length=512)
    planned_date: Optional[str] = Field(None, max_length=32)
    status: Literal[
        "planned", "in_progress", "passed", "failed", "blocked",
    ] = "planned"
    evidence_link_ids: list[str] = Field(default_factory=list, max_length=1000)



class CanonicalRequirementAllocation(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    system_model_id: str = Field(min_length=1, max_length=128)
    instance_id: Optional[str] = Field(None, max_length=128)
    definition_id: Optional[str] = Field(None, max_length=128)
    function_id: Optional[str] = Field(None, max_length=128)
    failure_mode_id: Optional[str] = Field(None, max_length=128)
    interface_id: Optional[str] = Field(None, max_length=128)
    revision: Optional[str] = Field(None, max_length=128)
    checksum: Optional[str] = Field(None, max_length=128)


class SystemSupportingAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    module_key: str = Field(min_length=1, max_length=128)
    analysis_id: str = Field(min_length=1, max_length=128)


class SystemRequirement(FMEAFunctionalRequirement):
    lifecycle: Literal["draft", "active", "retired"] = "draft"
    derived_from_ids: list[str] = Field(default_factory=list, max_length=1000)
    allocations: list[CanonicalRequirementAllocation] = Field(default_factory=list, max_length=10000)
    mode_ids: list[str] = Field(default_factory=list, max_length=1000)
    mission_profile: str = Field(default="", max_length=4000)
    failure_definition: str = Field(default="", max_length=4000)
    supporting_analyses: list[SystemSupportingAnalysis] = Field(default_factory=list, max_length=10000)


class SystemVerificationEvidence(FMEAEvidenceLink):
    # Incomplete drafts are valid records; assessment reports missing fields.
    target_id: str = Field(default="", max_length=128)
    source_module: Literal[
        "prediction", "life_data", "pof", "reliability_testing", "warranty",
        "fracas", "testability", "fault_tree", "rbd", "markov", "doe",
        "msa", "spc", "requirements", "external",
    ] = "external"
    source_analysis_id: str = Field(default="", max_length=128)
    source_checksum: Optional[str] = Field(None, max_length=128)
    captured_at: str = Field(default="", max_length=64)
    requirement_ids: list[str] = Field(default_factory=list, max_length=1000)
    mode_ids: list[str] = Field(default_factory=list, max_length=1000)
    run_id: Optional[str] = Field(None, max_length=128)
    module_key: Optional[str] = Field(None, max_length=128)


class SystemVerificationCase(FMEAVerificationPlanRow):
    objective: str = Field(default="", max_length=4000)
    mode_ids: list[str] = Field(default_factory=list, max_length=1000)
    outcome: Literal["not_assessed", "pass", "fail", "inconclusive"] = "not_assessed"
    assessment: str = Field(default="", max_length=4000)
    reviewed_by: str = Field(default="", max_length=512)
    reviewed_at: str = Field(default="", max_length=64)
    reviewed_fingerprint: str = Field(default="", max_length=128)
    reviewed_revision: str = Field(default="", max_length=128)


class SystemVerificationSource(BaseModel):
    """Current run provenance supplied by the project's analysis ledger."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    runId: str = Field(min_length=1, max_length=128)
    moduleKey: str = Field(min_length=1, max_length=128)
    analysisId: str = Field(min_length=1, max_length=128)
    analysisName: str = Field(default="", max_length=512)
    fingerprintSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    inputSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    resultSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    engineRevision: int = Field(ge=0)
    current: bool
