import os

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_browse_data_dir(client: AsyncClient, setup_test_dirs):
    data_dir, _ = setup_test_dirs
    # Create some test directories
    (data_dir / "movies").mkdir()
    (data_dir / "music").mkdir()
    (data_dir / "testfile.txt").write_text("hello")

    resp = await client.get(f"/api/browse?path={data_dir}")
    assert resp.status_code == 200
    data = resp.json()
    assert "entries" in data
    names = [e["name"] for e in data["entries"]]
    assert "movies" in names
    assert "music" in names
    assert "testfile.txt" in names

    # Directories should come first
    dir_entries = [e for e in data["entries"] if e["is_dir"]]
    file_entries = [e for e in data["entries"] if not e["is_dir"]]
    assert len(dir_entries) == 2
    assert len(file_entries) == 1


@pytest.mark.asyncio
async def test_browse_prevents_traversal(client: AsyncClient):
    resp = await client.get("/api/browse?path=/etc")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_browse_nonexistent_path(client: AsyncClient, setup_test_dirs):
    data_dir, _ = setup_test_dirs
    resp = await client.get(f"/api/browse?path={data_dir}/nonexistent")
    assert resp.status_code == 404
