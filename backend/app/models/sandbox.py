from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON, Index, func
from app.database import Base


class SandboxSession(Base):
    __tablename__ = "sandbox_sessions"

    id = Column(Integer, primary_key=True)
    scan_id = Column(Integer, ForeignKey("scans.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=True)
    commands = Column(JSON, nullable=False, default=list)
    cursor = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_sandbox_sessions_scan_id", "scan_id"),
    )
