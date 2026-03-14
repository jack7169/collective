import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.action import Action
from app.schemas.action import ActionCreate, ActionResponse
from app.schemas.common import PaginatedResponse
from app.services.action_service import ActionService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/actions", tags=["actions"])


@router.get("", response_model=PaginatedResponse[ActionResponse])
async def list_actions(
    scan_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    actions, total = await ActionService.list_actions(db, scan_id, status, page, per_page)
    return PaginatedResponse.create(
        items=[ActionResponse.model_validate(a) for a in actions],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.post("", response_model=ActionResponse, status_code=201)
async def create_action(
    body: ActionCreate,
    db: AsyncSession = Depends(get_db),
):
    action = await ActionService.create_action(db, body)
    await db.commit()
    return ActionResponse.model_validate(action)


@router.get("/{action_id}", response_model=ActionResponse)
async def get_action(action_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Action).where(Action.id == action_id))
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    return ActionResponse.model_validate(action)


@router.post("/{action_id}/dry-run", response_model=ActionResponse)
async def dry_run_action(action_id: int, db: AsyncSession = Depends(get_db)):
    action = await ActionService.run_dry_run(db, action_id)
    await db.commit()
    return ActionResponse.model_validate(action)


@router.post("/{action_id}/confirm", response_model=ActionResponse)
async def confirm_action(action_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Action).where(Action.id == action_id))
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    if action.status not in ("planned", "dry_run"):
        raise HTTPException(
            status_code=400, detail=f"Cannot confirm action with status '{action.status}'"
        )
    action.status = "confirmed"
    await db.commit()
    await db.refresh(action)

    try:
        from app.tasks.action_tasks import execute_action_task
        execute_action_task(action.id)
        logger.info("Enqueued action execution task for action %d", action.id)
    except Exception as e:
        logger.error("Failed to enqueue action task: %s", e)

    return ActionResponse.model_validate(action)
