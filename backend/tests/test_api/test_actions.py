import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_actions_empty(client: AsyncClient):
    resp = await client.get("/api/actions")
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_get_action_not_found(client: AsyncClient):
    resp = await client.get("/api/actions/9999")
    assert resp.status_code == 404
