import sqlite3,json
conn=sqlite3.connect('data/database.db')
c=conn.cursor()
try:
    c.execute('SELECT order_id, token_preview, token_received, created_at FROM order_token_previews ORDER BY created_at DESC LIMIT 20')
    rows=c.fetchall()
    print('rows=',len(rows))
    for r in rows:
        oid, tp, tr, created = r
        print('order_id=', oid, 'token_received=', tr, 'created_at=', created)
        try:
            print('preview=', json.loads(tp) if tp else tp)
        except Exception:
            print('preview_raw=', tp)
except Exception as e:
    print('error', e)
finally:
    conn.close()
