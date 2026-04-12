import asyncio
import logging
import os
from collections import OrderedDict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.duplicate import DuplicateFile

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/compare", tags=["compare"])


class _LRUCache(OrderedDict):
    """Simple LRU cache using OrderedDict — no external dependencies."""
    def __init__(self, maxsize: int = 256):
        super().__init__()
        self._maxsize = maxsize

    def __getitem__(self, key):
        self.move_to_end(key)
        return super().__getitem__(key)

    def __setitem__(self, key, value):
        if key in self:
            self.move_to_end(key)
        super().__setitem__(key, value)
        while len(self) > self._maxsize:
            self.popitem(last=False)


_compare_cache: _LRUCache = _LRUCache(maxsize=256)


def clear_caches_for_scan(scan_id: int):
    """Remove cached entries for a specific scan."""
    prefix = f"{scan_id}:"
    for cache in (_compare_cache, _tree_cache):
        keys = [k for k in cache if k.startswith(prefix)]
        for k in keys:
            del cache[k]


@router.get("")
async def compare_directories(
    dir_a: str = Query(...),
    dir_b: str = Query(...),
    scan_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
):
    cache_key = f"{scan_id}:{dir_a}:{dir_b}"
    if cache_key in _compare_cache:
        return _compare_cache[cache_key]

    q = select(
        DuplicateFile.path,
        DuplicateFile.size,
        DuplicateFile.mtime,
        DuplicateFile.checksum,
    ).where(
        DuplicateFile.scan_id == scan_id,
        (DuplicateFile.path.startswith(dir_a + "/"))
        | (DuplicateFile.path.startswith(dir_b + "/")),
    )
    result = await db.execute(q)
    files = result.all()

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

    def file_response(f) -> dict:
        return {
            "name": os.path.basename(f.path),
            "path": f.path,
            "size": f.size,
            "mtime": f.mtime if hasattr(f, "mtime") and f.mtime else "",
            "checksum": f.checksum,
        }

    shared_files = []
    shared_size = 0
    for cksum in shared_checksums:
        first_rel = checksums_a[cksum][0]
        f = files_a[first_rel]
        shared_files.append(file_response(f))
        shared_size += f.size

    only_in_a = []
    only_a_size = 0
    for cksum in unique_checksums_a:
        for rel in checksums_a[cksum]:
            f = files_a[rel]
            only_in_a.append(file_response(f))
            only_a_size += f.size

    only_in_b = []
    only_b_size = 0
    for cksum in unique_checksums_b:
        for rel in checksums_b[cksum]:
            f = files_b[rel]
            only_in_b.append(file_response(f))
            only_b_size += f.size

    response = {
        "dir_a": dir_a,
        "dir_b": dir_b,
        "shared_files": shared_files,
        "only_in_a": only_in_a,
        "only_in_b": only_in_b,
        "shared_size": shared_size,
        "only_a_size": only_a_size,
        "only_b_size": only_b_size,
    }

    _compare_cache[cache_key] = response
    return response


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
    scan_id: int | None = None


_tree_cache: _LRUCache = _LRUCache(maxsize=64)


@router.post("/tree-diff")
async def tree_diff(body: DirectoryTreeRequest):
    """
    Compare two directory trees structurally — returns a unified tree
    showing which subdirectories and files exist in each side.
    Folders where all children share the same status are collapsed by default.
    """
    cache_key = f"{body.scan_id}:{body.dir_a}:{body.dir_b}:{body.max_depth}"
    if cache_key in _tree_cache:
        return _tree_cache[cache_key]

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

    def get_uniform_status(children: list[dict]) -> str | None:
        """If all children (recursively) share the same status, return it."""
        if not children:
            return None
        statuses = set()
        for child in children:
            statuses.add(child.get("status", "both"))
            # Check nested children too
            nested = child.get("children")
            if nested:
                nested_status = get_uniform_status(nested)
                if nested_status:
                    statuses.add(nested_status)
                else:
                    return None  # Mixed nested children
        if len(statuses) == 1:
            return statuses.pop()
        return None

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
                    # Smart collapse: if all children share uniform status, mark folder as collapsed
                    uniform = get_uniform_status(node["children"])
                    if uniform:
                        node["collapsed"] = True
                        node["child_count"] = total
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
                    node["collapsed"] = True
                    node["child_count"] = len(node["children"])
            else:
                node["status"] = "only_b"
                node["size_b"] = in_b.get("size")
                node["is_dir"] = in_b.get("is_dir", False)
                if in_b.get("is_dir") and in_b.get("children"):
                    node["children"] = [
                        {"name": k, "status": "only_b", "is_dir": v.get("is_dir", False), "size_b": v.get("size")}
                        for k, v in in_b["children"].items()
                    ]
                    node["collapsed"] = True
                    node["child_count"] = len(node["children"])

            result.append(node)
        return result

    diff = diff_trees(tree_a, tree_b)

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

    response = {
        "dir_a": body.dir_a,
        "dir_b": body.dir_b,
        "tree": diff,
        "stats": stats,
    }

    _tree_cache[cache_key] = response
    return response
