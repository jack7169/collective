from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class ScanCreate(BaseModel):
    name: str
    scanner: Literal["rmlint", "fclones"] = "rmlint"
    target_paths: list[str]
    tagged_paths: Optional[list[str]] = None
    scanner_flags: Optional[dict] = None
    scan_depth: Optional[int] = None
    similarity_threshold: Optional[float] = None


class ScanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    saved_scan_id: Optional[int] = None
    name: str
    status: str
    scanner: str
    target_paths: list[str]
    tagged_paths: Optional[list[str]] = None
    scanner_flags: Optional[dict] = None
    scan_depth: Optional[int] = None
    similarity_threshold: float
    total_files: Optional[int] = None
    total_size: Optional[int] = None
    duplicates_found: Optional[int] = None
    space_recoverable: Optional[int] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    created_at: datetime
    progress_percent: Optional[float] = None
    progress_message: Optional[str] = None


class ScanProgress(BaseModel):
    scan_id: int
    status: str
    progress_percent: Optional[float] = None
    progress_message: Optional[str] = None
    total_files: Optional[int] = None
    duplicates_found: Optional[int] = None


class ReanalyzeRequest(BaseModel):
    similarity_threshold: Optional[float] = None
    scan_depth: Optional[int] = None
