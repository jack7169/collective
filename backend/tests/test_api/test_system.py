import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    resp = await client.get("/api/system/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "scanners" in data
    assert "rmlint" in data["scanners"]
    assert "fclones" in data["scanners"]
    assert "rsync" in data["scanners"]


@pytest.mark.asyncio
async def test_scanner_versions(client: AsyncClient):
    resp = await client.get("/api/system/scanners")
    assert resp.status_code == 200
    data = resp.json()
    assert "rmlint" in data
    assert "fclones" in data


@pytest.mark.asyncio
async def test_list_mounts(client: AsyncClient):
    resp = await client.get("/api/system/mounts")
    assert resp.status_code == 200
    data = resp.json()
    assert "data_dir" in data
    assert "mounts" in data
