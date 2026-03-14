from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Iterator, Optional


@dataclass
class DuplicateFileResult:
    checksum: str
    path: str
    size: int
    mtime: Optional[float]
    is_original: bool
    group_id: Optional[str]


@dataclass
class DuplicateDirResult:
    group_id: str
    path: str
    file_count: int
    total_size: int
    is_original: bool


@dataclass
class ScanProgressInfo:
    percent: Optional[float] = None
    message: Optional[str] = None
    total_files: Optional[int] = None


class ScannerBackend(ABC):
    @abstractmethod
    def build_command(
        self,
        target_paths: list[str],
        tagged_paths: Optional[list[str]],
        extra_flags: Optional[dict],
        output_path: str,
    ) -> list[str]:
        ...

    @abstractmethod
    def parse_output(self, output_path: str) -> Iterator[DuplicateFileResult | DuplicateDirResult]:
        ...

    @abstractmethod
    def parse_progress(self, line: str) -> Optional[ScanProgressInfo]:
        ...
