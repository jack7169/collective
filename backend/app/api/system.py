import asyncio
import logging
import os
import shutil

from fastapi import APIRouter

from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/system", tags=["system"])


@router.get("/health")
async def health_check():
    return {
        "status": "ok",
        "scanners": {
            "rmlint": shutil.which("rmlint") is not None,
            "fclones": shutil.which("fclones") is not None,
            "rsync": shutil.which("rsync") is not None,
        },
    }


@router.get("/scanners")
async def scanner_versions():
    scanners = {}

    for name, cmd in [("rmlint", ["rmlint", "--version"]), ("fclones", ["fclones", "--version"])]:
        if shutil.which(name) is None:
            scanners[name] = {"installed": False, "version": None}
            continue
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
            output = stdout.decode("utf-8", errors="replace").strip()
            if not output:
                output = stderr.decode("utf-8", errors="replace").strip()
            scanners[name] = {"installed": True, "version": output.split("\n")[0]}
        except (asyncio.TimeoutError, FileNotFoundError, OSError) as e:
            scanners[name] = {"installed": False, "version": None, "error": str(e)}

    return scanners


@router.get("/mounts")
async def list_mounts():
    settings = get_settings()
    data_dir = settings.DATA_DIR

    if not os.path.isdir(data_dir):
        return {"data_dir": data_dir, "mounts": [], "error": "DATA_DIR does not exist"}

    mounts = []
    try:
        for entry in sorted(os.listdir(data_dir)):
            full_path = os.path.join(data_dir, entry)
            if os.path.isdir(full_path):
                try:
                    stat = os.stat(full_path)
                    mounts.append({
                        "name": entry,
                        "path": full_path,
                        "accessible": True,
                    })
                except OSError:
                    mounts.append({
                        "name": entry,
                        "path": full_path,
                        "accessible": False,
                    })
    except PermissionError:
        return {"data_dir": data_dir, "mounts": [], "error": "Permission denied"}

    return {"data_dir": data_dir, "mounts": mounts}


@router.get("/btrfs")
async def btrfs_status():
    """Check BTRFS support for the data directory."""
    from app.services.btrfs_service import detect_btrfs
    settings = get_settings()
    status = detect_btrfs(settings.DATA_DIR)
    return {
        "is_btrfs": status.is_btrfs,
        "supports_reflinks": status.supports_reflinks,
        "supports_checksums": status.supports_checksums,
        "tools": status.tools_available,
        "subvolume": status.subvolume,
        "data_dir": settings.DATA_DIR,
    }
