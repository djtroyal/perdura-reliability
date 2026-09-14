"""Strict contracts for the canonical, reusable System Definition graph.

Version 2 deliberately remains portable JSON.  The richer MBSE semantics live in
the model and graph services rather than requiring a particular graph database.
Version 1 is accepted so existing saved projects can be upgraded in place.
"""

from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


InterfaceType = Literal[
    "physical", "energy", "information", "material", "human_machine",
    "clearance",
]

BlockKind = Literal["system", "subsystem", "assembly", "component", "piece_part"]
AnalysisDomain = Literal["prediction", "reliability", "fmea", "rbd", "custom"]


class NumberParameterValue(StrictModel):
    kind: Literal["number"] = "number"
    value: float
    unit: str = Field(default="", max_length=64)


class TextParameterValue(StrictModel):
    kind: Literal["text"] = "text"
    value: str = Field(default="", max_length=4096)


class BooleanParameterValue(StrictModel):
    kind: Literal["boolean"] = "boolean"
    value: bool = False


class ChoiceParameterValue(StrictModel):
    kind: Literal["choice"] = "choice"
    value: str = Field(default="", max_length=512)
    option_ids: list[str] = Field(default_factory=list, max_length=1000)


SystemParameterValue = Annotated[
    Union[
        NumberParameterValue, TextParameterValue,
        BooleanParameterValue, ChoiceParameterValue,
    ],
    Field(discriminator="kind"),
]


class SystemAnalysisProfile(StrictModel):
    """Versioned, adapter-owned analysis data carried by a block definition."""

    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=512)
    domain: AnalysisDomain
    adapter_id: str = Field(min_length=1, max_length=128)
    adapter_version: int = Field(default=1, ge=1, le=10000)
    status: Literal["draft", "reviewed"] = "draft"
    mode_ids: list[str] = Field(default_factory=list, max_length=100)
    values: dict[str, SystemParameterValue] = Field(default_factory=dict)
    source_ref: Optional[str] = Field(None, max_length=2048)


class SystemProfileOverride(StrictModel):
    profile_id: str = Field(min_length=1, max_length=128)
    disabled: bool = False
    values: dict[str, SystemParameterValue] = Field(default_factory=dict)


class SystemMode(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=512)
    description: str = ""


class SystemPort(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=512)
    interface_type: InterfaceType = "information"
    direction: Literal["input", "output", "bidirectional"] = "bidirectional"
    description: str = ""
    properties: dict[str, SystemParameterValue] = Field(default_factory=dict)


class SystemFunction(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    description: str = Field(min_length=1, max_length=2048)
    canonical_verb_id: Optional[str] = Field(None, max_length=128)
    function_type: Literal[
        "primary", "supporting", "interface", "monitoring", "system_response",
    ] = "primary"
    mode_ids: list[str] = Field(default_factory=list, max_length=100)
    port_ids: list[str] = Field(default_factory=list, max_length=1000)


class SystemFailureMode(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    function_id: str = Field(min_length=1, max_length=128)
    description: str = Field(min_length=1, max_length=2048)
    deviation_id: str = Field(default="custom", min_length=1, max_length=128)
    mode_ids: list[str] = Field(default_factory=list, max_length=100)


class SystemChildSlot(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    definition_id: str = Field(min_length=1, max_length=128)
    name: str = Field(default="", max_length=512)
    quantity: int = Field(default=1, ge=1, le=100000)


class SystemBlockDefinition(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=512)
    kind: BlockKind = "component"
    classification: str = Field(default="component", max_length=128)
    revision: str = Field(default="A", max_length=128)
    description: str = ""
    part_number: str = Field(default="", max_length=512)
    manufacturer: str = Field(default="", max_length=512)
    category: str = Field(default="", max_length=512)
    properties: dict[str, SystemParameterValue] = Field(default_factory=dict)
    analysis_profiles: list[SystemAnalysisProfile] = Field(
        default_factory=list, max_length=1000)
    ports: list[SystemPort] = Field(default_factory=list, max_length=1000)
    functions: list[SystemFunction] = Field(default_factory=list, max_length=1000)
    failure_modes: list[SystemFailureMode] = Field(
        default_factory=list, max_length=10000)
    child_slots: list[SystemChildSlot] = Field(
        default_factory=list, max_length=10000)


class FunctionOverride(StrictModel):
    function_id: str = Field(min_length=1, max_length=128)
    enabled: bool = True
    description: Optional[str] = Field(None, max_length=2048)
    mode_ids: Optional[list[str]] = Field(None, max_length=100)


class FailureModeOverride(StrictModel):
    failure_mode_id: str = Field(min_length=1, max_length=128)
    enabled: bool = True
    description: Optional[str] = Field(None, max_length=2048)
    deviation_id: Optional[str] = Field(None, max_length=128)
    mode_ids: Optional[list[str]] = Field(None, max_length=100)


class SystemBlockInstance(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    definition_id: str = Field(min_length=1, max_length=128)
    parent_instance_id: Optional[str] = Field(None, max_length=128)
    slot_id: Optional[str] = Field(None, max_length=128)
    name: str = Field(default="", max_length=512)
    quantity: int = Field(default=1, ge=1, le=100000)
    reference_designators: list[str] = Field(default_factory=list, max_length=10000)
    mode_ids: list[str] = Field(default_factory=list, max_length=100)
    function_overrides: list[FunctionOverride] = Field(
        default_factory=list, max_length=1000)
    failure_mode_overrides: list[FailureModeOverride] = Field(
        default_factory=list, max_length=10000)
    legacy_refs: list[str] = Field(default_factory=list, max_length=1000)
    origin: Literal["ad_hoc", "definition_slot"] = "ad_hoc"
    definition_revision: str = Field(default="", max_length=128)
    properties: dict[str, SystemParameterValue] = Field(default_factory=dict)
    profile_overrides: list[SystemProfileOverride] = Field(
        default_factory=list, max_length=1000)


class SystemFunctionRef(StrictModel):
    instance_id: str = Field(min_length=1, max_length=128)
    function_id: str = Field(min_length=1, max_length=128)


class SystemEndpoint(StrictModel):
    instance_id: Optional[str] = Field(None, max_length=128)
    port_id: Optional[str] = Field(None, max_length=128)
    external_id: Optional[str] = Field(None, max_length=128)

    @model_validator(mode="after")
    def validate_endpoint(self):
        if bool(self.instance_id) == bool(self.external_id):
            raise ValueError(
                "An endpoint requires exactly one instance_id or external_id.")
        if self.instance_id and not self.port_id:
            raise ValueError("An instance endpoint requires port_id.")
        return self


class SystemExternal(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=512)
    kind: Literal["adjacent_system", "person", "environment", "other"] = "other"
    description: str = ""
    ports: list[SystemPort] = Field(default_factory=list, max_length=1000)


class SystemInterface(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(default="", max_length=512)
    interface_type: InterfaceType = "information"
    source: SystemEndpoint
    target: SystemEndpoint
    directionality: Literal["directed", "bidirectional", "undirected"] = "directed"
    linkage: Literal["direct", "indirect"] = "direct"
    strength: Literal["strong", "weak", "unknown"] = "unknown"
    nature: Literal["required", "incidental", "conditional", "unknown"] = "unknown"
    interface_detail: str = ""
    flow_description: str = ""
    operating_condition: str = ""
    source_function_ids: list[str] = Field(default_factory=list, max_length=1000)
    target_function_ids: list[str] = Field(default_factory=list, max_length=1000)
    mode_ids: list[str] = Field(default_factory=list, max_length=100)
    properties: dict[str, SystemParameterValue] = Field(default_factory=dict)


class SystemFunctionLink(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    source: SystemFunctionRef
    target: SystemFunctionRef
    relationship: Literal[
        "decomposes_to", "depends_on", "provides_input", "enables",
        "monitors", "responds_to",
    ] = "depends_on"
    rationale: str = ""
    mode_ids: list[str] = Field(default_factory=list, max_length=100)


class SystemPropagationRule(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    action: Literal["pass_through", "transform", "stop", "terminate"] = "pass_through"
    interface_id: Optional[str] = Field(None, max_length=128)
    source: Optional[SystemFunctionRef] = None
    target: Optional[SystemFunctionRef] = None
    source_deviation_id: Optional[str] = Field(None, max_length=128)
    result_deviation_id: Optional[str] = Field(None, max_length=128)
    result_description: str = ""
    mode_ids: list[str] = Field(default_factory=list, max_length=100)
    rationale: str = ""


class SystemPropagationAssertion(StrictModel):
    """A reviewed propagation result that can be reused by other analyses."""

    id: str = Field(min_length=1, max_length=128)
    source_failure_mode_id: str = Field(min_length=1, max_length=256)
    source_node_id: str = Field(min_length=1, max_length=512)
    target_node_id: str = Field(min_length=1, max_length=512)
    transition_id: str = Field(min_length=1, max_length=128)
    result_deviation_id: str = Field(min_length=1, max_length=128)
    status: Literal["accepted", "rejected", "superseded"] = "accepted"
    rationale: str = ""
    evidence_refs: list[str] = Field(default_factory=list, max_length=1000)
    mode_ids: list[str] = Field(default_factory=list, max_length=100)
    source_fingerprint: str = Field(default="", max_length=128)


class SystemDiagramNode(StrictModel):
    instance_id: Optional[str] = Field(None, max_length=128)
    external_id: Optional[str] = Field(None, max_length=128)
    x: float = Field(default=0, ge=-1_000_000, le=1_000_000)
    y: float = Field(default=0, ge=-1_000_000, le=1_000_000)
    width: float = Field(default=180, ge=60, le=10000)
    height: float = Field(default=72, ge=36, le=10000)
    expanded: bool = False

    @model_validator(mode="after")
    def validate_subject(self):
        if bool(self.instance_id) == bool(self.external_id):
            raise ValueError(
                "A diagram node requires exactly one instance_id or external_id.")
        return self


class SystemDiagramBoundary(StrictModel):
    label: str = Field(default="System Boundary", max_length=512)
    x: float = Field(default=-40, ge=-1_000_000, le=1_000_000)
    y: float = Field(default=-40, ge=-1_000_000, le=1_000_000)
    width: float = Field(default=1200, ge=100, le=1_000_000)
    height: float = Field(default=700, ge=100, le=1_000_000)


class SystemDiagramViewport(StrictModel):
    x: float = Field(default=0, ge=-1_000_000, le=1_000_000)
    y: float = Field(default=0, ge=-1_000_000, le=1_000_000)
    zoom: float = Field(default=1, ge=0.01, le=10)


class SystemDiagram(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=512)
    scope_instance_id: Optional[str] = Field(None, max_length=128)
    density: Literal["compact", "standard", "detailed"] = "standard"
    boundary: SystemDiagramBoundary = Field(default_factory=SystemDiagramBoundary)
    viewport: SystemDiagramViewport = Field(default_factory=SystemDiagramViewport)
    snap_to_grid: bool = True
    mode_ids: list[str] = Field(default_factory=list, max_length=100)
    nodes: list[SystemDiagramNode] = Field(default_factory=list, max_length=10000)


class SystemDefinitionModel(StrictModel):
    version: Literal[1, 2] = 2
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=512)
    revision: str = Field(default="A", max_length=128)
    modes: list[SystemMode] = Field(default_factory=list, max_length=1000)
    definitions: list[SystemBlockDefinition] = Field(
        default_factory=list, max_length=10000)
    instances: list[SystemBlockInstance] = Field(
        default_factory=list, max_length=100000)
    externals: list[SystemExternal] = Field(default_factory=list, max_length=10000)
    interfaces: list[SystemInterface] = Field(
        default_factory=list, max_length=100000)
    function_links: list[SystemFunctionLink] = Field(
        default_factory=list, max_length=100000)
    propagation_rules: list[SystemPropagationRule] = Field(
        default_factory=list, max_length=100000)
    propagation_assertions: list[SystemPropagationAssertion] = Field(
        default_factory=list, max_length=100000)
    diagrams: list[SystemDiagram] = Field(default_factory=list, max_length=1000)


class SystemEntityChecksum(StrictModel):
    entity_type: Literal[
        "definition", "instance", "interface", "function",
        "failure_mode", "propagation_assertion",
    ]
    entity_id: str = Field(min_length=1, max_length=512)
    checksum: str = Field(min_length=1, max_length=128)


class SystemAnalysisBinding(StrictModel):
    """Provenance between a canonical model and a downstream analysis."""

    id: str = Field(min_length=1, max_length=128)
    system_model_id: str = Field(min_length=1, max_length=128)
    analysis_module: Literal["prediction", "fmea", "rbd", "fta", "markov"]
    analysis_id: str = Field(min_length=1, max_length=128)
    scope_instance_id: Optional[str] = Field(None, max_length=128)
    mode_id: Optional[str] = Field(None, max_length=128)
    quantity_strategy: Literal["grouped", "exploded"] = "grouped"
    source_revision: str = Field(default="", max_length=128)
    source_fingerprint: str = Field(default="", max_length=128)
    entity_checksums: list[SystemEntityChecksum] = Field(
        default_factory=list, max_length=100000)
    analysis_overrides: dict[str, Any] = Field(default_factory=dict)


class SystemDefinitionValidateRequest(StrictModel):
    model: SystemDefinitionModel


class SystemDefinitionPropagateRequest(StrictModel):
    model: SystemDefinitionModel
    mode_id: Optional[str] = Field(None, max_length=128)
    source_failure_mode_ids: list[str] = Field(default_factory=list, max_length=10000)
    max_paths: int = Field(default=10000, ge=1, le=100000)
    max_depth: int = Field(default=100, ge=1, le=10000)


class SystemDefinitionStarterRequest(SystemDefinitionPropagateRequest):
    target: Literal["rbd", "fta", "markov"]
    selected_path_ids: list[str] = Field(default_factory=list, max_length=10000)


class SystemDefinitionResolveProfileRequest(StrictModel):
    model: SystemDefinitionModel
    instance_id: str = Field(min_length=1, max_length=128)
    profile_id: str = Field(min_length=1, max_length=128)
    mode_id: Optional[str] = Field(None, max_length=128)
    analysis_overrides: dict[str, SystemParameterValue] = Field(default_factory=dict)


class SystemDefinitionCompositionPlanRequest(StrictModel):
    model: SystemDefinitionModel
    instance_id: str = Field(min_length=1, max_length=128)


class SystemDefinitionProjectionRequest(StrictModel):
    model: SystemDefinitionModel
    target: Literal["prediction", "fmea", "rbd", "fta", "markov"]
    scope_instance_id: Optional[str] = Field(None, max_length=128)
    mode_id: Optional[str] = Field(None, max_length=128)
    quantity_strategy: Literal["grouped", "exploded"] = "grouped"
    selected_path_ids: list[str] = Field(default_factory=list, max_length=10000)
    current_analysis: dict[str, Any] = Field(default_factory=dict)


class SystemDefinitionImpactRequest(StrictModel):
    model: SystemDefinitionModel
    bindings: list[SystemAnalysisBinding] = Field(default_factory=list, max_length=10000)
