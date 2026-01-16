import os
import uuid
import aiofiles


async def save_upload_file(upload_file, upload_dir: str) -> str:
    # ensure folder exists
    os.makedirs(upload_dir, exist_ok=True)
    ext = os.path.splitext(upload_file.filename)[1]
    fname = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(upload_dir, fname)
    # write asynchronously
    async with aiofiles.open(dest, 'wb') as out_file:
        content = await upload_file.read()
        await out_file.write(content)
    return dest

def ensure_upload_folder(path: str):
    os.makedirs(path, exist_ok=True)

def compute_promotion_total(product_prices, promo_type: str, promo_value=None, qty=1):
    """Compute the total amount for a promotion given product prices and promo details.
    - product_prices: list of numeric prices per product in promotion
    - promo_type: 'percent' or '2x1'
    - promo_value: percentage (e.g., 20 for 20%) if promo_type == 'percent'
    - qty: number of promo groups (applies multiplier)
    """
    if not product_prices or qty <= 0:
        return 0.0
    prices = [float(p or 0) for p in product_prices]
    if promo_type == 'percent' and promo_value is not None:
        rate = float(promo_value) or 0.0
        total = sum(prices) * (1 - (rate / 100.0)) * qty
        return total
    if promo_type == '2x1':
        # For each product, charged quantity is ceil(qty/2)
        charge_qty = int((qty + 1) // 2) if qty > 0 else 0
        total = sum(p * charge_qty for p in prices)
        return total
    # default: simple sum * qty
    return sum(prices) * qty
