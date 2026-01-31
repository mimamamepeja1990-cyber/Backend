from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

# Create product without discount (non-empty description)
payload = {
    "name": "APITestNoDiscount",
    "price": 7.5,
    "description": "No discount provided",
    "category": "API",
    "image_url": None,
    "active": True,
    "stock": 10
}

# Create product with empty description and no discount (mimics legacy/edge case)
payload_empty_desc = {
    "name": "APITestEmptyDesc",
    "price": 5.0,
    "description": "",
    "category": "API",
    "image_url": None,
    "active": True,
    "stock": 3
}
# First case: create w/ non-empty desc
r = client.post('/products', json=payload)
print('POST status', r.status_code)
print('POST body', r.json())

if r.status_code == 200:
    prod = r.json()
    pid = prod.get('id')
    upd_payload = {"description": "Updated via API test"}
    r2 = client.put(f'/products/{pid}', json=upd_payload)
    print('PUT status', r2.status_code)
    print('PUT body', r2.json())

# Second case: create with empty description and no discount
r3 = client.post('/products', json=payload_empty_desc)
print('POST empty desc status', r3.status_code)
print('POST empty desc body', r3.json())
if r3.status_code == 200:
    prod2 = r3.json()
    pid2 = prod2.get('id')
    # Update only price
    r4 = client.put(f'/products/{pid2}', json={"price": 6.0})
    print('PUT empty-desc status', r4.status_code)
    print('PUT empty-desc body', r4.json())
