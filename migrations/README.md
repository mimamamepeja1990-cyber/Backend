Migration: orders -> Postgres JSONB

Purpose
- Convert `orders.items` to Postgres `JSONB` type.
- Ensure `orders` has `user_*` and `_token_*` columns.
- Add basic indexes useful for admin listing.

IMPORTANT: Backup your database before running any migration.

Recommended steps
1. Backup (pg_dump):

   ```bash
   # Dumps in custom format. Replace the URL with your DATABASE_URL.
   pg_dump --dbname="$DATABASE_URL" -F c -f orders_backup.dump
   ```

2. Test migration on a staging DB copy.

3. Run migration SQL:

   ```bash
   # Run using psql. Replace DATABASE_URL with your Postgres connection string.
   psql "$DATABASE_URL" -f Backend/migrations/migrate_orders_to_postgres.sql
   ```

Notes and cautions
- The script attempts a best-effort conversion per-row. If `items` contains invalid JSON, that row will be converted to an empty array `[]` to keep the migration resilient.
- Index creation in the script uses normal `CREATE INDEX`; for large tables you should run `CREATE INDEX CONCURRENTLY` manually outside transactions to avoid locking.
- After migration, verify the app against the Postgres DB and confirm `GET /orders` returns items and user fields correctly.

Optional follow-ups
- Add a migration to remove duplicate rows in `order_token_previews`.
- Create more selective indexes for queries you run frequently (e.g., GIN indexes with jsonb_path_ops).

If you want, puedo ejecutar este script localmente si me proporcionás la variable de entorno `DATABASE_URL` en tu entorno, o puedo darte los comandos exactos para que lo ejecutes en Render/Producción.
