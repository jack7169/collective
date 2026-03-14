import asyncio
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.duplicate import DuplicateFile

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/compare", tags=["compare"])


@router.get("")
async def compare_directories(
    dir_a: str = Query(...),
    dir_b: str = Query(...),
    scan_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
):
    q = select(DuplicateFile).where(
        DuplicateFile.scan_id == scan_id,
        (DuplicateFile.path.startswith(dir_a + "/"))
        | (DuplicateFile.path.startswith(dir_b + "/")),
    )
    result = await db.execute(q)
    files = result.scalars().all()

    files_a: dict[str, DuplicateFile] = {}
    files_b: dict[str, DuplicateFile] = {}
    checksums_a: dict[str, list[str]] = {}
    checksums_b: dict[str, list[str]] = {}

    for f in files:
        if f.path.startswith(dir_a + "/"):
            rel_path = f.path[len(dir_a):]
            files_a[rel_path] = f
            checksums_a.setdefault(f.checksum, []).append(rel_path)
        elif f.path.startswith(dir_b + "/"):
            rel_path = f.path[len(dir_b):]
            files_b[rel_path] = f
            checksums_b.setdefault(f.checksum, []).append(rel_path)

    shared_checksums = set(checksums_a.keys()) & set(checksums_b.keys())
    unique_checksums_a = set(checksums_a.keys()) - shared_checksums
    unique_checksums_b = set(checksums_b.keys()) - shared_checksums

    def file_info(f: DuplicateFile) -> dict:
        return {
            "path": f.path,
            "size": f.size,
            "checksum": f.checksum,
            "is_original": f.is_original,
        }

    shared = []
    for cksum in shared_checksums:
        shared.append({
            "checksum": cksum,
            "in_a": [files_a[p].path for p in checksums_a[cksum]],
            "in_b": [files_b[p].path for p in checksums_b[cksum]],
            "size": files_a[checksums_a[cksum][0]].size,
        })

    unique_a = []
    for cksum in unique_checksums_a:
        for rel in checksums_a[cksum]:
            unique_a.append(file_info(files_a[rel]))

    unique_b = []
    for cksum in unique_checksums_b:
        for rel in checksums_b[cksum]:
            unique_b.append(file_info(files_b[rel]))

    return {
        "dir_a": dir_a,
        "dir_b": dir_b,
        "shared": shared,
        "unique_to_a": unique_a,
        "unique_to_b": unique_b,
        "shared_count": len(shared),
        "unique_to_a_count": len(unique_a),
        "unique_to_b_count": len(unique_b),
    }


class RsyncDryRunRequest(BaseModel):
    source: str
    dest: str


@router.post("/rsync-dry-run")
async def rsync_dry_run(body: RsyncDryRunRequest):
    settings = get_settings()
    source = os.path.realpath(body.source)
    dest = os.path.realpath(body.dest)

    if not source.startswith(settings.DATA_DIR):
        raise HTTPException(status_code=400, detail="Source must be within DATA_DIR")
    if not dest.startswith(settings.DATA_DIR):
        raise HTTPException(status_code=400, detail="Destination must be within DATA_DIR")

    source_trailing = source.rstrip("/") + "/"
    cmd = ["rsync", "-avcn", "--delete", source_trailing, dest]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        return {
            "command": " ".join(cmd),
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
            "returncode": proc.returncode,
        }
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="rsync dry-run timed out")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="rsync not found on system")


# --- Filesystem management operations for the comparison view ---


class FileOperation(BaseModel):
    """A single file operation within a directory comparison context."""
    operation: str  # "move", "copy", "delete", "hardlink", "symlink"
    source_path: str
    dest_path: str | None = None


class BulkFileOperation(BaseModel):
    """Bulk file operations from the comparison view."""
    operations: list[FileOperation]
    dry_run: bool = True


@router.post("/file-ops")
async def execute_file_operations(body: BulkFileOperation):
    """
    Execute file operations from the side-by-side comparison view.
    Always validates paths are within DATA_DIR. Supports dry-run mode.
    """
    settings = get_settings()
    data_dir = os.path.realpath(settings.DATA_DIR)
    results = []

    for op in body.operations:
        source = os.path.realpath(op.source_path)
        if not source.startswith(data_dir):
            results.append({
                "source": op.source_path,
                "status": "error",
                "message": "Source path is outside DATA_DIR",
            })
            continue

        if op.dest_path:
            dest = os.path.realpath(op.dest_path)
            if not dest.startswith(data_dir):
                results.append({
                    "source": op.source_path,
                    "status": "error",
                    "message": "Destination path is outside DATA_DIR",
                })
                continue

        if body.dry_run:
            results.append({
                "source": op.source_path,
                "dest": op.dest_path,
                "operation": op.operation,
                "status": "dry_run",
                "message": f"Would {op.operation} {op.source_path}" + (f" -> {op.dest_path}" if op.dest_path else ""),
                "exists": os.path.exists(source),
            })
            continue

        try:
            if op.operation == "delete":
                if os.path.isfile(source):
                    os.remove(source)
                elif os.path.isdir(source):
                    import shutil
                    shutil.rmtree(source)
                results.append({"source": op.source_path, "status": "success", "operation": op.operation})

            elif op.operation == "move" and op.dest_path:
                os.makedirs(os.path.dirname(op.dest_path), exist_ok=True)
                import shutil
                shutil.move(source, op.dest_path)
                results.append({"source": op.source_path, "dest": op.dest_path, "status": "success", "operation": op.operation})

            elif op.operation == "copy" and op.dest_path:
                os.makedirs(os.path.dirname(op.dest_path), exist_ok=True)
                import shutil
                if os.path.isdir(source):
                    shutil.copytree(source, op.dest_path)
                else:
                    shutil.copy2(source, op.dest_path)
                results.append({"source": op.source_path, "dest": op.dest_path, "status": "success", "operation": op.operation})

            elif op.operation == "hardlink" and op.dest_path:
                os.makedirs(os.path.dirname(op.dest_path), exist_ok=True)
                os.link(source, op.dest_path)
                results.append({"source": op.source_path, "dest": op.dest_path, "status": "success", "operation": op.operation})

            elif op.operation == "symlink" and op.dest_path:
                os.makedirs(os.path.dirname(op.dest_path), exist_ok=True)
                os.symlink(source, op.dest_path)
                results.append({"source": op.source_path, "dest": op.dest_path, "status": "success", "operation": op.operation})

            else:
                results.append({"source": op.source_path, "status": "error", "message": f"Unknown operation: {op.operation}"})

        except Exception as e:
            results.append({"source": op.source_path, "status": "error", "message": str(e)})

    return {"results": results, "dry_run": body.dry_run}


class DirectoryTreeRequest(BaseModel):
    """Request for side-by-side directory tree comparison."""
    dir_a: str
    dir_b: str
    max_depth: int = 5


@router.post("/tree-diff")
async def tree_diff(body: DirectoryTreeRequest):
    """
    Compare two directory trees structurally — returns a unified tree
    showing which subdirectories and files exist in each side.
    Integrates with filesystem browsing for navigation.
    """
    settings = get_settings()
    data_dir = os.path.realpath(settings.DATA_DIR)

    dir_a = os.path.realpath(body.dir_a)
    dir_b = os.path.realpath(body.dir_b)

    for d in [dir_a, dir_b]:
        if not d.startswith(data_dir):
            raise HTTPException(status_code=400, detail="Path must be within DATA_DIR")
        if not os.path.isdir(d):
            raise HTTPException(status_code=404, detail=f"Directory not found: {d}")

    def scan_tree(root: str, depth: int = 0) -> dict:
        entries = {}
        if depth > body.max_depth:
            return entries
        try:
            with os.scandir(root) as it:
                for entry in sorted(it, key=lambda e: (not e.is_dir(), e.name.lower())):
                    try:
                        stat = entry.stat(follow_symlinks=False)
                        info = {
                            "name": entry.name,
                            "is_dir": entry.is_dir(follow_symlinks=False),
                            "size": stat.st_size,
                            "mtime": stat.st_mtime,
                        }
                        if entry.is_dir(follow_symlinks=False) and depth < body.max_depth:
                            info["children"] = scan_tree(entry.path, depth + 1)
                        entries[entry.name] = info
                    except (PermissionError, OSError):
                        entries[entry.name] = {"name": entry.name, "error": True}
        except (PermissionError, OSError):
            pass
        return entries

    tree_a = scan_tree(dir_a)
    tree_b = scan_tree(dir_b)

    def diff_trees(a: dict, b: dict) -> list[dict]:
        all_names = sorted(set(list(a.keys()) + list(b.keys())))
        result = []
        for name in all_names:
            in_a = a.get(name)
            in_b = b.get(name)

            node = {"name": name}
            if in_a and in_b:
                node["status"] = "both"
                node["size_a"] = in_a.get("size")
                node["size_b"] = in_b.get("size")
                node["is_dir"] = in_a.get("is_dir", False) or in_b.get("is_dir", False)
                if in_a.get("size") == in_b.get("size") and not in_a.get("is_dir"):
                    node["match"] = "size_match"
                elif in_a.get("is_dir") and in_b.get("is_dir"):
                    children_a = in_a.get("children", {})
                    children_b = in_b.get("children", {})
                    node["children"] = diff_trees(children_a, children_b)
                    total = len(node["children"]) if node["children"] else 1
                    both = sum(1 for c in node["children"] if c.get("status") == "both")
                    node["similarity"] = round(both / total * 100, 1) if total > 0 else 0
                else:
                    node["match"] = "name_only"
            elif in_a:
                node["status"] = "only_a"
                node["size_a"] = in_a.get("size")
                node["is_dir"] = in_a.get("is_dir", False)
                if in_a.get("is_dir") and in_a.get("children"):
                    node["children"] = [
                        {"name": k, "status": "only_a", "is_dir": v.get("is_dir", False), "size_a": v.get("size")}
                        for k, v in in_a["children"].items()
                    ]
            else:
                node["status"] = "only_b"
                node["size_b"] = in_b.get("size")
                node["is_dir"] = in_b.get("is_dir", False)
                if in_b.get("is_dir") and in_b.get("children"):
                    node["children"] = [
                        {"name": k, "status": "only_b", "is_dir": v.get("is_dir", False), "size_b": v.get("size")}
                        for k, v in in_b["children"].items()
                    ]

            result.append(node)
        return result

    diff = diff_trees(tree_a, tree_b)

    # Summary stats
    def count_status(nodes: list[dict]) -> dict:
        counts = {"both": 0, "only_a": 0, "only_b": 0}
        for n in nodes:
            status = n.get("status", "both")
            if status in counts:
                counts[status] += 1
            for child in n.get("children", []):
                child_counts = count_status([child])
                for k in counts:
                    counts[k] += child_counts[k]
        return counts

    stats = count_status(diff)

    return {
        "dir_a": body.dir_a,
        "dir_b": body.dir_b,
        "tree": diff,
        "stats": stats,
    }
