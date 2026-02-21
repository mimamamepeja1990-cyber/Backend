from pathlib import Path
import os

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

# app/
BASE_DIR = Path(__file__).resolve().parent

# Backend/data/
DATA_DIR = BASE_DIR.parent / 'data'
DATA_DIR.mkdir(exist_ok=True)

DB_PATH = DATA_DIR / 'database.db'

# Allow overriding the DB with a managed DATABASE_URL (Postgres, etc.) via env var.
# Use `str(DB_PATH)` to ensure a proper path string is embedded in the sqlite URL.
SQLALCHEMY_DATABASE_URL = os.environ.get('DATABASE_URL') or f"sqlite:///{str(DB_PATH)}"

# For sqlite we need the special connect arg; for other DBs (e.g. postgres) do not pass it.
if SQLALCHEMY_DATABASE_URL.startswith('sqlite'):
    engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={'check_same_thread': False})
else:
    engine = create_engine(SQLALCHEMY_DATABASE_URL)


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
        ('status', "VARCHAR(50) DEFAULT 'nuevo'"),
        ('customer_type', "VARCHAR(50) DEFAULT 'mayorista'"),
        ('user_id', 'INTEGER'),
        ('user_full_name', 'VARCHAR(200)'),
        ('user_email', 'VARCHAR(320)'),
        ('user_barrio', 'VARCHAR(200)'),
        ('user_calle', 'VARCHAR(200)'),
        ('user_numeracion', 'VARCHAR(100)'),
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
