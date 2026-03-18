from uuid import uuid4

from fastapi.testclient import TestClient

from app import models, utils
from app.database import SessionLocal
from app.main import app


def _create_driver_with_orders():
    db = SessionLocal()
    username = f"driver_{uuid4().hex[:8]}"
    email = f"cliente_{uuid4().hex[:8]}@example.com"
    driver = models.AdminUser(
        username=username,
        full_name="Driver Test",
        role="repartidor",
        zone="Capital",
        hashed_password=utils.hash_password("secret"),
        is_active=True,
    )
    db.add(driver)
    db.commit()
    db.refresh(driver)

    order_one = models.Order(
        items=[{"id": "1", "qty": 1}],
        total=1200.0,
        status="preparado",
        user_full_name="Cliente Test",
        user_email=email,
        user_calle="San Martin",
        user_numeracion="123",
        assigned_driver_id=driver.id,
        assigned_driver_username=driver.username,
        assigned_driver_name=driver.full_name,
        assigned_driver_zone=driver.zone,
        route_id=f"route-{uuid4().hex[:6]}",
        route_order=1,
    )
    order_two = models.Order(
        items=[{"id": "2", "qty": 1}],
        total=800.0,
        status="preparado",
        user_full_name="Cliente Test 2",
        user_email=f"cliente2_{uuid4().hex[:8]}@example.com",
        user_calle="Belgrano",
        user_numeracion="456",
        assigned_driver_id=driver.id,
        assigned_driver_username=driver.username,
        assigned_driver_name=driver.full_name,
        assigned_driver_zone=driver.zone,
        route_id=order_one.route_id,
        route_order=2,
    )
    db.add_all([order_one, order_two])
    db.commit()
    db.refresh(order_one)
    db.refresh(order_two)
    db.close()
    return driver.id, driver.username, order_one.id, order_two.id


def _cleanup_records(driver_id: int, order_ids: list[int]):
    db = SessionLocal()
    try:
        for order_id in order_ids:
            row = db.query(models.Order).filter(models.Order.id == order_id).first()
            if row:
                db.delete(row)
        user = db.query(models.AdminUser).filter(models.AdminUser.id == driver_id).first()
        if user:
            db.delete(user)
        db.commit()
    finally:
        db.close()


def _driver_token(driver_id: int, username: str) -> str:
    return utils.create_access_token({
        "sub": username,
        "id": driver_id,
        "role": "repartidor",
        "kind": "admin",
    })


def test_first_closed_issue_moves_order_to_end():
    client = TestClient(app)
    driver_id, username, first_order_id, second_order_id = _create_driver_with_orders()
    token = _driver_token(driver_id, username)

    try:
        response = client.post(
            f"/orders/{first_order_id}/delivery-issue",
            headers={"Authorization": f"Bearer {token}"},
            json={"type": "negocio_cerrado", "photo_url": "/images/123"},
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["action"] == "moved_to_end"
        assert data["order"]["closed_attempts"] == 1
        assert data["order"]["status"] == "enviado"

        db = SessionLocal()
        try:
            first = db.query(models.Order).filter(models.Order.id == first_order_id).first()
            second = db.query(models.Order).filter(models.Order.id == second_order_id).first()
            assert first is not None
            assert second is not None
            assert first.route_order == 2
            assert second.route_order == 1
        finally:
            db.close()
    finally:
        _cleanup_records(driver_id, [first_order_id, second_order_id])


def test_second_closed_issue_cancels_order_and_triggers_email(monkeypatch):
    sent_orders = []

    async def fake_send(order_data):
        sent_orders.append(order_data)
        return True

    monkeypatch.setattr("app.main._send_order_closed_cancellation_email", fake_send)

    client = TestClient(app)
    driver_id, username, first_order_id, second_order_id = _create_driver_with_orders()
    token = _driver_token(driver_id, username)

    try:
        first = client.post(
            f"/orders/{first_order_id}/delivery-issue",
            headers={"Authorization": f"Bearer {token}"},
            json={"type": "negocio_cerrado", "photo_url": "/images/first"},
        )
        assert first.status_code == 200, first.text

        second = client.post(
            f"/orders/{first_order_id}/delivery-issue",
            headers={"Authorization": f"Bearer {token}"},
            json={"type": "negocio_cerrado", "photo_url": "/images/second"},
        )
        assert second.status_code == 200, second.text
        data = second.json()
        assert data["action"] == "cancelled"
        assert data["order"]["status"] == "cancelado"
        assert data["order"]["closed_attempts"] == 2
        assert "cerrado" in (data["order"]["cancel_reason"] or "").lower()
        assert sent_orders, "Expected cancellation email to be triggered"
    finally:
        _cleanup_records(driver_id, [first_order_id, second_order_id])
