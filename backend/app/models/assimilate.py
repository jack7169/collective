from sqlalchemy import Column, DateTime, Float, Integer, JSON, String, Text, func, ForeignKey
from app.database import Base


class AssimilateSession(Base):
    __tablename__ = "assimilate_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    scan_id = Column(Integer, ForeignKey("scans.id", ondelete="SET NULL"), nullable=True)
    name = Column(String, nullable=False)
    status = Column(String, default="working", nullable=False)
    # working → previewing → committing → committed → failed
    dir_a = Column(String, nullable=False)
    dir_b = Column(String, nullable=False)
    # List of staged ops: [{type, source, dest, description}]
    staged_operations = Column(JSON, default=list)
    # List of file checksums the user has accepted losing
    warnings_acknowledged = Column(JSON, default=list)
    # Preview result from last preview run
    preview_result = Column(JSON, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, onupdate=func.now(), nullable=True)
    committed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    files_affected = Column(Integer, nullable=True)
    bytes_affected = Column(Integer, nullable=True)
