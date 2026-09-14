"""Canonical system architecture and qualitative fault-map API."""

import sys
from pathlib import Path

from fastapi import APIRouter

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.SystemDefinition import (  # noqa: E402
    analyze_system_impact,
    generate_system_starter,
    plan_definition_composition,
    profile_adapters,
    project_system_definition,
    propagate_system_definition,
    resolve_analysis_profile,
    upgrade_system_definition,
    validate_system_definition,
)
from system_definition_schemas import (  # noqa: E402
    SystemDefinitionCompositionPlanRequest,
    SystemDefinitionImpactRequest,
    SystemDefinitionProjectionRequest,
    SystemDefinitionPropagateRequest,
    SystemDefinitionResolveProfileRequest,
    SystemDefinitionStarterRequest,
    SystemDefinitionValidateRequest,
)


router = APIRouter()


@router.get("/profile-adapters", response_model=dict,
            summary="List supported typed analysis-profile adapters")
def adapters() -> dict:
    return profile_adapters()


@router.post("/validate", response_model=dict, summary="Validate a canonical system model")
def validate(request: SystemDefinitionValidateRequest) -> dict:
    return validate_system_definition(request.model.model_dump())


@router.post("/upgrade", response_model=dict,
             summary="Upgrade a version 1 canonical model to version 2")
def upgrade(request: SystemDefinitionValidateRequest) -> dict:
    return upgrade_system_definition(request.model.model_dump())


@router.post("/resolve-profile", response_model=dict,
             summary="Resolve definition, instance, and analysis profile values")
def resolve_profile(request: SystemDefinitionResolveProfileRequest) -> dict:
    return resolve_analysis_profile(
        request.model.model_dump(), request.instance_id, request.profile_id,
        mode_id=request.mode_id,
        analysis_overrides={key: value.model_dump()
                            for key, value in request.analysis_overrides.items()},
    )


@router.post("/composition-plan", response_model=dict,
             summary="Plan reviewed synchronization of reusable child slots")
def composition_plan(request: SystemDefinitionCompositionPlanRequest) -> dict:
    return plan_definition_composition(
        request.model.model_dump(), request.instance_id)


@router.post("/propagate", response_model=dict,
             summary="Build an explainable qualitative functional fault map")
def propagate(request: SystemDefinitionPropagateRequest) -> dict:
    return propagate_system_definition(
        request.model.model_dump(), mode_id=request.mode_id,
        source_failure_mode_ids=request.source_failure_mode_ids,
        max_paths=request.max_paths, max_depth=request.max_depth,
    )


@router.post("/project", response_model=dict,
             summary="Build a linked downstream analysis projection and diff")
def project(request: SystemDefinitionProjectionRequest) -> dict:
    return project_system_definition(
        request.model.model_dump(), request.target,
        scope_instance_id=request.scope_instance_id, mode_id=request.mode_id,
        quantity_strategy=request.quantity_strategy,
        selected_path_ids=request.selected_path_ids,
        current_analysis=request.current_analysis,
    )


@router.post("/impact", response_model=dict,
             summary="Report canonical model changes affecting linked analyses")
def impact(request: SystemDefinitionImpactRequest) -> dict:
    return analyze_system_impact(
        request.model.model_dump(),
        [binding.model_dump() for binding in request.bindings],
    )


@router.post("/generate-starter", response_model=dict,
             summary="Generate a reviewable RBD, FTA, or Markov starter")
def starter(request: SystemDefinitionStarterRequest) -> dict:
    return generate_system_starter(
        request.model.model_dump(), request.target, mode_id=request.mode_id,
        source_failure_mode_ids=request.source_failure_mode_ids,
        selected_path_ids=request.selected_path_ids,
        max_paths=request.max_paths, max_depth=request.max_depth,
    )
