import sys
import httpx
import json
import time
import traceback

# Small delay to ensure server is ready
time.sleep(1)

url = 'http://127.0.0.1:8000/products'
payload = {
    'name': 'Prueba HTTP',
    'price': 1.23,
    'description': 'descripcion de prueba',
    'category': 'Test',
    'image_url': None,
    'active': True,
    'stock': 10,
    'discount': 0
}

print('=' * 80)
print('Posting to', url)
print('Payload:', json.dumps(payload, indent=2))
print('=' * 80)

try:
    with httpx.Client(timeout=30) as c:
        r = c.post(url, json=payload)
        print('STATUS:', r.status_code)
        print('HEADERS:', dict(r.headers))
        try:
            body = r.json()
            print('JSON RESPONSE:', json.dumps(body, ensure_ascii=False, indent=2))
        except Exception:
            print('TEXT RESPONSE:', r.text)
except Exception as e:
    print('ERROR:', str(e))
    traceback.print_exc()
    sys.exit(1)
