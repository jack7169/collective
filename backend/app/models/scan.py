from sqlalchemy import BigInteger, Column, DateTime, Float, Integer, JSON, String, Text, func
from app.database import Base


class Scan(Base):
    __tablename__ = "scans"

    id = Column(Integer, primary_key=True, autoincrement=True)
    saved_scan_id = Column(Integer, nullable=True)  # links to saved_scans.id
    name = Column(String, nullable=False)
    status = Column(String, default="pending", nullable=False)
    scanner = Column(String, default="rmlint", nullable=False)
    target_paths = Column(JSON, nullable=False)
    tagged_paths = Column(JSON, nullable=True)
    scanner_flags = Column(JSON, nullable=True)
    scan_depth = Column(Integer, nullable=True)
    similarity_threshold = Column(Float, default=50.0)
    total_files = Column(Integer, nullable=True)
    total_dirs = Column(Integer, nullable=True)
    total_size = Column(BigInteger, nullable=True)
    duplicates_found = Column(Integer, nullable=True)
    space_recoverable = Column(BigInteger, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    progress_percent = Column(Float, nullable=True)
    progress_message = Column(String, nullable=True)
    interrupted_phase = Column(String, nullable=True)  # Phase when interrupted: "running", "parsing", "analyzing"
