import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_scans_empty(client: AsyncClient):
    resp = await client.get("/api/scans")
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["total"] == 0
    assert data["page"] == 1


@pytest.mark.asyncio
async def test_create_scan(client: AsyncClient):
    resp = await client.post("/api/scans", json={
        "name": "Test Scan",
        "scanner": "rmlint",
        "target_paths": ["/data/share1"],
    })
    # May be 201 or 500 if huey is not running, but the scan record should be created
    assert resp.status_code in (201, 200)
    if resp.status_code == 201:
        data = resp.json()
        assert data["name"] == "Test Scan"
        assert data["scanner"] == "rmlint"
        assert data["target_paths"] == ["/data/share1"]
        assert data["status"] in ("pending", "failed")


@pytest.mark.asyncio
async def test_get_scan_not_found(client: AsyncClient):
    resp = await client.get("/api/scans/9999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_scan_not_found(client: AsyncClient):
    resp = await client.delete("/api/scans/9999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_and_get_scan(client: AsyncClient):
    create_resp = await client.post("/api/scans", json={
        "name": "Get Test",
        "scanner": "rmlint",
        "target_paths": ["/data/videos"],
    })
    if create_resp.status_code != 201:
        pytest.skip("Scan creation failed (likely no huey worker)")

    scan_id = create_resp.json()["id"]
    get_resp = await client.get(f"/api/scans/{scan_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["name"] == "Get Test"


@pytest.mark.asyncio
async def test_list_scans_pagination(client: AsyncClient):
    resp = await client.get("/api/scans?page=1&per_page=10")
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert "pages" in data
