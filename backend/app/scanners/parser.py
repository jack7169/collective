import os

from app.config import get_settings


def normalize_path(path: str) -> str:
    settings = get_settings()
    resolved = os.path.realpath(os.path.expanduser(path))
    data_dir = os.path.realpath(settings.DATA_DIR)
    if not resolved.startswith(data_dir):
        raise ValueError(f"Path '{path}' is outside DATA_DIR '{data_dir}'")
    return resolved


def truncate_to_depth(path: str, depth: int) -> str:
    parts = path.rstrip("/").split("/")
    if depth <= 0:
        return path
    if len(parts) <= depth + 1:
        return path
    return "/".join(parts[: depth + 1])


def get_parent_directory(path: str) -> str:
    return os.path.dirname(path)


def get_relative_path(path: str, base: str) -> str:
    return os.path.relpath(path, base)
