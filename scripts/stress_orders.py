import asyncio
import os
import random
import time

import httpx


API_URL = os.environ.get("API_URL", "http://localhost:8000").rstrip("/")
TOTAL = int(os.environ.get("TOTAL_ORDERS", "100"))
CONCURRENCY = int(os.environ.get("CONCURRENCY", "25"))
SPREAD_SEC = float(os.environ.get("SPREAD_SEC", "0.0"))


async def _pick_product(client: httpx.AsyncClient):
    resp = await client.get(f"{API_URL}/products", timeout=20)
    resp.raise_for_status()
    products = resp.json() or []
    if not products:
        raise RuntimeError("No products returned from /products")

    def score(p):
        try:
            return int(p.get("stock") or 0)
        except Exception:
            return 0

    products_sorted = sorted(products, key=score, reverse=True)
    chosen = products_sorted[0]
    return chosen


async def main():
    print(f"Target API: {API_URL}")
    print(f"Orders: {TOTAL} | Concurrency: {CONCURRENCY} | Spread: {SPREAD_SEC}s")
    async with httpx.AsyncClient() as client:
        product = await _pick_product(client)
        product_id = product.get("id") or product.get("_id")
        if product_id is None:
            raise RuntimeError("Product has no id")
        unit_price = float(product.get("price") or product.get("precio") or 0)
        name = product.get("name") or product.get("nombre") or "Producto"

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
        }

        sem = asyncio.Semaphore(CONCURRENCY)
        results = {"ok": 0, "fail": 0, "errors": []}

        async def send(idx: int):
            async with sem:
                if SPREAD_SEC > 0:
                    await asyncio.sleep(random.random() * SPREAD_SEC)
                try:
                    resp = await client.post(f"{API_URL}/orders", json=payload, timeout=30)
                    if resp.status_code < 400:
                        results["ok"] += 1
                    else:
                        results["fail"] += 1
                        results["errors"].append((resp.status_code, resp.text[:200]))
                except Exception as exc:
                    results["fail"] += 1
                    results["errors"].append(("exception", str(exc)[:200]))

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
