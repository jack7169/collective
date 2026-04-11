from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class DirectorySimilarityResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    scan_id: int
    dir_a: str
    dir_b: str
    files_a: int
    files_b: int
    shared_files: int
    shared_size: int
    size_a: int
    size_b: int
    jaccard_similarity: float
    a_subset_pct: float
    b_subset_pct: float
    structural_similarity: Optional[float] = None
    unique_to_a: int
    unique_to_b: int
    relationship: Optional[str] = None
    is_rollup: bool = False


class DirectorySimilarityFilters(BaseModel):
    min_similarity: float = Field(default=0.0, ge=0.0, le=100.0)
    sort_by: str = Field(default="shared_size")
    sort_order: str = Field(default="desc", pattern="^(asc|desc)$")
    relationship: Optional[str] = None
    path_filter: Optional[str] = None
