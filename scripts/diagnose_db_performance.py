"""Read-only PostgreSQL diagnostics for slow image and admin requests.

Usage (production shell, with DATABASE_URL already configured):
    python scripts/diagnose_db_performance.py --image-id 101

The script never writes data, changes PostgreSQL settings, or prints query text
from pg_stat_activity. It reports image byte sizes, the image access plan,
active wait states, and lock blockers.
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Any

from sqlalchemy import create_engine, text


def _rows(conn, statement: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    return [dict(row._mapping) for row in conn.execute(text(statement), params or {})]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--image-id', type=int, default=101)
    parser.add_argument('--top', type=int, default=20)
    args = parser.parse_args()
    database_url = str(os.environ.get('DATABASE_URL') or '').strip()
    if not database_url:
        raise SystemExit('DATABASE_URL is required; no database connection was attempted')

    engine = create_engine(database_url, pool_pre_ping=True)
    result: dict[str, Any] = {'dialect': engine.dialect.name, 'image_id': args.image_id}
    try:
        with engine.connect() as conn:
            if engine.dialect.name == 'postgresql':
                size_expr = 'octet_length(data)'
            else:
                size_expr = 'length(data)'
            result['image_stats'] = _rows(
                conn,
                f'''SELECT count(*) AS image_count,
                           coalesce(sum({size_expr}), 0) AS total_bytes,
                           coalesce(avg({size_expr}), 0) AS average_bytes,
                           coalesce(min({size_expr}), 0) AS minimum_bytes,
                           coalesce(max({size_expr}), 0) AS maximum_bytes
                    FROM images''',
            )[0]
            result['largest_images'] = _rows(
                conn,
                f'''SELECT id, mime, {size_expr} AS bytes, created_at
                    FROM images ORDER BY {size_expr} DESC NULLS LAST LIMIT :limit''',
                {'limit': max(1, min(args.top, 100))},
            )
            result['requested_image'] = _rows(
                conn,
                f'''SELECT id, mime, {size_expr} AS bytes
                    FROM images WHERE id = :image_id''',
                {'image_id': args.image_id},
            )

            if engine.dialect.name == 'postgresql':
                result['image_indexes'] = _rows(
                    conn,
                    """SELECT indexname, indexdef
                       FROM pg_indexes WHERE tablename = 'images'""",
                )
                result['image_plan'] = conn.execute(
                    text('''EXPLAIN (FORMAT JSON, COSTS true)
                            SELECT data, mime FROM images WHERE id = :image_id'''),
                    {'image_id': args.image_id},
                ).scalar()
                result['activity'] = _rows(
                    conn,
                    """SELECT pid, application_name, state, wait_event_type,
                              wait_event,
                              round(extract(epoch FROM (now() - query_start))::numeric, 3) AS query_age_seconds,
                              round(extract(epoch FROM (now() - xact_start))::numeric, 3) AS transaction_age_seconds
                       FROM pg_stat_activity
                      WHERE datname = current_database()
                        AND pid <> pg_backend_pid()
                      ORDER BY query_start NULLS LAST""",
                )
                result['blocking_locks'] = _rows(
                    conn,
                    """SELECT blocked.pid AS blocked_pid,
                              blocked.wait_event_type AS blocked_wait_event_type,
                              blocked.wait_event AS blocked_wait_event,
                              blocking.pid AS blocking_pid,
                              blocking.state AS blocking_state,
                              round(extract(epoch FROM (now() - blocking.xact_start))::numeric, 3) AS blocking_transaction_age_seconds
                       FROM pg_locks blocked_lock
                       JOIN pg_stat_activity blocked ON blocked.pid = blocked_lock.pid
                       JOIN pg_locks blocking_lock
                         ON blocking_lock.locktype = blocked_lock.locktype
                        AND blocking_lock.database IS NOT DISTINCT FROM blocked_lock.database
                        AND blocking_lock.relation IS NOT DISTINCT FROM blocked_lock.relation
                        AND blocking_lock.page IS NOT DISTINCT FROM blocked_lock.page
                        AND blocking_lock.tuple IS NOT DISTINCT FROM blocked_lock.tuple
                        AND blocking_lock.virtualxid IS NOT DISTINCT FROM blocked_lock.virtualxid
                        AND blocking_lock.transactionid IS NOT DISTINCT FROM blocked_lock.transactionid
                        AND blocking_lock.classid IS NOT DISTINCT FROM blocked_lock.classid
                        AND blocking_lock.objid IS NOT DISTINCT FROM blocked_lock.objid
                        AND blocking_lock.objsubid IS NOT DISTINCT FROM blocked_lock.objsubid
                        AND blocking_lock.pid <> blocked_lock.pid
                       JOIN pg_stat_activity blocking ON blocking.pid = blocking_lock.pid
                      WHERE NOT blocked_lock.granted
                        AND blocking_lock.granted""",
                )
    finally:
        engine.dispose()
    print(json.dumps(result, default=str, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
