import asyncio
import os
import random
import time

import httpx


API_URL = os.environ.get("API_URL", "http://localhost:8000").rstrip("/")
TOTAL = int(os.environ.get("TOTAL_ORDERS", "100"))
CONCURRENCY = int(os.environ.get("CONCURRENCY", "25"))
SPREAD_SEC = float(os.environ.get("SPREAD_SEC", "0.0"))
TEST_EMAIL = os.environ.get("TEST_EMAIL", "stress-test@example.com")
TEST_NAME = os.environ.get("TEST_NAME", "Stress Test")
TIMEOUT_SEC = float(os.environ.get("TIMEOUT_SEC", "60"))
RETRIES = int(os.environ.get("RETRIES", "2"))
RETRY_DELAY = float(os.environ.get("RETRY_DELAY", "0.15"))
PRODUCT_ID = os.environ.get("PRODUCT_ID")
PRODUCT_PRICE = os.environ.get("PRODUCT_PRICE")
PRODUCT_NAME = os.environ.get("PRODUCT_NAME")


async def _pick_product(client: httpx.AsyncClient):
    if PRODUCT_ID:
        return {
            "id": PRODUCT_ID,
            "price": float(PRODUCT_PRICE or 0),
            "name": PRODUCT_NAME or "Producto",
            "stock": TOTAL,
        }
    products = None
    last_err = None
    for attempt in range(RETRIES + 1):
        try:
            resp = await client.get(f"{API_URL}/products")
            resp.raise_for_status()
            products = resp.json() or []
            if products:
                break
        except Exception as exc:
            last_err = exc
            if attempt < RETRIES:
                await asyncio.sleep(RETRY_DELAY * (attempt + 1))
                continue
            raise
    if not products:
        raise RuntimeError(f"No products returned from /products: {last_err}")

    def score(p):
        try:
            return int(p.get("stock") or 0)
        except Exception:
            return 0

    products_sorted = sorted(products, key=score, reverse=True)
    chosen = None
    for p in products_sorted:
        if score(p) >= TOTAL:
            chosen = p
            break
    if not chosen:
        chosen = products_sorted[0]
    return chosen


async def main():
    print(f"Target API: {API_URL}")
    print(f"Orders: {TOTAL} | Concurrency: {CONCURRENCY} | Spread: {SPREAD_SEC}s")
    timeout = httpx.Timeout(TIMEOUT_SEC)
    async with httpx.AsyncClient(timeout=timeout) as client:
        product = await _pick_product(client)
        product_id = product.get("id") or product.get("_id")
        if product_id is None:
            raise RuntimeError("Product has no id")
        unit_price = float(product.get("price") or product.get("precio") or 0)
        name = product.get("name") or product.get("nombre") or "Producto"
        try:
            print(f"Using product {product_id} | stock={product.get('stock')}")
        except Exception:
            pass

        payload = {
            "items": [
                {
                    "id": product_id,
                    "qty": 1,
                    "meta": {"name": name, "price": unit_price},
                }
            ],
            "total": unit_price,
            "source": "web",
            "customer_type": "mayorista",
            "user_email": TEST_EMAIL,
            "user_full_name": TEST_NAME,
        }

        sem = asyncio.Semaphore(CONCURRENCY)
        results = {"ok": 0, "fail": 0, "errors": []}

        async def send(idx: int):
            async with sem:
                if SPREAD_SEC > 0:
                    await asyncio.sleep(random.random() * SPREAD_SEC)
                last_exc = None
                for attempt in range(RETRIES + 1):
                    try:
                        resp = await client.post(f"{API_URL}/orders", json=payload)
                        if resp.status_code < 400:
                            results["ok"] += 1
                            return
                        # Retry on 5xx or 429.
                        if resp.status_code >= 500 or resp.status_code == 429:
                            last_exc = (resp.status_code, resp.text[:200])
                            if attempt < RETRIES:
                                await asyncio.sleep(RETRY_DELAY * (attempt + 1))
                                continue
                        results["fail"] += 1
                        results["errors"].append((resp.status_code, resp.text[:200]))
                        return
                    except Exception as exc:
                        last_exc = ("exception", f"{type(exc).__name__}: {exc}"[:200])
                        if attempt < RETRIES:
                            await asyncio.sleep(RETRY_DELAY * (attempt + 1))
                            continue
                        results["fail"] += 1
                        results["errors"].append(last_exc)
                        return

        start = time.time()
        await asyncio.gather(*[send(i) for i in range(TOTAL)])
        elapsed = time.time() - start

        print(f"✅ OK: {results['ok']} | ❌ Fail: {results['fail']} | {elapsed:.2f}s total")
        if results["errors"]:
            print("Sample errors:")
            for entry in results["errors"][:5]:
                print(" -", entry)


if __name__ == "__main__":
    asyncio.run(main())
