"""Dedicated FMEA analysis and controlled-lifecycle API."""

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.FMEA import (  # noqa: E402
    analyze_studies,
    create_release,
    create_revision,
    evidence_impact,
    generate_suggestions,
    instantiate_library_item,
    method_profiles,
    prepare_library_item,
    semantic_diff,
    transition_lifecycle,
    verify_release,
)
from reliability.AIAG_VDA_FMEA import builtin_rating_profiles  # noqa: E402
from schemas import (  # noqa: E402
    FMEAAnalyzeRequest,
    FMEADiffRequest,
    FMEAEvidenceImpactRequest,
    FMEALibraryInstantiateRequest,
    FMEALibraryPrepareRequest,
    FMEALifecycleTransitionRequest,
    FMEAReleaseRequest,
    FMEARevisionRequest,
    FMEASuggestionRequest,
    FMEAVerifyReleaseRequest,
)


router = APIRouter()


@router.get("/method-profiles", response_model=list[dict[str, Any]],
            summary="List FMEA method profiles and verification status")
def profiles() -> list[dict[str, Any]]:
    return method_profiles()


@router.get("/rating-profiles", response_model=list[dict[str, Any]],
            summary="List controlled FMEA rating profiles")
def ratings() -> list[dict[str, Any]]:
    return builtin_rating_profiles()


@router.post("/analyze", response_model=dict[str, Any],
             summary="Analyze controlled FMEA studies")
def analyze(request: FMEAAnalyzeRequest) -> dict[str, Any]:
    return analyze_studies(
        [item.model_dump() for item in request.studies],
        rating_profiles=[item.model_dump() for item in request.rating_profiles],
        program_requirements=[
            item.model_dump() for item in request.program_requirements
        ],
    )


@router.post("/diff", response_model=dict[str, Any],
             summary="Compare two FMEA study revisions")
def diff(request: FMEADiffRequest) -> dict[str, Any]:
    changes = semantic_diff(
        request.before.model_dump(), request.after.model_dump())
    return {"changes": changes, "count": len(changes)}


@router.post("/revisions", response_model=dict[str, Any],
             summary="Create a content-addressed FMEA revision record")
def revision(request: FMEARevisionRequest) -> dict[str, Any]:
    return create_revision(
        request.study.model_dump(),
        created_by=request.created_by,
        change_summary=request.change_summary,
    )


@router.post("/releases", response_model=dict[str, Any],
             summary="Create an immutable FMEA release manifest")
def release(request: FMEAReleaseRequest) -> dict[str, Any]:
    try:
        return create_release(
            request.study.model_dump(),
            rating_profiles=[
                item.model_dump() for item in request.rating_profiles
            ],
            program_requirements=[
                item.model_dump() for item in request.program_requirements
            ],
            software_version=request.software_version,
            software_commit=request.software_commit,
            attestations=[
                item.model_dump() for item in request.attestations
            ],
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/releases/verify", response_model=dict[str, Any],
             summary="Verify an FMEA release against its study")
def verify(request: FMEAVerifyReleaseRequest) -> dict[str, Any]:
    return verify_release(
        request.study.model_dump(), request.release.model_dump())


@router.post("/lifecycle/transition", response_model=dict[str, Any],
             summary="Transition a controlled FMEA lifecycle")
def transition(request: FMEALifecycleTransitionRequest) -> dict[str, Any]:
    try:
        return transition_lifecycle(
            request.study.model_dump(),
            target_status=request.target_status,
            actor=request.actor,
            rationale=request.rationale,
            attestations=[
                item.model_dump() for item in request.attestations
            ],
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/evidence/impact", response_model=dict[str, Any],
             summary="Find FMEA records affected by changed evidence")
def impact(request: FMEAEvidenceImpactRequest) -> dict[str, Any]:
    return evidence_impact(
        request.study.model_dump(),
        [item.model_dump() for item in request.source_records],
    )


@router.post("/library/prepare", response_model=dict[str, Any],
             summary="Checksum a reusable FMEA family/foundation item")
def prepare_library(request: FMEALibraryPrepareRequest) -> dict[str, Any]:
    return prepare_library_item(request.item.model_dump())


@router.post("/library/instantiate", response_model=dict[str, Any],
             summary="Instantiate a released FMEA library item")
def instantiate_library(
    request: FMEALibraryInstantiateRequest,
) -> dict[str, Any]:
    try:
        return instantiate_library_item(
            request.study.model_dump(),
            request.item.model_dump(),
            instance_id=request.instance_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/suggestions", response_model=dict[str, Any],
             summary="Generate cited, proposal-only FMEA suggestions")
def suggestions(request: FMEASuggestionRequest) -> dict[str, Any]:
    return generate_suggestions(request.study.model_dump())
