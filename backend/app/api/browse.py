import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/browse", tags=["browse"])


@router.get("")
async def browse_directory(path: Optional[str] = Query(None)):
    settings = get_settings()
    data_dir = os.path.realpath(settings.DATA_DIR)

    if path is None:
        target = data_dir
    else:
        target = os.path.realpath(path)

    if not target.startswith(data_dir):
        raise HTTPException(status_code=403, detail="Access denied: path is outside DATA_DIR")

    if not os.path.isdir(target):
        raise HTTPException(status_code=404, detail="Directory not found")

    entries = []
    try:
        with os.scandir(target) as it:
            for entry in sorted(it, key=lambda e: (not e.is_dir(), e.name.lower())):
                try:
                    stat = entry.stat(follow_symlinks=False)
                    info = {
                        "name": entry.name,
                        "path": entry.path,
                        "is_dir": entry.is_dir(follow_symlinks=False),
                        "size": stat.st_size if not entry.is_dir() else None,
                        "mtime": stat.st_mtime,
                    }
                    if entry.is_dir(follow_symlinks=False):
                        try:
                            info["children_count"] = len(os.listdir(entry.path))
                        except PermissionError:
                            info["children_count"] = None
                    else:
                        info["children_count"] = None
                    entries.append(info)
                except (PermissionError, OSError) as e:
                    entries.append({
                        "name": entry.name,
                        "path": entry.path,
                        "is_dir": False,
                        "size": None,
                        "mtime": None,
                        "children_count": None,
                        "error": str(e),
                    })
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied reading directory")

    return {
        "path": target,
        "parent": os.path.dirname(target) if target != data_dir else None,
        "entries": entries,
    }
