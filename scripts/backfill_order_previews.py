#!/usr/bin/env python3
"""
Backfill order user contact fields from order_token_previews.
Run on the same environment as the app (DATABASE_URL env var set to the production DB).
"""
import os
import json
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    print('ERROR: DATABASE_URL not set in environment')
    raise SystemExit(2)

engine = create_engine(DATABASE_URL)

def parse_preview(tp_raw):
    if tp_raw is None:
        return None
    if isinstance(tp_raw, str):
        try:
            return json.loads(tp_raw)
        except Exception:
            try:
                # sometimes stored as repr(dict)
                return eval(tp_raw)
            except Exception:
                return None
    return tp_raw

def main():
    conn = engine.connect()
    try:
        # Find distinct order_ids that have previews
        rows = conn.execute(text('SELECT DISTINCT order_id FROM order_token_previews')).fetchall()
        order_ids = [r[0] for r in rows]
        print(f'Found {len(order_ids)} orders with token previews')
        updated = 0
        for oid in order_ids:
            try:
                # fetch latest preview for this order
                r = conn.execute(text('SELECT token_preview FROM order_token_previews WHERE order_id = :id ORDER BY created_at DESC LIMIT 1'), {'id': str(oid)}).fetchone()
                if not r:
                    continue
                tp_raw = r[0]
                tp = parse_preview(tp_raw)
                if not tp or not isinstance(tp, dict):
                    continue
                # Map preview keys to orders columns
                mapping = {
                    'user_full_name': tp.get('name') or tp.get('full_name'),
                    'user_email': tp.get('email'),
                    'user_barrio': tp.get('barrio'),
                    'user_calle': tp.get('calle'),
                    'user_numeracion': tp.get('numeracion')
                }
                # Build SET clause only for non-empty values
                sets = []
                params = {'id': str(oid)}
                for col, val in mapping.items():
                    if val:
                        # Only update if current value is NULL or empty
                        sets.append(f"{col} = COALESCE(NULLIF({col}, ''), :{col})")
                        params[col] = val
                if not sets:
                    continue
                sql = f"UPDATE orders SET {', '.join(sets)} WHERE CAST(id AS TEXT) = :id"
                conn.execute(text(sql), params)
                updated += 1
            except SQLAlchemyError as e:
                print('DB error for order', oid, e)
            except Exception as e:
                print('Unexpected error for order', oid, e)
        print(f'Backfill complete, updated {updated} orders')
    finally:
        conn.close()

if __name__ == '__main__':
    main()
