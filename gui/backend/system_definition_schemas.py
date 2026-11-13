"""Strict contracts for the canonical, reusable System Definition graph.

Version 4 is the canonical structured architecture contract. Older alpha
formats are intentionally rejected instead of silently migrating analyses.
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
    resource_id: Optional[str] = Field(None, max_length=128)
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=512)
    interface_type: InterfaceType = "information"
    direction: Literal["input", "output", "bidirectional"] = "bidirectional"
    description: str = ""
    properties: dict[str, SystemParameterValue] = Field(default_factory=dict)


class InterfaceFunctionOrigin(StrictModel):
    interface_id: str = Field(min_length=1, max_length=128)
    endpoint: Literal["source", "target"]
    instance_id: str = Field(min_length=1, max_length=128)
    generated_description: str = Field(max_length=2048)
    generated_mode_ids: list[str] = Field(default_factory=list, max_length=100)


class SystemResource(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(default="", max_length=512)
    category: Literal["physical", "energy", "information", "material", "human_machine", "clearance", "state"]
    quantity: Optional[str] = Field(None, max_length=128)
    unit: Optional[str] = Field(None, max_length=128)


class FunctionResourceIO(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    resource_id: str = Field(default="", max_length=128)
    direction: Literal["input", "output"]
    port_id: Optional[str] = Field(None, max_length=128)


class StructuredFunctionDefinition(StrictModel):
    role: Literal["transform", "source", "maintain_state"]
    action: str = Field(default="", max_length=2048)
    state_verb: Optional[Literal["maintain", "secure", "support", "contain", "isolate", "protect"]] = None
    io: list[FunctionResourceIO] = Field(default_factory=list, max_length=1000)


class FunctionTransferEndpoint(StrictModel):
    kind: Literal["function"] = "function"
    instance_id: str = Field(min_length=1, max_length=128)
    function_id: str = Field(min_length=1, max_length=128)
    io_id: str = Field(min_length=1, max_length=128)


class ExternalTransferEndpoint(StrictModel):
    kind: Literal["external"] = "external"
    external_id: str = Field(min_length=1, max_length=128)
    port_id: str = Field(min_length=1, max_length=128)


ResourceTransferEndpoint = Annotated[Union[FunctionTransferEndpoint, ExternalTransferEndpoint], Field(discriminator="kind")]


class ResourceFlow(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    resource_id: str = Field(min_length=1, max_length=128)
    kind: Literal["flow"] = "flow"
    source: ResourceTransferEndpoint
    target: ResourceTransferEndpoint
    mode_ids: list[str] = Field(default_factory=list, max_length=100)


class BlockRelationEndpoint(StrictModel):
    kind: Literal["block"] = "block"
    instance_id: str = Field(min_length=1, max_length=128)
    function_id: Optional[str] = Field(None, max_length=128)


class ExternalRelationEndpoint(StrictModel):
    kind: Literal["external"] = "external"
    external_id: str = Field(min_length=1, max_length=128)
    port_id: Optional[str] = Field(None, max_length=128)


RelationEndpoint = Annotated[Union[BlockRelationEndpoint, ExternalRelationEndpoint], Field(discriminator="kind")]


class PhysicalRelation(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    kind: Literal["relation"] = "relation"
    source: RelationEndpoint
    target: RelationEndpoint
    mode_ids: list[str] = Field(default_factory=list, max_length=100)


ResourceTransfer = Annotated[Union[ResourceFlow, PhysicalRelation], Field(discriminator="kind")]


class SystemFunction(StrictModel):
    default_enabled: bool = True
    id: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2048)
    canonical_verb_id: Optional[str] = Field(None, max_length=128)
    function_type: Literal[
        "primary", "supporting", "interface", "monitoring", "system_response",
    ] = "primary"
    mode_ids: list[str] = Field(default_factory=list, max_length=100)
    port_ids: list[str] = Field(default_factory=list, max_length=1000)
    interface_origin: Optional[InterfaceFunctionOrigin] = None
    definition: Optional[StructuredFunctionDefinition] = None


class SystemFailureMode(StrictModel):
    default_enabled: bool = True
    id: str = Field(min_length=1, max_length=128)
    function_id: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2048)
    deviation_id: str = Field(default="custom", min_length=1, max_length=128)
    mode_ids: list[str] = Field(default_factory=list, max_length=100)


class SystemChildSlot(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    definition_id: str = Field(min_length=1, max_length=128)
    name: str = Field(default="", max_length=512)
    quantity: int = Field(default=1, ge=1, le=100000)


class SystemBlockDefinition(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(default="", max_length=512)
    kind: BlockKind = "component"
    classification: str = Field(default="component", max_length=128)
    revision: str = Field(default="A", max_length=128)
    description: str = ""
    part_number: str = Field(default="", max_length=512)
    manufacturer: str = Field(default="", max_length=512)
    category: str = Field(default="", max_length=512)
    part_metadata: dict[str, Any] = Field(default_factory=dict)
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
    resource_bindings: Optional[dict[str, str]] = None
    definition: Optional[StructuredFunctionDefinition] = None
    function_id: str = Field(min_length=1, max_length=128)
    enabled: Optional[bool] = None
    description: Optional[str] = Field(None, max_length=2048)
    mode_ids: Optional[list[str]] = Field(None, max_length=100)
    function_type: Optional[Literal[
        "primary", "supporting", "interface", "monitoring", "system_response",
    ]] = None
    canonical_verb_id: Optional[str] = Field(None, max_length=128)


class FailureModeOverride(StrictModel):
    failure_mode_id: str = Field(min_length=1, max_length=128)
    enabled: Optional[bool] = None
    description: Optional[str] = Field(None, max_length=2048)
    deviation_id: Optional[str] = Field(None, max_length=128)
    mode_ids: Optional[list[str]] = Field(None, max_length=100)
    function_id: Optional[str] = Field(None, min_length=1, max_length=128)


class SystemBlockInstance(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    definition_id: str = Field(min_length=1, max_length=128)
    parent_instance_id: Optional[str] = Field(None, max_length=128)
    slot_id: Optional[str] = Field(None, max_length=128)
    name: str = Field(default="", max_length=512)
    quantity: int = Field(default=1, ge=1, le=100000)
    reference_designators: list[str] = Field(default_factory=list, max_length=10000)
    source_metadata: dict[str, Any] = Field(default_factory=dict)
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
        return self


class SystemExternal(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=512)
    kind: Literal["adjacent_system", "person", "environment", "other"] = "other"
    description: str = ""
    ports: list[SystemPort] = Field(default_factory=list, max_length=1000)


class SystemInterface(StrictModel):
    generated: Optional[bool] = None
    transfers: list[ResourceTransfer] = Field(default_factory=list, max_length=10000)
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
    generated: Optional[bool] = None
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


class SystemDiagramLayoutOptions(StrictModel):
    mode: Literal["compact", "normal", "expanded"] = "normal"
    preserveGateOrder: bool = True
    preserveEventOrder: bool = True
    optimizeLabelGeometry: bool = False


class SystemDiagram(StrictModel):
    hidden_instance_ids: list[str] = Field(default_factory=list, max_length=100000)
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=512)
    scope_instance_id: Optional[str] = Field(None, max_length=128)
    density: Literal["compact", "standard", "detailed"] = "standard"
    layoutOptions: Optional[SystemDiagramLayoutOptions] = None
    connectorStyle: Literal["orthogonal", "curved", "straight"] = "curved"
    boundary: SystemDiagramBoundary = Field(default_factory=SystemDiagramBoundary)
    viewport: SystemDiagramViewport = Field(default_factory=SystemDiagramViewport)
    snap_to_grid: bool = True
    mode_ids: list[str] = Field(default_factory=list, max_length=100)
    nodes: list[SystemDiagramNode] = Field(default_factory=list, max_length=10000)


class SystemDefinitionModel(StrictModel):
    version: Literal[4]
    resources: list[SystemResource] = Field(default_factory=list, max_length=10000)
    id: str = Field(min_length=1, max_length=128)
    root_instance_id: Optional[str] = Field(None, max_length=128)
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


class SharedSystemPredictionRequest(StrictModel):
    """Canonical structure plus scenario-owned inputs; no copied hierarchy."""
    model: SystemDefinitionModel
    scenario: dict[str, Any]
    source_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
