from fastapi import (
    FastAPI, Depends, HTTPException, UploadFile, File,
    WebSocket, WebSocketDisconnect, Request
)
from fastapi.responses import Response
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from typing import List, Optional
from typing import Any, Dict
import os
import asyncio
import logging
import csv
import json
from io import StringIO
import anyio
from sqlalchemy.orm import Session as OrmSession

from app import models, schemas, crud, utils
from app.database import engine, get_db, SessionLocal


# -------------------------------------------------------------------
# LOGGING
# -------------------------------------------------------------------
logger = logging.getLogger("catalog_api")
if not logger.handlers:
    h = logging.StreamHandler()
    h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(h)
logger.setLevel(logging.INFO)

# -------------------------------------------------------------------
# APP
# -------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
    db = SessionLocal()
    try:
        if db.query(models.Product).count() == 0:
            sample = [
                models.Product(name="Camiseta", price=19.99, description="Camiseta", category="Ropa"),
                models.Product(name="Taza", price=8.5, description="Taza", category="Accesorios"),
            ]
            db.add_all(sample)
            db.commit()
    except Exception:
        pass
    finally:
        db.close()
    yield
    # shutdown steps (none for now)

app = FastAPI(title="Catálogo API", lifespan=lifespan)

# Initialize Sentry if available in environment. Import is optional to allow
# running in test/dev environments without the package installed.
try:
    sentry_dsn = os.environ.get('SENTRY_DSN')
    if sentry_dsn:
        try:
            import sentry_sdk
            from sentry_sdk.integrations.asgi import SentryAsgiMiddleware
            sentry_sdk.init(dsn=sentry_dsn, traces_sample_rate=0.0)
            app.add_middleware(SentryAsgiMiddleware)
            logger.info('Sentry initialized')
        except ImportError:
            logger.warning('sentry-sdk package not installed, skipping Sentry initialization')
        except Exception:
            logger.exception('Failed to initialize Sentry integration')
except Exception:
    logger.exception('Failed reading SENTRY_DSN')


@app.middleware("http")
async def log_requests(request, call_next):
    logger.info(f"Incoming request: {request.method} {request.url}")
    response = await call_next(request)
    logger.info(f"Response: {response.status_code} for {request.method} {request.url}")
    return response


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    try:
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer-when-downgrade'
        response.headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload'
        response.headers['Permissions-Policy'] = 'interest-cohort=()'
        # Basic CSP: allow self and common external assets; tune for your deployment
        response.headers['Content-Security-Policy'] = "default-src 'self' data: https:; img-src 'self' data: https:; connect-src 'self' ws: https:; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com;"
    except Exception:
        pass
    return response

# Lista global de WebSockets
connections: List[WebSocket] = []

# -------------------------------------------------------------------
# LOGGING
# -------------------------------------------------------------------
logger = logging.getLogger("catalog_api")
if not logger.handlers:
    h = logging.StreamHandler()
    h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(h)
logger.setLevel(logging.INFO)

# -------------------------------------------------------------------
# CORS
# -------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------------------------------------------
# PATHS
# -------------------------------------------------------------------
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
UPLOAD_DIR = os.path.join(ROOT_DIR, "uploads")
FRONTEND_DIR = os.path.join(ROOT_DIR, "admin")
CATALOG_DIR = os.path.join(ROOT_DIR, "catalogo")

utils.ensure_upload_folder(UPLOAD_DIR)

# -------------------------------------------------------------------
# STATIC FILES
# -------------------------------------------------------------------
if os.path.exists(FRONTEND_DIR):
    app.mount('/admin', StaticFiles(directory=FRONTEND_DIR), name='admin')

    @app.get("/")
    def read_admin_root():
        return RedirectResponse("/admin/index.html")

app.mount('/uploads', StaticFiles(directory=UPLOAD_DIR), name='uploads')

if os.path.exists(CATALOG_DIR):
    app.mount('/catalogo', StaticFiles(directory=CATALOG_DIR), name='catalogo')

# -------------------------------------------------------------------
# CREATE TABLES
# -------------------------------------------------------------------
try:
    models.Base.metadata.create_all(bind=engine)
except Exception as e:
    logger.error(f"Error creating tables: {e}")

# -------------------------------------------------------------------
# BROADCAST FUNC
# -------------------------------------------------------------------
async def push_event(data: dict):
    """Enviar evento JSON a todos los clientes WebSocket de forma concurrente y sin bloquear.
    Remove closed connections."""
    logger.debug(f"push_event called with data={data}, connections={len(connections)}")
    # Build tasks for all sends so we don't stall on one slow socket.
    tasks = []
    for ws in list(connections):
        try:
            tasks.append(asyncio.create_task(ws.send_json(data)))
        except Exception:
            if ws in connections:
                connections.remove(ws)
    if not tasks:
        logger.debug("No connected websockets. Nothing to broadcast.")
        return
    results = await asyncio.gather(*tasks, return_exceptions=True)
    # Clean up connections that errored
    for ws, res in zip(list(connections), results):
            if isinstance(res, Exception):
                try:
                    connections.remove(ws)
                except ValueError:
                    pass
    logger.debug(f"Broadcast sent to {len(results)} sockets; remaining connections: {len(connections)}")

# -------------------------------------------------------------------
# WEBSOCKET ENDPOINT
# -------------------------------------------------------------------
@app.websocket("/ws/products")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connections.append(ws)

    try:
        while True:
            # Mantener conexión abierta sin bloquear tests
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass
    finally:
        if ws in connections:
            connections.remove(ws)

# -------------------------------------------------------------------
# Lifespan handles startup seed above
# -------------------------------------------------------------------

# -------------------------------------------------------------------
# ENDPOINTS
# -------------------------------------------------------------------

@app.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):
    saved_path = await utils.save_upload_file(file, UPLOAD_DIR)
    filename = os.path.basename(saved_path)
    return {"image_url": f"/uploads/{filename}", "filename": filename}


@app.post("/products", response_model=schemas.ProductResponse)
async def create_product(payload: schemas.ProductCreate, db=Depends(get_db)):
    # Execute DB call inside a thread and create a new session inside the thread to avoid cross-thread session use
    def _create():
        s = SessionLocal()
        try:
            return crud.create_product(s, payload)
        finally:
            s.close()
    prod = await anyio.to_thread.run_sync(_create)
    payload_out = {
        "id": prod.id,
        "name": prod.name,
        "price": float(prod.price) if prod.price is not None else None,
        "description": prod.description,
        "category": prod.category,
        "image_url": prod.image_url,
        "active": prod.active,
    }
    # schedule broadcast in the event loop without waiting
    try:
        await push_event({"action": "created", "product": payload_out})
    except Exception:
        logger.exception("Failed running push_event (create)")
    else:
        logger.info(f"Broadcast scheduled for create product {payload_out['id']}")
    # update local static snapshot (non-blocking)
    try:
        await anyio.to_thread.run_sync(write_catalog_snapshot)
    except Exception:
        logger.exception("Failed writing catalog snapshot (create)")
    return prod


def write_catalog_snapshot():
    """Escribe un archivo JSON en el directorio del frontend del catálogo para que el
    catálogo estático pueda leerlo (por ejemplo, desde file://)."""
    try:
        # Obtener todos los productos desde la base
        db = SessionLocal()
        products = crud.export_all(db)
        db.close()
        rows = [
            {
                "id": p.id,
                "name": p.name,
                "price": float(p.price) if p.price is not None else None,
                "description": p.description,
                "category": p.category,
                "image_url": p.image_url,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
                "active": p.active,
            }
            for p in products
        ]
        if not os.path.exists(CATALOG_DIR):
            logger.debug(f"Catalog dir does not exist: {CATALOG_DIR}. Skipping snapshot write.")
            return
        out_path = os.path.join(CATALOG_DIR, "products.json")
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, ensure_ascii=False, indent=2)
        logger.info(f"Wrote catalog snapshot to {out_path}")
    except Exception:
        logger.exception("Failed to write catalog snapshot")


def write_promotions_snapshot(promos: List[Dict[str, Any]]):
    """Escribe un archivo promotions.json en el directorio del frontend del catálogo
    para que el catálogo estático pueda leer promociones (por ejemplo, desde file://).
    """
    try:
        if not os.path.exists(CATALOG_DIR):
            logger.debug(f"Catalog dir does not exist: {CATALOG_DIR}. Skipping promotions write.")
            return
        out_path = os.path.join(CATALOG_DIR, "promotions.json")
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(promos, fh, ensure_ascii=False, indent=2)
        logger.info(f"Wrote promotions snapshot to {out_path}")
    except Exception:
        logger.exception("Failed to write promotions snapshot")


@app.get("/products/{product_id}", response_model=schemas.ProductResponse)
def get_product(product_id: int, db: OrmSession = Depends(get_db)):
    prod = crud.get_product(db, product_id)
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")
    return prod


@app.get("/products", response_model=List[schemas.ProductResponse])
def list_products(skip: int = 0, limit: int = 100, q: Optional[str] = None, category: Optional[str] = None, active: Optional[bool] = None, sort: Optional[str] = None, db: OrmSession = Depends(get_db)):
    prods = crud.get_products(db, skip=skip, limit=limit, q=q, category=category, active=active, sort=sort)
    return prods


@app.get("/promotions")
def list_promotions():
    try:
        path = os.path.join(CATALOG_DIR, "promotions.json")
        if not os.path.exists(path):
            return []
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data
    except Exception:
        logger.exception("Failed reading promotions.json")
        return []


@app.post("/promotions")
async def save_promotions(payload: List[Dict[str, Any]]):
    try:
        # Persist to disk (front-end snapshot)
        await anyio.to_thread.run_sync(write_promotions_snapshot, payload)
        return {"ok": True}
    except Exception:
        logger.exception("Failed saving promotions")
        raise HTTPException(status_code=500, detail="Failed saving promotions")


@app.put("/products/{product_id}", response_model=schemas.ProductResponse)
async def update_product(product_id: int, payload: schemas.ProductUpdate, db=Depends(get_db)):
    def _update():
        s = SessionLocal()
        try:
            return crud.update_product(s, product_id, payload)
        finally:
            s.close()
    prod = await anyio.to_thread.run_sync(_update)
    payload_out = {
        "id": prod.id,
        "name": prod.name,
        "price": float(prod.price) if prod.price is not None else None,
        "description": prod.description,
        "category": prod.category,
        "image_url": prod.image_url,
        "active": prod.active,
    }
    try:
        await push_event({"action": "updated", "product": payload_out})
    except Exception:
        logger.exception("Failed running push_event (update)")
    else:
        logger.info(f"Broadcast scheduled for update product {payload_out['id']}")
    # update snapshot
    try:
        await anyio.to_thread.run_sync(write_catalog_snapshot)
    except Exception:
        logger.exception("Failed writing catalog snapshot (update)")
    return prod


@app.delete("/products/{product_id}")
async def delete_product(product_id: int, db=Depends(get_db)):
    def _del():
        s = SessionLocal()
        try:
            return crud.delete_product(s, product_id)
        finally:
            s.close()
    await anyio.to_thread.run_sync(_del)
    try:
        await push_event({"action": "deleted", "product": {"id": product_id}})
    except Exception:
        logger.exception("Failed running push_event (delete)")
    else:
        logger.info(f"Broadcast scheduled for delete product {product_id}")
    # update snapshot
    try:
        await anyio.to_thread.run_sync(write_catalog_snapshot)
    except Exception:
        logger.exception("Failed writing catalog snapshot (delete)")
    return {"detail": "deleted"}


@app.get("/export")
def export(format: str = "json", db=Depends(get_db)):
    products = crud.export_all(db)

    rows = [
        {
            "id": p.id,
            "name": p.name,
            "price": p.price,
            "description": p.description,
            "category": p.category,
            "image_url": p.image_url,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            "active": p.active
        }
        for p in products
    ]

    if format == "csv":
        si = StringIO()
        writer = csv.DictWriter(si, fieldnames=list(rows[0].keys()) if rows else [])
        writer.writeheader()
        writer.writerows(rows)
        return PlainTextResponse(si.getvalue(), media_type="text/csv")

    return rows


@app.get("/stats")
def get_stats(db=Depends(get_db)):
    return crud.stats(db)

