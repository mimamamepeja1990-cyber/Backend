import os
import sys

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text


# Keep this test focused on request handling; do not run the production
# bootstrap/migrations as a side effect of importing the application.
os.environ.setdefault("SKIP_STARTUP_BOOTSTRAP", "1")

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from app.main import app  # noqa: E402
from app.observability import (  # noqa: E402
    begin_request_metrics,
    configure_sqlalchemy_instrumentation,
    current_request_metrics,
    reset_request_metrics,
)


def test_http_middleware_preserves_health_response_and_adds_request_id():
    with TestClient(app) as client:
        response = client.get("/health", headers={"X-Request-ID": "test-observe"})

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "mercadopago_configured": bool((os.environ.get("MERCADOPAGO_ACCESS_TOKEN") or "").strip()),
    }
    assert response.headers["X-Request-ID"] == "test-observe"


def test_sql_instrumentation_counts_query_without_logging_sql_text():
    engine = create_engine("sqlite://")
    configure_sqlalchemy_instrumentation(engine)
    token = begin_request_metrics("sql-test", "GET", "/products")
    try:
        with engine.connect() as connection:
            assert connection.execute(text("SELECT 1")).scalar_one() == 1
        metrics = current_request_metrics()
        assert metrics is not None
        assert metrics.query_count == 1
        assert metrics.sql_time_ms >= 0
    finally:
        reset_request_metrics(token)
        engine.dispose()


def test_catalog_endpoints_keep_json_shapes():
    expected_shapes = {
        "/products": list,
        "/products/paged": dict,
        "/init": dict,
        "/promotions": list,
        "/api/consumos": list,
        "/filters.json": list,
        "/product-categories.json": dict,
    }
    with TestClient(app) as client:
        for path, expected_type in expected_shapes.items():
            response = client.get(path)
            assert response.status_code == 200, path
            assert isinstance(response.json(), expected_type), path

        products = client.get("/products").json()
        if products and products[0].get("id") is not None:
            detail = client.get(f"/products/{products[0]['id']}")
            assert detail.status_code == 200
            assert isinstance(detail.json(), dict)


def test_products_websocket_still_accepts_connections():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/products", headers={"X-Request-ID": "ws-test"}):
            pass
