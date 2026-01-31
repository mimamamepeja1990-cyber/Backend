
# --- MIGRACIÓN AUTOMÁTICA DE SOURCE EN ORDERS ---
import sqlalchemy
from sqlalchemy import text
import os
def migrate_orders_source():
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        return
    engine = sqlalchemy.create_engine(db_url)
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS source VARCHAR(16);"))
        except Exception:
            pass
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source);"))
        except Exception:
            pass
        try:
            conn.execute(text("UPDATE orders SET source = 'web' WHERE source IS NULL OR TRIM(source) = '';"))
        except Exception:
            pass
        print('Migración automática de source en orders ejecutada.')

migrate_orders_source()
from pathlib import Path
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# app/
BASE_DIR = Path(__file__).resolve().parent

# Backend/data/
DATA_DIR = BASE_DIR.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

DB_PATH = DATA_DIR / "database.db"

# Allow overriding the DB with a managed DATABASE_URL (Postgres, etc.) via env var.
# Use `str(DB_PATH)` to ensure a proper path string is embedded in the sqlite URL.
SQLALCHEMY_DATABASE_URL = os.environ.get('DATABASE_URL') or f"sqlite:///{str(DB_PATH)}"

# For sqlite we need the special connect arg; for other DBs (e.g. postgres) don't pass it
if SQLALCHEMY_DATABASE_URL.startswith('sqlite'):
    engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(SQLALCHEMY_DATABASE_URL)


SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()

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
