import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services import assimilate_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/assimilate", tags=["assimilate"])


class CreateSessionRequest(BaseModel):
    scan_id: int
    name: str
    dir_a: str
    dir_b: str


class StageOperationsRequest(BaseModel):
    operations: list[dict]


class AcknowledgeWarningsRequest(BaseModel):
    checksums: list[str]


@router.post("/sessions")
async def create_session(body: CreateSessionRequest, db: AsyncSession = Depends(get_db)):
    session = await assimilate_service.create_session(
        db, body.scan_id, body.name, body.dir_a, body.dir_b
    )
    await db.commit()
    return _session_response(session)


@router.get("/sessions")
async def list_sessions(
    scan_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    sessions = await assimilate_service.list_sessions(db, scan_id, status)
    return [_session_response(s) for s in sessions]


@router.get("/sessions/{session_id}")
async def get_session(session_id: int, db: AsyncSession = Depends(get_db)):
    session = await assimilate_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return _session_response(session)


@router.put("/sessions/{session_id}/stage")
async def stage_operations(
    session_id: int,
    body: StageOperationsRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        session = await assimilate_service.update_staged_ops(
            db, session_id, body.operations
        )
        await db.commit()
        return _session_response(session)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/sessions/{session_id}/preview")
async def preview_commit(session_id: int, db: AsyncSession = Depends(get_db)):
    try:
        preview = await assimilate_service.preview_commit(db, session_id)
        await db.commit()
        return preview
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/sessions/{session_id}/acknowledge")
async def acknowledge_warnings(
    session_id: int,
    body: AcknowledgeWarningsRequest,
    db: AsyncSession = Depends(get_db),
):
    session = await assimilate_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    existing = set(session.warnings_acknowledged or [])
    existing.update(body.checksums)
    session.warnings_acknowledged = list(existing)
    await db.commit()
    return _session_response(session)


@router.post("/sessions/{session_id}/commit")
async def commit_session(session_id: int, db: AsyncSession = Depends(get_db)):
    try:
        session = await assimilate_service.commit_session(db, session_id)
        await db.commit()
        return _session_response(session)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _session_response(session) -> dict:
    return {
        "id": session.id,
        "scan_id": session.scan_id,
        "name": session.name,
        "status": session.status,
        "dir_a": session.dir_a,
        "dir_b": session.dir_b,
        "staged_operations": session.staged_operations or [],
        "warnings_acknowledged": session.warnings_acknowledged or [],
        "preview_result": session.preview_result,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        "committed_at": session.committed_at.isoformat() if session.committed_at else None,
        "error_message": session.error_message,
        "files_affected": session.files_affected,
        "bytes_affected": session.bytes_affected,
    }
