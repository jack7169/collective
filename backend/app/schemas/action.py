from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict


class ActionCreate(BaseModel):
    scan_id: int
    similarity_id: Optional[int] = None
    action_type: Literal["merge", "delete", "hardlink", "symlink", "move", "skip", "bookmark"]
    source_path: str
    dest_path: Optional[str] = None
    notes: Optional[str] = None


class ActionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    scan_id: Optional[int] = None
    similarity_id: Optional[int] = None
    action_type: str
    source_path: str
    dest_path: Optional[str] = None
    status: str
    dry_run_output: Optional[str] = None
    files_affected: Optional[int] = None
    bytes_affected: Optional[int] = None
    executed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
