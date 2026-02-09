from fastapi import status
from fastapi import (
    FastAPI, Depends, HTTPException, UploadFile, File,
    WebSocket, WebSocketDisconnect, Request
)
from fastapi.responses import RedirectResponse, PlainTextResponse, Response, FileResponse, StreamingResponse
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

from typing import List, Optional, Dict, Any
import os
import asyncio
import logging
import csv
import json
import time
import datetime
from io import StringIO
import anyio
import sys
import traceback

from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy import inspect
from sqlalchemy import or_
from types import SimpleNamespace

from app import models, schemas, crud, utils
from app.database import engine, Base, get_db, SessionLocal
from sqlalchemy.exc import IntegrityError
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from typing import Tuple

# optional remote backup (GitHub Gist) — configured via env vars
import httpx
GIST_TOKEN = os.environ.get('BACKUP_GIST_TOKEN')
GIST_ID = os.environ.get('BACKUP_GIST_ID')
BACKUP_URL = os.environ.get('CATALOG_BACKUP_URL')  # optional public URL to fetch a snapshot from

async def push_snapshot_to_gist(content: str) -> bool:
    """Update the configured Gist with the provided JSON content. Requires BACKUP_GIST_TOKEN and BACKUP_GIST_ID."""
    if not GIST_TOKEN or not GIST_ID:
        return False
    url = f"https://api.github.com/gists/{GIST_ID}"
    headers = {"Authorization": f"token {GIST_TOKEN}", "Accept": "application/vnd.github.v3+json"}
    payload = {"files": {"products.json": {"content": content}}}
    try:
        resp = httpx.patch(url, json=payload, headers=headers, timeout=15)
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.warning('push_snapshot_to_gist failed: %s', e)
        return False

async def fetch_snapshot_from_gist() -> Optional[str]:
    """Fetch the products.json content from the configured Gist (if available)."""
    if GIST_ID:
        url = f"https://api.github.com/gists/{GIST_ID}"
        try:
            resp = httpx.get(url, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            files = data.get('files') or {}
            pj = files.get('products.json') or files.get('products')
            if pj and pj.get('content'):
                return pj.get('content')
        except Exception as e:
            logger.warning('fetch_snapshot_from_gist failed: %s', e)
    # try a generic public URL if provided
    if BACKUP_URL:
        try:
            resp = httpx.get(BACKUP_URL, timeout=15)
            resp.raise_for_status()
            return resp.text
        except Exception as e:
            logger.warning('fetch_snapshot_from_url failed: %s', e)
    return None


async def fetch_promotions_from_gist() -> Optional[str]:
    """Fetch the promotions.json content from the configured Gist (if available)."""
    if GIST_ID:
        url = f"https://api.github.com/gists/{GIST_ID}"
        try:
            resp = httpx.get(url, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            files = data.get('files') or {}
            pj = files.get('promotions.json') or files.get('promotions')
            if pj and pj.get('content'):
                return pj.get('content')
        except Exception as e:
            logger.warning('fetch_promotions_from_gist failed: %s', e)
    # try a generic public URL if provided (reuse BACKUP_URL if it points to a promotions snapshot)
    if BACKUP_URL:
        try:
            resp = httpx.get(BACKUP_URL, timeout=15)
            resp.raise_for_status()
            return resp.text
        except Exception as e:
            logger.warning('fetch_promotions_from_url failed: %s', e)
    return None


# LOGGING
# -------------------------------------------------------------------
logger = logging.getLogger("catalog_api")
handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logger.addHandler(handler)
logger.setLevel(logging.INFO)

# -------------------------------------------------------------------
# Engine-level safe helpers 🔧
# -------------------------------------------------------------------

def _invalidate_conn(conn):
    try:
        # mark connection as invalid so it's removed from pool
        conn.invalidate()
    except Exception:
        try:
            conn.close()
        except Exception:
            pass


def _safe_engine_fetchall(sql, params=None):
    params = params or {}
    try:
        with engine.connect() as conn:
            return conn.execute(text(sql), params).fetchall()
    except Exception as e:
        msg = str(e)
        logger.exception('safe_engine_fetchall initial failed: %s', e)
        if 'current transaction is aborted' in msg.lower():
            try:
                tb = traceback.format_exc()
                # Persist diagnostic so we can find the originating failure in Render logs
                base = os.path.dirname(os.path.dirname(__file__))
                logpath = os.path.join(base, 'server_log.txt')
                with open(logpath, 'a', encoding='utf-8') as f:
                    f.write(f"{datetime.datetime.utcnow().isoformat()} - safe_engine_fetchall aborted transaction: stmt={sql} msg={msg[:300]}\n")
                    f.write(tb + "\n\n")
            except Exception:
                pass
        # retry once with a fresh connection
        try:
            with engine.connect() as conn2:
                return conn2.execute(text(sql), params).fetchall()
        except Exception as e2:
            logger.exception('safe_engine_fetchall retry failed: %s', e2)
            return None


def _safe_engine_fetchone(sql, params=None):
    params = params or {}
    try:
        with engine.connect() as conn:
            return conn.execute(text(sql), params).fetchone()
    except Exception as e:
        msg = str(e)
        logger.exception('safe_engine_fetchone initial failed: %s', e)
        if 'current transaction is aborted' in msg.lower():
            try:
                tb = traceback.format_exc()
                base = os.path.dirname(os.path.dirname(__file__))
                logpath = os.path.join(base, 'server_log.txt')
                with open(logpath, 'a', encoding='utf-8') as f:
                    f.write(f"{datetime.datetime.utcnow().isoformat()} - safe_engine_fetchone aborted transaction: stmt={sql} msg={msg[:300]}\n")
                    f.write(tb + "\n\n")
            except Exception:
                pass
        try:
            with engine.connect() as conn2:
                return conn2.execute(text(sql), params).fetchone()
        except Exception as e2:
            logger.exception('safe_engine_fetchone retry failed: %s', e2)
            return None

# -------------------------------------------------------------------
# LIFESPAN (startup / shutdown)
# -------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    Base.metadata.create_all(bind=engine)

    # Ensure legacy DBs get required columns on the `orders` table.
    # Use SQLAlchemy inspector (cross-dialect) to detect missing columns and
    # issue ALTER TABLE ADD COLUMN statements for any that are absent. This
    # avoids relying on information_schema schema assumptions.
    try:
        conn = engine.connect()
        try:
            needed = {
                'status': "VARCHAR(50) DEFAULT 'nuevo'",
                'user_id': 'INTEGER',
                'user_full_name': 'VARCHAR(200)',
                'user_email': 'VARCHAR(320)',
                'user_barrio': 'VARCHAR(200)',
                'user_calle': 'VARCHAR(200)',
                'user_numeracion': 'VARCHAR(100)',
                '_token_received': 'BOOLEAN',
                '_token_preview': 'TEXT',
                # Ensure 'source' has a server-side default so rows without explicit
                # source end up with 'web' in the DB and survive restarts.
                'source': "VARCHAR(50) DEFAULT 'web'",
            }

            try:
                insp = inspect(engine)
                existing_cols = {c['name'] for c in insp.get_columns('orders')}
            except Exception:
                existing_cols = set()

            dialect = getattr(engine, 'dialect', None)
            dialect_name = getattr(dialect, 'name', '') if dialect else ''

            for col, coltype in needed.items():
                if col in existing_cols:
                    continue
                try:
                    # Prefer ALTER TABLE ... ADD COLUMN IF NOT EXISTS on Postgres
                    if 'postgres' in dialect_name:
                        try:
                            conn.execute(text(f"ALTER TABLE orders ADD COLUMN IF NOT EXISTS {col} {coltype}"))
                        except Exception:
                            conn.execute(text(f"ALTER TABLE orders ADD COLUMN {col} {coltype}"))
                    else:
                        # SQLite and other dialects generally support simple ADD COLUMN
                        conn.execute(text(f"ALTER TABLE orders ADD COLUMN {col} {coltype}"))
                    logger.info('Added missing column to orders: %s', col)
                except Exception as e:
                    logger.warning('Could not add column %s to orders: %s', col, e)
        finally:
            conn.close()
    except Exception:
        logger.exception('ensure orders columns step failed')

    # Ensure legacy DBs get `stock` and `discount` columns on the `products` table.
    try:
        conn = engine.connect()
        try:
            dialect = getattr(engine, 'dialect', None)
            dialect_name = getattr(dialect, 'name', '') if dialect else ''
            discount_type = 'REAL DEFAULT 0' if 'postgres' in dialect_name else 'FLOAT DEFAULT 0'
            prod_needed = {
                'stock': 'INTEGER DEFAULT 0',
                'discount': discount_type
            }
            try:
                insp = inspect(engine)
                existing_prod_cols = {c['name'] for c in insp.get_columns('products')}
            except Exception:
                existing_prod_cols = set()

            dialect = getattr(engine, 'dialect', None)
            dialect_name = getattr(dialect, 'name', '') if dialect else ''
            for col, coltype in prod_needed.items():
                if col in existing_prod_cols:
                    continue
                try:
                    if 'postgres' in dialect_name:
                        try:
                            conn.execute(text(f"ALTER TABLE products ADD COLUMN IF NOT EXISTS {col} {coltype}"))
                        except Exception:
                            conn.execute(text(f"ALTER TABLE products ADD COLUMN {col} {coltype}"))
                    else:
                        conn.execute(text(f"ALTER TABLE products ADD COLUMN {col} {coltype}"))
                    logger.info('Added missing column to products: %s', col)
                except Exception as e:
                    try:
                        _invalidate_conn(conn)
                    except Exception:
                        pass
                    logger.warning('Could not add column %s to products: %s', col, e)
        finally:
            conn.close()
    except Exception:
        logger.exception('ensure products columns step failed')

    # Log which database we are using (mask credentials) and test connection
    try:
        db_env = os.environ.get('DATABASE_URL')
        masked = 'sqlite (local file)'
        if db_env:
            try:
                from urllib.parse import urlparse
                u = urlparse(db_env)
                user = u.username or ''
                host = u.hostname or ''
                port = u.port or ''
                path = u.path or ''
                masked = f"{u.scheme}://{user + ':****@' if user else ''}{host}{(':'+str(port)) if port else ''}{path}"
            except Exception:
                masked = 'postgres (masked)'
        logger.info('Database URL: %s', masked)
        try:
            conn = engine.connect()
            try:
                conn.execute(text('SELECT 1'))
            finally:
                conn.close()
            logger.info('Database connection test succeeded')
        except Exception as e:
            logger.exception('Database connection test failed: %s', e)
        # If running on a PaaS like Render and no managed DATABASE_URL is set,
        # using the bundled SQLite file will not survive deploys/restarts.
        # Fail early to force configuration of a managed database.
        try:
            running_on_render = bool(os.environ.get('RENDER') or os.environ.get('RENDER_SERVICE_ID') or os.environ.get('RENDER_EXTERNAL_HOSTNAME'))
            using_sqlite = (db_env is None) or (str(db_env).strip() == '') or (str(db_env).lower().startswith('sqlite'))
            if running_on_render and using_sqlite:
                logger.error('Detected Render environment but no managed DATABASE_URL configured. Using SQLite on Render is ephemeral and will lose data on deploys. Set DATABASE_URL to a managed Postgres database.')
                # Raise to stop startup and make the problem obvious in logs
                raise RuntimeError('Render deployment requires a managed DATABASE_URL (Postgres). Set the DATABASE_URL env var.')
        except Exception:
            # If detection fails, continue but we've already logged above
            pass
    except Exception:
        logger.exception('Database startup check failed')

    db = SessionLocal()
    try:
        try:
            # Use a raw count select to avoid SQLAlchemy attempting to select
            # mapped columns that may not yet exist in legacy DB schemas.
            r = crud._safe_scalar(db, 'SELECT count(*) FROM products')
            prod_count = int(r or 0)
        except Exception as e:
            # Avoid any ORM-based product queries here because the ORM may
            # reference model columns (e.g. `stock`) that are missing in the
            # live DB and cause a ProgrammingError. We log and treat as empty.
            logger.warning('Raw products count failed; skipping ORM count to avoid schema errors: %s', e)
            prod_count = 0
        if prod_count == 0:
            # try to restore from remote backup (gist or public URL) or from local snapshot before seeding demo data
            restored = False
            try:
                content = await fetch_snapshot_from_gist()
                if content:
                    logger.info('Restoring products from configured backup');
                    items = json.loads(content)
                    for p in items:
                        db.add(models.Product(name=p.get('name'), price=p.get('price') or 0, description=p.get('description') or '', category=p.get('category') or '', image_url=p.get('image_url') or None, active=bool(p.get('active', True))))
                    db.commit()
                    restored = True
            except Exception as _err:
                logger.warning('restore-from-backup (gist) failed: %s', _err)

            # If no remote backup restored, try local catalog snapshot file (written by write_catalog_snapshot)
            if not restored:
                try:
                    local_path = os.path.join(CATALOG_DIR, 'products.json')
                    if os.path.exists(local_path):
                        with open(local_path, 'r', encoding='utf-8') as f:
                            items = json.load(f)
                        if items and isinstance(items, list):
                            logger.info('Restoring products from local snapshot %s', local_path)
                            for p in items:
                                db.add(models.Product(name=p.get('name'), price=p.get('price') or 0, description=p.get('description') or '', category=p.get('category') or '', image_url=p.get('image_url') or None, active=bool(p.get('active', True))))
                            db.commit()
                            restored = True
                except Exception as _err:
                    logger.warning('restore-from-local-snapshot failed: %s', _err)

            # fallback to demo data only if nothing was restored
            if not restored:
                try:
                    db.add_all([
                        models.Product(name="Camiseta", price=19.99, description="Camiseta", category="Ropa"),
                        models.Product(name="Taza", price=8.5, description="Taza", category="Accesorios"),
                    ])
                    db.commit()
                except Exception as _err:
                    logger.warning('seeding demo data failed: %s', _err)
        # Try to restore promotions snapshot from remote backup (gist) or local snapshot
        try:
            restored_promos = False
            try:
                prom_content = await fetch_promotions_from_gist()
                if prom_content:
                    try:
                        # ensure catalog dir exists
                        os.makedirs(CATALOG_DIR, exist_ok=True)
                        with open(os.path.join(CATALOG_DIR, 'promotions.json'), 'w', encoding='utf-8') as f:
                            f.write(prom_content)
                        logger.info('Restored promotions from configured backup');
                        restored_promos = True
                    except Exception as e:
                        logger.warning('writing restored promotions failed: %s', e)
            except Exception as _err:
                logger.warning('restore-promotions-from-backup failed: %s', _err)

            # If no remote promotions restored, prefer existing local promotions.json if present (no-op)
        except Exception:
            logger.exception('promotions restore step failed')
    finally:
        db.close()

    yield
    # Shutdown (nada)

# -------------------------------------------------------------------
# APP
# -------------------------------------------------------------------
app = FastAPI(title="Catálogo API", lifespan=lifespan)

# In-memory cache of recently created order payloads (id -> { payload, ts })
# Used to surface token previews in the admin list when the DB lacks persisted user_* columns.
ORDER_PAYLOAD_CACHE = {}
ORDER_PAYLOAD_CACHE_MAX_AGE = 60 * 60 * 2  # keep for 2 hours

# In-memory cache for order status overrides (id -> { status, ts })
# Used as a fallback if DB status column is missing or update fails.
ORDER_STATUS_CACHE = {}
ORDER_STATUS_CACHE_MAX_AGE = 60 * 60 * 24  # keep for 24 hours

def _prune_order_cache():
    try:
        now = time.time()
        for k in list(ORDER_PAYLOAD_CACHE.keys()):
            try:
                if ORDER_PAYLOAD_CACHE[k] and (now - ORDER_PAYLOAD_CACHE[k].get('ts', 0) > ORDER_PAYLOAD_CACHE_MAX_AGE):
                    del ORDER_PAYLOAD_CACHE[k]
            except Exception:
                pass
    except Exception:
        pass

def _prune_status_cache():
    try:
        now = time.time()
        for k in list(ORDER_STATUS_CACHE.keys()):
            try:
                if ORDER_STATUS_CACHE[k] and (now - ORDER_STATUS_CACHE[k].get('ts', 0) > ORDER_STATUS_CACHE_MAX_AGE):
                    del ORDER_STATUS_CACHE[k]
            except Exception:
                pass
    except Exception:
        pass

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")

# -------------------------------------------------------------------
# MIDDLEWARES
# -------------------------------------------------------------------
# Configure CORS origins via env var CORS_ALLOWED_ORIGINS (comma-separated). When credentials are required
# we cannot use wildcard '*' for Access-Control-Allow-Origin, so prefer explicit origins.
CORS_ALLOWED_ORIGINS = [o.strip() for o in (os.environ.get('CORS_ALLOWED_ORIGINS') or '').split(',') if o.strip()]
if CORS_ALLOWED_ORIGINS:
    cors_allow_origins = CORS_ALLOWED_ORIGINS
    cors_allow_credentials = True
else:
    # No explicit allowed origins configured: allow all origins but disable credentials to avoid
    # browser rejection when Access-Control-Allow-Origin == '*'. This is a safe default.
    cors_allow_origins = ['*']
    cors_allow_credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allow_origins,
    allow_credentials=cors_allow_credentials,
    allow_methods=["*"],
    # Explicitly allow Authorization and common headers instead of wildcard so browsers' preflights
    # reliably accept the Authorization header across origins.
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"],
)


def _cors_headers_for_request(request: Request) -> Dict[str, str]:
    """Return CORS response headers appropriate for the incoming request.
    If the request includes an Origin header, echo it back (required when credentials are included).
    If the browser made a preflight (OPTIONS) request with Access-Control-Request-Headers, echo
    that back so custom headers like Authorization are explicitly permitted.
    """
    origin = request.headers.get('origin')
    headers: Dict[str, str] = {
        'Access-Control-Allow-Credentials': 'true' if cors_allow_credentials else 'false',
        'Access-Control-Allow-Methods': '*',
    }
    # Respect the browser's requested headers if provided (preflight); otherwise advertise common safe set
    acrh = request.headers.get('access-control-request-headers')
    if acrh:
        headers['Access-Control-Allow-Headers'] = acrh
    else:
        headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, Accept, Origin, X-Requested-With'

    if origin:
        headers['Access-Control-Allow-Origin'] = origin
    else:
        headers['Access-Control-Allow-Origin'] = '*'
    return headers


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # Log validation errors and request body to server_log.txt to help diagnose 422 issues in production
    try:
        try:
            body_bytes = await request.body()
            try:
                body = body_bytes.decode('utf-8')
            except Exception:
                body = str(body_bytes)
        except Exception:
            body = '<could not read body>'
        tb = traceback.format_exc()
        try:
            base = os.path.dirname(os.path.dirname(__file__))
            logpath = os.path.join(base, 'server_log.txt')
            with open(logpath, 'a', encoding='utf-8') as f:
                f.write(f"{datetime.datetime.utcnow().isoformat()} - RequestValidationError path={request.url.path} body={body[:2000]} error={str(exc)[:500]}\n")
                f.write(tb + "\n\n")
        except Exception:
            pass
            logger.exception('RequestValidationError for %s: %s body=%s', request.url.path, exc, (body[:500] if body else ''))
    except Exception:
        logger.exception('validation_exception_handler failed')

    # Fallback: for admin product create/update requests, try to coerce payload and perform the DB operation directly
    try:
        m = (request.method or '').upper()
        p = request.url.path or ''
        if p.startswith('/products') and m in ('POST', 'PUT'):
            try:
                body_json = None
                try:
                    body_json = await request.json()
                except Exception:
                    body_json = None
                if body_json and isinstance(body_json, dict):
                    # Coerce common product fields
                    name = str(body_json.get('name') or '').strip()
                    price_raw = body_json.get('price')
                    try:
                        price = float(price_raw)
                    except Exception:
                        price = None
                    if m == 'POST':
                        if name and price is not None:
                            payload_obj = SimpleNamespace(
                                name=name,
                                price=price,
                                description=body_json.get('description') or '',
                                category=body_json.get('category') or '',
                                image_url=body_json.get('image_url') or '',
                                active=bool(body_json.get('active', True)),
                                stock=int(body_json.get('stock') or 0),
                                discount=float(body_json.get('discount') or 0.0)
                            )
                            db = SessionLocal()
                            try:
                                created = crud.create_product(db, payload_obj)
                                if created:
                                    # Normalize to dict
                                    if isinstance(created, dict):
                                        res = created
                                    else:
                                        res = {k: getattr(created, k) for k in ('id','name','price','description','category','image_url','active','stock','discount') if hasattr(created, k)}
                                    # log the fallback usage
                                    try:
                                        base = os.path.dirname(os.path.dirname(__file__))
                                        with open(os.path.join(base, 'server_log.txt'), 'a', encoding='utf-8') as f:
                                            f.write(f"{datetime.datetime.utcnow().isoformat()} - Validation fallback POST /products used for body: {str(body)[:1000]} created_id={res.get('id')}\n")
                                    except Exception:
                                        pass
                                    headers = _cors_headers_for_request(request)
                                    return JSONResponse(status_code=200, content=res, headers=headers)
                            finally:
                                try:
                                    db.close()
                                except Exception:
                                    pass
                    else:
                        # PUT fallback: extract id from path and perform permissive update
                        try:
                            parts = [x for x in p.split('/') if x]
                            # path may be /products or /products/123; ensure last part is id
                            if len(parts) >= 2 and parts[-2] == 'products':
                                pid = parts[-1]
                            elif len(parts) >= 1 and parts[0] == 'products' and len(parts) == 2:
                                pid = parts[1]
                            else:
                                pid = None
                        except Exception:
                            pid = None
                        if pid is not None:
                            # Build permissive updates dict
                            updates = {}
                            for k in ('name','price','description','category','image_url','active','stock','discount'):
                                if k in body_json:
                                    updates[k] = body_json[k]
                            if 'price' in updates:
                                try:
                                    updates['price'] = float(updates['price'])
                                except Exception:
                                    updates.pop('price', None)
                            if 'stock' in updates:
                                try:
                                    updates['stock'] = int(updates['stock'])
                                except Exception:
                                    updates.pop('stock', None)
                            if 'discount' in updates:
                                try:
                                    updates['discount'] = float(updates['discount'])
                                except Exception:
                                    updates.pop('discount', None)
                            if updates:
                                # Create a small payload object with dict() method used by crud.update_product
                                upd_dict = updates.copy()
                                class _UpdObj:
                                    def __init__(self, d):
                                        self.__dict__.update(d)
                                    def dict(self, exclude_unset=True):
                                        return d
                                d = upd_dict
                                upd_obj = _UpdObj(d)
                                db = SessionLocal()
                                try:
                                    updated = crud.update_product(db, int(pid), upd_obj)
                                    if updated:
                                        # Normalize to dict
                                        res = updated if isinstance(updated, dict) else {k: getattr(updated, k) for k in ('id','name','price','description','category','image_url','active','stock','discount') if hasattr(updated,k)}
                                        try:
                                            base = os.path.dirname(os.path.dirname(__file__))
                                            with open(os.path.join(base, 'server_log.txt'), 'a', encoding='utf-8') as f:
                                                f.write(f"{datetime.datetime.utcnow().isoformat()} - Validation fallback PUT /products/{pid} used for body: {str(body)[:1000]}\n")
                                        except Exception:
                                            pass
                                        headers = _cors_headers_for_request(request)
                                        return JSONResponse(status_code=200, content=res, headers=headers)
                                finally:
                                    try:
                                        db.close()
                                    except Exception:
                                        pass
            except Exception:
                pass
    except Exception:
        pass

    headers = _cors_headers_for_request(request)
    return JSONResponse(status_code=422, content={"detail": exc.errors()}, headers=headers)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception('Unhandled exception: %s', exc)
    headers = _cors_headers_for_request(request)
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"}, headers=headers)


# Lightweight health and debug endpoints
@app.get('/health')
def health():
    return {'status': 'ok'}

@app.get('/debug/version')
def debug_version():
    """Return deploy identification info to help confirm the running code version."""
    commit = os.environ.get('DEPLOY_COMMIT') or os.environ.get('RENDER_GIT_COMMIT') or os.environ.get('HEROKU_SLUG_COMMIT')
    return {
        'commit': commit or 'unknown',
        'python': sys.version.splitlines()[0]
    }


@app.post('/debug/echo')
async def debug_echo(request: Request):
    try:
        data = await request.json()
    except Exception:
        data = None
    logger.info('debug/echo called, origin=%s, data=%s', request.headers.get('origin'), data)
    headers = _cors_headers_for_request(request)
    return JSONResponse(status_code=200, content={"echo": data, "headers": dict(request.headers)}, headers=headers)


# -------------------------------------------------------------------
# Filters endpoint: serve and persist admin-managed filters so public catalog can fetch them
# -------------------------------------------------------------------
@app.get('/filters.json')
def get_filters(request: Request, db: Session = Depends(get_db)):
    """Return admin-managed filters. Prefer the DB-backed setting when available
    so filters survive deploys; fall back to the on-disk snapshot for compatibility."""
    data = None
    try:
        # Try DB first
        dbv = crud.get_setting(db, 'filters')
        if isinstance(dbv, list):
            data = dbv
        else:
            # fallback to file if DB has no value or it's malformed
            path = os.path.join(CATALOG_DIR, 'filters.json')
            if os.path.exists(path):
                with open(path, 'r', encoding='utf-8') as f:
                    loaded = json.load(f)
                data = loaded if isinstance(loaded, list) else []
            else:
                data = []
    except Exception as e:
        logger.exception('get_filters failed: %s', e)
        data = []
    headers = _cors_headers_for_request(request)
    return JSONResponse(status_code=200, content=data, headers=headers)


@app.post('/filters')
async def set_filters(request: Request, db: Session = Depends(get_db)):
    try:
        body = await request.json()
        if not isinstance(body, list):
            raise HTTPException(status_code=400, detail='filters must be an array')
        # Persist to DB (best-effort)
        try:
            ok = crud.set_setting(db, 'filters', body)
            if not ok:
                logger.warning('set_filters: failed to persist filters to DB')
        except Exception:
            logger.exception('set_filters: DB persist failed')
        # Also write file snapshot for backward compatibility
        try:
            os.makedirs(CATALOG_DIR, exist_ok=True)
            path = os.path.join(CATALOG_DIR, 'filters.json')
            with open(path, 'w', encoding='utf-8') as f:
                f.write(json.dumps(body, ensure_ascii=False, indent=2))
        except Exception:
            logger.exception('set_filters: failed to write snapshot file')
        headers = _cors_headers_for_request(request)
        # notify websocket listeners that filters changed
        try:
            await push_event({'type':'filters-updated','count': len(body)})
        except Exception:
            pass
        logger.info('Saved filters.json with %s entries', len(body))
        return JSONResponse(status_code=200, content={'ok': True, 'saved': len(body)}, headers=headers)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('set_filters failed: %s', e)
        raise HTTPException(status_code=500, detail='Failed to save filters')


# -------------------------------------------------------------------
# Product categories: mappings productKey -> [filterValues]
# Stored in catalogo/product_categories.json for the public catalog to consume
# -------------------------------------------------------------------
@app.get('/product-categories.json')
def get_product_categories(request: Request, db: Session = Depends(get_db)):
    """Return mapping productKey -> [categoryValues]. Prefer DB-stored mapping so
    the configuration survives deploys; fall back to the file snapshot otherwise."""
    data = None
    try:
        dbv = crud.get_setting(db, 'product_categories')
        if isinstance(dbv, dict):
            data = dbv
        else:
            path = os.path.join(CATALOG_DIR, 'product_categories.json')
            if os.path.exists(path):
                with open(path, 'r', encoding='utf-8') as f:
                    loaded = json.load(f)
                data = loaded if isinstance(loaded, dict) else {}
            else:
                data = {}
    except Exception as e:
        logger.exception('get_product_categories failed: %s', e)
        data = {}
    headers = _cors_headers_for_request(request)
    return JSONResponse(status_code=200, content=data, headers=headers)


@app.post('/product-categories')
async def set_product_categories(request: Request, db: Session = Depends(get_db)):
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail='body must be an object mapping productKey to array')
        # Persist into DB (best-effort)
        try:
            ok = crud.set_setting(db, 'product_categories', body)
            if not ok:
                logger.warning('set_product_categories: failed to persist mapping to DB')
        except Exception:
            logger.exception('set_product_categories: DB persist failed')
        # Also write local snapshot file for compatibility
        try:
            os.makedirs(CATALOG_DIR, exist_ok=True)
            path = os.path.join(CATALOG_DIR, 'product_categories.json')
            with open(path, 'w', encoding='utf-8') as f:
                f.write(json.dumps(body, ensure_ascii=False, indent=2))
        except Exception:
            logger.exception('set_product_categories: failed to write snapshot file')
        headers = _cors_headers_for_request(request)
        try:
            await push_event({'type':'product-categories-updated','count': len(body)})
        except Exception:
            pass
        logger.info('Saved product_categories.json with %s keys', len(body))
        return JSONResponse(status_code=200, content={'ok': True, 'saved': len(body)}, headers=headers)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('set_product_categories failed: %s', e)
        raise HTTPException(status_code=500, detail='Failed to save product categories')


def _run_add_user_columns() -> dict:
    """Run the same migration logic as `add_user_columns.py` and return a report dict."""
    results = { 'added': [], 'skipped': [], 'failed': [] }
    needed = [
        ('status', "VARCHAR(50) DEFAULT 'nuevo'"),
        ('user_id', 'INTEGER'),
        ('user_full_name', 'VARCHAR(200)'),
        ('user_email', 'VARCHAR(320)'),
        ('user_barrio', 'VARCHAR(200)'),
        ('user_calle', 'VARCHAR(200)'),
        ('user_numeracion', 'VARCHAR(100)'),
        ('_token_received', 'BOOLEAN'),
        ('_token_preview', 'TEXT'),
    ]
    dialect = engine.dialect.name if engine and getattr(engine, 'dialect', None) else ''
    try:
        insp = inspect(engine)
        has_orders = 'orders' in insp.get_table_names()
        if not has_orders:
            return {'error': 'no_orders_table'}
        existing = {c['name'] for c in insp.get_columns('orders')}
        with engine.connect() as conn:
            for name, coltype in needed:
                if name in existing:
                    results['skipped'].append(name)
                    continue
                try:
                    if 'postgres' in dialect:
                        sql = f"ALTER TABLE orders ADD COLUMN IF NOT EXISTS {name} {coltype};"
                    else:
                        sql = f"ALTER TABLE orders ADD COLUMN {name} {coltype};"
                    conn.execute(text(sql))
                    results['added'].append(name)
                except Exception as e:
                    try:
                        _invalidate_conn(conn)
                    except Exception:
                        pass
                    results['failed'].append({ 'name': name, 'error': str(e) })
        return results
    except Exception as e:
        logger.exception('Migration helper failed: %s', e)
        return {'error': str(e)}


@app.get('/debug/db-columns')
async def debug_db_columns(request: Request):
    """Return column names from `orders` table for diagnosis. Requires MIGRATION_SECRET header."""
    secret = os.environ.get('MIGRATION_SECRET')
    provided = request.headers.get('x-migrate-secret')
    if secret and provided != secret:
        return JSONResponse(status_code=403, content={'error': 'forbidden'})
    try:
        insp = inspect(engine)
        if 'orders' not in insp.get_table_names():
            return JSONResponse(status_code=200, content={'columns': []})
        cols = [c['name'] for c in insp.get_columns('orders')]
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=200, content={'columns': cols}, headers=headers)
    except Exception as e:
        logger.exception('debug_db_columns failed: %s', e)
        return JSONResponse(status_code=500, content={'error': str(e)})


@app.get('/debug/db-info')
async def debug_db_info(request: Request):
    """Return basic DB engine info (dialect and whether using sqlite). Requires MIGRATION_SECRET header."""
    secret = os.environ.get('MIGRATION_SECRET')
    provided = request.headers.get('x-migrate-secret')
    if secret and provided != secret:
        return JSONResponse(status_code=403, content={'error': 'forbidden'})
    try:
        dialect = getattr(engine, 'dialect', None)
        dialect_name = getattr(dialect, 'name', '') if dialect else ''
        using_sqlite = 'sqlite' in dialect_name
        # Masked DB url
        db_env = os.environ.get('DATABASE_URL')
        masked = 'sqlite (local file)'
        if db_env:
            try:
                from urllib.parse import urlparse
                u = urlparse(db_env)
                user = u.username or ''
                host = u.hostname or ''
                port = u.port or ''
                path = u.path or ''
                masked = f"{u.scheme}://{user + ':****@' if user else ''}{host}{(':'+str(port)) if port else ''}{path}"
            except Exception:
                masked = 'postgres (masked)'
        headers = _cors_headers_for_request(request)
        # quick connectivity test
        ok = False
        try:
            with engine.connect() as conn:
                conn.execute(text('SELECT 1'))
                ok = True
        except Exception:
            ok = False
        return JSONResponse(status_code=200, content={'dialect': dialect_name, 'using_sqlite': using_sqlite, 'database_url_masked': masked, 'connection_ok': ok}, headers=headers)
    except Exception as e:
        logger.exception('debug_db_info failed: %s', e)
        return JSONResponse(status_code=500, content={'error': str(e)})


@app.post('/debug/migrate')
async def debug_migrate(request: Request):
    """Run migration to add missing `user_*` columns to `orders` table. Requires MIGRATION_SECRET header."""
    secret = os.environ.get('MIGRATION_SECRET')
    provided = request.headers.get('x-migrate-secret')
    if secret and provided != secret:
        return JSONResponse(status_code=403, content={'error': 'forbidden'})
    # Run migration (blocking but quick)
    result = _run_add_user_columns()
    headers = _cors_headers_for_request(request)
    return JSONResponse(status_code=200, content={'result': result}, headers=headers)


@app.post('/debug/push-order')
async def debug_push_order(request: Request):
    """Debug-only: push a synthetic order event to connected admin clients. Requires MIGRATION_SECRET if set."""
    secret = os.environ.get('MIGRATION_SECRET')
    provided = request.headers.get('x-migrate-secret')
    if secret and provided != secret:
        return JSONResponse(status_code=403, content={'error': 'forbidden'})
    try:
        body = await request.json()
    except Exception:
        body = {}
    # ensure we include at least an id
    if not body.get('id'):
        import time
        body['id'] = f"debug-{int(time.time())}"
        body['items'] = body.get('items', [])
        body['total'] = body.get('total', 0)
        body['created_at'] = body.get('created_at')
    await push_event({"action": "order_created", "order": body})
    headers = _cors_headers_for_request(request)
    return JSONResponse(status_code=200, content={'ok': True, 'order': body}, headers=headers)


@app.post('/debug/backfill-token-previews')
async def debug_backfill_token_previews(request: Request):
    """Attempt to persist cached token previews from ORDER_PAYLOAD_CACHE into the DB.
    Only for debugging; requires MIGRATION_SECRET header if set."""
    secret = os.environ.get('MIGRATION_SECRET')
    provided = request.headers.get('x-migrate-secret')
    if secret and provided != secret:
        return JSONResponse(status_code=403, content={'error': 'forbidden'})

    results = {'updated': [], 'skipped': [], 'failed': []}
    try:
        insp = inspect(engine)
        existing = {c['name'] for c in insp.get_columns('orders')}
    except Exception:
        existing = set()

    if '_token_preview' not in existing and '_token_received' not in existing:
        return JSONResponse(status_code=400, content={'error': 'token_columns_missing'})

    import json as _json
    now = time.time()
    for oid, rec in list(ORDER_PAYLOAD_CACHE.items()):
        try:
            p = rec.get('payload') if rec and isinstance(rec, dict) else None
            if not p or not p.get('_token_preview'):
                results['skipped'].append({'id': oid, 'reason': 'no_preview'})
                continue
            tp = p.get('_token_preview')
            # Serialize
            tp_json = _json.dumps(tp, ensure_ascii=False)
            # Attempt update via transactional context
            try:
                with engine.begin() as conn:
                    # Try numeric id first
                    try:
                        iid = int(oid)
                        conn.execute(text('UPDATE orders SET _token_preview = :tp, _token_received = :tr WHERE id = :id'), {'tp': tp_json, 'tr': True, 'id': iid})
                    except Exception:
                        conn.execute(text('UPDATE orders SET _token_preview = :tp, _token_received = :tr WHERE CAST(id AS TEXT) = :id'), {'tp': tp_json, 'tr': True, 'id': str(oid)})
                results['updated'].append(oid)
            except Exception as e:
                results['failed'].append({'id': oid, 'error': str(e)})
        except Exception as e:
            results['failed'].append({'id': oid, 'error': str(e)})

    headers = _cors_headers_for_request(request)
    return JSONResponse(status_code=200, content={'result': results}, headers=headers)


@app.get('/debug/whoami')
async def debug_whoami(request: Request):
    """Return decoded bearer token payload for debugging (safe to call from browser)."""
    auth = request.headers.get('authorization') or request.headers.get('Authorization')
    headers = _cors_headers_for_request(request)
    if not auth or not isinstance(auth, str) or not auth.lower().startswith('bearer '):
        return JSONResponse(status_code=200, content={'ok': False, 'error': 'no_authorization'}, headers=headers)
    token = auth.split(' ', 1)[1]
    try:
        payload = utils.decode_access_token(token)
        # Mask token in logs
        try: logger.info('debug_whoami called; token=***%s payload=%s', token[-12:], payload)  # last chars for identification
        except Exception: pass
        if not payload:
            return JSONResponse(status_code=200, content={'ok': False, 'error': 'invalid_token'}, headers=headers)
        return JSONResponse(status_code=200, content={'ok': True, 'payload': payload}, headers=headers)
    except Exception as e:
        logger.exception('debug_whoami failed: %s', e)
        return JSONResponse(status_code=500, content={'ok': False, 'error': str(e)}, headers=headers)



@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"{request.method} {request.url}")
    return await call_next(request)


@app.middleware("http")
async def ensure_cors_middleware(request: Request, call_next):
    """Handle preflight OPTIONS and ensure CORS response headers are present on every response.
    This echoes the request Origin when present (required when credentials are used), or falls back to '*'.
    """
    # Fast-path preflight
    if request.method == 'OPTIONS':
        headers = _cors_headers_for_request(request)
        return Response(status_code=204, headers=headers)

    response = await call_next(request)

    # Add CORS headers if not already present
    try:
        headers = _cors_headers_for_request(request)
        for k, v in headers.items():
            if k not in response.headers:
                response.headers[k] = v
    except Exception:
        # be defensive: don't break the response if header handling fails
        pass

    return response


# -------------------------------------------------------------------
# PATHS
# -------------------------------------------------------------------
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
# Allow overriding upload directory via env var so a Render persistent disk can be mounted there.
# If not provided, fall back to the local `uploads` folder inside the project (ephemeral on some hosts).
UPLOAD_DIR = os.environ.get('UPLOAD_DIR') or os.path.join(ROOT_DIR, "uploads")
PROMO_DIR = os.path.join(UPLOAD_DIR, 'promos')
FRONTEND_DIR = os.path.join(ROOT_DIR, "admin")
CATALOG_DIR = os.environ.get('CATALOG_DIR') or os.path.join(ROOT_DIR, "catalogo")

# ensure catalog dir exists when possible (if mounted as persistent volume this will create it)
try:
    os.makedirs(CATALOG_DIR, exist_ok=True)
except Exception:
    pass

utils.ensure_upload_folder(UPLOAD_DIR)
try:
    os.makedirs(PROMO_DIR, exist_ok=True)
except Exception:
    pass

# -------------------------------------------------------------------
# STATIC FILES
# -------------------------------------------------------------------
if os.path.exists(FRONTEND_DIR):
    app.mount("/admin", StaticFiles(directory=FRONTEND_DIR), name="admin")

    @app.get("/")
    def root():
        return RedirectResponse("/admin/index.html")

    # Serve a versioned `index.html` to help cache-bust client assets after deploys.
    @app.get("/admin/index.html")
    async def admin_index():
        path = os.path.join(FRONTEND_DIR, 'index.html')
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail='Admin UI not found')
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            logger.exception('Failed reading admin index.html: %s', e)
            raise HTTPException(status_code=500, detail='Failed to read admin UI')
        # Determine a short version token: prefer DEPLOY_COMMIT if present, otherwise use file mtime
        ver = os.environ.get('DEPLOY_COMMIT') or os.environ.get('RENDER_GIT_COMMIT') or os.environ.get('HEROKU_SLUG_COMMIT') or str(int(os.path.getmtime(path)))
        # Inject cache-busting query param for the main JS and CSS references
        content = content.replace('app.js"', f'app.js?v={ver}"').replace('styles.css"', f'styles.css?v={ver}"')
        return Response(content=content, media_type='text/html')

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

if os.path.exists(CATALOG_DIR):
    app.mount("/catalogo", StaticFiles(directory=CATALOG_DIR), name="catalogo")

# --- Promotional images API (admin/frontend) ---
@app.get('/api/promos')
def list_promos(request: Request, db: Session = Depends(get_db)):
    """Return only the images selected for the public promo carousel.
    The selection is stored in `promo_list.json` under the catalog directory.
    """
    try:
        # Prefer DB-backed selection of promo images. Fall back to scanned uploads when DB empty.
        selected = []
        try:
            promos = db.query(models.PromoImage).filter(models.PromoImage.selected == True).order_by(models.PromoImage.created_at.desc()).all()
            for p in promos:
                # prefer stored URL, but make it absolute so frontend/admin can load across origins
                try:
                    base = str(request.base_url).rstrip('/')
                except Exception:
                    base = ''
                stored = (p.url or '')
                use_filename = False
                if stored:
                    s = stored.replace('\\', '/')
                    if s.startswith('http://') or s.startswith('https://'):
                        url = s
                    elif s.startswith('/'):
                        url = (base + s) if base else s
                    else:
                        # treat suspicious filesystem-like values as filesystem
                        if (':' in stored and ('\\' in stored or '/' in stored)) or '\\' in stored:
                            use_filename = True
                        else:
                            if s.startswith('uploads/'):
                                s = '/' + s
                            url = (base + s) if base else s
                else:
                    use_filename = True

                if use_filename:
                    url = f'/uploads/promos/{p.filename}'
                    if base:
                        url = base + url

                if isinstance(url, str):
                    url = url.replace('\\', '/')

                selected.append({ 'url': url, 'alt': p.alt or p.filename, 'name': p.filename, 'ts': int(p.created_at.timestamp()) if p.created_at else None })
            # If DB has none, fall back to scanning PROMO_DIR for compatibility
            if not selected and os.path.isdir(PROMO_DIR):
                for fname in sorted(os.listdir(PROMO_DIR)):
                    if fname.startswith('.'):
                        continue
                    path = os.path.join(PROMO_DIR, fname)
                    if not os.path.isfile(path):
                        continue
                    try:
                        base = str(request.base_url).rstrip('/')
                    except Exception:
                        base = ''
                    url = f'/uploads/promos/{fname}'
                    if base:
                        url = base + url
                    selected.append({ 'url': url, 'alt': fname, 'name': fname, 'ts': int(os.path.getmtime(path)) if os.path.exists(path) else None })
        except Exception:
            selected = []
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=200, content=selected, headers=headers)
    except Exception as e:
        logger.exception('list_promos failed: %s', e)
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=500, content={'detail': 'failed'}, headers=headers)


@app.post('/api/promos')
async def upload_promo(file: UploadFile = File(...), request: Request = None, db: Session = Depends(get_db)):
    """Save promo image either to S3 (if configured) or local uploads and persist metadata.

    Uses `utils.save_upload_file` so deployments on hosts like Render can be configured
    to use a persistent `UPLOAD_DIR` or S3 via env vars.
    """
    try:
        # Ensure upload folder exists
        utils.ensure_upload_folder(PROMO_DIR)

        # Read file content so we can both persist to external storage and to DB
        contents = await file.read()
        orig_name = os.path.basename(file.filename or 'promo')
        s3_bucket = os.environ.get('S3_BUCKET') or os.environ.get('AWS_S3_BUCKET')

        # Persist image bytes into DB `images` table first so promo images are durable
        img_id = None
        try:
            img = models.Image(data=contents, mime=getattr(file, 'content_type', None), filename=orig_name)
            db.add(img)
            db.commit()
            db.refresh(img)
            img_id = img.id
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
            img_id = None

        # Best-effort: also save to S3 or disk for compatibility, but do not rely on it
        try:
            _ = await utils.save_bytes_upload(contents, orig_name, PROMO_DIR, s3_bucket=s3_bucket, content_type=getattr(file, 'content_type', None))
        except Exception:
            # ignore storage errors; DB-backed image is authoritative
            pass

        # Build a durable URL that points to our DB-backed image endpoint when possible
        if img_id:
            try:
                base = str(request.base_url).rstrip('/')
            except Exception:
                base = ''
            url = (base + f'/images/{img_id}') if base else f'/images/{img_id}'
            fname = orig_name
        else:
            # fallback: try the saved path or public uploads path
            dest_path = None
            try:
                dest_path = await utils.save_bytes_upload(contents, orig_name, PROMO_DIR, s3_bucket=s3_bucket, content_type=getattr(file, 'content_type', None))
            except Exception:
                dest_path = None
            fname = os.path.basename(str(dest_path)) if dest_path else orig_name
            try:
                base = str(request.base_url).rstrip('/')
            except Exception:
                base = ''
            url_path = f'/uploads/promos/{fname}'
            url = (base + url_path) if base else url_path

        # persist metadata in DB (store absolute URL when possible)
        try:
            # Try to avoid duplicate PromoImage rows: match by exact filename or by suffix of original filename
            existing_pi = db.query(models.PromoImage).filter(
                or_(models.PromoImage.filename == fname, models.PromoImage.filename.like(f'%{orig_name}'))
            ).first()
            if existing_pi:
                existing_pi.url = url
                existing_pi.alt = fname
                existing_pi.selected = False
                db.add(existing_pi)
                db.commit()
            else:
                pi = models.PromoImage(filename=fname, url=url, alt=fname, selected=False)
                db.add(pi)
                db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass

        headers = _cors_headers_for_request(request or Request)
        return JSONResponse(status_code=201, content={'url': url, 'name': fname}, headers=headers)
    except Exception as e:
        logger.exception('upload_promo failed: %s', e)
        headers = _cors_headers_for_request(request or Request)
        return JSONResponse(status_code=500, content={'detail': 'upload failed'}, headers=headers)


@app.get('/api/uploads')
def list_uploads(request: Request, db: Session = Depends(get_db)):
    """Return all uploaded image files (for admin browsing)."""
    try:
        items = []
        try:
            # prefer DB records
            rows = db.query(models.PromoImage).order_by(models.PromoImage.created_at.desc()).all()
            for r in rows:
                try:
                    base = str(request.base_url).rstrip('/')
                except Exception:
                    base = ''
                # Normalize stored URL — if it's an absolute HTTP URL, keep it.
                stored = (r.url or '')
                # If stored URL looks like a filesystem path (backslashes or drive letter), ignore it and build public path
                use_filename = False
                if stored:
                    s = stored.replace('\\', '/')
                    if s.startswith('http://') or s.startswith('https://'):
                        url = s
                    elif s.startswith('/'):
                        url = (base + s) if base else s
                    else:
                        # If it contains a colon (windows drive C:) or a backslash originally, treat as filesystem
                        if (':' in stored and ('\\' in stored or '/' in stored)) or '\\' in stored:
                            use_filename = True
                        else:
                            # relative path like 'uploads/promos/...' — ensure leading slash
                            if s.startswith('uploads/'):
                                s = '/' + s
                            url = (base + s) if base else s
                else:
                    use_filename = True

                if use_filename:
                    url = f'/uploads/promos/{r.filename}'
                    if base:
                        url = base + url

                # final normalize
                if isinstance(url, str):
                    url = url.replace('\\', '/')

                items.append({ 'url': url, 'alt': r.alt or r.filename, 'name': r.filename, 'ts': int(r.created_at.timestamp()) if r.created_at else None, 'selected': bool(r.selected) })
            # If DB empty, fallback to scanning disk
            if not items and os.path.isdir(PROMO_DIR):
                for fname in sorted(os.listdir(PROMO_DIR)):
                    if fname.startswith('.'):
                        continue
                    path = os.path.join(PROMO_DIR, fname)
                    if not os.path.isfile(path):
                        continue
                    lower = fname.lower()
                    if not (lower.endswith('.png') or lower.endswith('.jpg') or lower.endswith('.jpeg') or lower.endswith('.webp') or lower.endswith('.gif')):
                        continue
                    try:
                        mtime = int(os.path.getmtime(path))
                    except Exception:
                        mtime = None
                    try:
                        base = str(request.base_url).rstrip('/')
                    except Exception:
                        base = ''
                    url = f'/uploads/promos/{fname}'
                    if base:
                        url = base + url
                    url = url.replace('\\', '/')
                    items.append({ 'url': url, 'alt': fname, 'name': fname, 'ts': mtime, 'selected': False })
        except Exception:
            items = []
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=200, content=items, headers=headers)
    except Exception as e:
        logger.exception('list_uploads failed: %s', e)
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=500, content={'detail': 'failed'}, headers=headers)


@app.delete('/api/promos/{filename}')
def delete_promo(filename: str, request: Request, db: Session = Depends(get_db)):
    try:
        # prevent traversal
        fname = os.path.basename(filename)
        path = os.path.join(PROMO_DIR, fname)

        deleted_any = False

        # If the file exists on disk, remove it
        try:
            if os.path.exists(path) and os.path.isfile(path):
                os.remove(path)
                deleted_any = True
        except Exception as e:
            logger.exception('Failed removing file %s: %s', path, e)

        # Remove associated promo DB record(s)
        try:
            rec = db.query(models.PromoImage).filter(models.PromoImage.filename == fname).first()
            if rec:
                # If the promo image points to a DB-backed image URL like /images/{id}, remove that image row too
                try:
                    if rec.url and isinstance(rec.url, str) and '/images/' in rec.url:
                        # extract numeric id if possible
                        try:
                            img_id = int(rec.url.rstrip('/').split('/')[-1])
                            db.query(models.Image).filter(models.Image.id == img_id).delete()
                            db.commit()
                            deleted_any = True
                        except Exception:
                            db.rollback()
                except Exception:
                    db.rollback()
                # delete the promo record
                try:
                    db.query(models.PromoImage).filter(models.PromoImage.filename == fname).delete()
                    db.commit()
                    deleted_any = True
                except Exception:
                    db.rollback()
        except Exception:
            db.rollback()

        headers = _cors_headers_for_request(request)
        if deleted_any:
            return JSONResponse(status_code=200, content={'detail': 'deleted'}, headers=headers)
        else:
            return JSONResponse(status_code=404, content={'detail': 'not found or not deletable'}, headers=headers)
    except Exception as e:
        logger.exception('delete_promo failed: %s', e)
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=500, content={'detail': 'delete failed'}, headers=headers)


# Fallback route: serve promos from disk when present, otherwise from DB `images` table.
# This lets the existing `/uploads/promos/<file>` URLs keep working for admins without
# requiring an immediate migration of DB rows; if the file is missing, try to locate
# the binary in the `images` table by filename or via a linked `promo_images` record.
@app.get('/uploads/promos/{filename}')
def serve_promo_fallback(filename: str, request: Request, db: Session = Depends(get_db)):
    try:
        fname = os.path.basename(filename)
        path = os.path.join(PROMO_DIR, fname)

        # If file exists on disk, let FastAPI serve it directly for efficiency
        if os.path.exists(path) and os.path.isfile(path):
            return FileResponse(path)

        # Try to resolve a DB-backed image via the PromoImage record
        try:
            rec = db.query(models.PromoImage).filter(models.PromoImage.filename == fname).first()
            if rec and rec.url and isinstance(rec.url, str) and '/images/' in rec.url:
                try:
                    img_id = int(rec.url.rstrip('/').split('/')[-1])
                    img = db.query(models.Image).filter(models.Image.id == img_id).first()
                    if img and getattr(img, 'data', None):
                        headers = _cors_headers_for_request(request)
                        return Response(content=img.data, media_type=(img.mime or 'application/octet-stream'), headers=headers)
                except Exception:
                    pass
        except Exception:
            pass

        # As a last resort, try to find an Image row by filename
        try:
            img = db.query(models.Image).filter(models.Image.filename == fname).first()
            if img and getattr(img, 'data', None):
                headers = _cors_headers_for_request(request)
                return Response(content=img.data, media_type=(img.mime or 'application/octet-stream'), headers=headers)
        except Exception:
            pass

        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=404, content={'detail': 'not found'}, headers=headers)
    except Exception as e:
        logger.exception('serve_promo_fallback failed: %s', e)
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=500, content={'detail': 'internal error'}, headers=headers)


@app.post('/api/promos/select')
def select_promo(request: Request, db: Session = Depends(get_db)):
    """Add a filename to the promo_list (body: { "name": "filename" })."""
    try:
        body = request.json() if hasattr(request, 'json') else None
    except Exception:
        body = None
    try:
        data = None
        try:
            data = request.json()
        except Exception:
            try:
                # fallback to reading body bytes
                import asyncio
                data = None
            except Exception:
                data = None
        # simpler: parse raw body
        try:
            raw = request._body if hasattr(request, '_body') else None
        except Exception:
            raw = None
        # We'll instead read from the request stream synchronously (FastAPI gives us Request instance)
        # But to keep compatibility, accept query param 'name'
        name = None
        try:
            name = request.query_params.get('name')
        except Exception:
            name = None
        if not name:
            # try json load from body
            try:
                import json as _json
                raw_body = request._body if hasattr(request, '_body') else None
                if not raw_body:
                    # attempt to read via awaitable (not possible here), return error
                    raise HTTPException(status_code=400, detail='name required')
                pd = _json.loads(raw_body)
                name = pd.get('name')
            except Exception:
                raise HTTPException(status_code=400, detail='name required')

        fname = os.path.basename(name)
        path = os.path.join(PROMO_DIR, fname)
        if not os.path.isfile(path):
            # If the file is not present on disk, allow selection if a DB record exists (tolerant behavior)
            rec = db.query(models.PromoImage).filter(models.PromoImage.filename == fname).first()
            if not rec:
                headers = _cors_headers_for_request(request)
                return JSONResponse(status_code=404, content={'detail': 'file not found'}, headers=headers)
        # mark DB record selected (and deselect others if necessary)
        try:
            # ensure record exists
            rec = db.query(models.PromoImage).filter(models.PromoImage.filename == fname).first()
            if not rec:
                # create record with absolute URL when possible
                try:
                    base = str(request.base_url).rstrip('/')
                except Exception:
                    base = ''
                url_path = f'/uploads/promos/{fname}'
                url = (base + url_path) if base else url_path
                rec = models.PromoImage(filename=fname, url=url, alt=fname, selected=True)
                db.add(rec)
            else:
                rec.selected = True
            # commit selection
            db.commit()
        except Exception:
            db.rollback()
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=200, content={'detail': 'selected', 'name': fname}, headers=headers)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('select_promo failed: %s', e)
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=500, content={'detail': 'failed'}, headers=headers)


@app.delete('/api/promos/select/{filename}')
def deselect_promo(filename: str, request: Request, db: Session = Depends(get_db)):
    try:
        fname = os.path.basename(filename)
        try:
            rec = db.query(models.PromoImage).filter(models.PromoImage.filename == fname).first()
            if not rec:
                headers = _cors_headers_for_request(request)
                return JSONResponse(status_code=404, content={'detail': 'not found'}, headers=headers)
            rec.selected = False
            db.commit()
            headers = _cors_headers_for_request(request)
            return JSONResponse(status_code=200, content={'detail': 'deselected', 'name': fname}, headers=headers)
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
            headers = _cors_headers_for_request(request)
            return JSONResponse(status_code=500, content={'detail': 'failed to deselect'}, headers=headers)
    except Exception as e:
        logger.exception('deselect_promo failed: %s', e)
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=500, content={'detail': 'failed'}, headers=headers)


# --- Consumición inmediata API (admin) ---
@app.get('/api/consumos')
def list_consumos(request: Request, db: Session = Depends(get_db)):
    """Return consumos config: list of { id: product_id, discount: percent }.
    Prefer DB-backed settings when available; fall back to consumos.json.
    """
    try:
        items = []
        # Prefer DB-backed setting if present
        try:
            rec = db.query(models.Setting).filter(models.Setting.key == 'consumos').first()
            if rec and rec.value:
                try:
                    items = json.loads(rec.value) or []
                except Exception:
                    items = []
        except Exception:
            items = []
        # Fallback to file if DB empty
        if not items:
            consumos_path = os.path.join(CATALOG_DIR, 'consumos.json')
            if os.path.exists(consumos_path):
                try:
                    with open(consumos_path, 'r', encoding='utf-8') as f:
                        items = json.load(f) or []
                except Exception:
                    items = []
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=200, content=items, headers=headers)
    except Exception as e:
        logger.exception('list_consumos failed: %s', e)
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=500, content={'detail': 'failed'}, headers=headers)


@app.post('/api/consumos')
async def save_consumos(request: Request, db: Session = Depends(get_db)):
    """Replace the consumos list. Accepts JSON array in body."""
    try:
        body = await request.body()
        try:
            data = json.loads(body) if body else []
        except Exception:
            data = []
        if not isinstance(data, list):
            raise HTTPException(status_code=400, detail='expected list')
        # If client attempts to save an empty list, require explicit confirmation to avoid accidental wipes
        if len(data) == 0 and not request.query_params.get('confirm'):
            raise HTTPException(status_code=400, detail='empty-list-requires-confirm')
        # Normalize and validate incoming entries (coerce id and numeric fields). Invalid entries are rejected.
        cleaned = []
        for entry in data:
            if not isinstance(entry, dict):
                continue
            try:
                pid = int(entry.get('id'))
            except Exception:
                continue
            # tolerate strings with comma decimal (e.g. "10,5") and percent signs
            try:
                raw_disc = entry.get('discount') if entry.get('discount') is not None else entry.get('value', 0)
                if isinstance(raw_disc, str):
                    raw_disc = raw_disc.replace('%', '').strip().replace(',', '.')
                discount = float(raw_disc) if raw_disc is not None else 0.0
            except Exception:
                discount = 0.0
            try:
                raw_qty = entry.get('qty') if entry.get('qty') is not None else entry.get('cantidad', 0)
                if isinstance(raw_qty, str):
                    raw_qty = raw_qty.strip().replace(',', '.')
                qty = int(float(raw_qty)) if raw_qty is not None else 0
            except Exception:
                qty = 0
            # keep entries with a positive discount and non-negative qty
            if discount <= 0 or qty < 0:
                continue
            # Default consumos to percent-type discounts unless caller specifies otherwise
            ctype = entry.get('type') if isinstance(entry, dict) else None
            if not ctype and discount > 0:
                ctype = 'percent'
            cleaned.append({'id': pid, 'discount': float(discount), 'qty': int(qty), 'type': ctype})
        # If after cleaning there is nothing to save but the original data wasn't empty, reject to avoid accidental clears
        if len(cleaned) == 0 and len(data) > 0:
            raise HTTPException(status_code=400, detail='no-valid-consumos')
        data = cleaned
        consumos_path = os.path.join(CATALOG_DIR, 'consumos.json')
        # write and verify success; if writing fails return 500 so client knows
        try:
            os.makedirs(CATALOG_DIR, exist_ok=True)
            with open(consumos_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            # Persist to DB settings so consumos survive deploys
            try:
                rec = db.query(models.Setting).filter(models.Setting.key == 'consumos').first()
                if rec:
                    rec.value = json.dumps(data, ensure_ascii=False)
                else:
                    rec = models.Setting(key='consumos', value=json.dumps(data, ensure_ascii=False))
                    db.add(rec)
                db.commit()
            except Exception as db_err:
                try:
                    db.rollback()
                except Exception:
                    pass
                logger.exception('save_consumos db write failed: %s', db_err)
            # Update static snapshot with consumos reflected (best-effort) and notify WS clients
            try:
                await anyio.to_thread.run_sync(write_catalog_snapshot)
            except Exception:
                logger.exception('write_catalog_snapshot after save_consumos failed')
            try:
                await push_event({"action": "consumos-updated", "consumos": data})
            except Exception:
                logger.exception('push_event consumos-updated failed')
            headers = _cors_headers_for_request(request)
            return JSONResponse(status_code=200, content={'detail': 'saved'}, headers=headers)
        except Exception as write_err:
            logger.exception('save_consumos write failed: %s', write_err)
            headers = _cors_headers_for_request(request)
            return JSONResponse(status_code=500, content={'detail': 'failed to save consumos'}, headers=headers)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('save_consumos failed: %s', e)
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=500, content={'detail': 'failed'}, headers=headers)


@app.delete('/api/consumos/{product_id}')
def delete_consumo(product_id: str, request: Request):
    try:
        pid = int(product_id)
    except Exception:
        pid = product_id
    try:
        consumos_path = os.path.join(CATALOG_DIR, 'consumos.json')
        items = []
        if os.path.exists(consumos_path):
            try:
                with open(consumos_path, 'r', encoding='utf-8') as f:
                    items = json.load(f) or []
            except Exception:
                items = []
            new_items = [it for it in items if it.get('id') != pid and str(it.get('id')) != str(pid)]
            try:
                with open(consumos_path, 'w', encoding='utf-8') as f:
                    json.dump(new_items, f, ensure_ascii=False, indent=2)
                headers = _cors_headers_for_request(request)
                return JSONResponse(status_code=200, content={'detail': 'deleted'}, headers=headers)
            except Exception as write_err:
                logger.exception('delete_consumo write failed: %s', write_err)
                headers = _cors_headers_for_request(request)
                return JSONResponse(status_code=500, content={'detail': 'failed to delete consumos'}, headers=headers)
    except Exception as e:
        logger.exception('delete_consumo failed: %s', e)
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=500, content={'detail': 'failed'}, headers=headers)

# -------------------------------------------------------------------
# WEBSOCKETS
# -------------------------------------------------------------------
connections: List[WebSocket] = []

async def push_event(data: dict):
    """Broadcast JSON `data` to all connected WebSocket clients and log diagnostics."""
    try:
        logger.info('push_event sending to %s connections: %s', len(connections), data)
    except Exception:
        pass
    tasks = []
    for ws in list(connections):
        try:
            tasks.append(ws.send_json(data))
        except Exception:
            try:
                connections.remove(ws)
            except Exception:
                pass
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    try:
        logger.info('push_event completed')
    except Exception:
        pass

@app.websocket("/ws/products")
async def ws_products(ws: WebSocket):
    await ws.accept()
    connections.append(ws)
    try:
        while True:
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass
    finally:
        if ws in connections:
            connections.remove(ws)

# -------------------------------------------------------------------
# ENDPOINTS
# -------------------------------------------------------------------
@app.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):
    # Read content
    content = await file.read()
    mime = getattr(file, 'content_type', None) or 'application/octet-stream'
    filename = getattr(file, 'filename', None)

    # Save into DB Image table (run blocking DB write in thread)
    def task():
        db = SessionLocal()
        try:
            img = models.Image(data=content, mime=mime, filename=filename)
            db.add(img)
            db.commit()
            db.refresh(img)
            return img.id
        finally:
            db.close()

    img_id = await anyio.to_thread.run_sync(task)
    return {"image_url": f"/images/{img_id}"}


@app.get('/images/{image_id}')
def get_image(image_id: int, db: Session = Depends(get_db)):
    img = db.query(models.Image).filter(models.Image.id == image_id).first()
    if not img:
        raise HTTPException(404, 'Image not found')
    return Response(img.data, media_type=img.mime)


# --- Auth endpoints ---
@app.post('/auth/register', response_model=schemas.UserResponse)
async def register(user: schemas.UserCreate):
    # validate unique email and create user with hashed password
    def task():
        db = SessionLocal()
        try:
            if crud.get_user_by_email(db, user.email):
                # signal duplicate via exception for the outer handler
                raise IntegrityError('duplicate', params=None, orig=None)
            hashed = utils.hash_password(user.password)
            new = crud.create_user(db, user, hashed)
            return new
        finally:
            db.close()

    try:
        new_user = await anyio.to_thread.run_sync(task)
    except IntegrityError:
        raise HTTPException(status_code=400, detail='Email already registered')
    except Exception as e:
        logger.exception('Unexpected error in /auth/register: %s', e)
        raise HTTPException(status_code=500, detail='Server error')
    return new_user


@app.post('/auth/token', response_model=schemas.Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    def task():
        db = SessionLocal()
        try:
            user = crud.authenticate_user(db, form_data.username, form_data.password)
            return user
        finally:
            db.close()

    try:
        user = await anyio.to_thread.run_sync(task)
    except Exception as e:
        logger.exception('Unexpected error in /auth/token: %s', e)
        raise HTTPException(status_code=500, detail='Server error')

    if not user:
        raise HTTPException(status_code=401, detail='Incorrect credentials')
    access_token = utils.create_access_token({"sub": user.email, "id": user.id, "full_name": user.full_name})
    logger.info('login_for_access_token: issued token for user id=%s email=%s', user.id, user.email)
    return {"access_token": access_token, "token_type": "bearer"}


def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = utils.decode_access_token(token)
    except Exception as e:
        logger.exception('get_current_user: decode_access_token failed: %s', e)
        raise HTTPException(status_code=401, detail='Invalid token')
    logger.info('get_current_user: token payload=%s', payload)
    if not payload:
        raise HTTPException(status_code=401, detail='Invalid token')
    email = payload.get('sub')
    if not email:
        raise HTTPException(status_code=401, detail='Invalid token payload')
    db = SessionLocal()
    try:
        user = crud.get_user_by_email(db, email)
        logger.info('get_current_user: user lookup for email %s -> %s', email, bool(user))
        if not user:
            raise HTTPException(status_code=401, detail='User not found')
        return user
    finally:
        db.close()


@app.get('/auth/me', response_model=schemas.UserResponse)
def auth_me(current_user = Depends(get_current_user)):
    return current_user

@app.post("/products")
async def create_product(payload: schemas.ProductCreate):
    """Create a product - no response validation, just raw JSON."""
    # Log incoming payload (helps debug server vs validation failures)
    try:
        logger.info('POST /products called with payload: %s', jsonable_encoder(payload))
    except Exception:
        logger.exception('Failed to log payload for POST /products')

    def task():
        db = SessionLocal()
        try:
            prod = crud.create_product(db, payload)
            if not prod:
                return None
            # Convert safely to dict whether prod is a dict or object
            if isinstance(prod, dict):
                getv = prod.get
            else:
                getv = lambda k, d=None: getattr(prod, k, d)
            result = {
                'id': getv('id', None),
                'name': getv('name', ''),
                'price': getv('price', 0),
                'description': getv('description', ''),
                'category': getv('category', ''),
                'image_url': getv('image_url', ''),
                'active': bool(getv('active', True)),
                'created_at': getv('created_at', None),
                'updated_at': getv('updated_at', None),
                'stock': int(getv('stock', 0) or 0),
                'discount': float(getv('discount', 0.0) or 0.0)
            }
            return result
        finally:
            try:
                db.rollback()
            except:
                pass
            try:
                db.close()
            except:
                pass
                pass

    try:
        result = await anyio.to_thread.run_sync(task)
        if not result:
            raise HTTPException(status_code=500, detail='Product creation failed')
        # Normalize result to plain dict
        if not isinstance(result, dict):
            try:
                result = {k: getattr(result, k) for k in ('id','name','price','description','category','image_url','active','stock','discount') if hasattr(result, k)}
            except Exception:
                result = dict(result.__dict__) if hasattr(result, '__dict__') else dict(result)
        try:
            await push_event({"action": "created", "product": {"id": result.get('id')}})
        except:
            pass
        
        try:
            await anyio.to_thread.run_sync(write_catalog_snapshot)
        except:
            pass
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        try:
            tb = traceback.format_exc()
            base = os.path.dirname(os.path.dirname(__file__))
            logpath = os.path.join(base, 'server_log.txt')
            with open(logpath, 'a', encoding='utf-8') as f:
                f.write(f"{datetime.datetime.utcnow().isoformat()} - POST /products exception: {str(e)[:400]}\n")
                f.write(tb + "\n\n")
        except Exception:
            pass
        logger.exception('POST /products: %s', e)
        raise HTTPException(status_code=500, detail=str(e)[:100])

@app.get("/products", response_model=List[schemas.ProductResponse])
def list_products(
    skip: int = 0,
    limit: int = 100,
    q: Optional[str] = None,
    category: Optional[str] = None,
    active: Optional[bool] = None,
    sort: Optional[str] = None,
    db: Session = Depends(get_db),
):
    try:
        return crud.get_products(db, skip, limit, q, category, active, sort)
    except Exception:
        logger.exception('list_products ORM failed, attempting raw fallback')
        # Try raw fallback select to avoid failing when DB lacks mapped columns
        try:
            try:
                bind = db.get_bind()
                insp = inspect(bind)
                existing = {c['name'] for c in insp.get_columns('products')}
            except Exception:
                existing = set()
            cols = ['id','name','price','description','category','image_url','created_at','updated_at','active']
            if 'stock' in existing: cols.append('stock')
            if 'discount' in existing: cols.append('discount')
            where = []
            params = {'skip': skip, 'limit': limit}
            if q:
                where.append('LOWER(name) LIKE :q'); params['q'] = f"%{q.lower()}%"
            if category:
                where.append('category = :category'); params['category'] = category
            if active is not None and 'active' in existing:
                where.append('active = :active'); params['active'] = bool(active)
            where_clause = (' WHERE ' + ' AND '.join(where)) if where else ''
            order_clause = ''
            if sort == 'price_asc': order_clause = ' ORDER BY price ASC'
            elif sort == 'price_desc': order_clause = ' ORDER BY price DESC'
            cols_sql = ', '.join(cols)
            sql = f"SELECT {cols_sql} FROM products{where_clause}{order_clause} LIMIT :limit OFFSET :skip"
            rows = crud._safe_execute_fetchall(db, sql, params)
            result = []
            for row in rows:
                objd = {cols[i]: row[i] for i in range(len(cols))}
                result.append(objd)
            return result
        except Exception:
            logger.exception('list_products raw fallback failed')
            return []

@app.get("/products/{product_id}", response_model=schemas.ProductResponse)
def get_product(product_id: int, db: Session = Depends(get_db)):
    try:
        prod = crud.get_product(db, product_id)
        if not prod:
            raise HTTPException(404, "Product not found")
        return prod
    except Exception:
        logger.exception('get_product ORM failed, attempting raw fallback')
        try:
            bind = db.get_bind()
            insp = inspect(bind)
            existing = {c['name'] for c in insp.get_columns('products')}
        except Exception:
            existing = set()
        cols = ['id','name','price','description','category','image_url','created_at','updated_at','active']
        if 'stock' in existing: cols.append('stock')
        if 'discount' in existing: cols.append('discount')
        cols_sql = ', '.join(cols)
        row = crud._safe_execute_fetchone(db, f"SELECT {cols_sql} FROM products WHERE id = :id LIMIT 1", {'id': product_id})
        if not row:
            raise HTTPException(404, 'Product not found')
        objd = {cols[i]: row[i] for i in range(len(cols))}
        return objd

@app.put("/products/{product_id}", response_model=schemas.ProductResponse)
async def update_product(product_id: int, payload: schemas.ProductUpdate):
    # Log incoming payload for diagnostics
    try:
        logger.info('PUT /products/%s called with payload: %s', product_id, jsonable_encoder(payload))
    except Exception:
        logger.exception('Failed to log payload for PUT /products/%s', product_id)

    def task():
        db = SessionLocal()
        try:
            return crud.update_product(db, product_id, payload)
        finally:
            db.close()

    try:
        prod = await anyio.to_thread.run_sync(task)
    except Exception as e:
        try:
            tb = traceback.format_exc()
            base = os.path.dirname(os.path.dirname(__file__))
            with open(os.path.join(base, 'server_log.txt'), 'a', encoding='utf-8') as f:
                f.write(f"{datetime.datetime.utcnow().isoformat()} - PUT /products/{product_id} exception: {str(e)[:400]}\n")
                f.write(tb + "\n\n")
        except Exception:
            pass
        logger.exception('PUT /products/%s failed: %s', product_id, e)
        raise HTTPException(status_code=500, detail=str(e)[:200])

    # Normalize prod to obtain id whether it's a dict or object
    prod_id = prod.get('id') if isinstance(prod, dict) else getattr(prod, 'id', None)
    try:
        await push_event({"action": "updated", "product": {"id": prod_id}})
    except Exception:
        pass
    try:
        await anyio.to_thread.run_sync(write_catalog_snapshot)
    except Exception:
        pass
    return prod

@app.delete("/products/{product_id}")
async def delete_product(product_id: int):
    def task():
        db = SessionLocal()
        try:
            crud.delete_product(db, product_id)
        finally:
            db.close()

    await anyio.to_thread.run_sync(task)
    await push_event({"action": "deleted", "product": {"id": product_id}})
    await anyio.to_thread.run_sync(write_catalog_snapshot)
    return {"detail": "deleted"}


@app.get('/debug/products-info')
def debug_products_info(db: Session = Depends(get_db)):
    """Return current products table columns and a small sample of rows (raw select).
    Use this to diagnose schema drift on deployments.
    """
    try:
        bind = db.get_bind()
        insp = inspect(bind)
        cols = [c['name'] for c in insp.get_columns('products')]
    except Exception as e:
        cols = []
    sample = []
    try:
        if cols:
            cols_sql = ', '.join(cols)
            rows = crud._safe_execute_fetchall(db, f"SELECT {cols_sql} FROM products ORDER BY created_at DESC LIMIT 10")
            for row in rows:
                obj = {cols[i]: row[i] for i in range(len(cols))}
                sample.append(obj)
    except Exception:
        try:
            # fallback: try ORM
            orm_rows = db.query(models.Product).order_by(models.Product.created_at.desc()).limit(10).all()
            for r in orm_rows:
                d = {c: getattr(r, c, None) for c in ('id','name','price','description','category','image_url','created_at','updated_at','active','stock','discount')}
                sample.append(d)
        except Exception:
            pass
    return { 'columns': cols, 'sample': sample }

# -------------------------------------------------------------------
# EXPORT / SNAPSHOT
# -------------------------------------------------------------------
def write_catalog_snapshot():
    # ensure catalog directory exists
    try:
        os.makedirs(CATALOG_DIR, exist_ok=True)
    except Exception:
        # if we cannot create the directory, bail out
        logger.exception('Could not ensure CATALOG_DIR exists')
        return

    db = SessionLocal()
    try:
        products = crud.export_all(db)
    finally:
        db.close()

    # Try to reflect consumos (reserved near-expiry qty) in the snapshot so public catalog shows correct available stock
    consumos_path = os.path.join(CATALOG_DIR, 'consumos.json')
    consumos_map = {}
    try:
        if os.path.exists(consumos_path):
            with open(consumos_path, 'r', encoding='utf-8') as f:
                _items = json.load(f) or []
            for it in _items:
                try:
                    pid = str(it.get('id'))
                    qty = int(it.get('qty') or 0)
                    disc = int(it.get('discount') or it.get('value') or 0)
                    if pid not in consumos_map:
                        consumos_map[pid] = {'qty': 0, 'discount': disc}
                    consumos_map[pid]['qty'] += qty
                except Exception:
                    continue
    except Exception:
        consumos_map = {}

    data = []
    for p in products:
        pid = str(p.id)
        reserved = consumos_map.get(pid, {}).get('qty', 0)
        discount_for_consumo = consumos_map.get(pid, {}).get('discount')
        orig_stock = int(p.stock) if getattr(p, 'stock', None) is not None else None
        adjusted_stock = None
        if orig_stock is not None:
            adjusted_stock = max(0, orig_stock - reserved)
        data.append({
            "id": p.id,
            "name": p.name,
            "price": float(p.price) if p.price else None,
            "description": p.description,
            "category": p.category,
            "image_url": p.image_url,
            "active": p.active,
            "stock": adjusted_stock,
            "discount": int(p.discount) if getattr(p, 'discount', None) is not None else None,
            "consumo_qty": int(reserved) if reserved else None,
            "consumo_discount": int(discount_for_consumo) if discount_for_consumo is not None else None,
        })

    with open(os.path.join(CATALOG_DIR, "products.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    # best-effort remote backup (async-friendly): update configured gist or URL
    try:
        content = json.dumps(data, ensure_ascii=False, indent=2)
        # schedule a background push (use anyio.to_thread to avoid blocking if not awaited)
        try:
            import anyio
            anyio.from_thread.run(lambda: None)
        except Exception:
            pass
        # try to push (synchronously here but guarded)
        if GIST_TOKEN and GIST_ID:
            try:
                httpx.patch(f"https://api.github.com/gists/{GIST_ID}", json={"files": {"products.json": {"content": content}}}, headers={"Authorization": f"token {GIST_TOKEN}"}, timeout=15)
            except Exception:
                logger.warning('Remote gist backup failed (write_catalog_snapshot)')
    except Exception:
        logger.exception('write_catalog_snapshot: remote backup step failed')


def write_promotions_snapshot(promos):
    """Write promotions snapshot to catalog directory so frontend/admin can read/write a canonical file."""
    try:
        if not os.path.exists(CATALOG_DIR):
            os.makedirs(CATALOG_DIR, exist_ok=True)
        path = os.path.join(CATALOG_DIR, "promotions.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(promos or [], f, indent=2, ensure_ascii=False)
        logger.info('promotions snapshot written to %s', path)
        # best-effort: also push promotions to configured gist backup
        try:
            if GIST_TOKEN and GIST_ID:
                url = f"https://api.github.com/gists/{GIST_ID}"
                payload = {"files": {"promotions.json": {"content": json.dumps(promos or [], ensure_ascii=False, indent=2)}}}
                try:
                    resp = httpx.patch(url, json=payload, headers={"Authorization": f"token {GIST_TOKEN}", "Accept": "application/vnd.github.v3+json"}, timeout=15)
                    if resp.status_code >= 200 and resp.status_code < 300:
                        logger.info('promotions pushed to gist successfully')
                except Exception as e:
                    logger.warning('promotions push to gist failed: %s', e)
        except Exception:
            logger.exception('promotions push step failed')
        return True
    except Exception as e:
        logger.exception('write_promotions_snapshot failed: %s', e)
        return False


@app.get('/promotions')
def list_promotions():
    """Return persisted promotions snapshot if present, otherwise return empty list."""
    try:
        path = os.path.join(CATALOG_DIR, 'promotions.json')
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        logger.exception('list_promotions failed: %s', e)
    return []


@app.post('/promotions')
def save_promotions(promos: List[Dict[str, Any]]):
    """Persist promotions snapshot (admin may send the full array)."""
    try:
        logger.info('Received /promotions POST, count=%s', len(promos or []))
        ok = write_promotions_snapshot(promos)
        if not ok:
            raise HTTPException(status_code=500, detail='failed to write promotions')
        return { 'detail': 'ok', 'count': len(promos or []) }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('save_promotions error: %s', e)
        raise HTTPException(status_code=500, detail='save failed')

@app.get("/export")
def export(format: str = "json", db: Session = Depends(get_db)):
    products = crud.export_all(db)
    rows = [p.__dict__ for p in products]

    if format == "csv":
        si = StringIO()
        writer = csv.DictWriter(si, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
        return PlainTextResponse(si.getvalue(), media_type="text/csv")

    return rows


@app.post('/backup')
def trigger_backup(db: Session = Depends(get_db)):
    """Trigger writing the static snapshot and pushing to remote backup (if configured)."""
    try:
        write_catalog_snapshot()
        return {"detail": "snapshot written"}
    except Exception as e:
        logger.exception('backup failed')
        raise HTTPException(500, 'backup failed')


@app.get("/stats")
def stats(db: Session = Depends(get_db)):
    return crud.stats(db)


# -----------------------------
# Orders
# -----------------------------
@app.post('/orders', response_model=schemas.OrderResponse)
async def create_order(request: Request, payload: schemas.OrderCreate):
    # Deep logging of payload for debugging (may include PII)
    try:
        encoded = jsonable_encoder(payload)
    except Exception:
        encoded = { 'items': getattr(payload, 'items', None), 'total': getattr(payload, 'total', None) }

    logger.info('create_order called; payload=%s', encoded)

    # decode optional bearer token so the DB task can associate the order with the authenticated user
    auth = request.headers.get('authorization') or request.headers.get('Authorization')
    token_payload = None
    # Helpful debug: log whether the browser sent an Access-Control-Request-Headers header (preflight)
    try:
        acrh = request.headers.get('access-control-request-headers')
        if acrh:
            logger.debug('create_order: preflight requested headers: %s', acrh)
    except Exception:
        pass

    if auth and isinstance(auth, str) and auth.lower().startswith('bearer '):
        logger.info('create_order: Authorization header present')
        try:
            token = auth.split(' ', 1)[1]
            token_payload = utils.decode_access_token(token)
            logger.info('create_order: token_payload=%s', token_payload)
        except Exception as ex:
            logger.exception('create_order: failed to decode token: %s', ex)
            token_payload = None
    else:
        logger.info('create_order: no Authorization header present')

    # If a token payload was decoded, attach a safe preview to the request payload
    # so the CRUD layer can persist it into the orders table when columns exist.
    if token_payload:
        try:
            try:
                setattr(payload, '_token_received', True)
                setattr(payload, '_token_preview', {
                    'sub': token_payload.get('sub') or token_payload.get('email') or None,
                    'email': token_payload.get('email') or token_payload.get('sub') or None,
                    'name': token_payload.get('full_name') or token_payload.get('name') or None
                })
            except Exception:
                # Fallback: try direct attribute assignment
                payload._token_received = True
        except Exception:
            # Non-fatal: ignore if we cannot mutate the payload
            pass

    # Infer source from headers or payload: prefer explicit payload.source, then header 'X-Client-Platform' or 'X-Source'.
    # Si el payload no trae source, o viene vacío, se infiere SIEMPRE aquí y se fuerza el valor correcto.
    try:
        src = getattr(payload, 'source', None)
        if not src or not str(src).strip():
            src_hdr = request.headers.get('x-client-platform') or request.headers.get('x-source') or request.headers.get('x-client')
            if src_hdr:
                src = src_hdr
        if not src or not str(src).strip():
            ua = (request.headers.get('user-agent') or '').lower()
            # Detectar móvil por user-agent o headers
            if ua and ( 'okhttp' in ua or 'android' in ua or 'dalvik' in ua or 'retrofit' in ua or 'okhttp/' in ua ):
                src = 'app'
            # También considerar si el referer o origin contiene 'app' (por si hay proxy)
            ref = (request.headers.get('referer') or request.headers.get('origin') or '').lower()
            if 'app' in ref:
                src = 'app'
        # Si sigue sin source, default a web
        if not src or not str(src).strip():
            src = 'web'
        src = str(src).strip().lower()
        # Solo permitir 'app' o 'web'
        if src not in ('app', 'web'):
            src = 'web'
        # Forzar 'app' si user-agent es móvil aunque el cliente mande mal el campo
        ua = (request.headers.get('user-agent') or '').lower()
        if ua and ( 'okhttp' in ua or 'android' in ua or 'dalvik' in ua or 'retrofit' in ua or 'okhttp/' in ua ):
            src = 'app'
        try:
            setattr(payload, 'source', src)
        except Exception:
            try:
                payload.source = src
            except Exception:
                pass
        logger.info(f'[create_order] source inferido: {src}')
    except Exception as e:
        setattr(payload, 'source', 'web')
        logger.warning(f'[create_order] Error infiriendo source, se forzó a web: {e}')

    def task():
        db = SessionLocal()
        try:
            try:
                return crud.create_order(db, payload, current_user=token_payload)
            except Exception as inner_e:
                logger.exception('Error in create_order DB task: %s', inner_e)
                raise
        finally:
            db.close()

    try:
        order = await anyio.to_thread.run_sync(task)
        try:
            # Publish full order payload to WS so admin clients can insert it immediately
            payload = jsonable_encoder(order)
        except Exception:
            payload = {"id": getattr(order, 'id', None)}
        # Ensure 'source' is present on pushed payload when available (from DB row or request)
        try:
            if not payload.get('source'):
                # prefer DB value if available
                try:
                    payload['source'] = getattr(order, 'source', None)
                except Exception:
                    pass
            # fallback to original request-encoded value if still missing
            if not payload.get('source'):
                try:
                    payload['source'] = encoded.get('source') if isinstance(encoded, dict) else None
                except Exception:
                    pass
        except Exception:
            pass
        # Workaround: if the client provided a bearer token, supplement the
        # pushed payload with user info from the token so the admin sees the
        # user's email/name immediately even if the DB could not persist the
        # user_* columns yet (useful while migrations are pending).
        try:
            if token_payload:
                if not payload.get('user_full_name'):
                    payload['user_full_name'] = token_payload.get('full_name') or token_payload.get('name')
                if not payload.get('user_email'):
                    payload['user_email'] = token_payload.get('sub') or token_payload.get('email')
                if not payload.get('user_id'):
                    payload['user_id'] = token_payload.get('id') or token_payload.get('user_id')
                # Add a safe token preview to help diagnose missing token propagation without exposing secrets
                try:
                    payload['_token_received'] = True
                    payload['_token_preview'] = {
                        'sub': token_payload.get('sub') or token_payload.get('email') or None,
                        'email': token_payload.get('email') or token_payload.get('sub') or None,
                        'name': token_payload.get('full_name') or token_payload.get('name') or None
                    }
                except Exception:
                    payload['_token_received'] = True
                # Try to fetch richer profile from the users table (if present)
                try:
                    uid = payload.get('user_id') or (token_payload.get('id') if isinstance(token_payload, dict) else None)
                    from app import models as _models
                    if uid is not None:
                        db_for_user = SessionLocal()
                        try:
                            # ensure we use integer id when possible
                            try:
                                uid_int = int(uid)
                            except Exception:
                                uid_int = None
                            if uid_int is not None:
                                u = db_for_user.query(_models.User).filter(_models.User.id == uid_int).first()
                            else:
                                u = db_for_user.query(_models.User).filter(_models.User.email == (payload.get('user_email') or token_payload.get('sub') or token_payload.get('email'))).first()
                            if u:
                                payload['user_full_name'] = payload.get('user_full_name') or getattr(u, 'full_name', None)
                                payload['user_email'] = payload.get('user_email') or getattr(u, 'email', None)
                                payload['user_barrio'] = payload.get('user_barrio') or getattr(u, 'barrio', None)
                                payload['user_calle'] = payload.get('user_calle') or getattr(u, 'calle', None)
                                payload['user_numeracion'] = payload.get('user_numeracion') or getattr(u, 'numeracion', None)
                        finally:
                            try: db_for_user.close()
                            except Exception: pass
                except Exception:
                    # non-fatal: if user table doesn't exist or query fails, ignore
                    pass
        except Exception:
            pass
        try:
            logger.info('create_order succeeded; id=%s created_at=%s payload_summary=%s', getattr(order, 'id', None), getattr(order, 'created_at', None), { 'user': payload.get('user_email') or payload.get('user_full_name'), 'total': payload.get('total') })
        except Exception:
            pass
        # Ensure durability: persist a token preview / contact snapshot into
        # `order_token_previews` so contact info survives service restarts and
        # schema mismatches where orders.user_* columns are missing.
        try:
            # Use the original request payload (logged as `encoded`) as the source
            # of contact fields and token preview, not the `payload` variable which
            # was overwritten with the created order representation.
            try:
                tp_val = encoded.get('_token_preview') if isinstance(encoded, dict) else None
            except Exception:
                tp_val = None
            # If no explicit token preview, build one from available request payload fields
            if not tp_val:
                try:
                    tp_val = {}
                    if isinstance(encoded, dict) and encoded.get('user_full_name'):
                        tp_val['name'] = encoded.get('user_full_name')
                    if isinstance(encoded, dict) and encoded.get('user_email'):
                        tp_val['email'] = encoded.get('user_email')
                    if isinstance(encoded, dict) and encoded.get('user_barrio'):
                        tp_val['barrio'] = encoded.get('user_barrio')
                    if isinstance(encoded, dict) and encoded.get('user_calle'):
                        tp_val['calle'] = encoded.get('user_calle')
                    if isinstance(encoded, dict) and encoded.get('user_numeracion'):
                        tp_val['numeracion'] = encoded.get('user_numeracion')
                    if not tp_val:
                        tp_val = None
                except Exception:
                    tp_val = None
            # token preview constructed from the request is handled in CRUD layer
        except Exception:
            pass
        # Cache the pushed payload so list queries can show token-preview/user info even if DB lacks columns
        try:
            if payload and payload.get('id'):
                # Ensure cached payload always records the inferred `source` so admin can split Web/App correctly
                try:
                    if not payload.get('source'):
                        payload['source'] = src if 'src' in locals() else (getattr(order, 'source', None) or (encoded.get('source') if isinstance(encoded, dict) else None) or 'web')
                except Exception:
                    try:
                        payload['source'] = getattr(order, 'source', None) or (encoded.get('source') if isinstance(encoded, dict) else None) or 'web'
                    except Exception:
                        payload['source'] = 'web'
                ORDER_PAYLOAD_CACHE[str(payload.get('id'))] = {'payload': payload, 'ts': time.time()}
                try:
                    logger.debug('create_order: cached payload for id=%s (has_user=%s, has_token_preview=%s)', payload.get('id'), bool(payload.get('user_full_name') or payload.get('user_email')), bool(payload.get('_token_preview')))
                except Exception:
                    pass
                _prune_order_cache()
        except Exception:
            pass
        await push_event({"action": "order_created", "order": payload})
        # If order creation decremented stock, update snapshot and notify product watchers.
        try:
            # Product stock updates
            updated = getattr(order, '_updated_product_ids', None)
            if updated:
                try:
                    await anyio.to_thread.run_sync(write_catalog_snapshot)
                except Exception:
                    logger.exception('write_catalog_snapshot after order failed')
                try:
                    for pid in updated:
                        await push_event({"action": "updated", "product": {"id": pid}})
                except Exception:
                    logger.exception('push_event product updates after order failed')
            # Consumptions consumed: reduce quantities in consumos.json on disk
            consumed = getattr(order, '_consumos_consumed', None)
            if consumed:
                try:
                    def _apply_consumos(consumed_map):
                        try:
                            path = os.path.join(CATALOG_DIR, 'consumos.json')
                            cur = []
                            if os.path.exists(path):
                                try:
                                    with open(path, 'r', encoding='utf-8') as f:
                                        cur = json.load(f) or []
                                except Exception:
                                    cur = []
                            # Build map of existing entries
                            emap = { int(c.get('id')): c for c in cur }
                            changed = False
                            for pid_s, delta in consumed_map.items():
                                try:
                                    pid = int(pid_s)
                                except Exception:
                                    continue
                                if pid not in emap:
                                    continue
                                try:
                                    curqty = int(emap[pid].get('qty', 0) or 0)
                                except Exception:
                                    curqty = 0
                                newqty = max(0, curqty - int(delta or 0))
                                if newqty <= 0:
                                    del emap[pid]
                                    changed = True
                                else:
                                    emap[pid]['qty'] = newqty
                                    changed = True
                            if changed:
                                new_list = list(emap.values())
                                with open(path, 'w', encoding='utf-8') as f:
                                    json.dump(new_list, f, ensure_ascii=False, indent=2)
                                return new_list
                            return None
                        except Exception:
                            return None
                    new_consumos = await anyio.to_thread.run_sync(lambda: _apply_consumos(consumed))
                    if new_consumos is not None:
                        try:
                            await push_event({"action": "consumos-updated", "consumos": new_consumos})
                        except Exception:
                            logger.exception('push_event consumos-updated after order failed')
                        try:
                            await anyio.to_thread.run_sync(write_catalog_snapshot)
                        except Exception:
                            logger.exception('write_catalog_snapshot after consumos update failed')
                except Exception:
                    logger.exception('apply consumos after order failed')
        except Exception:
            logger.exception('post-order product update notifications failed')
        return order
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Unexpected error creating order (outer): %s', e)
        raise HTTPException(status_code=500, detail='Could not create order')


@app.post('/debug/orders')
async def debug_create_order(payload: schemas.OrderCreate):
    """Debug-only endpoint: attempt to create order and return full details for diagnosis."""
    try:
        encoded = jsonable_encoder(payload)
    except Exception:
        encoded = { 'items': getattr(payload, 'items', None), 'total': getattr(payload, 'total', None) }
    logger.info('debug_create_order called; payload=%s', encoded)

    def task():
        db = SessionLocal()
        try:
            return crud.create_order(db, payload, current_user=None)
        finally:
            db.close()

    order = await anyio.to_thread.run_sync(task)
    return order


@app.post('/debug/orders-diagnose')
async def debug_create_order_diagnose(request: Request):
    """Verbose diagnostic endpoint: attempts to create an order and returns
    either the created object or a detailed error trace (appends trace to
    Backend/server_log.txt for further inspection).
    """
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail='Invalid JSON body')

    # Try to coerce into OrderCreate schema for consistency with create flow
    try:
        order_schema = schemas.OrderCreate.parse_obj(data)
    except Exception:
        try:
            order_schema = schemas.OrderCreate(**data)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f'Invalid order payload: {e}')

    def task_payload(sch=order_schema):
        db = SessionLocal()
        try:
            return crud.create_order(db, sch, current_user=None)
        finally:
            try:
                db.close()
            except Exception:
                pass

    try:
        created = await anyio.to_thread.run_sync(task_payload)
        try:
            return JSONResponse(status_code=200, content=jsonable_encoder(created))
        except Exception:
            return JSONResponse(status_code=200, content={ 'id': getattr(created, 'id', None) })
    except Exception as e:
        import traceback, datetime, os as _os
        tb = traceback.format_exc()
        logger.exception('debug/orders-diagnose failed: %s', e)
        # Append trace to Backend/server_log.txt next to the repository Backend folder
        try:
            base = _os.path.dirname(_os.path.dirname(__file__))
            logpath = _os.path.join(base, 'server_log.txt')
            with open(logpath, 'a', encoding='utf-8') as f:
                f.write(f"{datetime.datetime.utcnow().isoformat()} - DEBUG_CREATE_ORDER_ERROR - {str(e)}\n")
                f.write(tb + "\n\n")
        except Exception:
            pass
        # Return limited trace in response to help local debugging (trim to 1000 chars)
        safe_tb = tb[:1000]
        raise HTTPException(status_code=500, detail={ 'error': str(e), 'trace': safe_tb })


@app.get('/debug/db-info')
def debug_db_info(request: Request):
    """Return basic DB diagnostic info: dialect, masked DATABASE_URL and orders columns."""
    try:
        db_env = os.environ.get('DATABASE_URL')
        masked = 'sqlite (local file)'
        if db_env:
            try:
                from urllib.parse import urlparse
                u = urlparse(db_env)
                user = u.username or ''
                host = u.hostname or ''
                port = u.port or ''
                path = u.path or ''
                masked = f"{u.scheme}://{user + ':****@' if user else ''}{host}{(':'+str(port)) if port else ''}{path}"
            except Exception:
                masked = 'postgres (masked)'
    except Exception:
        masked = 'unknown'

    try:
        insp = inspect(engine)
        cols = {c['name'] for c in insp.get_columns('orders')}
    except Exception:
        cols = set()

    try:
        dialect = getattr(engine, 'dialect', None)
        dialect_name = getattr(dialect, 'name', '') if dialect else ''
    except Exception:
        dialect_name = ''

    headers = _cors_headers_for_request(request)
    return JSONResponse(status_code=200, content={'database_url': masked, 'dialect': dialect_name, 'orders_columns': sorted(list(cols))}, headers=headers)


@app.get('/debug/db-test')
def debug_db_test(request: Request):
    """Perform a small set of DB connectivity checks and return results.
    Useful to diagnose connection/auth issues on PaaS (Render).
    """
    out = {'ok': False, 'checks': []}
    headers = _cors_headers_for_request(request)
    try:
        # Try basic connect
        try:
            conn = engine.connect()
            try:
                out['checks'].append({'connect': True})
            finally:
                conn.close()
        except Exception as e:
            out['checks'].append({'connect': False, 'error': str(e)})
            # append to server log
            try:
                import traceback, datetime, os as _os
                base = _os.path.dirname(_os.path.dirname(__file__))
                logpath = _os.path.join(base, 'server_log.txt')
                with open(logpath, 'a', encoding='utf-8') as f:
                    f.write(f"{datetime.datetime.utcnow().isoformat()} - DB_CONNECT_FAILED - {str(e)}\n")
                    f.write(traceback.format_exc() + "\n\n")
            except Exception:
                pass
            return JSONResponse(status_code=500, content=out, headers=headers)

        # Try select 1
        try:
            conn2 = engine.connect()
            try:
                try:
                    r = conn2.execute(text('SELECT 1')).fetchone()
                    out['checks'].append({'select_1': True, 'result': list(r) if r is not None else None})
                except Exception as e:
                    try:
                        _invalidate_conn(conn2)
                    except Exception:
                        pass
                    out['checks'].append({'select_1': False, 'error': str(e)})
            finally:
                conn2.close()
        except Exception as e:
            out['checks'].append({'select_1': False, 'error': str(e)})

        # Inspect orders table existence
        try:
            insp = inspect(engine)
            cols = {c['name'] for c in insp.get_columns('orders')} if insp and insp.get_columns('orders') is not None else set()
            out['checks'].append({'orders_table_columns_count': len(cols), 'orders_columns_sample': list(cols)[:10]})
        except Exception as e:
            out['checks'].append({'orders_table': False, 'error': str(e)})

        out['ok'] = True
        return JSONResponse(status_code=200, content=out, headers=headers)
    except Exception as e:
        out['checks'].append({'error': str(e)})
        return JSONResponse(status_code=500, content=out, headers=headers)


@app.get('/debug/token-previews')
def debug_token_previews():
    """Return recent rows from `order_token_previews` for debugging/verification."""
    try:
        rows = _safe_engine_fetchall('SELECT order_id, token_preview, token_received, created_at FROM order_token_previews ORDER BY created_at DESC LIMIT 50') or []
    except Exception:
        return []
    out = []
    import json as _json
    for r in rows:
        try:
            tp_raw = r[1]
            try:
                tp = _json.loads(tp_raw) if isinstance(tp_raw, str) else tp_raw
            except Exception:
                tp = tp_raw
        except Exception:
            tp = None
        out.append({'order_id': r[0], 'token_preview': tp, 'token_received': bool(r[2]), 'created_at': str(r[3])})
    return out


@app.get('/debug/server-log')
async def debug_server_log(request: Request):
    """Return last 200 lines of server_log.txt (requires MIGRATION_SECRET header)."""
    secret = os.environ.get('MIGRATION_SECRET')
    provided = request.headers.get('x-migrate-secret')
    if secret and provided != secret:
        return JSONResponse(status_code=403, content={'error': 'forbidden'})
    try:
        path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'server_log.txt')
        if not os.path.exists(path):
            return JSONResponse(status_code=200, content={'lines': []})
        with open(path, 'r', encoding='utf-8') as f:
            lines = f.read().splitlines()
        return JSONResponse(status_code=200, content={'lines': lines[-200:]})
    except Exception as e:
        logger.exception('debug_server_log failed: %s', e)
        return JSONResponse(status_code=500, content={'error': str(e)})


@app.post('/backup-orders')
async def backup_orders(request: Request):
    """Accept one or many order payloads and persist them to the DB so they are
    durable and visible to the admin panel. This endpoint is intentionally
    permissive (no auth) to allow offline/failed clients to sync back their local
    queue when connectivity is restored. Use with care in public deployments.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail='Invalid JSON body')
    items = body if isinstance(body, list) else [body]
    results = []
    for it in items:
        try:
            # Normalize into OrderCreate schema
            try:
                order_schema = schemas.OrderCreate.parse_obj(it)
            except Exception:
                # Try simple coercion for common shapes
                order_schema = schemas.OrderCreate(**it)
            def task_payload(sch=order_schema):
                db = SessionLocal()
                try:
                    return crud.create_order(db, sch, current_user=None)
                finally:
                    db.close()
            created = await anyio.to_thread.run_sync(task_payload)
            results.append({'ok': True, 'id': getattr(created, 'id', None)})
        except Exception as e:
            logger.exception('backup_orders: failed to persist order: %s', e)
            results.append({'ok': False, 'error': str(e)})
    return {'saved': len([r for r in results if r.get('ok')]), 'results': results}


@app.get('/orders', response_model=List[schemas.OrderResponse])
def list_orders(skip: int = 0, limit: int = 200, source: Optional[str] = None, db: Session = Depends(get_db)):
    # Fetch recent orders (safe select in CRUD). Then merge any cached pushed payloads
    # (which may contain token preview) to surface user info when DB lacks columns.
    rows = crud.get_orders(db, skip, limit, source=source)
    try:
        _prune_order_cache()
    except Exception:
        pass
    out = []
    # Load status overrides (best-effort) so admin can show "visto" even if DB column is missing.
    status_overrides = {}
    try:
        status_overrides = crud.get_setting(db, 'order_status_overrides') or {}
    except Exception:
        status_overrides = {}
    try:
        _prune_status_cache()
    except Exception:
        pass
    cached_any = 0
    for r in (rows or []):
        try:
            # r may be a dict (raw select) or an object (ORM fallback). Normalize to dict
            od = r if isinstance(r, dict) else { k: getattr(r, k, None) for k in ['id','items','total','status','user_id','user_full_name','user_email','user_barrio','user_calle','user_numeracion','created_at','_token_received','_token_preview'] }
            cached_used = False
            # If user fields missing try to merge from cached pushed payload
            if (not od.get('user_full_name') and not od.get('user_email')) and od.get('id'):
                try:
                    cached = ORDER_PAYLOAD_CACHE.get(str(od.get('id')))
                    if cached and cached.get('payload'):
                        p = cached.get('payload')
                        cached_used = True
                        cached_any += 1
                        # prefer explicit user_* fields from cached payload
                        for f in ('user_full_name','user_email','user_barrio','user_calle','user_numeracion','user_id'):
                            if not od.get(f) and p.get(f):
                                od[f] = p.get(f)
                        # fallback to token preview when available
                        tp = p.get('_token_preview') or {}
                        if not od.get('user_full_name') and tp.get('name'):
                            od['user_full_name'] = tp.get('name')
                        if not od.get('user_email') and tp.get('email'):
                            od['user_email'] = tp.get('email')
                        # include the token preview in the returned row so clients can show it explicitly
                        if tp:
                            od['_token_preview'] = tp
                            od['_token_received'] = True
                        # include the token preview in the returned row so clients can show it explicitly
                        if tp:
                            od['_token_preview'] = tp
                            od['_token_received'] = True
                except Exception:
                    pass

                # If still missing user info try to read persisted token previews table
                # (durable across restarts) and merge into the row.
                if (not od.get('user_full_name') and not od.get('user_email')) and od.get('id'):
                    try:
                        # order_id stored as text in order_token_previews to support debug ids
                        row = _safe_engine_fetchone('SELECT token_preview, token_received FROM order_token_previews WHERE order_id = :id ORDER BY created_at DESC LIMIT 1', {'id': str(od.get('id'))})
                        if row:
                            try:
                                tp_raw = row[0]
                                tr_flag = row[1]
                                if tp_raw:
                                    try:
                                        tp = json.loads(tp_raw) if isinstance(tp_raw, str) else tp_raw
                                    except Exception:
                                        tp = {}
                                    if not od.get('user_full_name') and tp.get('name'):
                                        od['user_full_name'] = tp.get('name')
                                    if not od.get('user_email') and tp.get('email'):
                                        od['user_email'] = tp.get('email')
                                    od['_token_preview'] = tp
                                    od['_token_received'] = bool(tr_flag)
                                    cached_used = True
                                    cached_any += 1
                            except Exception:
                                pass
                    except Exception:
                        pass
            # Apply status override if present
            try:
                oid = od.get('id')
                if oid is not None:
                    ov = None
                    try:
                        ov = (status_overrides or {}).get(str(oid))
                    except Exception:
                        ov = None
                    if ov is None:
                        ov = (ORDER_STATUS_CACHE.get(str(oid)) or {}).get('status')
                    if ov:
                        od['status'] = ov
            except Exception:
                pass
            # log per-row diagnostics for debugging clarity
            try:
                logger.debug('list_orders row id=%s user_full_name=%s user_email=%s cached_used=%s', od.get('id'), od.get('user_full_name'), od.get('user_email'), cached_used)
            except Exception:
                pass
            out.append(od)
        except Exception:
            out.append(r)
    try:
        logger.info('list_orders returning %d rows (sample ids %s)', len(out), [str(x.get('id')) for x in (out or [])][:10])
        if cached_any:
            logger.info('list_orders merged cached payloads for %d rows', cached_any)
    except Exception:
        pass
    return out


@app.patch('/orders/{order_id}/status')
async def update_order_status(order_id: str, request: Request):
    """Update the `status` field for an order and broadcast the change via WS.
    Accepts numeric or non-numeric IDs (debug events may use string IDs)."""
    def _ensure_status_column():
        try:
            insp_local = inspect(engine)
            existing_local = {c['name'] for c in insp_local.get_columns('orders')}
        except Exception:
            existing_local = set()
        if 'status' in existing_local:
            return True, existing_local
        try:
            dialect_local = getattr(engine, 'dialect', None)
            dialect_name_local = getattr(dialect_local, 'name', '') if dialect_local else ''
            with engine.begin() as conn_local:
                if 'postgres' in dialect_name_local:
                    try:
                        conn_local.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'nuevo'"))
                    except Exception:
                        conn_local.execute(text("ALTER TABLE orders ADD COLUMN status VARCHAR(50) DEFAULT 'nuevo'"))
                else:
                    conn_local.execute(text("ALTER TABLE orders ADD COLUMN status VARCHAR(50) DEFAULT 'nuevo'"))
            try:
                insp_local = inspect(engine)
                existing_local = {c['name'] for c in insp_local.get_columns('orders')}
            except Exception:
                existing_local.add('status')
            return True, existing_local
        except Exception as e_local:
            logger.exception('ensure status column failed: %s', e_local)
            return False, existing_local

    def _persist_status_override(order_id_value, status_value):
        try:
            db_local = SessionLocal()
            try:
                overrides = crud.get_setting(db_local, 'order_status_overrides') or {}
                overrides[str(order_id_value)] = status_value
                crud.set_setting(db_local, 'order_status_overrides', overrides)
            finally:
                try:
                    db_local.close()
                except Exception:
                    pass
            return True
        except Exception:
            # fall back to in-memory cache
            try:
                ORDER_STATUS_CACHE[str(order_id_value)] = { 'status': status_value, 'ts': time.time() }
                return True
            except Exception:
                return False

    try:
        body = await request.json()
    except Exception:
        body = {}
    status = body.get('status')
    if not status:
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=400, content={'error': 'missing_status'}, headers=headers)

    # Decide whether we should treat order_id as int or text for SQL WHERE
    use_id_int = False
    id_param = order_id
    try:
        id_int = int(order_id)
        use_id_int = True
        id_param = id_int
    except Exception:
        use_id_int = False
        id_param = str(order_id)

    # Best-effort: ensure status column exists before updating
    ok_status_col, existing_cols = _ensure_status_column()
    db_update_ok = False
    try:
        # Use a transactional context so the UPDATE is committed immediately
        try:
            with engine.begin() as conn:
                if use_id_int:
                    conn.execute(text('UPDATE orders SET status = :status WHERE id = :id'), {'status': status, 'id': id_param})
                else:
                    # Fall back to text comparison; CAST to TEXT works on SQLite/Postgres
                    conn.execute(text('UPDATE orders SET status = :status WHERE CAST(id AS TEXT) = :id'), {'status': status, 'id': id_param})
            db_update_ok = True
        except Exception as inner_e:
            # If status column was missing, attempt to add and retry once.
            msg = str(inner_e).lower()
            if (('status' in msg) and ('does not exist' in msg or 'no such column' in msg)):
                ok_status_col, existing_cols = _ensure_status_column()
                if ok_status_col:
                    try:
                        with engine.begin() as conn2:
                            if use_id_int:
                                conn2.execute(text('UPDATE orders SET status = :status WHERE id = :id'), {'status': status, 'id': id_param})
                            else:
                                conn2.execute(text('UPDATE orders SET status = :status WHERE CAST(id AS TEXT) = :id'), {'status': status, 'id': id_param})
                        db_update_ok = True
                    except Exception as inner_e2:
                        logger.exception('update_order_status retry failed: %s', inner_e2)
                        headers = _cors_headers_for_request(request)
                        # fall through to override persistence below
                        db_update_ok = False
                else:
                    logger.exception('update_order_status DB execute failed: %s', inner_e)
                    headers = _cors_headers_for_request(request)
                    db_update_ok = False
            else:
                logger.exception('update_order_status DB execute failed: %s', inner_e)
                headers = _cors_headers_for_request(request)
                db_update_ok = False
    except Exception as e:
        logger.exception('update_order_status failed: %s', e)
        headers = _cors_headers_for_request(request)
        db_update_ok = False

    # Always persist an override so the admin UI can reflect the change even if DB update failed.
    override_ok = _persist_status_override(order_id, status)

    # Fetch updated row safely (only request existing columns)
    try:
        insp = inspect(engine)
        existing = {c['name'] for c in insp.get_columns('orders')}
    except Exception:
        existing = set()

    cols = ['id','items','total','created_at']
    if 'status' in existing:
        cols.insert(3, 'status')
    optional = ['user_id','user_full_name','user_email','user_barrio','user_calle','user_numeracion','_token_received','_token_preview']
    for c in optional:
        if c in existing:
            cols.append(c)

    cols_sql = ', '.join(cols)
    try:
        if use_id_int:
            row = _safe_engine_fetchone(f"SELECT {cols_sql} FROM orders WHERE id = :id LIMIT 1", {'id': id_param})
        else:
            row = _safe_engine_fetchone(f"SELECT {cols_sql} FROM orders WHERE CAST(id AS TEXT) = :id LIMIT 1", {'id': id_param})
        if row is None:
            # treat as not found or as a DB failure depending on caller
            pass
    except Exception as e:
        logger.exception('fetch updated order failed: %s', e)
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=500, content={'error': str(e)}, headers=headers)

    if not row:
        # If update failed but we could persist override, return a minimal response.
        if override_ok:
            headers = _cors_headers_for_request(request)
            return JSONResponse(status_code=200, content={'id': id_param, 'status': status, 'status_fallback': True}, headers=headers)
        headers = _cors_headers_for_request(request)
        return JSONResponse(status_code=404, content={'error': 'not_found'}, headers=headers)

    od = {k: row[idx] for idx, k in enumerate(cols)}
    if 'status' not in od:
        od['status'] = status
    # parse items and token_preview if present
    try:
        if isinstance(od.get('items'), str):
            import json as _json
            od['items'] = _json.loads(od['items'])
    except Exception:
        od['items'] = []
    try:
        if isinstance(od.get('_token_preview'), str):
            import json as _json
            try:
                od['_token_preview'] = _json.loads(od['_token_preview'])
            except Exception:
                pass
    except Exception:
        pass

    # Broadcast the updated order to connected admin clients
    try:
        await push_event({"action": "order_updated", "order": od})
    except Exception:
        pass

    # Ensure status is present in response
    try:
        od['status'] = od.get('status') or status
        if override_ok and not db_update_ok:
            od['status_fallback'] = True
    except Exception:
        pass

    headers = _cors_headers_for_request(request)
    return JSONResponse(status_code=200, content=od, headers=headers)

