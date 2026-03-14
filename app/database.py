from pathlib import Path
import os

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

# app/
BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent


def _is_running_on_render() -> bool:
    return bool(
        os.environ.get('RENDER')
        or os.environ.get('RENDER_SERVICE_ID')
        or os.environ.get('RENDER_EXTERNAL_HOSTNAME')
    )


def _is_truthy(value: str | None) -> bool:
    try:
        return str(value or '').strip().lower() in {'1', 'true', 'yes', 'y', 'on'}
    except Exception:
        return False


def _should_run_import_migrations() -> bool:
    """Control best-effort migrations that run at import time.

    - Skip by default on Render to avoid blocking port bind.
    - Allow explicit opt-in via RUN_DB_MIGRATIONS_AT_IMPORT=1.
    - Allow explicit opt-out via SKIP_DB_MIGRATIONS=1.
    """
    if _is_truthy(os.environ.get('SKIP_DB_MIGRATIONS')):
        return False
    if _is_truthy(os.environ.get('RUN_DB_MIGRATIONS_AT_IMPORT')):
        return True
    return not _is_running_on_render()


def _resolve_data_dir() -> Path:
    """Resolve a writable data directory, preferring persistent Render disk paths."""
    candidates = []

    # Explicit app overrides first.
    for key in ('DATA_DIR', 'PERSISTENT_DATA_DIR'):
        val = str(os.environ.get(key) or '').strip()
        if val:
            candidates.append(Path(val))

    # Common Render disk env vars (if configured).
    for key in ('RENDER_DISK_MOUNT_PATH', 'RENDER_DISK_PATH', 'RENDER_PERSISTENT_DISK_PATH'):
        val = str(os.environ.get(key) or '').strip()
        if val:
            candidates.append(Path(val))

    # Render default mount path.
    if _is_running_on_render():
        candidates.append(Path('/var/data'))

    # Local fallback inside repo.
    candidates.append(ROOT_DIR / 'data')

    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            probe = candidate / '.rw_probe'
            with open(probe, 'w', encoding='utf-8') as f:
                f.write('ok')
            try:
                probe.unlink()
            except Exception:
                pass
            return candidate
        except Exception:
            continue

    # Last-resort fallback.
    fallback = ROOT_DIR / 'data'
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


DATA_DIR = _resolve_data_dir()

db_path_env = str(os.environ.get('DB_PATH') or '').strip()
if db_path_env:
    db_path = Path(db_path_env)
    DB_PATH = db_path if db_path.is_absolute() else (DATA_DIR / db_path)
else:
    DB_PATH = DATA_DIR / 'database.db'

# Allow overriding the DB with a managed DATABASE_URL (Postgres, etc.) via env var.
# Use `str(DB_PATH)` to ensure a proper path string is embedded in the sqlite URL.
SQLALCHEMY_DATABASE_URL = os.environ.get('DATABASE_URL') or f"sqlite:///{str(DB_PATH)}"

# For sqlite we need the special connect arg; for other DBs (e.g. postgres) tune pool defaults.
if SQLALCHEMY_DATABASE_URL.startswith('sqlite'):
    engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={'check_same_thread': False})
else:
    pool_size = int(os.environ.get('DB_POOL_SIZE') or 15)
    max_overflow = int(os.environ.get('DB_MAX_OVERFLOW') or 30)
    pool_timeout = int(os.environ.get('DB_POOL_TIMEOUT') or 60)
    pool_recycle = int(os.environ.get('DB_POOL_RECYCLE') or 1800)
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_timeout=pool_timeout,
        pool_recycle=pool_recycle,
        pool_pre_ping=True,
    )


SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def _migrate_orders_optional_columns() -> None:
    """Best-effort migration for legacy `orders` schemas.

    Runs at import time so ad-hoc scripts (that do not boot FastAPI lifespan)
    can still operate with payment/source/user columns present.
    """
    try:
        insp = inspect(engine)
        if 'orders' not in insp.get_table_names():
            return
        existing = {c['name'] for c in insp.get_columns('orders')}
    except Exception:
        return

    try:
        dialect = engine.dialect.name if engine and getattr(engine, 'dialect', None) else ''
    except Exception:
        dialect = ''

    needed = [
        # Order lifecycle: recibido -> visto -> preparado -> enviado -> entregado
        ('status', "VARCHAR(50) DEFAULT 'recibido'"),
        ('customer_type', "VARCHAR(50) DEFAULT 'mayorista'"),
        ('user_id', 'INTEGER'),
        ('user_full_name', 'VARCHAR(200)'),
        ('user_email', 'VARCHAR(320)'),
        ('user_barrio', 'VARCHAR(200)'),
        ('user_calle', 'VARCHAR(200)'),
        ('user_numeracion', 'VARCHAR(100)'),
        ('user_postal_code', 'VARCHAR(20)'),
        ('user_department', 'VARCHAR(120)'),
        ('_token_received', 'BOOLEAN'),
        ('_token_preview', 'TEXT'),
        ('source', "VARCHAR(50) DEFAULT 'web'"),
        ('payment_method', 'VARCHAR(50)'),
        ('payment_status', 'VARCHAR(50)'),
        ('payment_reference', 'VARCHAR(200)'),
    ]

    with engine.begin() as conn:
        for name, coltype in needed:
            if name in existing:
                continue
            try:
                if 'postgres' in dialect:
                    conn.execute(text(f"ALTER TABLE orders ADD COLUMN IF NOT EXISTS {name} {coltype};"))
                else:
                    conn.execute(text(f"ALTER TABLE orders ADD COLUMN {name} {coltype};"))
            except Exception:
                pass

        try:
            conn.execute(text('CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source);'))
        except Exception:
            pass
        try:
            conn.execute(text('CREATE INDEX IF NOT EXISTS idx_orders_customer_type ON orders(customer_type);'))
        except Exception:
            pass

        try:
            conn.execute(text("UPDATE orders SET source = 'web' WHERE source IS NULL OR TRIM(source) = '';"))
        except Exception:
            pass
        try:
            conn.execute(text("UPDATE orders SET customer_type = 'mayorista' WHERE customer_type IS NULL OR TRIM(customer_type) = '';"))
        except Exception:
            pass


if _should_run_import_migrations():
    _migrate_orders_optional_columns()


def _migrate_products_optional_columns() -> None:
    """Best-effort migration for legacy `products` schemas."""
    try:
        insp = inspect(engine)
        if 'products' not in insp.get_table_names():
            return
        existing = {c['name'] for c in insp.get_columns('products')}
    except Exception:
        return

    try:
        dialect = engine.dialect.name if engine and getattr(engine, 'dialect', None) else ''
    except Exception:
        dialect = ''

    needed = [
        ('price_retail', 'REAL'),
        ('code', 'VARCHAR(100)'),
    ]

    with engine.begin() as conn:
        for name, coltype in needed:
            if name in existing:
                continue
            try:
                if 'postgres' in dialect:
                    conn.execute(text(f"ALTER TABLE products ADD COLUMN IF NOT EXISTS {name} {coltype};"))
                else:
                    conn.execute(text(f"ALTER TABLE products ADD COLUMN {name} {coltype};"))
            except Exception:
                pass


if _should_run_import_migrations():
    _migrate_products_optional_columns()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        try:
            db.rollback()
        except Exception:
            pass
        db.close()
