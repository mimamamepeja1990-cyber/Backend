
"""Utility to add missing optional columns to the `orders` table.

Usage (from repo root):
    $ PYTHONPATH=Backend python Backend/scripts/add_user_columns.py

You can also run this on a machine with DATABASE_URL set to the production DB connection
string (Postgres). The script is careful to check which columns already exist and will only
attempt to add missing ones.
"""
from sqlalchemy import text
from app.database import engine
from sqlalchemy import inspect

COLS = [
    ("status", "VARCHAR(50) DEFAULT 'nuevo'"),
    ("user_id", "INTEGER"),
    ("user_full_name", "VARCHAR(200)"),
    ("user_email", "VARCHAR(320)"),
    ("user_barrio", "VARCHAR(200)"),
    ("user_calle", "VARCHAR(200)"),
    ("user_numeracion", "VARCHAR(100)"),
    ("_token_received", "BOOLEAN"),
    ("_token_preview", "TEXT"),
    ("source", "VARCHAR(50) DEFAULT 'web'"),
    ("payment_method", "VARCHAR(50)"),
    ("payment_status", "VARCHAR(50)"),
    ("payment_reference", "VARCHAR(200)"),
]

def main():
    dialect = engine.dialect.name
    print(f"Connected to DB dialect: {dialect}")
    insp = inspect(engine)
    has_orders = 'orders' in insp.get_table_names()
    if not has_orders:
        print('No `orders` table found. If this is an old DB, run the app once or create tables first.')
        return

    existing = {c['name'] for c in insp.get_columns('orders')}
    with engine.connect() as conn:
        for name, coltype in COLS:
            if name in existing:
                print(f"Column {name} already exists; skipping")
                continue
            if dialect == 'postgresql':
                sql = f"ALTER TABLE orders ADD COLUMN IF NOT EXISTS {name} {coltype};"
            else:
                # SQLite and others - try a safe ALTER TABLE
                sql = f"ALTER TABLE orders ADD COLUMN {name} {coltype};"
            try:
                print('Executing:', sql)
                conn.execute(text(sql))
                print('OK')
            except Exception as e:
                print('Failed to add', name, '->', e)

if __name__ == '__main__':
    main()
