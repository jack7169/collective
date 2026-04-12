from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.sandbox import SandboxSession

router = APIRouter(tags=["sandbox"])


# --- Response / request schemas ---

class SessionResponse(BaseModel):
    id: int
    scan_id: int
    name: Optional[str]
    commands: list
    cursor: int
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm(cls, obj: SandboxSession) -> "SessionResponse":
        return cls(
            id=obj.id,
            scan_id=obj.scan_id,
            name=obj.name,
            commands=obj.commands or [],
            cursor=obj.cursor,
            created_at=obj.created_at.isoformat() if obj.created_at else "",
            updated_at=obj.updated_at.isoformat() if obj.updated_at else "",
        )


class CreateSessionBody(BaseModel):
    name: Optional[str] = None


class UpdateSessionBody(BaseModel):
    commands: list
    cursor: int


# --- Scan-scoped routes ---

@router.get("/scans/{scan_id}/sandbox", response_model=SessionResponse)
async def get_sandbox(scan_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SandboxSession)
        .where(SandboxSession.scan_id == scan_id)
        .order_by(desc(SandboxSession.updated_at))
        .limit(1)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="No sandbox session for this scan")
    return SessionResponse.from_orm(session)


@router.post("/scans/{scan_id}/sandbox", response_model=SessionResponse, status_code=201)
async def create_sandbox(
    scan_id: int,
    body: CreateSessionBody,
    db: AsyncSession = Depends(get_db),
):
    # Idempotent: return existing session if one already exists
    result = await db.execute(
        select(SandboxSession)
        .where(SandboxSession.scan_id == scan_id)
        .order_by(desc(SandboxSession.updated_at))
        .limit(1)
    )
    existing = result.scalar_one_or_none()
    if existing:
        return SessionResponse.from_orm(existing)

    session = SandboxSession(
        scan_id=scan_id,
        name=body.name,
        commands=[],
        cursor=0,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return SessionResponse.from_orm(session)


# --- Session-scoped routes ---

@router.put("/sandbox/{session_id}", response_model=SessionResponse)
async def update_sandbox(
    session_id: int,
    body: UpdateSessionBody,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(SandboxSession).where(SandboxSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Sandbox session not found")

    session.commands = body.commands
    session.cursor = body.cursor
    await db.commit()
    await db.refresh(session)
    return SessionResponse.from_orm(session)


@router.delete("/sandbox/{session_id}")
async def delete_sandbox(session_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SandboxSession).where(SandboxSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Sandbox session not found")

    await db.delete(session)
    await db.commit()
    return {"ok": True}
