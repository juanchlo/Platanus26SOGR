"""Tests to verify OpenAPI schema generation and compliance."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_openapi_json_schema(client: AsyncClient) -> None:
    """Test /openapi.json endpoint returns valid OpenAPI 3.x document."""
    response = await client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert "openapi" in schema
    assert "info" in schema
    assert schema["info"]["title"] == "SOGR API"
    assert "paths" in schema
    assert "/api/v1/auth/login" in schema["paths"]
    assert "/api/v1/auth/me" in schema["paths"]
    assert "/api/v1/health" in schema["paths"]
    assert "components" in schema
    assert "schemas" in schema["components"]
    assert "UserResponse" in schema["components"]["schemas"]
    assert "Token" in schema["components"]["schemas"]


@pytest.mark.asyncio
async def test_docs_html_endpoint(client: AsyncClient) -> None:
    """Test /docs Swagger UI endpoint is accessible."""
    response = await client.get("/docs")
    assert response.status_code == 200
    assert "swagger-ui" in response.text
