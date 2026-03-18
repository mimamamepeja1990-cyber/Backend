import datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from app import models, utils
from app.database import SessionLocal
from app.main import app


def _create_customer_with_order(payment_method: str = "mercadopago", payment_status: str = "approved"):
    db = SessionLocal()
    email = f"cliente_cancel_{uuid4().hex[:8]}@example.com"
    user = models.User(
        full_name="Cliente Cancelacion",
        email=email,
        hashed_password=utils.hash_password("secret"),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    order = models.Order(
        items=[{"id": "1", "qty": 2}],
        total=2500.0,
        status="recibido",
        user_id=user.id,
        user_full_name=user.full_name,
        user_email=user.email,
        user_calle="San Martin",
        user_numeracion="123",
        payment_method=payment_method,
        payment_status=payment_status,
        payment_reference="1234567890",
        source="web",
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    db.close()
    return user.id, user.email, order.id


def _cleanup_records(user_id: int, order_id: int):
    db = SessionLocal()
    try:
        order = db.query(models.Order).filter(models.Order.id == order_id).first()
        if order:
            db.delete(order)
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if user:
            db.delete(user)
        db.commit()
    finally:
        db.close()


def _user_token(user_id: int, email: str) -> str:
    return utils.create_access_token({
        "sub": email,
        "id": user_id,
        "full_name": "Cliente Cancelacion",
    })


def test_customer_cancel_order_refunds_mercadopago(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "test-secret")

    refund_ts = datetime.datetime.now(datetime.timezone.utc)
    sent_orders = []

    async def fake_resolve(order_data):
        return {
            "ok": True,
            "payment_id": "1234567890",
            "payment_reference": "1234567890",
            "payment_status": "approved",
            "payload": {"id": "1234567890", "status": "approved"},
        }

    async def fake_refund(order_data):
        return {
            "ok": True,
            "refund_required": True,
            "refund_processed": True,
            "payment_status": "refunded",
            "payment_reference": "1234567890",
            "refund_reference": "refund-123",
            "refund_status": "approved",
            "refunded_at": refund_ts,
            "refunded_amount": 2500.0,
        }

    async def fake_send(order_data):
        sent_orders.append(order_data)
        return True

    monkeypatch.setattr("app.main._resolve_mercadopago_payment_for_order", fake_resolve)
    monkeypatch.setattr("app.main._refund_mercadopago_payment_for_order", fake_refund)
    monkeypatch.setattr("app.main._send_order_customer_cancellation_email", fake_send)

    client = TestClient(app)
    user_id, email, order_id = _create_customer_with_order()
    token = _user_token(user_id, email)

    try:
        response = client.post(
            f"/orders/{order_id}/cancel",
            headers={"Authorization": f"Bearer {token}"},
            json={},
        )
        assert response.status_code == 200, response.text
        data = response.json()

        assert data["action"] == "cancelled"
        assert data["refund_required"] is True
        assert data["refund_processed"] is True
        assert data["refund_status"] == "approved"
        assert data["refund_reference"] == "refund-123"
        assert data["refunded_amount"] == 2500.0
        assert "reembolso" in (data["message"] or "").lower()
        assert data["order"]["status"] == "cancelado"
        assert data["order"]["payment_status"] == "refunded"
        assert data["order"]["refund_reference"] == "refund-123"
        assert data["order"]["refund_status"] == "approved"

        db = SessionLocal()
        try:
            order = db.query(models.Order).filter(models.Order.id == order_id).first()
            assert order is not None
            assert order.status == "cancelado"
            assert order.cancelled_by_user_id == user_id
            assert order.payment_status == "refunded"
            assert order.refund_reference == "refund-123"
            assert order.refund_status == "approved"
            assert order.refunded_amount == 2500.0
        finally:
            db.close()

        assert sent_orders, "Expected customer cancellation email to be triggered"
    finally:
        _cleanup_records(user_id, order_id)
