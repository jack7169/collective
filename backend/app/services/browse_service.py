import logging
import os
from dataclasses import dataclass
from typing import Optional

from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class FileInfo:
    name: str
    path: str
    is_dir: bool
    size: Optional[int]
    mtime: Optional[float]
    children_count: Optional[int]


class BrowseService:
    @staticmethod
    def list_directory(path: Optional[str] = None) -> list[FileInfo]:
        settings = get_settings()
        data_dir = os.path.realpath(settings.DATA_DIR)

        if path is None:
            target = data_dir
        else:
            target = os.path.realpath(path)

        if not target.startswith(data_dir):
            raise PermissionError(f"Access denied: path is outside DATA_DIR")

        if not os.path.isdir(target):
            raise FileNotFoundError(f"Directory not found: {target}")

        entries = []
        with os.scandir(target) as it:
            for entry in sorted(it, key=lambda e: (not e.is_dir(), e.name.lower())):
                try:
                    stat = entry.stat(follow_symlinks=False)
                    is_dir = entry.is_dir(follow_symlinks=False)
                    children = None
                    if is_dir:
                        try:
                            children = len(os.listdir(entry.path))
                        except PermissionError:
                            children = None

                    entries.append(FileInfo(
                        name=entry.name,
                        path=entry.path,
                        is_dir=is_dir,
                        size=stat.st_size if not is_dir else None,
                        mtime=stat.st_mtime,
                        children_count=children,
                    ))
                except (PermissionError, OSError) as e:
                    logger.warning("Cannot stat %s: %s", entry.path, e)

        return entries
