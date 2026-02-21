from fastapi.testclient import TestClient
from app.main import app
from app.database import Base, engine

# Ensure tables exist for the test (some test flows don't run the app lifespan)
Base.metadata.create_all(bind=engine)

client = TestClient(app)

payload = {
    "items": [{"id": "test-1", "qty": 2, "meta": {"name": "Test Product", "price": 3.5}}],
    "total": 7.0
}

r = client.post('/orders', json=payload)
print('status', r.status_code)
try:
    print('json:', r.json())
except Exception:
    print('text:', r.text)
