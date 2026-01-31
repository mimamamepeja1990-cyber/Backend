import httpx, json
url = 'http://127.0.0.1:8000/products'
payload = {
    'name': 'Prueba Automatica',
    'price': 1.23,
    'description': 'descripcion de prueba',
    'category': 'Test',
    'image_url': None,
    'active': True,
    'stock': 10,
    'discount': 0
}
print('Posting to', url)
with httpx.Client(timeout=30) as c:
    r = c.post(url, json=payload)
    print('STATUS', r.status_code)
    try:
        print('JSON:', json.dumps(r.json(), ensure_ascii=False, indent=2))
    except Exception:
        print('TEXT:', r.text)
