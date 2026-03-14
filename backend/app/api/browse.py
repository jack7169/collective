import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/browse", tags=["browse"])


def _allowed_roots() -> list[str]:
    """Return all directories the user is allowed to browse."""
    settings = get_settings()
    roots = [os.path.realpath(settings.DATA_DIR)]
    for p in settings.BROWSE_PATHS.split(","):
        p = p.strip()
        if p:
            roots.append(os.path.realpath(p))
    return roots


@router.get("")
async def browse_directory(path: Optional[str] = Query(None)):
    settings = get_settings()
    allowed = _allowed_roots()

    if path is None:
        target = allowed[0]
    else:
        target = os.path.realpath(path)

    if not any(target == root or target.startswith(root + os.sep) for root in allowed):
        raise HTTPException(status_code=403, detail="Access denied: path is outside allowed directories")

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

    # Allow navigating up only if parent is still within an allowed root
    parent = os.path.dirname(target)
    parent_allowed = any(
        parent == root or parent.startswith(root + os.sep) for root in allowed
    )

    return {
        "path": target,
        "parent": parent if parent_allowed else None,
        "entries": entries,
    }
