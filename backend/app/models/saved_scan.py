"""
SavedScan — a persistent scan configuration with optional scheduling.

A SavedScan defines WHAT to scan and HOW OFTEN. Each execution creates
a Scan record (a "run") linked back via saved_scan_id. This gives users:
- Reusable scan configs they can re-run with one click
- A history of runs showing how duplicates change over time
- Automatic scheduling so Collective always has fresh data
"""
from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, Float, Integer, JSON, String, Text, func
)
from app.database import Base


class SavedScan(Base):
    __tablename__ = "saved_scans"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Configuration
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    scanner = Column(String, default="rmlint", nullable=False)
    target_paths = Column(JSON, nullable=False)  # list of paths to scan
    tagged_paths = Column(JSON, nullable=True)    # post-scan originals
    scanner_flags = Column(JSON, nullable=True)
    scan_depth = Column(Integer, default=5)
    similarity_threshold = Column(Float, default=10.0)

    # Schedule (null = manual only)
    schedule_enabled = Column(Boolean, default=False, nullable=False)
    schedule_interval = Column(String, nullable=True)  # hourly|daily|weekly|monthly
    schedule_interval_value = Column(Integer, default=1)  # every N intervals
    schedule_day_of_week = Column(Integer, nullable=True)  # 0=Mon..6=Sun for weekly
    schedule_hour = Column(Integer, default=3)  # hour of day to run (default 3am)

    # State
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    last_scan_id = Column(Integer, nullable=True)  # FK to scans.id (most recent run)
    total_runs = Column(Integer, default=0, nullable=False)

    # Stats from most recent completed run (cached for quick dashboard display)
    last_total_files = Column(Integer, nullable=True)
    last_duplicates_found = Column(Integer, nullable=True)
    last_space_recoverable = Column(BigInteger, nullable=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
