"""API routes for industry templates."""

from __future__ import annotations

from fastapi import APIRouter

from ..services.templates.industry_templates import (
    get_template,
    list_templates,
)

router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("/industries")
async def list_industry_templates():
    """List all available industry review templates."""
    return {"templates": list_templates()}


@router.get("/industries/{industry_id}")
async def get_industry_template(industry_id: str):
    """Get a specific industry template."""
    t = get_template(industry_id)
    if t is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Industry template '{industry_id}' not found")
    return {
        "id": t.id,
        "name_ja": t.name_ja,
        "name_en": t.name_en,
        "description": t.description,
        "rubric_weights": t.rubric_weights,
        "focus_areas": t.focus_areas,
        "example_cta_patterns": t.example_cta_patterns,
        "prompt_augmentation": t.prompt_augmentation,
    }
