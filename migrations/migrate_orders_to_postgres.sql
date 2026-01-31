-- migrate_orders_to_postgres.sql
-- Safely convert `orders.items` to JSONB and ensure user_*/_token_* columns exist.
-- IMPORTANT: Backup your database before running this script.

BEGIN;

-- 1) Ensure contact columns exist
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS user_full_name VARCHAR(200);
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS user_email VARCHAR(320);
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS user_barrio VARCHAR(200);
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS user_calle VARCHAR(200);
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS user_numeracion VARCHAR(100);
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS _token_received BOOLEAN;

-- 2) Ensure _token_preview exists as JSONB (create if missing or convert if text)
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS _token_preview JSONB;
-- If column existed as TEXT, try to cast it to JSONB (safe cast may fail if content invalid)
DO $$
BEGIN
  BEGIN
    ALTER TABLE orders ALTER COLUMN _token_preview TYPE JSONB USING (_token_preview::jsonb);
  EXCEPTION WHEN others THEN
    -- ignore casting failure; leave as is (TEXT) — we already have JSONB column created
    RAISE NOTICE 'Could not cast existing _token_preview to JSONB, leaving existing data untouched.';
  END;
END$$;

-- 3) Convert items -> items_json (JSONB) per-row safely
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS items_json JSONB;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, items FROM orders LOOP
    BEGIN
      IF r.items IS NULL OR trim(r.items) = '' THEN
        UPDATE orders SET items_json = '[]'::jsonb WHERE id = r.id;
      ELSE
        BEGIN
          -- Try to cast items to jsonb directly
          UPDATE orders SET items_json = r.items::jsonb WHERE id = r.id;
        EXCEPTION WHEN others THEN
          -- Fallback: try to parse as JSON string
          BEGIN
            UPDATE orders SET items_json = (CASE WHEN (trim(r.items) LIKE '{%' OR trim(r.items) LIKE '[%') THEN r.items::jsonb ELSE to_json(r.items)::jsonb END) WHERE id = r.id;
          EXCEPTION WHEN others THEN
            -- As last resort, store an empty array
            UPDATE orders SET items_json = '[]'::jsonb WHERE id = r.id;
          END;
        END;
      END IF;
    EXCEPTION WHEN others THEN
      -- On unexpected error for this row, set empty array and continue
      UPDATE orders SET items_json = '[]'::jsonb WHERE id = r.id;
    END;
  END LOOP;
END$$;

-- 4) Replace old column with JSONB column
ALTER TABLE orders DROP COLUMN IF EXISTS items;
ALTER TABLE orders RENAME COLUMN items_json TO items;

-- 5) Create helpful indexes (use CONCURRENTLY in production to avoid locking large tables)
-- If you run this against a large table, run these commands with CONCURRENTLY outside transaction.
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_user_email ON orders (user_email);
CREATE INDEX IF NOT EXISTS idx_orders_items_gin ON orders USING GIN (items);

COMMIT;

-- Notes:
-- - For very large tables consider running the index creation with CREATE INDEX CONCURRENTLY
--   and outside of a transaction to avoid long locks.
-- - Test this script on a staging copy of your DB before running in production.
-- - If your `items` column contains truncated or invalid JSON, rows will get '[]' as a safe fallback.
