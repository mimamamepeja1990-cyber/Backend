import os
import uuid
import anyio
import datetime
import hashlib
import secrets
from typing import Optional

# Optional imports are performed lazily where needed (boto3, aiofiles)
import jwt
import logging




# Password hashing using PBKDF2-HMAC (no external dependencies)
# Stored format: pbkdf2_sha256$iterations$salt_hex$hash_hex
PBKDF_ITERATIONS = 200_000
PBKDF_ALGO = 'sha256'


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(PBKDF_ALGO, password.encode('utf-8'), bytes.fromhex(salt), PBKDF_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF_ITERATIONS}${salt}${dk.hex()}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        parts = hashed_password.split('$')
        if len(parts) != 4:
            return False
        _alg, iterations_s, salt_hex, hash_hex = parts
        iterations = int(iterations_s)
        dk = hashlib.pbkdf2_hmac(PBKDF_ALGO, plain_password.encode('utf-8'), bytes.fromhex(salt_hex), iterations)
        return secrets.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


def create_access_token(data: dict, expires_minutes: int = 60 * 24):
    secret = os.environ.get('SECRET_KEY')
    if not secret:
        raise RuntimeError('SECRET_KEY not set')
    to_encode = data.copy()
    expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=expires_minutes)
    to_encode.update({"exp": expire})
    token = jwt.encode(to_encode, secret, algorithm="HS256")
    return token


def decode_access_token(token: str) -> Optional[dict]:
    secret = os.environ.get('SECRET_KEY')
    if not secret:
        raise RuntimeError('SECRET_KEY not set')
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        return payload
    except Exception:
        return None


def ensure_upload_folder(path: str):
    os.makedirs(path, exist_ok=True)


async def save_upload_file(upload_file, upload_dir: str, s3_bucket: Optional[str] = None) -> str:
    """Save an uploaded file either to S3 (if configured) or to the local disk.

    - `upload_file` is expected to be a Starlette/FastAPI UploadFile-like object.
    - Returns the URL or local path where the file was saved.
    """
    ensure_upload_folder(upload_dir)
    fname = f"{uuid.uuid4().hex}_{getattr(upload_file, 'filename', 'file')}"
    content = await upload_file.read()

    # Try S3 if a bucket is provided and AWS credentials look present
    if s3_bucket and os.environ.get('AWS_ACCESS_KEY_ID') and os.environ.get('AWS_SECRET_ACCESS_KEY'):
        try:
            import boto3

            region = os.environ.get('AWS_REGION')
            custom_domain = os.environ.get('AWS_S3_CUSTOM_DOMAIN')
            s3 = boto3.client(
                's3',
                aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
                aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY'),
                region_name=region,
            )

            # Perform blocking S3 upload in a thread to avoid blocking the event loop
            def _put():
                s3.put_object(
                    Bucket=s3_bucket,
                    Key=fname,
                    Body=content,
                    ACL='public-read',
                    ContentType=getattr(upload_file, 'content_type', 'application/octet-stream'),
                )

            await anyio.to_thread.run_sync(_put)

            if custom_domain:
                return f"https://{custom_domain}/{fname}"
            if region:
                return f"https://{s3_bucket}.s3.{region}.amazonaws.com/{fname}"
            return f"https://{s3_bucket}.s3.amazonaws.com/{fname}"
        except Exception:
            # if S3 upload fails, fallback to local save below
            pass

    # Fallback: write to local disk using aiofiles
    dest = os.path.join(upload_dir, fname)
    try:
        import aiofiles
    except Exception:
        # aiofiles should be in requirements, but if not, write synchronously as last resort
        with open(dest, 'wb') as out_file:
            out_file.write(content)
        return dest

    async with aiofiles.open(dest, 'wb') as out_file:
        await out_file.write(content)
    return dest


async def save_bytes_upload(content: bytes, filename: str, upload_dir: str, s3_bucket: Optional[str] = None, content_type: Optional[str] = None) -> str:
    """Save raw bytes to S3 (if configured) or to local disk.

    Returns either a public URL (when uploaded to S3) or the local filesystem path.
    """
    ensure_upload_folder(upload_dir)
    import uuid
    fname = f"{uuid.uuid4().hex}_{os.path.basename(filename)}"

    # Try S3 if configured
    if s3_bucket and os.environ.get('AWS_ACCESS_KEY_ID') and os.environ.get('AWS_SECRET_ACCESS_KEY'):
        try:
            import boto3

            region = os.environ.get('AWS_REGION')
            custom_domain = os.environ.get('AWS_S3_CUSTOM_DOMAIN')
            s3 = boto3.client(
                's3',
                aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
                aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY'),
                region_name=region,
            )

            def _put():
                s3.put_object(
                    Bucket=s3_bucket,
                    Key=fname,
                    Body=content,
                    ACL='public-read',
                    ContentType=content_type or 'application/octet-stream',
                )

            await anyio.to_thread.run_sync(_put)

            if custom_domain:
                return f"https://{custom_domain}/{fname}"
            if region:
                return f"https://{s3_bucket}.s3.{region}.amazonaws.com/{fname}"
            return f"https://{s3_bucket}.s3.amazonaws.com/{fname}"
        except Exception:
            pass

    # Fallback: write to disk
    dest = os.path.join(upload_dir, fname)
    try:
        import aiofiles
    except Exception:
        with open(dest, 'wb') as out_file:
            out_file.write(content)
        return dest

    async with aiofiles.open(dest, 'wb') as out_file:
        await out_file.write(content)
    return dest


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
