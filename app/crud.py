from app import models, schemas
from sqlalchemy.orm import Session
from fastapi import HTTPException
import os
from typing import Optional, List
from sqlalchemy import func
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
import logging
from types import SimpleNamespace
logger = logging.getLogger('catalog_api.crud')
import traceback
import datetime
import os
from sqlalchemy.exc import InternalError


def _safe_execute_fetchall(db, stmt, params=None):
    params = params or {}
    bind = db.get_bind()
    conn = None
    try:
        conn = bind.connect()
        try:
            return conn.execute(text(stmt), params).fetchall()
        except Exception as inner_e:
            # If the underlying DB connection is poisoned (aborted tx), invalidate it so pool removes it
            try:
                conn.invalidate()
            except Exception:
                try:
                    conn.close()
                except Exception:
                    pass
            raise inner_e
    except Exception as e:
        msg = str(e)
        logger.exception('safe_fetchall initial failed: %s', msg[:300])
        if 'current transaction is aborted' in msg.lower():
            try:
                tb = traceback.format_exc()
                _append_server_log(f'Aborted transaction detected during safe_fetchall: stmt={stmt} msg={msg[:300]}', tb)
            except Exception:
                pass
            try:
                db.rollback()
            except Exception:
                pass
            # retry once using a fresh engine-level connection (pool should not return the invalidated conn)
            try:
                bind2 = db.get_bind()
                conn2 = bind2.connect()
                try:
                    return conn2.execute(text(stmt), params).fetchall()
                finally:
                    try: conn2.close()
                    except Exception: pass
            except Exception as e2:
                logger.exception('safe_fetchall retry failed: %s', str(e2)[:300])
                raise
        raise
    finally:
        try:
            if conn is not None:
                conn.close()
        except Exception:
            pass


def _safe_execute_fetchone(db, stmt, params=None):
    params = params or {}
    bind = db.get_bind()
    conn = None
    try:
        conn = bind.connect()
        try:
            return conn.execute(text(stmt), params).fetchone()
        except Exception as inner_e:
            try:
                conn.invalidate()
            except Exception:
                try:
                    conn.close()
                except Exception:
                    pass
            raise inner_e
    except Exception as e:
        msg = str(e)
        logger.exception('safe_fetchone initial failed: %s', msg[:300])
        if 'current transaction is aborted' in msg.lower():
            try:
                tb = traceback.format_exc()
                _append_server_log(f'Aborted transaction detected during safe_fetchone: stmt={stmt} msg={msg[:300]}', tb)
            except Exception:
                pass
            try:
                db.rollback()
            except Exception:
                pass
            try:
                bind2 = db.get_bind()
                conn2 = bind2.connect()
                try:
                    return conn2.execute(text(stmt), params).fetchone()
                finally:
                    try: conn2.close()
                    except Exception: pass
            except Exception as e2:
                logger.exception('safe_fetchone retry failed: %s', str(e2)[:300])
                raise
        raise
    finally:
        try:
            if conn is not None:
                conn.close()
        except Exception:
            pass


def _safe_scalar(db, stmt, params=None):
    params = params or {}
    bind = db.get_bind()
    conn = None
    try:
        conn = bind.connect()
        try:
            return conn.execute(text(stmt), params).scalar()
        except Exception as inner_e:
            try:
                conn.invalidate()
            except Exception:
                try:
                    conn.close()
                except Exception:
                    pass
            raise inner_e
    except Exception as e:
        msg = str(e)
        logger.exception('safe_scalar initial failed: %s', msg[:300])
        if 'current transaction is aborted' in msg.lower():
            try:
                tb = traceback.format_exc()
                _append_server_log(f'Aborted transaction detected during safe_scalar: stmt={stmt} msg={msg[:300]}', tb)
            except Exception:
                pass
            try:
                db.rollback()
            except Exception:
                pass
            try:
                bind2 = db.get_bind()
                conn2 = bind2.connect()
                try:
                    return conn2.execute(text(stmt), params).scalar()
                finally:
                    try: conn2.close()
                    except Exception: pass
            except Exception as e2:
                logger.exception('safe_scalar retry failed: %s', str(e2)[:300])
                raise
        raise
    finally:
        try:
            if conn is not None:
                conn.close()
        except Exception:
            pass


def _safe_execute(db, stmt, params=None):
    params = params or {}
    try:
        return db.execute(text(stmt), params)
    except Exception as e:
        msg = str(e)
        logger.exception('safe_execute initial failed: %s', msg[:300])
        if 'current transaction is aborted' in msg.lower():
            try:
                tb = traceback.format_exc()
                _append_server_log(f'Aborted transaction detected during safe_execute: stmt={stmt} msg={msg[:300]}', tb)
            except Exception:
                pass
            try:
                db.rollback()
            except Exception:
                pass
            return db.execute(text(stmt), params)
        raise


def _append_server_log(msg, tb=None):
    try:
        base = os.path.dirname(os.path.dirname(__file__))
        logpath = os.path.join(base, 'server_log.txt')
        with open(logpath, 'a', encoding='utf-8') as f:
            f.write(f"{datetime.datetime.utcnow().isoformat()} - {msg}\n")
            if tb:
                f.write(tb + "\n\n")
    except Exception:
        pass


def get_products(db: Session, skip: int = 0, limit: int = 100, q: Optional[str]=None, category: Optional[str]=None, active: Optional[bool]=None, sort: Optional[str]=None) -> List[models.Product]:
    try:
        query = db.query(models.Product)
        if q:
            query = query.filter(models.Product.name.ilike(f"%{q}%"))
        if category:
            query = query.filter(models.Product.category == category)
        if active is not None:
            query = query.filter(models.Product.active == active)
        # Simple sorting support
        if sort == "price_asc":
            query = query.order_by(models.Product.price.asc())
        elif sort == "price_desc":
            query = query.order_by(models.Product.price.desc())
        return query.offset(skip).limit(limit).all()
    except Exception as e:
        logger.exception('ORM get_products failed, falling back to raw SQL: %s', e)
        # If ORM select fails (e.g. missing columns in legacy DB), fallback to a raw select
        try:
            bind = db.get_bind()
            insp = inspect(bind)
            existing = {c['name'] for c in insp.get_columns('products')}
        except Exception:
            existing = set()
        cols = ['id','name','price','description','category','image_url','created_at','updated_at','active']
        # only include optional columns if they exist
        if 'stock' in existing:
            cols.append('stock')
        if 'discount' in existing:
            cols.append('discount')
        cols_sql = ', '.join(cols)
        where = []
        params = {'skip': skip, 'limit': limit}
        if q:
            where.append("LOWER(name) LIKE :q")
            params['q'] = f"%{q.lower()}%"
        if category:
            where.append("category = :category")
            params['category'] = category
        if active is not None and 'active' in existing:
            where.append("active = :active")
            params['active'] = bool(active)
        where_clause = (' WHERE ' + ' AND '.join(where)) if where else ''
        order_clause = ''
        if sort == 'price_asc': order_clause = ' ORDER BY price ASC'
        elif sort == 'price_desc': order_clause = ' ORDER BY price DESC'
        sql = f"SELECT {cols_sql} FROM products{where_clause}{order_clause} LIMIT :limit OFFSET :skip"

        # Use safe helper that retries once after rollback if needed
        rows = _safe_execute_fetchall(db, sql, params)

        result = []
        for row in rows:
            objd = {cols[i]: row[i] for i in range(len(cols))}
            result.append(objd)
        return result

def create_product(db: Session, payload: schemas.ProductCreate) -> models.Product:
    """Create product - ultra-simple and robust."""
    logger.info('CREATE_PRODUCT: Inserting %s', payload.name)
    
    # ALWAYS use raw SQL to avoid ORM issues
    # Get available columns
    try:
        bind = db.get_bind()
        insp = inspect(bind)
        existing_cols = {c['name'] for c in insp.get_columns('products')}
    except Exception:
        existing_cols = {'id', 'name', 'price', 'description', 'category', 'image_url', 'active', 'created_at', 'updated_at', 'stock', 'discount'}
    
    logger.info('Existing columns: %s', existing_cols)
    
    # Ensure stock and discount columns exist
    dialect = getattr(bind, 'dialect', None) if 'bind' in locals() else None
    dialect_name = getattr(dialect, 'name', '') if dialect else 'sqlite'
    
    for col in ['stock', 'discount']:
        if col not in existing_cols:
            try:
                if 'postgres' in dialect_name:
                    _safe_execute(db, f"ALTER TABLE products ADD COLUMN IF NOT EXISTS {col} {'REAL' if col == 'discount' else 'INTEGER'} DEFAULT 0")
                else:
                    _safe_execute(db, f"ALTER TABLE products ADD COLUMN {col} {'REAL' if col == 'discount' else 'INTEGER'} DEFAULT 0")
                db.commit()
                existing_cols.add(col)
                logger.info('Created column: %s', col)
            except Exception as e:
                logger.warning('Could not create column %s: %s', col, e)
                try:
                    db.rollback()
                except:
                    pass
    
    # Build column list - only use columns that exist
    data = {
        'name': payload.name,
        'price': payload.price,
        'description': payload.description or '',
        'category': payload.category or '',
        'image_url': payload.image_url or '',
        'active': payload.active,
        'stock': getattr(payload, 'stock', 0),
        'discount': getattr(payload, 'discount', 0.0)
    }
    
    # Filter to only existing columns
    cols_to_insert = [k for k in data.keys() if k in existing_cols]
    logger.info('Columns to insert: %s', cols_to_insert)
    
    if not cols_to_insert:
        raise RuntimeError('No columns available to insert')
    
    # Raw SQL INSERT
    col_names = ', '.join(cols_to_insert)
    placeholders = ', '.join([f':{c}' for c in cols_to_insert])
    sql = f'INSERT INTO products ({col_names}) VALUES ({placeholders})'
    params = {k: data[k] for k in cols_to_insert}
    
    logger.info('SQL: %s', sql)
    logger.info('Params: %s', params)
    
    try:
        _safe_execute(db, sql, params)
        db.commit()
        logger.info('INSERT committed successfully')
    except Exception as e:
        logger.exception('INSERT failed: %s', e)
        try:
            db.rollback()
        except:
            pass
        raise
    
    # Fetch the inserted product
    try:
        # Build an explicit column list that includes optional `stock` and `discount` if present
        cols = ['id', 'name', 'price', 'description', 'category', 'image_url', 'active', 'created_at', 'updated_at']
        try:
            bind = db.get_bind()
            insp = inspect(bind)
            existing = {c['name'] for c in insp.get_columns('products')}
        except Exception:
            existing = set()
        if 'stock' in existing:
            cols.append('stock')
        if 'discount' in existing:
            cols.append('discount')
        cols_sql = ', '.join(cols)
        result = _safe_execute_fetchone(db, f'SELECT {cols_sql} FROM products WHERE name = :name ORDER BY created_at DESC LIMIT 1', {'name': payload.name})

        if result:
            logger.info('Fetched product id=%s', result[0])
            # Unpack in correct order and return plain dict (avoid SimpleNamespace so callers can use .get())
            obj = {cols[i]: result[i] for i in range(len(cols))}
            # coerce numeric types
            obj['price'] = float(obj.get('price') or 0.0)
            obj['stock'] = int(obj.get('stock') or 0)
            obj['discount'] = float(obj.get('discount') or 0.0)
            obj['active'] = bool(obj.get('active')) if 'active' in obj else False
            return obj
    except Exception as e:
        logger.exception('Could not fetch product: %s', e)
    
    # Worst case: return a plain dict with input data
    return {
        'id': None,
        'name': payload.name,
        'price': float(payload.price) if getattr(payload, 'price', None) is not None else 0.0,
        'stock': int(getattr(payload, 'stock', 0) or 0),
        'discount': float(getattr(payload, 'discount', 0.0) or 0.0),
        'description': payload.description,
        'category': payload.category,
        'image_url': payload.image_url,
        'active': bool(getattr(payload, 'active', True))
    }

def get_product(db: Session, product_id: int) -> Optional[models.Product]:
    try:
        return db.query(models.Product).filter(models.Product.id == product_id).first()
    except Exception:
        # fallback: perform a raw select for known columns to avoid missing-column errors
        try:
            bind = db.get_bind()
            insp = inspect(bind)
            existing = {c['name'] for c in insp.get_columns('products')}
        except Exception:
            existing = set()
        cols = ['id','name','price','description','category','image_url','created_at','updated_at','active']
        if 'stock' in existing:
            cols.append('stock')
        if 'discount' in existing:
            cols.append('discount')
        cols_sql = ', '.join(cols)
        row = _safe_execute_fetchone(db, f"SELECT {cols_sql} FROM products WHERE id = :id LIMIT 1", {'id': product_id})
        if not row:
            return None
        objd = {cols[i]: row[i] for i in range(len(cols))}
        return objd

def update_product(db: Session, product_id: int, payload: schemas.ProductUpdate) -> models.Product:
    obj = get_product(db, product_id)
    if not obj:
        raise Exception("Not found")
    updates = payload.dict(exclude_unset=True)
    # If obj is an ORM instance, perform usual setattr flow
    try:
        is_orm = hasattr(obj, '__table__') or (hasattr(obj, '__class__') and getattr(obj.__class__, '__table__', None) is not None)
    except Exception:
        is_orm = False

    if is_orm:
        for field, value in updates.items():
            setattr(obj, field, value)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    # Fallback: perform a raw UPDATE using only existing columns
    try:
        bind = db.get_bind()
        insp = inspect(bind)
        existing = {c['name'] for c in insp.get_columns('products')}
    except Exception:
        existing = set()

    set_cols = [k for k in updates.keys() if (not existing) or (k in existing)]
    if not set_cols:
        # Nothing to update (columns don't exist), return the original object
        return obj

    set_sql = ', '.join(f"{c} = :{c}" for c in set_cols)
    params = {c: updates[c] for c in set_cols}
    params['id'] = product_id
    try:
        _safe_execute(db, f"UPDATE products SET {set_sql}, updated_at = CURRENT_TIMESTAMP WHERE id = :id", params)
        try:
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        raise

    # Fetch updated row safely (only request existing columns)
    cols = ['id','name','price','description','category','image_url','created_at','updated_at','active']
    if 'stock' in existing:
        cols.append('stock')
    if 'discount' in existing:
        cols.append('discount')
    cols_sql = ', '.join(cols)
    row = _safe_execute_fetchone(db, f"SELECT {cols_sql} FROM products WHERE id = :id LIMIT 1", {'id': product_id})
    if not row:
        return None
    objd = {cols[i]: row[i] for i in range(len(cols))}
    # Return plain dict for consistency
    return objd

def delete_product(db: Session, product_id: int):
    obj = get_product(db, product_id)
    if obj:
        db.delete(obj)
        db.commit()

def export_all(db: Session):
    return db.query(models.Product).all()

def stats(db: Session):
    try:
        total = int(_safe_scalar(db, 'SELECT count(*) FROM products') or 0)
    except Exception:
        total = db.query(models.Product).count()
    avg = db.query(models.Product).with_entities(func.avg(models.Product.price)).scalar()
    return {"total": total, "average_price": float(avg) if avg else 0.0}


# --- Orders CRUD ---
import json as _json
from sqlalchemy import inspect, text
from sqlalchemy.exc import DatabaseError

def create_order(db: Session, payload: schemas.OrderCreate, current_user: Optional[dict]=None) -> models.Order:
    # Defensive serialization: coerce items to plain JSON-serializable shapes and validate types
    items_list = []
    try:
        for o in getattr(payload, 'items', []) or []:
            # o may be a pydantic model or a plain dict
            try:
                if hasattr(o, 'dict'):
                    od = o.dict()
                else:
                    od = dict(o)
            except Exception:
                # fallback: stringify minimal fields
                od = {'id': str(getattr(o, 'id', o.get('id') if isinstance(o, dict) else None)), 'qty': int(getattr(o, 'qty', o.get('qty', 1) if isinstance(o, dict) else 1)), 'meta': getattr(o, 'meta', o.get('meta') if isinstance(o, dict) else {})}
            # coerce types
            od['id'] = str(od.get('id', ''))
            try:
                od['qty'] = int(od.get('qty', 1))
            except Exception:
                od['qty'] = 1
            if 'meta' not in od or od['meta'] is None:
                od['meta'] = {}
            items_list.append(od)
    except Exception:
        items_list = []

    items_json = _json.dumps(items_list, ensure_ascii=False)

    # Validate stock availability: if any product lacks enough stock, raise HTTP 400
    try:
        for it in items_list:
            try:
                pid = int(it.get('id'))
            except Exception:
                # non-numeric id: skip strict stock enforcement (admin may use name-based ids)
                pid = None
            if pid is None:
                continue
            prod = db.query(models.Product).filter(models.Product.id == pid).first()
            if prod is None:
                continue
            # treat None stock as 0
            try:
                available = int(getattr(prod, 'stock', 0) or 0)
            except Exception:
                available = 0
            if available < int(it.get('qty', 1) or 1):
                raise HTTPException(status_code=400, detail='actualmente no contamos con stock de este articulo')
    except HTTPException:
        raise
    except Exception:
        # non-fatal: if stock check fails for unexpected reasons, continue
        pass
    # Decide how to pass `items` to DB depending on dialect. For Postgres
    # prefer passing the native Python list (driver will send JSON/JSONB).
    try:
        bind_check = None
        try:
            bind_check = None
            # Attempt to use the DB bind from an existing Session if available
            bind_check = None
        except Exception:
            bind_check = None
    except Exception:
        bind_check = None
    # We'll determine dialect later (after we have a bind). For now do a safe truncation
    # for non-Postgres backends that store JSON as TEXT to avoid excessively large values.
    if len(items_json) > 16000:
        items_json = items_json[:16000]

    # ensure total is numeric
    try:
        total_val = float(getattr(payload, 'total', 0) or 0)
    except Exception:
        total_val = 0.0


    # --- FUERZA source a 'app' o 'web' ---
    # Si el payload no trae source, o viene como None, o string vacío, se fuerza a 'web' (o 'app' si se detecta)
    src = getattr(payload, 'source', None)
    if not src or not str(src).strip():
        # Heurística: si el payload tiene un campo user_agent o similar, podrías inferir aquí, pero para robustez, default 'web'
        src = 'web'
    src = str(src).strip().lower()
    if src not in ('app', 'web'):
        src = 'web'

    kwargs = {
        'items': items_json,
        'total': total_val,
        'status': 'nuevo',
        'source': src
    }
    optional = ['user_id', 'user_full_name', 'user_email', 'user_barrio', 'user_calle', 'user_numeracion', '_token_received', '_token_preview']
    try:
        bind = db.get_bind()
        insp = inspect(bind)
        existing_cols = {c['name'] for c in insp.get_columns('orders')}
    except Exception:
        existing_cols = set()

    preview_candidate = {}
    for f in optional:
        try:
            # Prefer explicit attribute on the payload, fall back to dict access
            v = getattr(payload, f, None)
        except Exception:
            try:
                v = payload.get(f) if isinstance(payload, dict) else None
            except Exception:
                v = None
        if v is None:
            continue
        # serialize complex types to JSON string for storage
        try:
            if isinstance(v, (dict, list)):
                v = _json.dumps(v, ensure_ascii=False)
        except Exception:
            v = str(v)
        kwargs[f] = v

    # If an authenticated user token was provided (current_user), and the payload
    # did not include contact fields, fill them from the user's record when possible.
    try:
        if current_user:
            # Try to load the user record when an id is available in the token
            uid = current_user.get('id') if isinstance(current_user, dict) else None
            u = None
            if uid is not None:
                try:
                    u = db.query(models.User).filter(models.User.id == int(uid)).first()
                except Exception:
                    u = None
            # Build preview_candidate from either the DB user or token fields
            try:
                if u:
                    if getattr(u, 'full_name', None):
                        preview_candidate['name'] = getattr(u, 'full_name')
                    if getattr(u, 'email', None):
                        preview_candidate['email'] = getattr(u, 'email')
                    if getattr(u, 'barrio', None):
                        preview_candidate['barrio'] = getattr(u, 'barrio')
                    if getattr(u, 'calle', None):
                        preview_candidate['calle'] = getattr(u, 'calle')
                    if getattr(u, 'numeracion', None):
                        preview_candidate['numeracion'] = getattr(u, 'numeracion')
                else:
                    # Token fallback
                    email = current_user.get('sub') or current_user.get('email')
                    name = current_user.get('name') or current_user.get('full_name')
                    if name:
                        preview_candidate['name'] = name
                    if email:
                        preview_candidate['email'] = email
            except Exception:
                pass

            # If the orders table actually exposes user_* columns, populate kwargs
            # so they are inserted directly into `orders` as well.
            if existing_cols:
                # Prefer explicit values from payload; otherwise fill from user record when available
                if getattr(payload, 'user_id', None) is None and 'user_id' in existing_cols:
                    if u:
                        kwargs['user_id'] = u.id
                for col, attr in (('user_full_name', 'full_name'), ('user_email', 'email'), ('user_barrio', 'barrio'), ('user_calle', 'calle'), ('user_numeracion', 'numeracion')):
                    if col in existing_cols and not kwargs.get(col):
                        # prefer explicit payload values
                        val = getattr(payload, col, None) or (getattr(u, attr, None) if u else None)
                        if val is not None:
                            kwargs[col] = val
                            return SimpleNamespace(**objd)
                if 'source' in existing_cols and getattr(payload, 'source', None):
                    kwargs['source'] = getattr(payload, 'source')
    except Exception:
        pass

    # Attempt to perform an explicit INSERT that only includes columns
    # determined to exist in the target DB. This avoids SQLAlchemy trying to
    # insert mapped columns that might not exist in an older remote schema.
    try:
        # Ensure we have a set of existing columns (fallback to conservative set)
        insert_cols = [c for c in kwargs.keys() if (not existing_cols) or (c in existing_cols)]
        # Always ensure required columns are present
        for req in ('items', 'total', 'status'):
            if req not in insert_cols and req in kwargs:
                insert_cols.insert(0, req)

        if not insert_cols:
            raise RuntimeError('No columns available for insert')

        cols_sql = ', '.join(insert_cols)
        vals_sql = ', '.join(':' + c for c in insert_cols)

        bind = db.get_bind()
        dialect_name = getattr(bind, 'dialect', None).name if bind and getattr(bind, 'dialect', None) else ''
        returning = ' RETURNING id, created_at' if 'postgres' in dialect_name else ''
        sql = f'INSERT INTO orders ({cols_sql}) VALUES ({vals_sql}){returning}'
        params = {k: kwargs[k] for k in insert_cols}
        # For Postgres, prefer sending native JSON objects (list/dict) so the
        # driver stores JSONB. Detect dialect and convert `items` param when
        # appropriate. For SQLite/text backends leave it as a JSON string.
        try:
            # For Postgres drivers, ensure the `items` parameter is a JSON string
            # so psycopg2 can adapt it reliably into JSONB. Sending a raw Python
            # list-of-dicts can trigger "can't adapt type 'dict'" errors.
            if 'postgres' in dialect_name and 'items' in params:
                try:
                    params['items'] = _json.dumps(items_list, ensure_ascii=False)
                except Exception:
                    # fallback to string conversion
                    params['items'] = str(items_list)
        except Exception:
            pass

        # Execute via Session.execute so it participates in the session transaction
        res = _safe_execute(db, sql, params)
        # Attempt to decrement stock for ordered items (atomic within this transaction)
        updated_product_ids = set()
        try:
            for it in items_list:
                try:
                    pid = int(it.get('id'))
                except Exception:
                    pid = None
                if pid is None:
                    continue
                qty = int(it.get('qty', 1) or 1)
                if qty <= 0:
                    continue
                # Try row-level lock when supported
                try:
                    prod_row = db.query(models.Product).filter(models.Product.id == pid).with_for_update().first()
                except Exception:
                    prod_row = db.query(models.Product).filter(models.Product.id == pid).first()
                if not prod_row:
                    continue
                try:
                    avail = int(getattr(prod_row, 'stock', 0) or 0)
                except Exception:
                    avail = 0
                if avail < qty:
                    raise HTTPException(status_code=400, detail='actualmente no contamos con stock de este articulo')
                prod_row.stock = avail - qty
                db.add(prod_row)
                updated_product_ids.add(pid)
        except HTTPException:
            raise
        except Exception:
            logger.exception('Stock decrement step failed; continuing')
        # For Postgres (returning) get id and created_at
        new_id = None
        new_created_at = None
        if 'postgres' in dialect_name:
            try:
                row = res.fetchone()
                if row is not None:
                    # row expected as (id, created_at)
                    new_id = row[0]
                    try:
                        new_created_at = row[1]
                    except Exception:
                        new_created_at = None
            except Exception:
                new_id = None
                new_created_at = None
        # commit the transaction
        db.commit()

# Helper: fetch created order using a safe SELECT that only requests
        # columns that exist in the target `orders` table. This avoids raising
        # a ProgrammingError if the table lacks newer `user_*` columns.
        def _fetch_order_by_id_safe(db_session, oid):
            try:
                bind = db_session.get_bind()
                insp = inspect(bind)
                existing = {c['name'] for c in insp.get_columns('orders')}
            except Exception:
                existing = set()
            # base columns we expect
            cols = ['id', 'items', 'total', 'status', 'created_at']
            optional_cols = ['user_id', 'user_full_name', 'user_email', 'user_barrio', 'user_calle', 'user_numeracion', '_token_received', '_token_preview']
            for c in optional_cols:
                if c in existing:
                    cols.append(c)
            cols_sql = ', '.join(cols)
            try:
                row = _safe_execute_fetchone(db_session, f"SELECT {cols_sql} FROM orders WHERE id = :id LIMIT 1", {'id': oid})
                if not row:
                    return None
                # map columns to values
                objd = {k: row[idx] for idx, k in enumerate(cols)}
                # ensure items is parsed
                try:
                    if isinstance(objd.get('items'), str):
                        objd['items'] = _json.loads(objd['items'])
                except Exception:
                    objd['items'] = []
                # deserialize token preview if present
                try:
                    if isinstance(objd.get('_token_preview'), str):
                        try:
                            objd['_token_preview'] = _json.loads(objd['_token_preview'])
                        except Exception:
                            pass
                except Exception:
                    pass
                return SimpleNamespace(**objd)
            except Exception:
                # If raw select fails for any reason, do not fallback to ORM (which may try to
                # select missing columns). Return None and let caller handle a sensible fallback.
                logger.exception('Safe fetch by id failed')
                return None

        # If we have a new_id use it to obtain the created object, otherwise
            # try to find the last inserted row by timestamp (best-effort)
        if new_id is not None:
            # Avoid an immediate ORM fetch which may fail if the DB schema is missing
            # newer `user_*` columns. Return a minimal object derived from the inserted
            # values so the API can respond successfully.
            objd = {
                'id': new_id,
                'items': items_list,
                'total': total_val,
                'status': kwargs.get('status', 'nuevo'),
                'created_at': new_created_at
            }
            # include any optional user_* fields we actually set
            for f in ['user_id', 'user_full_name', 'user_email', 'user_barrio', 'user_calle', 'user_numeracion', '_token_received', '_token_preview']:
                if f in kwargs:
                    objd[f] = kwargs.get(f)
                if 'source' in kwargs:
                    objd['source'] = kwargs.get('source')
            obj = SimpleNamespace(**objd)
            # Persist token preview in a side-table so it's durable even if the orders
            # table doesn't contain the token columns or migration hasn't run yet.
            try:
                tp_json = None
                tr_flag = None
                if '_token_preview' in kwargs and kwargs.get('_token_preview') is not None:
                    tp_json = kwargs.get('_token_preview')
                    # already serialized if we set it earlier
                elif getattr(payload, '_token_preview', None) is not None:
                    tp_json = getattr(payload, '_token_preview')
                if '_token_received' in kwargs and kwargs.get('_token_received') is not None:
                    tr_flag = kwargs.get('_token_received')
                elif getattr(payload, '_token_received', None) is not None:
                    tr_flag = getattr(payload, '_token_received')

                if tp_json is not None or tr_flag is not None:
                    # ensure tp_json is a JSON string for storage
                    try:
                        if not isinstance(tp_json, str):
                            tp_json = _json.dumps(tp_json, ensure_ascii=False)
                    except Exception:
                        tp_json = str(tp_json)
                    try:
                        # Only insert if no preview exists yet for this order
                        try:
                            exists = _safe_execute_fetchone(db, 'SELECT 1 FROM order_token_previews WHERE order_id = :id LIMIT 1', {'id': str(new_id)})
                        except Exception:
                            exists = None
                        if not exists:
                            ins_sql = "INSERT INTO order_token_previews (order_id, token_preview, token_received) VALUES (:oid, :tp, :tr)"
                            _safe_execute(db, ins_sql, {'oid': str(new_id), 'tp': tp_json, 'tr': bool(tr_flag)})
                            try:
                                db.commit()
                            except Exception:
                                try:
                                    db.rollback()
                                except Exception:
                                    pass
                    except Exception:
                        try:
                            db.rollback()
                        except Exception:
                            pass
                else:
                    # If there is no explicit token preview, attempt to persist a
                    # minimal preview derived from kwargs, payload or the
                    # `preview_candidate` (which may contain current_user info).
                    try:
                        preview = {}
                        for k, label in (('user_full_name', 'name'), ('user_email', 'email'), ('user_barrio', 'barrio'), ('user_calle', 'calle'), ('user_numeracion', 'numeracion')):
                            v = kwargs.get(k) or getattr(payload, k, None)
                            if v:
                                preview[label] = v
                        # Merge any preview_candidate values (do not overwrite existing)
                        try:
                            for sk, sval in preview_candidate.items():
                                if sk not in preview and sval:
                                    preview[sk] = sval
                        except Exception:
                            pass
                        if preview:
                            tp_json = _json.dumps(preview, ensure_ascii=False)
                            try:
                                exists = _safe_execute_fetchone(db, 'SELECT 1 FROM order_token_previews WHERE order_id = :id LIMIT 1', {'id': str(new_id)})
                            except Exception:
                                exists = None
                            if not exists:
                                ins_sql = "INSERT INTO order_token_previews (order_id, token_preview, token_received) VALUES (:oid, :tp, :tr)"
                                _safe_execute(db, ins_sql, {'oid': str(new_id), 'tp': tp_json, 'tr': True})
                                try:
                                    db.commit()
                                except Exception:
                                    try:
                                        db.rollback()
                                    except Exception:
                                        pass
                    except Exception:
                        try:
                            db.rollback()
                        except Exception:
                            pass
            except Exception:
                pass
        else:
            # fallback: try a minimal raw select (best-effort) to find the created record
            try:
                cols = ['id', 'items', 'total', 'status', 'created_at']
                cols_sql = ', '.join(cols)
                row = _safe_execute_fetchone(db, f"SELECT {cols_sql} FROM orders WHERE items = :items AND total = :total ORDER BY created_at DESC LIMIT 1", {'items': kwargs.get('items'), 'total': kwargs.get('total')})
                if row:
                    objd = {k: row[idx] for idx, k in enumerate(cols)}
                    try:
                        if isinstance(objd.get('items'), str):
                            objd['items'] = _json.loads(objd['items'])
                    except Exception:
                        objd['items'] = []
                    obj = SimpleNamespace(**objd)
                else:
                    obj = None
            except Exception:
                obj = None

    except Exception as db_e:
        # If an insert failed because a column truly does not exist, attempt
        # a retry by removing optional user_* fields and re-inserting.
        msg = str(db_e)
        logger.exception('Explicit insert failed when creating order: %s', msg)
        try:
            tb = traceback.format_exc()
            _append_server_log(f'create_order explicit insert failed: {msg}', tb)
        except Exception:
            pass
        try:
            db.rollback()
        except Exception:
            pass
        if 'does not exist' in msg or 'UndefinedColumn' in msg or 'unknown column' in msg or 'column "user_' in msg:
            logger.info('Retrying explicit insert without optional user_* fields due to DB schema mismatch')
            for f in optional:
                if f in kwargs:
                    kwargs.pop(f, None)
            # Recompute insert_cols
            insert_cols = [c for c in kwargs.keys() if (not existing_cols) or (c in existing_cols)]
            cols_sql = ', '.join(insert_cols)
            vals_sql = ', '.join(':' + c for c in insert_cols)
            sql = f'INSERT INTO orders ({cols_sql}) VALUES ({vals_sql}){returning}'
            params = {k: kwargs[k] for k in insert_cols}
            try:
                res = _safe_execute(db, sql, params)
                db.commit()
                if 'postgres' in dialect_name:
                    try:
                        row = res.fetchone()
                        if row is not None:
                            new_id = row[0]
                            try:
                                new_created_at = row[1]
                            except Exception:
                                new_created_at = None
                        else:
                            new_id = None
                            new_created_at = None
                    except Exception:
                        new_id = None
                        new_created_at = None
                if new_id is not None:
                    objd = {
                        'id': new_id,
                        'items': items_list,
                        'total': total_val,
                        'status': kwargs.get('status', 'nuevo'),
                        'created_at': new_created_at
                    }
                    for f in ['user_id', 'user_full_name', 'user_email', 'user_barrio', 'user_calle', 'user_numeracion', '_token_received', '_token_preview']:
                        if f in kwargs:
                            objd[f] = kwargs.get(f)
                    obj = SimpleNamespace(**objd)
                else:
                    try:
                        cols = ['id', 'items', 'total', 'status', 'created_at']
                        cols_sql = ', '.join(cols)
                        row = _safe_execute_fetchone(db, f"SELECT {cols_sql} FROM orders WHERE items = :items AND total = :total ORDER BY created_at DESC LIMIT 1", {'items': kwargs.get('items'), 'total': kwargs.get('total')})
                        if row:
                            objd = {k: row[idx] for idx, k in enumerate(cols)}
                            try:
                                if isinstance(objd.get('items'), str):
                                    objd['items'] = _json.loads(objd['items'])
                            except Exception:
                                objd['items'] = []
                            obj = SimpleNamespace(**objd)
                        else:
                            obj = None
                    except Exception:
                        obj = None
            except Exception as db_e2:
                logger.exception('Retry explicit insert failed: %s', db_e2)
                try:
                    tb2 = traceback.format_exc()
                    _append_server_log(f'create_order retry explicit insert failed: {db_e2}', tb2)
                except Exception:
                    pass
                raise
        else:
            raise

    # ensure returned object exposes `items` as a Python list (not a JSON string)
    try:
        obj.items = _json.loads(obj.items) if isinstance(obj.items, str) else obj.items
    except Exception:
        obj.items = []
    # As a final durability step: if the orders table lacked user_* columns
    # during insert and we didn't persist a token preview yet, persist a
    # minimal preview derived from any user_* snapshot fields so contact info
    # is durable across process restarts and deploys.
    try:
        oid = getattr(obj, 'id', None)
        if oid is not None:
            # Only insert if no preview exists for this order_id yet
            try:
                existing = _safe_execute_fetchone(db, 'SELECT 1 FROM order_token_previews WHERE order_id = :id LIMIT 1', {'id': str(oid)})
            except Exception:
                existing = True
            if not existing:
                preview = {}
                for k, label in (('user_full_name', 'name'), ('user_email', 'email'), ('user_barrio', 'barrio'), ('user_calle', 'calle'), ('user_numeracion', 'numeracion')):
                    v = kwargs.get(k) or getattr(payload, k, None)
                    if v:
                        preview[label] = v
                # Merge preview_candidate if there are additional values
                try:
                    for sk, sval in preview_candidate.items():
                        if sk not in preview and sval:
                            preview[sk] = sval
                except Exception:
                    pass
                if preview:
                    try:
                        tp_json = _json.dumps(preview, ensure_ascii=False)
                        try:
                            existing = _safe_execute_fetchone(db, 'SELECT 1 FROM order_token_previews WHERE order_id = :id LIMIT 1', {'id': str(oid)})
                        except Exception:
                            existing = None
                        if not existing:
                            _safe_execute(db, 'INSERT INTO order_token_previews (order_id, token_preview, token_received) VALUES (:oid, :tp, :tr)', {'oid': str(oid), 'tp': tp_json, 'tr': True})
                            try:
                                db.commit()
                            except Exception:
                                try:
                                    db.rollback()
                                except Exception:
                                    pass
                    except Exception:
                        try:
                            db.rollback()
                        except Exception:
                            pass
    except Exception:
        pass
    # Ensure user contact snapshot is durable: if the orders table exposes
    # user_* columns, perform an UPDATE to set them from the inserted
    # kwargs/payload/preview_candidate. This covers cases where the initial
    # INSERT omitted optional columns (schema mismatch) or the INSERT path
    # retried without them.
    try:
        oid = getattr(obj, 'id', None)
        if oid is not None:
            try:
                bind = db.get_bind()
                insp = inspect(bind)
                existing_cols = {c['name'] for c in insp.get_columns('orders')}
            except Exception:
                existing_cols = set()

            to_set = {}
            # Candidate sources: kwargs (what we attempted to insert), payload attrs, preview_candidate
            sources = (kwargs, getattr(payload, '__dict__', {}) or {}, preview_candidate or {})
            for col in ('user_id','user_full_name','user_email','user_barrio','user_calle','user_numeracion','_token_preview','_token_received'):
                if col not in existing_cols:
                    continue
                val = None
                for s in sources:
                    try:
                        if col in s and s.get(col) is not None:
                            val = s.get(col)
                            break
                    except Exception:
                        # payload may expose attributes rather than dict keys
                        try:
                            val = getattr(payload, col, None)
                            if val is not None:
                                break
                        except Exception:
                            pass
                # If preview is a dict and column is _token_preview, ensure JSON string
                if col == '_token_preview' and val is not None and not isinstance(val, str):
                    try:
                        val = _json.dumps(val, ensure_ascii=False)
                    except Exception:
                        val = str(val)
                if val is not None:
                    to_set[col] = val

            if to_set:
                try:
                    set_sql = ', '.join(f"{k} = :{k}" for k in to_set.keys())
                    params = {**to_set, 'id': oid}
                    _safe_execute(db, f"UPDATE orders SET {set_sql} WHERE id = :id", params)
                    try:
                        db.commit()
                    except Exception:
                        try:
                            db.rollback()
                        except Exception:
                            pass
                except Exception:
                    try:
                        db.rollback()
                    except Exception:
                        pass
    except Exception:
        pass
    try:
        # Attach any updated product ids so callers can notify frontends / update snapshots
        obj._updated_product_ids = list(updated_product_ids) if 'updated_product_ids' in locals() else []
    except Exception:
        pass
    return obj


def get_orders(db: Session, skip: int = 0, limit: int = 200, source: Optional[str] = None):
    """Return recent orders using a safe raw SELECT that only requests
    columns present in the `orders` table. This avoids ProgrammingError
    when the live DB schema lacks newly added columns.
    """
    try:
        bind = db.get_bind()
        insp = inspect(bind)
        existing = {c['name'] for c in insp.get_columns('orders')}
    except Exception:
        existing = set()

    cols = ['id', 'items', 'total', 'status', 'created_at']
    optional = ['user_id', 'user_full_name', 'user_email', 'user_barrio', 'user_calle', 'user_numeracion', '_token_received', '_token_preview', 'source']
    for c in optional:
        if c in existing:
            cols.append(c)

    cols_sql = ', '.join(cols)
    try:
        # Build WHERE clause if source filtering requested and column exists
        where_clause = ''
        params = {'skip': skip, 'limit': limit}
        if source and 'source' in existing:
            where_clause = ' WHERE source = :source'
            params['source'] = source
        rows = _safe_execute_fetchall(db, f"SELECT {cols_sql} FROM orders{where_clause} ORDER BY created_at DESC LIMIT :limit OFFSET :skip", params)
    except Exception:
        logger.exception('get_orders raw select failed')
        # As a last resort try the ORM query (may raise too); let caller see a handled error
        try:
            orm_rows = db.query(models.Order).order_by(models.Order.created_at.desc()).offset(skip).limit(limit).all()
            for r in orm_rows:
                try:
                    if isinstance(r.items, str):
                        r.items = _json.loads(r.items)
                except Exception:
                    r.items = []
            logger.info('get_orders ORM fallback returning %d rows (ids %s)', len(orm_rows), [getattr(r, 'id', None) for r in orm_rows][:10])
            return orm_rows
        except Exception:
            logger.exception('get_orders ORM fallback failed')
            return []

    result = []
    for row in rows:
        objd = {k: row[idx] for idx, k in enumerate(cols)}
        try:
            if isinstance(objd.get('items'), str):
                objd['items'] = _json.loads(objd['items'])
        except Exception:
            objd['items'] = []
        # Deserialize token preview if present as JSON string in DB
        try:
            if isinstance(objd.get('_token_preview'), str):
                try:
                    objd['_token_preview'] = _json.loads(objd['_token_preview'])
                except Exception:
                    pass
        except Exception:
            pass
        result.append(objd)
    try:
        logger.info('get_orders raw returning %d rows (ids %s)', len(result), [r.get('id') for r in result][:20])
    except Exception:
        pass
    return result



# --- Users CRUD ---
def get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.email == email).first()


def create_user(db: Session, payload: schemas.UserCreate, hashed_password: str) -> models.User:
    obj = models.User(
        full_name=payload.full_name,
        email=payload.email.lower(),
        barrio=payload.barrio,
        calle=payload.calle,
        numeracion=payload.numeracion,
        hashed_password=hashed_password,
        is_active=True,
    )
    db.add(obj)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise
    db.refresh(obj)
    return obj


def authenticate_user(db: Session, email: str, plain_password: str):
    user = get_user_by_email(db, email.lower())
    if not user:
        return None
    from app.utils import verify_password
    if not verify_password(plain_password, user.hashed_password):
        return None
    return user


# --- Settings CRUD ---
import json as _json
from sqlalchemy.exc import SQLAlchemyError

def get_setting(db: Session, key: str):
    try:
        row = _safe_execute_fetchone(db, "SELECT key, value FROM settings WHERE key = :k LIMIT 1", {'k': key})
        if not row:
            return None
        k, v = row[0], row[1]
        try:
            return _json.loads(v) if v is not None else None
        except Exception:
            return v
    except SQLAlchemyError:
        logger.exception('get_setting failed for key %s', key)
        return None


def set_setting(db: Session, key: str, value):
    """Upsert a setting key with JSON-serialized value (stored as TEXT)."""
    try:
        val = None
        if value is None:
            val = None
        else:
            try:
                val = _json.dumps(value, ensure_ascii=False)
            except Exception:
                val = str(value)
        # Try an INSERT ... ON CONFLICT style upsert for Postgres, fallback to
        # delete/insert for SQLite compatibility.
        dialect = getattr(db.get_bind(), 'dialect', None)
        dialect_name = getattr(dialect, 'name', '') if dialect else ''
        if 'postgres' in dialect_name:
            sql = "INSERT INTO settings (key, value) VALUES (:k, :v) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
            _safe_execute(db, sql, {'k': key, 'v': val})
            db.commit()
        else:
            # SQLite / generic: delete existing then insert
            _safe_execute(db, "DELETE FROM settings WHERE key = :k", {'k': key})
            _safe_execute(db, "INSERT INTO settings (key, value) VALUES (:k, :v)", {'k': key, 'v': val})
            db.commit()
        return True
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        logger.exception('set_setting failed for key %s', key)
        return False

