from app import models, schemas
from sqlalchemy.orm import Session
from fastapi import HTTPException
import os
from typing import Optional, List
from sqlalchemy import func, or_
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
import logging
from types import SimpleNamespace
logger = logging.getLogger('catalog_api.crud')
import traceback
import datetime
import os
import re
import uuid
from sqlalchemy.exc import InternalError
from zoneinfo import ZoneInfo


def _normalize_cutoff_hour(raw_value, default_value=18):
    try:
        value = int(str(raw_value).strip())
    except Exception:
        value = default_value
    if value < 0:
        return 0
    if value > 23:
        return 23
    return value


def _compute_delivery_schedule_snapshot(
    now_utc: Optional[datetime.datetime] = None,
    cutoff_hour: Optional[int] = None,
    timezone_name: Optional[str] = None,
):
    """Compute delivery scheduling metadata with cutoff-hour logic.

    Rule:
    - Before cutoff: deliver next day (+1).
    - On/after cutoff: add one extra day (+2 total).
    """
    tz_name = str(
        timezone_name
        or os.environ.get('ORDER_DELIVERY_TIMEZONE')
        or os.environ.get('ORDER_EMAIL_TIMEZONE')
        or 'America/Argentina/Buenos_Aires'
    ).strip() or 'America/Argentina/Buenos_Aires'
    cutoff = _normalize_cutoff_hour(
        cutoff_hour if cutoff_hour is not None else os.environ.get('ORDER_CUTOFF_HOUR', 18),
        default_value=18,
    )
    base_utc = now_utc or datetime.datetime.now(datetime.timezone.utc)
    if base_utc.tzinfo is None:
        base_utc = base_utc.replace(tzinfo=datetime.timezone.utc)

    try:
        tzinfo = ZoneInfo(tz_name)
    except Exception:
        tz_name = 'UTC'
        tzinfo = datetime.timezone.utc

    local_now = base_utc.astimezone(tzinfo)
    cutoff_applied = local_now.hour >= cutoff
    days_to_add = 2 if cutoff_applied else 1
    scheduled_date = (local_now + datetime.timedelta(days=days_to_add)).date().isoformat()
    return {
        'scheduled_delivery_date': scheduled_date,
        'delivery_cutoff_applied': bool(cutoff_applied),
        'delivery_timezone': tz_name,
        'delivery_cutoff_hour': int(cutoff),
    }


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


def _extract_missing_column_from_error(msg: str) -> Optional[str]:
    try:
        raw = str(msg or '')
        if not raw:
            return None
        patterns = (
            r'column\s+"([^"]+)"',
            r"column\s+'([^']+)'",
            r"unknown column\s+'([^']+)'",
            r'no such column:\s*([A-Za-z0-9_]+)',
        )
        for pattern in patterns:
            m = re.search(pattern, raw, flags=re.IGNORECASE)
            if m and m.group(1):
                return str(m.group(1)).strip()
        return None
    except Exception:
        return None


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


def _orders_items_char_limit(columns_meta) -> Optional[int]:
    """Infer max character length for orders.items when DB uses VARCHAR."""
    try:
        cols = columns_meta or []
        for col in cols:
            try:
                if str(col.get('name') or '').strip().lower() != 'items':
                    continue
                ctype = col.get('type')
                length = getattr(ctype, 'length', None)
                if isinstance(length, int) and length > 0:
                    return int(length)
                ctype_txt = str(ctype or '').lower()
                m = re.search(r'varchar\((\d+)\)', ctype_txt)
                if m:
                    return int(m.group(1))
            except Exception:
                continue
        return None
    except Exception:
        return None


def _compact_order_item_for_storage(item, include_meta: bool = True):
    out = {}
    try:
        out['id'] = str((item or {}).get('id', '')).strip()[:80]
    except Exception:
        out['id'] = ''
    try:
        qty_val = float((item or {}).get('qty', 1) or 1)
    except Exception:
        qty_val = 1.0
    out['qty'] = qty_val

    if not include_meta:
        return out

    try:
        meta = (item or {}).get('meta')
    except Exception:
        meta = None
    if not isinstance(meta, dict) or not meta:
        return out

    keep = (
        'name', 'price', 'code', 'codigo',
        'unit_type', 'sale_unit', 'kg_per_unit', 'ordered_weight_kg',
        'qty_label', 'key', 'consumo', 'force_regular', 'price_mode',
        'promo_id', 'consumo_id',
    )
    compact_meta = {}
    for key in keep:
        if key not in meta:
            continue
        val = meta.get(key)
        if isinstance(val, str):
            max_len = 140 if key in ('name', 'qty_label') else 80
            compact_meta[key] = val[:max_len]
        elif isinstance(val, (int, float, bool)) or val is None:
            compact_meta[key] = val
    if compact_meta:
        out['meta'] = compact_meta
    return out


def _serialize_order_items_for_storage(items_list, max_chars: Optional[int] = None) -> str:
    """Serialize items JSON, shrinking metadata when the DB column is constrained."""
    def _dump(payload):
        return _json.dumps(payload, ensure_ascii=False, separators=(',', ':'))

    try:
        max_len = int(max_chars) if max_chars is not None else None
    except Exception:
        max_len = None
    if max_len is not None and max_len <= 0:
        max_len = None

    safe_items = items_list if isinstance(items_list, list) else []
    candidates = [
        safe_items,
        [_compact_order_item_for_storage(it, include_meta=True) for it in safe_items],
        [_compact_order_item_for_storage(it, include_meta=False) for it in safe_items],
    ]

    for candidate in candidates:
        try:
            payload = candidate if isinstance(candidate, list) else []
            dumped = _dump(payload)
            if max_len is None or len(dumped) <= max_len:
                return dumped
        except Exception:
            continue

    # Hard-cap fallback: keep as many minimal rows as fit.
    minimal = candidates[-1] if isinstance(candidates[-1], list) else []
    if max_len is None:
        return _dump(minimal)

    fitted = []
    for row in minimal:
        trial = fitted + [row]
        trial_dumped = _dump(trial)
        if len(trial_dumped) <= max_len:
            fitted = trial
            continue
        break

    if len(fitted) < len(minimal):
        truncated = max(0, len(minimal) - len(fitted))
        marker = {'id': '__truncated__', 'qty': float(truncated)}
        trial = fitted + [marker]
        while trial and len(_dump(trial)) > max_len:
            trial.pop()
        fitted = trial

    if fitted:
        return _dump(fitted)
    return _dump([])


def get_products(db: Session, skip: int = 0, limit: int = 100, q: Optional[str]=None, category: Optional[str]=None, active: Optional[bool]=None, sort: Optional[str]=None) -> List[models.Product]:
    try:
        try:
            _ensure_product_columns(db)
        except Exception:
            pass
        query = db.query(models.Product)
        if q:
            needle = f"%{str(q).strip()}%"
            query = query.filter(
                or_(
                    models.Product.name.ilike(needle),
                    models.Product.description.ilike(needle),
                    models.Product.code.ilike(needle),
                )
            )
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
        if 'code' in existing:
            cols.append('code')
        if 'price_retail' in existing:
            cols.append('price_retail')
        # only include optional columns if they exist
        if 'stock' in existing:
            cols.append('stock')
        if 'stock_kg' in existing:
            cols.append('stock_kg')
        if 'kg_per_unit' in existing:
            cols.append('kg_per_unit')
        if 'discount' in existing:
            cols.append('discount')
        if 'sale_unit' in existing:
            cols.append('sale_unit')
        cols_sql = ', '.join(cols)
        where = []
        params = {'skip': skip, 'limit': limit}
        if q:
            match_parts = ["LOWER(COALESCE(name, '')) LIKE :q", "LOWER(COALESCE(description, '')) LIKE :q"]
            if 'code' in existing:
                match_parts.append("LOWER(COALESCE(code, '')) LIKE :q")
            where.append("(" + " OR ".join(match_parts) + ")")
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

def _ensure_product_columns(db: Session, existing_cols: Optional[set] = None) -> set:
    """Best-effort runtime migration for product columns used by admin/catalog."""
    try:
        bind = db.get_bind()
        insp = inspect(bind)
        existing = set(existing_cols) if existing_cols else {c['name'] for c in insp.get_columns('products')}
    except Exception:
        existing = set(existing_cols) if existing_cols else set()
    try:
        bind = db.get_bind()
        dialect = getattr(bind, 'dialect', None)
        dialect_name = getattr(dialect, 'name', '') if dialect else 'sqlite'
    except Exception:
        dialect_name = 'sqlite'

    col_defs = {
        'code': 'VARCHAR(100)',
        'stock': 'INTEGER DEFAULT 0',
        'stock_kg': 'REAL DEFAULT 0',
        'kg_per_unit': 'REAL DEFAULT 1',
        'discount': 'REAL DEFAULT 0',
        'sale_unit': "VARCHAR(20) DEFAULT 'unit'",
        'price_retail': 'REAL',
    }

    for col, coltype in col_defs.items():
        if col in existing:
            continue
        try:
            if 'postgres' in dialect_name:
                try:
                    _safe_execute(db, f"ALTER TABLE products ADD COLUMN IF NOT EXISTS {col} {coltype}")
                except Exception:
                    _safe_execute(db, f"ALTER TABLE products ADD COLUMN {col} {coltype}")
            else:
                _safe_execute(db, f"ALTER TABLE products ADD COLUMN {col} {coltype}")
            try:
                db.commit()
            except Exception:
                pass
            existing.add(col)
            logger.info('Created missing products column at runtime: %s', col)
        except Exception as e:
            logger.warning('Could not create missing products column %s: %s', col, e)
            try:
                db.rollback()
            except Exception:
                pass
    return existing

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
        existing_cols = {'id', 'code', 'name', 'price', 'description', 'category', 'image_url', 'active', 'created_at', 'updated_at', 'stock', 'stock_kg', 'kg_per_unit', 'discount', 'sale_unit', 'price_retail'}
    
    existing_cols = _ensure_product_columns(db, existing_cols)
    logger.info('Existing columns: %s', existing_cols)
    
    # Build column list - only use columns that exist
    sale_unit = str(getattr(payload, 'sale_unit', None) or 'unit').strip().lower()
    if sale_unit not in ('kg', 'unit'):
        sale_unit = 'unit'
    raw_stock = getattr(payload, 'stock', 0)
    raw_stock_kg = getattr(payload, 'stock_kg', None)
    raw_kg_per_unit = getattr(payload, 'kg_per_unit', None)
    try:
        stock_int = int(float(raw_stock or 0))
    except Exception:
        stock_int = 0
    try:
        stock_kg = float(raw_stock_kg) if raw_stock_kg is not None else float(raw_stock or 0)
    except Exception:
        stock_kg = float(stock_int)
    try:
        kg_per_unit = float(raw_kg_per_unit) if raw_kg_per_unit is not None else 1.0
    except Exception:
        kg_per_unit = 1.0
    if kg_per_unit <= 0:
        kg_per_unit = 1.0

    raw_price_retail = getattr(payload, 'price_retail', None)
    try:
        price_retail = float(raw_price_retail) if raw_price_retail is not None else None
    except Exception:
        price_retail = None

    data = {
        'code': str(getattr(payload, 'code', '') or '').strip() or None,
        'name': payload.name,
        'price': payload.price,
        'price_retail': price_retail,
        'description': payload.description or '',
        'category': payload.category or '',
        'image_url': payload.image_url or '',
        'active': payload.active,
        'stock': stock_int,
        'stock_kg': stock_kg,
        'kg_per_unit': kg_per_unit,
        'discount': getattr(payload, 'discount', 0.0),
        'sale_unit': sale_unit
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
        try:
            bind = db.get_bind()
            insp = inspect(bind)
            existing = {c['name'] for c in insp.get_columns('products')}
        except Exception:
            existing = set()
        # Build an explicit column list that includes optional fields only when present.
        cols = ['id', 'name', 'price', 'description', 'category', 'image_url', 'active', 'created_at', 'updated_at']
        if 'code' in existing:
            cols.append('code')
        if 'price_retail' in existing:
            cols.append('price_retail')
        if 'stock' in existing:
            cols.append('stock')
        if 'stock_kg' in existing:
            cols.append('stock_kg')
        if 'kg_per_unit' in existing:
            cols.append('kg_per_unit')
        if 'discount' in existing:
            cols.append('discount')
        if 'sale_unit' in existing:
            cols.append('sale_unit')
        cols_sql = ', '.join(cols)
        result = _safe_execute_fetchone(db, f'SELECT {cols_sql} FROM products WHERE name = :name ORDER BY created_at DESC LIMIT 1', {'name': payload.name})

        if result:
            logger.info('Fetched product id=%s', result[0])
            # Unpack in correct order and return plain dict (avoid SimpleNamespace so callers can use .get())
            obj = {cols[i]: result[i] for i in range(len(cols))}
            # coerce numeric types
            obj['price'] = float(obj.get('price') or 0.0)
            if 'price_retail' in obj:
                try:
                    obj['price_retail'] = float(obj.get('price_retail')) if obj.get('price_retail') is not None else None
                except Exception:
                    obj['price_retail'] = None
            obj['stock'] = int(obj.get('stock') or 0)
            if 'stock_kg' in obj:
                try:
                    obj['stock_kg'] = float(obj.get('stock_kg') or 0.0)
                except Exception:
                    obj['stock_kg'] = 0.0
            if 'kg_per_unit' in obj:
                try:
                    obj['kg_per_unit'] = float(obj.get('kg_per_unit') or 1.0)
                except Exception:
                    obj['kg_per_unit'] = 1.0
            obj['discount'] = float(obj.get('discount') or 0.0)
            if 'sale_unit' in obj:
                obj['sale_unit'] = obj.get('sale_unit') or 'unit'
            obj['active'] = bool(obj.get('active')) if 'active' in obj else False
            return obj
    except Exception as e:
        logger.exception('Could not fetch product: %s', e)
    
    # Worst case: return a plain dict with input data
    try:
        fallback_price_retail = float(getattr(payload, 'price_retail')) if getattr(payload, 'price_retail', None) is not None else None
    except Exception:
        fallback_price_retail = None
    return {
        'id': None,
        'code': str(getattr(payload, 'code', '') or '').strip() or None,
        'name': payload.name,
        'price': float(payload.price) if getattr(payload, 'price', None) is not None else 0.0,
        'price_retail': fallback_price_retail,
        'stock': int(getattr(payload, 'stock', 0) or 0),
        'stock_kg': float(getattr(payload, 'stock_kg', getattr(payload, 'stock', 0)) or 0.0),
        'kg_per_unit': float(getattr(payload, 'kg_per_unit', 1.0) or 1.0),
        'discount': float(getattr(payload, 'discount', 0.0) or 0.0),
        'description': payload.description,
        'category': payload.category,
        'image_url': payload.image_url,
        'active': bool(getattr(payload, 'active', True)),
        'sale_unit': getattr(payload, 'sale_unit', None) or 'unit'
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
        if 'code' in existing:
            cols.append('code')
        if 'price_retail' in existing:
            cols.append('price_retail')
        if 'stock' in existing:
            cols.append('stock')
        if 'stock_kg' in existing:
            cols.append('stock_kg')
        if 'kg_per_unit' in existing:
            cols.append('kg_per_unit')
        if 'discount' in existing:
            cols.append('discount')
        if 'sale_unit' in existing:
            cols.append('sale_unit')
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
    existing = _ensure_product_columns(db, existing)

    if 'price_retail' in updates:
        try:
            updates['price_retail'] = float(updates['price_retail']) if updates['price_retail'] is not None else None
        except Exception:
            updates.pop('price_retail', None)
    if 'code' in updates:
        try:
            updates['code'] = str(updates['code']).strip() if updates['code'] is not None else None
            if updates['code'] == '':
                updates['code'] = None
        except Exception:
            updates.pop('code', None)

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
    if 'code' in existing:
        cols.append('code')
    if 'price_retail' in existing:
        cols.append('price_retail')
    if 'stock' in existing:
        cols.append('stock')
    if 'stock_kg' in existing:
        cols.append('stock_kg')
    if 'kg_per_unit' in existing:
        cols.append('kg_per_unit')
    if 'discount' in existing:
        cols.append('discount')
    if 'sale_unit' in existing:
        cols.append('sale_unit')
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

def _get_item_unit(it):
    try:
        meta = it.get('meta') if isinstance(it, dict) else None
        if isinstance(meta, dict):
            return str(meta.get('unit_type') or meta.get('sale_unit') or meta.get('unit') or '').lower()
    except Exception:
        pass
    return ''

def _is_kg_item(it):
    u = _get_item_unit(it)
    return u in ('kg', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramo', 'kilogramos')


def _to_float(value, default=0.0):
    try:
        v = float(value)
        if v != v:  # NaN
            return default
        return v
    except Exception:
        return default


def _product_kg_per_unit(prod):
    try:
        v = _to_float(getattr(prod, 'kg_per_unit', None), 1.0)
        return v if v > 0 else 1.0
    except Exception:
        return 1.0


def _item_kg_per_unit(it, prod=None):
    try:
        meta = it.get('meta') if isinstance(it, dict) else None
        if isinstance(meta, dict):
            v = _to_float(meta.get('kg_per_unit'), None)
            if v is not None and v > 0:
                return v
    except Exception:
        pass
    if prod is not None:
        return _product_kg_per_unit(prod)
    return 1.0


def _item_requested_weight_kg(it, prod=None):
    try:
        meta = it.get('meta') if isinstance(it, dict) else None
        if isinstance(meta, dict):
            explicit = _to_float(meta.get('ordered_weight_kg'), None)
            if explicit is not None and explicit > 0:
                return explicit
    except Exception:
        pass
    qty = _to_float((it or {}).get('qty', 1), 1.0) if isinstance(it, dict) else 1.0
    if qty < 0:
        qty = 0.0
    return qty * _item_kg_per_unit(it, prod)


def _product_stock_kg(prod):
    try:
        v = _to_float(getattr(prod, 'stock_kg', None), None)
        if v is not None and v > 0:
            return v
    except Exception:
        pass
    # Legacy/backfill fallback: if stock_kg is unavailable (or still zero) fallback to stock.
    fallback = max(0.0, _to_float(getattr(prod, 'stock', 0), 0.0))
    if fallback > 0:
        return fallback
    try:
        v = _to_float(getattr(prod, 'stock_kg', 0), 0.0)
        return max(0.0, v)
    except Exception:
        return 0.0

def prealloc_consumos(items_list_input, catalog_dir_override=None):
    """Best-effort pre-allocation of consumos from catalogo/consumos.json.
    Returns (items_list, pre_alloc_flag, consumos_map)
    """
    try:
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
        catalog_dir_local = catalog_dir_override or os.environ.get('CATALOG_DIR') or os.path.join(root_dir, 'catalogo')
        consumos_path_local = os.path.join(catalog_dir_local, 'consumos.json')
        consumos_map_local = {}
        if os.path.exists(consumos_path_local):
            with open(consumos_path_local, 'r', encoding='utf-8') as f:
                c_list = _json.load(f) or []
                for c in c_list:
                    try:
                        cid = int(c.get('id'))
                        qty_c = int(c.get('qty', 0) or 0)
                        consumos_map_local[cid] = qty_c
                    except Exception:
                        continue
        pre_alloc = False
        try:
            alloc_map_local = {}
            for it in items_list_input:
                try:
                    pid = int(it.get('id'))
                    if _is_kg_item(it):
                        continue
                    raw_qty = it.get('qty', 1)
                    qty_req = int(float(raw_qty)) if raw_qty is not None else 1
                except Exception:
                    continue
                # Respect explicit flags: if item is marked regular, skip consumo allocation
                try:
                    meta = it.get('meta') if isinstance(it, dict) else None
                    if isinstance(meta, dict):
                        if meta.get('force_regular') is True:
                            continue
                        if meta.get('consumo') is False:
                            continue
                except Exception:
                    pass
                avail = int(consumos_map_local.get(pid, 0) or 0)
                take = min(avail, qty_req)
                if take > 0:
                    alloc_map_local[pid] = alloc_map_local.get(pid, 0) + take
                    consumos_map_local[pid] = max(0, avail - take)
                    try:
                        if not isinstance(it.get('meta'), dict):
                            it['meta'] = {}
                        it['meta']['consumo_consumed'] = take
                        it['meta']['consumo'] = True
                    except Exception:
                        pass
            if alloc_map_local:
                pre_alloc = True
        except Exception:
            pass
        return items_list_input, pre_alloc, consumos_map_local
    except Exception:
        return items_list_input, False, {}


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
                od = {
                    'id': str(getattr(o, 'id', o.get('id') if isinstance(o, dict) else None)),
                    'qty': float(getattr(o, 'qty', o.get('qty', 1) if isinstance(o, dict) else 1)),
                    'meta': getattr(o, 'meta', o.get('meta') if isinstance(o, dict) else {})
                }
            # coerce types
            od['id'] = str(od.get('id', ''))
            try:
                od['qty'] = float(od.get('qty', 1))
            except Exception:
                od['qty'] = 1.0
            if 'meta' not in od or od['meta'] is None:
                od['meta'] = {}
            # If the client sent a consumo key, ensure the meta flag is preserved
            try:
                meta_obj = od.get('meta')
                if isinstance(meta_obj, dict):
                    key_val = meta_obj.get('key') or od.get('key')
                    if key_val and ':consumo' in str(key_val):
                        if meta_obj.get('force_regular') is not True and meta_obj.get('consumo') is not False:
                            meta_obj['consumo'] = True
                    od['meta'] = meta_obj
            except Exception:
                pass
            items_list.append(od)
    except Exception:
        items_list = []

    items_json = _serialize_order_items_for_storage(items_list, max_chars=None)

    # Validate stock availability: consider near-expiry consumos and total stock.
    # Read consumos.json to get available near-expiry quantities (best-effort, file may not exist).
    try:
        # Extracted to helper for testability
        def _prealloc_consumos(items_list_input, catalog_dir_override=None):
            try:
                root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
                catalog_dir_local = catalog_dir_override or os.environ.get('CATALOG_DIR') or os.path.join(root_dir, 'catalogo')
                consumos_path_local = os.path.join(catalog_dir_local, 'consumos.json')
                consumos_map_local = {}
                if os.path.exists(consumos_path_local):
                    with open(consumos_path_local, 'r', encoding='utf-8') as f:
                        c_list = _json.load(f) or []
                        for c in c_list:
                            try:
                                cid = int(c.get('id'))
                                qty_c = int(c.get('qty', 0) or 0)
                                consumos_map_local[cid] = qty_c
                            except Exception:
                                continue
                pre_alloc = False
                try:
                    alloc_map_local = {}
                    for it in items_list_input:
                        try:
                            pid = int(it.get('id'))
                            if _is_kg_item(it):
                                continue
                            raw_qty = it.get('qty', 1)
                            qty_req = int(float(raw_qty)) if raw_qty is not None else 1
                        except Exception:
                            continue
                        # Respect explicit flags: if item is marked regular, skip consumo allocation
                        try:
                            meta = it.get('meta') if isinstance(it, dict) else None
                            if isinstance(meta, dict):
                                if meta.get('force_regular') is True:
                                    continue
                                if meta.get('consumo') is False:
                                    continue
                        except Exception:
                            pass
                        avail = int(consumos_map_local.get(pid, 0) or 0)
                        take = min(avail, qty_req)
                        if take > 0:
                            alloc_map_local[pid] = alloc_map_local.get(pid, 0) + take
                            consumos_map_local[pid] = max(0, avail - take)
                            try:
                                if not isinstance(it.get('meta'), dict):
                                    it['meta'] = {}
                                it['meta']['consumo_consumed'] = take
                                it['meta']['consumo'] = True
                            except Exception:
                                pass
                    if alloc_map_local:
                        pre_alloc = True
                except Exception:
                    pass
                return items_list_input, pre_alloc, consumos_map_local
            except Exception:
                return items_list_input, False, {}

        items_list, pre_alloc_consumos, consumos_map = _prealloc_consumos(items_list)
        try:
            items_json = _serialize_order_items_for_storage(items_list, max_chars=None)
        except Exception:
            pass
    except Exception:
        pre_alloc_consumos = False
        consumos_map = {}

    try:
        for it in items_list:
            try:
                pid = int(it.get('id'))
            except Exception:
                pid = None
            if pid is None:
                continue
            raw_qty = it.get('qty', 1)
            try:
                qty_req = float(raw_qty) if raw_qty is not None else 1.0
            except Exception:
                qty_req = 1.0
            # For unit-based products keep integer semantics
            if not _is_kg_item(it):
                try:
                    qty_req = int(qty_req)
                except Exception:
                    qty_req = 1
            prod = db.query(models.Product).filter(models.Product.id == pid).first()
            if prod is None:
                continue
            if _is_kg_item(it):
                req_kg = _item_requested_weight_kg(it, prod)
                avail_kg = _product_stock_kg(prod)
                if req_kg > avail_kg + 1e-9:
                    raise HTTPException(status_code=400, detail='actualmente no contamos con stock de este articulo')
                continue
            # nearest-expiry available
            near_avail = int((consumos_map or {}).get(pid, 0) or 0)
            # stock may be None (unknown) or numeric
            stock_attr = getattr(prod, 'stock', None)
            if stock_attr is None:
                # If stock unknown, allow order as long as near-expiry covers it; otherwise allow (do not block) to avoid preventing orders
                if near_avail >= qty_req:
                    continue
                else:
                    # stock unknown and near-expiry insufficient -> allow (do not block)
                    continue
            else:
                try:
                    stock_avail = int(stock_attr or 0)
                except Exception:
                    stock_avail = 0
                if (near_avail + stock_avail) < qty_req:
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
    # ensure total is numeric
    try:
        total_val = float(getattr(payload, 'total', 0) or 0)
    except Exception:
        total_val = 0.0

    # Compute delivery schedule snapshot with cutoff-hour rule.
    try:
        delivery_schedule = _compute_delivery_schedule_snapshot()
    except Exception:
        delivery_schedule = {
            'scheduled_delivery_date': None,
            'delivery_cutoff_applied': None,
            'delivery_timezone': None,
            'delivery_cutoff_hour': None,
        }


    # --- FUERZA source a 'app' o 'web' ---
    # Si el payload no trae source, o viene como None, o string vacío, se fuerza a 'web' (o 'app' si se detecta)
    src = getattr(payload, 'source', None)
    if not src or not str(src).strip():
        # Heurística: si el payload tiene un campo user_agent o similar, podrías inferir aquí, pero para robustez, default 'web'
        src = 'web'
    src = str(src).strip().lower()
    if src not in ('app', 'web'):
        src = 'web'

    customer_type = getattr(payload, 'customer_type', None)
    if not customer_type or not str(customer_type).strip():
        customer_type = 'mayorista'
    customer_type = str(customer_type).strip().lower()
    if customer_type not in ('mayorista', 'minorista'):
        customer_type = 'mayorista'

    kwargs = {
        'items': items_json,
        'total': total_val,
        'status': 'nuevo',
        'source': src,
        'customer_type': customer_type,
        'scheduled_delivery_date': delivery_schedule.get('scheduled_delivery_date'),
        'delivery_cutoff_applied': delivery_schedule.get('delivery_cutoff_applied'),
        'delivery_timezone': delivery_schedule.get('delivery_timezone'),
        'delivery_cutoff_hour': delivery_schedule.get('delivery_cutoff_hour'),
    }
    # Mark that this order included pre-allocated consumos (best-effort flag)
    try:
        if 'pre_alloc_consumos' in locals() and pre_alloc_consumos:
            kwargs['contains_consumos'] = True
    except Exception:
        pass
    optional = [
        'source',
        'customer_type',
        'user_id', 'user_full_name', 'user_email', 'user_barrio', 'user_calle', 'user_numeracion', 'user_postal_code', 'user_department',
        '_token_received', '_token_preview',
        'payment_method', 'payment_status', 'payment_reference',
        'scheduled_delivery_date', 'delivery_cutoff_applied', 'delivery_timezone', 'delivery_cutoff_hour',
        'contains_consumos',
    ]
    try:
        bind = db.get_bind()
        insp = inspect(bind)
        order_columns = insp.get_columns('orders')
        existing_cols = {c['name'] for c in order_columns}
    except Exception:
        order_columns = []
        existing_cols = set()

    try:
        items_char_limit = _orders_items_char_limit(order_columns)
    except Exception:
        items_char_limit = None
    try:
        items_json = _serialize_order_items_for_storage(items_list, max_chars=items_char_limit)
    except Exception:
        try:
            items_json = _serialize_order_items_for_storage(items_list, max_chars=None)
        except Exception:
            items_json = _json.dumps(items_list, ensure_ascii=False)
    kwargs['items'] = items_json

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

    try:
        ct_raw = kwargs.get('customer_type')
        ct_norm = str(ct_raw).strip().lower() if ct_raw is not None else ''
        kwargs['customer_type'] = ct_norm if ct_norm in ('mayorista', 'minorista') else customer_type
    except Exception:
        kwargs['customer_type'] = customer_type

    # Normalize payment snapshot values to stable enums.
    try:
        pm_raw = kwargs.get('payment_method')
        pm_norm = None
        if pm_raw is not None:
            pm = str(pm_raw).strip().lower()
            if pm in ('mercadopago', 'mp', 'mercado_pago'):
                pm_norm = 'mercadopago'
            elif pm in ('cash', 'efectivo'):
                pm_norm = 'cash'
        if pm_norm:
            kwargs['payment_method'] = pm_norm
        else:
            kwargs.pop('payment_method', None)

        ps_raw = kwargs.get('payment_status')
        if ps_raw is None and pm_norm == 'mercadopago':
            kwargs['payment_status'] = 'mp_pending'
        elif ps_raw is None and pm_norm == 'cash':
            kwargs['payment_status'] = 'cash_pending'
        elif ps_raw is not None:
            ps = str(ps_raw).strip().lower()
            if ps:
                kwargs['payment_status'] = ps
            else:
                kwargs.pop('payment_status', None)

        pr_raw = kwargs.get('payment_reference')
        if pr_raw is not None:
            pr = str(pr_raw).strip()
            if pr:
                kwargs['payment_reference'] = pr[:200]
            else:
                kwargs.pop('payment_reference', None)
    except Exception:
        pass

    # Keep delivery scheduling server-authoritative even if client sends overrides.
    try:
        kwargs['scheduled_delivery_date'] = delivery_schedule.get('scheduled_delivery_date')
        kwargs['delivery_cutoff_applied'] = delivery_schedule.get('delivery_cutoff_applied')
        kwargs['delivery_timezone'] = delivery_schedule.get('delivery_timezone')
        kwargs['delivery_cutoff_hour'] = delivery_schedule.get('delivery_cutoff_hour')
    except Exception:
        pass

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
        # Always ensure required columns are present. If we know the DB schema
        # and a required column is missing there, do not force it.
        for req in ('items', 'total', 'status'):
            if req not in kwargs:
                continue
            if existing_cols and req not in existing_cols:
                continue
            if req not in insert_cols:
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
            if 'postgres' in dialect_name and 'items' in params:
                params['items'] = kwargs.get('items')
        except Exception:
            pass

        # Execute via Session.execute so it participates in the session transaction
        res = _safe_execute(db, sql, params)
        # Consume near-expiry quantities first (from consumos.json), then decrement DB stock for remaining units.
        updated_product_ids = set()
        consumed_map = {}
        try:
            # Re-load consumos file (best-effort snapshot from disk)
            root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
            catalog_dir = os.environ.get('CATALOG_DIR') or os.path.join(root_dir, 'catalogo')
            consumos_path = os.path.join(catalog_dir, 'consumos.json')
            consumos_disk = {}
            try:
                if os.path.exists(consumos_path):
                    with open(consumos_path, 'r', encoding='utf-8') as f:
                        _cl = _json.load(f) or []
                        for c in _cl:
                            try:
                                cid = int(c.get('id'))
                                consumos_disk[cid] = int(c.get('qty', 0) or 0)
                            except Exception:
                                continue
            except Exception:
                consumos_disk = {}
            for it in items_list:
                try:
                    pid = int(it.get('id'))
                except Exception:
                    pid = None
                if pid is None:
                    continue
                raw_qty = it.get('qty', 1)
                try:
                    qty = float(raw_qty) if raw_qty is not None else 1.0
                except Exception:
                    qty = 1.0
                if qty <= 0:
                    continue
                # Lock product row when possible so stock updates remain consistent.
                try:
                    prod_row = db.query(models.Product).filter(models.Product.id == pid).with_for_update().first()
                except Exception:
                    prod_row = db.query(models.Product).filter(models.Product.id == pid).first()
                if not prod_row:
                    continue
                # Kg-based stock is stored/decremented in kilograms.
                if _is_kg_item(it):
                    req_kg = _item_requested_weight_kg(it, prod_row)
                    if req_kg <= 0:
                        continue
                    avail_kg = _product_stock_kg(prod_row)
                    if avail_kg < req_kg - 1e-9:
                        raise HTTPException(status_code=400, detail='actualmente no contamos con stock de este articulo')
                    new_stock_kg = max(0.0, avail_kg - req_kg)
                    try:
                        setattr(prod_row, 'stock_kg', new_stock_kg)
                    except Exception:
                        pass
                    # Keep legacy integer stock roughly in sync for old views.
                    try:
                        if getattr(prod_row, 'stock', None) is not None:
                            prod_row.stock = int(round(new_stock_kg))
                    except Exception:
                        pass
                    db.add(prod_row)
                    updated_product_ids.add(pid)
                    continue
                try:
                    qty = int(qty)
                except Exception:
                    qty = 1
                # First: take from consumos (near-expiry) only when item is flagged as consumo
                try:
                    meta = it.get('meta') if isinstance(it, dict) else None
                    if isinstance(meta, dict):
                        if meta.get('force_regular') is True:
                            take_from_consumos = 0
                        elif meta.get('consumo') is False:
                            take_from_consumos = 0
                        else:
                            take_from_consumos = min(consumos_disk.get(pid, 0), qty)
                    else:
                        take_from_consumos = min(consumos_disk.get(pid, 0), qty)
                except Exception:
                    take_from_consumos = min(consumos_disk.get(pid, 0), qty)
                if take_from_consumos > 0:
                    consumed_map[pid] = consumed_map.get(pid, 0) + take_from_consumos
                remaining = qty - take_from_consumos
                if remaining <= 0:
                    continue
                # Then: decrement DB stock when available (row-lock when supported)
                stock_attr = getattr(prod_row, 'stock', None)
                if stock_attr is None:
                    # stock unknown: allow remaining (do not block or decrement)
                    continue
                try:
                    avail = int(stock_attr or 0)
                except Exception:
                    avail = 0
                if avail < remaining:
                    raise HTTPException(status_code=400, detail='actualmente no contamos con stock de este articulo')
                prod_row.stock = avail - remaining
                db.add(prod_row)
                updated_product_ids.add(pid)
        except HTTPException:
            raise
        except Exception:
            logger.exception('Stock/consumos decrement step failed; continuing')
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
            optional_cols = [
                'customer_type',
                'user_id', 'user_full_name', 'user_email', 'user_barrio', 'user_calle', 'user_numeracion', 'user_postal_code', 'user_department',
                '_token_received', '_token_preview',
                'payment_method', 'payment_status', 'payment_reference',
                'scheduled_delivery_date', 'delivery_cutoff_applied', 'delivery_timezone', 'delivery_cutoff_hour',
            ]
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
            for f in [
                'customer_type',
                'user_id', 'user_full_name', 'user_email', 'user_barrio', 'user_calle', 'user_numeracion', 'user_postal_code', 'user_department',
                '_token_received', '_token_preview',
                'payment_method', 'payment_status', 'payment_reference',
                'scheduled_delivery_date', 'delivery_cutoff_applied', 'delivery_timezone', 'delivery_cutoff_hour',
            ]:
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
                        for k, label in (
                            ('user_full_name', 'name'),
                            ('user_email', 'email'),
                            ('user_barrio', 'barrio'),
                            ('user_calle', 'calle'),
                            ('user_numeracion', 'numeracion'),
                            ('user_postal_code', 'postal_code'),
                            ('user_department', 'department'),
                        ):
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
        if 'does not exist' in msg or 'UndefinedColumn' in msg or 'unknown column' in msg or 'column "user_' in msg or 'column "payment_' in msg:
            logger.info('Retrying explicit insert without optional user_* fields due to DB schema mismatch')
            for f in optional:
                if f in kwargs:
                    kwargs.pop(f, None)
            # If the DB explicitly reported a missing column, drop it from the
            # retry payload even if it was not part of `optional`.
            try:
                missing_col = _extract_missing_column_from_error(msg)
                if missing_col and missing_col in kwargs:
                    kwargs.pop(missing_col, None)
            except Exception:
                pass
            # Recompute insert_cols
            insert_cols = [c for c in kwargs.keys() if (not existing_cols) or (c in existing_cols)]
            for req in ('items', 'total', 'status'):
                if req not in kwargs:
                    continue
                if existing_cols and req not in existing_cols:
                    continue
                if req not in insert_cols:
                    insert_cols.insert(0, req)
            cols_sql = ', '.join(insert_cols)
            vals_sql = ', '.join(':' + c for c in insert_cols)
            sql = f'INSERT INTO orders ({cols_sql}) VALUES ({vals_sql}){returning}'
            params = {k: kwargs[k] for k in insert_cols}
            try:
                if 'postgres' in dialect_name and 'items' in params:
                    params['items'] = kwargs.get('items')
            except Exception:
                pass
            try:
                res = _safe_execute(db, sql, params)
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
                db.commit()
                if new_id is not None:
                    objd = {
                        'id': new_id,
                        'items': items_list,
                        'total': total_val,
                        'status': kwargs.get('status', 'nuevo'),
                        'created_at': new_created_at
                    }
                    for f in [
                        'customer_type',
                        'user_id', 'user_full_name', 'user_email', 'user_barrio', 'user_calle', 'user_numeracion', 'user_postal_code', 'user_department',
                        '_token_received', '_token_preview',
                        'payment_method', 'payment_status', 'payment_reference',
                        'scheduled_delivery_date', 'delivery_cutoff_applied', 'delivery_timezone', 'delivery_cutoff_hour',
                    ]:
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

    # Build a minimal fallback object if DB retrieval unexpectedly returned None.
    if obj is None:
        try:
            guessed_id = None
            try:
                guessed_id = _safe_scalar(db, "SELECT MAX(id) FROM orders")
            except Exception:
                guessed_id = None
            obj = SimpleNamespace(
                id=int(guessed_id) if guessed_id is not None else 0,
                items=items_list,
                total=total_val,
                status=kwargs.get('status', 'nuevo'),
                source=kwargs.get('source'),
                customer_type=kwargs.get('customer_type'),
            )
        except Exception:
            raise HTTPException(status_code=500, detail='Could not create order')

    # ensure returned object exposes `items` as a Python list (not a JSON string)
    try:
        obj.items = _json.loads(obj.items) if isinstance(obj.items, str) else obj.items
    except Exception:
        obj.items = []
    # Ensure the response object carries recent metadata even when selected via
    # fallback queries that only fetched minimal columns.
    try:
        for _col in (
            'source', 'customer_type',
            'payment_method', 'payment_status', 'payment_reference',
            'scheduled_delivery_date', 'delivery_cutoff_applied', 'delivery_timezone', 'delivery_cutoff_hour',
        ):
            if getattr(obj, _col, None) is None and kwargs.get(_col) is not None:
                setattr(obj, _col, kwargs.get(_col))
    except Exception:
        pass
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
                for k, label in (
                    ('user_full_name', 'name'),
                    ('user_email', 'email'),
                    ('user_barrio', 'barrio'),
                    ('user_calle', 'calle'),
                    ('user_numeracion', 'numeracion'),
                    ('user_postal_code', 'postal_code'),
                    ('user_department', 'department'),
                    ('customer_type', 'customer_type'),
                ):
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
            for col in (
                'user_id','user_full_name','user_email','user_barrio','user_calle','user_numeracion','user_postal_code','user_department',
                '_token_preview','_token_received',
                'payment_method','payment_status','payment_reference',
                'scheduled_delivery_date', 'delivery_cutoff_applied', 'delivery_timezone', 'delivery_cutoff_hour',
            ):
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
        # Attach consumos consumed deltas so higher layer can update consumos.json on-disk
        obj._consumos_consumed = { str(k): int(v) for k, v in (consumed_map.items() if 'consumed_map' in locals() else []) } if 'consumed_map' in locals() else {}
    except Exception:
        pass
    return obj


def create_order_minimal(db: Session, raw_payload: dict, current_user: Optional[dict] = None):
    """Emergency order persistence path.

    Stores a minimal order snapshot without stock-side effects, used only as a
    fallback when the full `create_order` flow raises unexpectedly.
    """
    data = raw_payload if isinstance(raw_payload, dict) else {}
    items_input = data.get('items') if isinstance(data.get('items'), list) else []
    items_list = []
    for it in items_input:
        try:
            if isinstance(it, dict):
                item_id = it.get('id', '')
                item_qty = it.get('qty', 1)
                item_meta = it.get('meta') if isinstance(it.get('meta'), dict) else {}
            else:
                item_id = getattr(it, 'id', '')
                item_qty = getattr(it, 'qty', 1)
                item_meta = getattr(it, 'meta', {}) if isinstance(getattr(it, 'meta', {}), dict) else {}
            items_list.append({
                'id': str(item_id or ''),
                'qty': float(item_qty or 1),
                'meta': item_meta or {},
            })
        except Exception:
            continue

    try:
        total_val = float(data.get('total', 0) or 0)
    except Exception:
        total_val = 0.0

    source = str(data.get('source') or 'web').strip().lower()
    if source not in ('web', 'app'):
        source = 'web'

    customer_type = str(data.get('customer_type') or 'mayorista').strip().lower()
    if customer_type not in ('mayorista', 'minorista'):
        customer_type = 'mayorista'

    kwargs = {
        'items': _serialize_order_items_for_storage(items_list, max_chars=None),
        'total': total_val,
        'status': str(data.get('status') or 'nuevo'),
        'source': source,
        'customer_type': customer_type,
    }

    for fld in (
        'user_id', 'user_full_name', 'user_email', 'user_barrio', 'user_calle', 'user_numeracion', 'user_postal_code', 'user_department',
        '_token_received', '_token_preview',
        'payment_method', 'payment_status', 'payment_reference',
        'scheduled_delivery_date', 'delivery_cutoff_applied', 'delivery_timezone', 'delivery_cutoff_hour',
    ):
        try:
            val = data.get(fld)
        except Exception:
            val = None
        if val is None:
            continue
        if fld == '_token_preview' and not isinstance(val, str):
            try:
                val = _json.dumps(val, ensure_ascii=False)
            except Exception:
                val = str(val)
        kwargs[fld] = val

    # token fallback for missing user snapshot values
    try:
        if current_user and not kwargs.get('user_email'):
            kwargs['user_email'] = current_user.get('email') or current_user.get('sub')
        if current_user and not kwargs.get('user_full_name'):
            kwargs['user_full_name'] = current_user.get('full_name') or current_user.get('name')
    except Exception:
        pass

    try:
        bind = db.get_bind()
        insp = inspect(bind)
        order_columns = insp.get_columns('orders')
        existing_cols = {c['name'] for c in order_columns}
    except Exception:
        order_columns = []
        existing_cols = set()

    try:
        items_char_limit = _orders_items_char_limit(order_columns)
    except Exception:
        items_char_limit = None
    try:
        kwargs['items'] = _serialize_order_items_for_storage(items_list, max_chars=items_char_limit)
    except Exception:
        kwargs['items'] = _serialize_order_items_for_storage(items_list, max_chars=None)

    insert_cols = [c for c in kwargs.keys() if (not existing_cols) or (c in existing_cols)]
    for req in ('items', 'total', 'status'):
        if req in kwargs and (not existing_cols or req in existing_cols) and req not in insert_cols:
            insert_cols.insert(0, req)

    if not insert_cols:
        raise RuntimeError('No columns available for minimal order insert')

    cols_sql = ', '.join(insert_cols)
    vals_sql = ', '.join(':' + c for c in insert_cols)

    bind = db.get_bind()
    dialect_name = getattr(bind, 'dialect', None).name if bind and getattr(bind, 'dialect', None) else ''
    returning = ' RETURNING id, created_at' if 'postgres' in dialect_name else ''
    sql = f'INSERT INTO orders ({cols_sql}) VALUES ({vals_sql}){returning}'

    params = {k: kwargs[k] for k in insert_cols}
    if 'postgres' in dialect_name and 'items' in params:
        params['items'] = kwargs.get('items')

    res = _safe_execute(db, sql, params)
    new_id = None
    new_created_at = None
    if 'postgres' in dialect_name:
        try:
            row = res.fetchone()
            if row is not None:
                new_id = row[0]
                try:
                    new_created_at = row[1]
                except Exception:
                    new_created_at = None
        except Exception:
            new_id = None
            new_created_at = None
    db.commit()

    if new_id is None:
        try:
            new_id = _safe_scalar(db, 'SELECT MAX(id) FROM orders')
        except Exception:
            new_id = 0

    objd = {
        'id': int(new_id or 0),
        'items': items_list,
        'total': total_val,
        'status': kwargs.get('status', 'nuevo'),
        'created_at': new_created_at,
        'source': kwargs.get('source', source),
        'customer_type': kwargs.get('customer_type', customer_type),
    }
    for fld in (
        'user_id', 'user_full_name', 'user_email', 'user_barrio', 'user_calle', 'user_numeracion', 'user_postal_code', 'user_department',
        '_token_received', '_token_preview',
        'payment_method', 'payment_status', 'payment_reference',
        'scheduled_delivery_date', 'delivery_cutoff_applied', 'delivery_timezone', 'delivery_cutoff_hour',
    ):
        if fld in kwargs:
            objd[fld] = kwargs.get(fld)

    return SimpleNamespace(**objd)


def get_orders(
    db: Session,
    skip: int = 0,
    limit: int = 200,
    source: Optional[str] = None,
    q: Optional[str] = None,
    date: Optional[str] = None,
):
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
    optional = [
        'customer_type',
        'user_id', 'user_full_name', 'user_email', 'user_barrio', 'user_calle', 'user_numeracion', 'user_postal_code', 'user_department',
        '_token_received', '_token_preview', 'source',
        'payment_method', 'payment_status', 'payment_reference',
        'scheduled_delivery_date', 'delivery_cutoff_applied', 'delivery_timezone', 'delivery_cutoff_hour',
    ]
    for c in optional:
        if c in existing:
            cols.append(c)

    cols_sql = ', '.join(cols)
    try:
        where = []
        params = {'skip': skip, 'limit': limit}
        if source and 'source' in existing:
            where.append('source = :source')
            params['source'] = source

        date_value = str(date or '').strip()
        if date_value:
            # Supports YYYY-MM-DD date filtering on both sqlite and postgres.
            where.append('DATE(created_at) = :date')
            params['date'] = date_value

        q_raw = str(q or '').strip()
        if q_raw:
            q_no_hash = q_raw[1:].strip() if q_raw.startswith('#') else q_raw
            q_like = f"%{q_raw.lower()}%"
            search_parts = []

            # Exact id match first so searching "1234" brings order #1234 reliably.
            if q_no_hash:
                search_parts.append("CAST(id AS TEXT) = :q_exact")
                params['q_exact'] = q_no_hash
                params['q_exact_lc'] = q_no_hash.lower()
                search_parts.append("LOWER(CAST(id AS TEXT)) = :q_exact_lc")

            # Partial id/name/email/address fallback search.
            params['q_like'] = q_like
            search_parts.append("LOWER(CAST(id AS TEXT)) LIKE :q_like")
            for col_name in (
                'user_full_name',
                'user_email',
                'user_barrio',
                'user_calle',
                'user_numeracion',
                'user_postal_code',
                'user_department',
                'payment_reference',
            ):
                if col_name in existing:
                    search_parts.append(f"LOWER(COALESCE(CAST({col_name} AS TEXT), '')) LIKE :q_like")

            if search_parts:
                where.append('(' + ' OR '.join(search_parts) + ')')

        where_clause = (' WHERE ' + ' AND '.join(where)) if where else ''
        rows = _safe_execute_fetchall(
            db,
            f"SELECT {cols_sql} FROM orders{where_clause} ORDER BY created_at DESC LIMIT :limit OFFSET :skip",
            params,
        )
    except Exception:
        logger.exception('get_orders raw select failed')
        # As a last resort try the ORM query (may raise too); let caller see a handled error
        try:
            query = db.query(models.Order)
            if source and hasattr(models.Order, 'source'):
                query = query.filter(models.Order.source == source)
            orm_rows = query.order_by(models.Order.created_at.desc()).offset(skip).limit(limit).all()
            q_raw = str(q or '').strip().lower()
            if q_raw:
                q_no_hash = q_raw[1:].strip() if q_raw.startswith('#') else q_raw
                filtered = []
                for row in orm_rows:
                    try:
                        row_id = str(getattr(row, 'id', '') or '').strip().lower()
                        row_blob = ' '.join([
                            row_id,
                            str(getattr(row, 'user_full_name', '') or '').strip().lower(),
                            str(getattr(row, 'user_email', '') or '').strip().lower(),
                            str(getattr(row, 'user_barrio', '') or '').strip().lower(),
                            str(getattr(row, 'user_calle', '') or '').strip().lower(),
                            str(getattr(row, 'user_numeracion', '') or '').strip().lower(),
                            str(getattr(row, 'user_postal_code', '') or '').strip().lower(),
                            str(getattr(row, 'user_department', '') or '').strip().lower(),
                            str(getattr(row, 'payment_reference', '') or '').strip().lower(),
                        ])
                        if (q_no_hash and row_id == q_no_hash) or (q_raw in row_blob):
                            filtered.append(row)
                    except Exception:
                        continue
                orm_rows = filtered
            date_value = str(date or '').strip()
            if date_value:
                orm_rows = [
                    row for row in orm_rows
                    if str(getattr(row, 'created_at', '') or '').strip()[:10] == date_value
                ]
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


def _clean_address_str(value, max_len: int = 200) -> str:
    try:
        text_value = str(value or '').strip()
    except Exception:
        text_value = ''
    if not text_value:
        return ''
    return re.sub(r'\s+', ' ', text_value).strip()[:max_len]


def _clean_address_id(value) -> str:
    candidate = _clean_address_str(value, 80)
    if candidate:
        return candidate
    return f"addr-{uuid.uuid4().hex[:18]}"


def _address_storage_id(user_id: int, client_id: str) -> str:
    return f"{int(user_id)}:{_clean_address_id(client_id)}"


def _address_client_id(raw_id: str, user_id: int) -> str:
    rid = str(raw_id or '').strip()
    prefix = f"{int(user_id)}:"
    if rid.startswith(prefix):
        return rid[len(prefix):] or rid
    return rid


def _clean_address_float(value):
    try:
        if value is None or value == '':
            return None
        if isinstance(value, str):
            value = value.strip().replace(',', '.')
        n = float(value)
        if not (-180.0 <= n <= 180.0):
            return None
        return round(n, 6)
    except Exception:
        return None


def _normalize_user_address_payload(item):
    if not item:
        return None
    if hasattr(item, 'dict'):
        try:
            item = item.dict()
        except Exception:
            item = {}
    if not isinstance(item, dict):
        return None

    barrio = _clean_address_str(item.get('barrio'), 200)
    calle = _clean_address_str(item.get('calle'), 200)
    numeracion = _clean_address_str(item.get('numeracion'), 100)
    if not barrio or not calle or not numeracion:
        return None

    return {
        'id': _clean_address_id(item.get('id')),
        'label': _clean_address_str(item.get('label'), 80) or None,
        'notes': _clean_address_str(item.get('notes'), 240) or None,
        'barrio': barrio,
        'calle': calle,
        'numeracion': numeracion,
        'postal_code': _clean_address_str(item.get('postal_code'), 20) or None,
        'department': _clean_address_str(item.get('department'), 120) or None,
        'query_hint': _clean_address_str(item.get('query_hint'), 200) or None,
        'full_text': _clean_address_str(item.get('full_text'), 300) or None,
        'lat': _clean_address_float(item.get('lat')),
        'lon': _clean_address_float(item.get('lon')),
        'is_default': bool(item.get('is_default')),
    }


def list_user_addresses(db: Session, user_id: int):
    return db.query(models.UserAddress).filter(
        models.UserAddress.user_id == int(user_id)
    ).order_by(
        models.UserAddress.is_default.desc(),
        models.UserAddress.created_at.desc(),
        models.UserAddress.id.asc(),
    ).all()


def ensure_user_primary_address(db: Session, user: models.User):
    try:
        if not user:
            return
        user_id = int(getattr(user, 'id'))
        has_rows = db.query(models.UserAddress).filter(models.UserAddress.user_id == user_id).first()
        if has_rows:
            return
        barrio = _clean_address_str(getattr(user, 'barrio', None), 200)
        calle = _clean_address_str(getattr(user, 'calle', None), 200)
        numeracion = _clean_address_str(getattr(user, 'numeracion', None), 100)
        if not (barrio and calle and numeracion):
            return
        row = models.UserAddress(
            id=f'profile-{user_id}',
            user_id=user_id,
            label='Principal',
            notes=None,
            barrio=barrio,
            calle=calle,
            numeracion=numeracion,
            postal_code=None,
            department=None,
            query_hint=f'{calle} {numeracion}, {barrio}',
            full_text=f'{calle} {numeracion}, {barrio}, Mendoza, Argentina',
            lat=None,
            lon=None,
            is_default=True,
        )
        db.add(row)
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def replace_user_addresses(db: Session, user_id: int, payload):
    raw_default = None
    raw_items = []
    if hasattr(payload, 'dict'):
        try:
            pdata = payload.dict()
        except Exception:
            pdata = {}
    else:
        pdata = payload if isinstance(payload, dict) else {}

    if isinstance(pdata, dict):
        raw_default = pdata.get('default_id')
        raw_items = pdata.get('addresses') or []
    elif isinstance(pdata, list):
        raw_items = pdata

    normalized = []
    seen_ids = set()
    for entry in (raw_items if isinstance(raw_items, list) else []):
        parsed = _normalize_user_address_payload(entry)
        if not parsed:
            continue
        if parsed['id'] in seen_ids:
            parsed['id'] = _clean_address_id(None)
        seen_ids.add(parsed['id'])
        normalized.append(parsed)

    target_default = _clean_address_str(raw_default, 80) if raw_default else ''
    ids_set = {item['id'] for item in normalized}
    if target_default not in ids_set:
        target_default = normalized[0]['id'] if normalized else ''

    existing_rows = db.query(models.UserAddress).filter(
        models.UserAddress.user_id == int(user_id)
    ).all()
    by_id = { _address_client_id(getattr(row, 'id', ''), user_id): row for row in existing_rows }
    incoming_ids = set(ids_set)

    for stale in existing_rows:
        sid = _address_client_id(getattr(stale, 'id', ''), user_id)
        if sid not in incoming_ids:
            db.delete(stale)

    for item in normalized:
        rid = item['id']
        sid = _address_storage_id(user_id, rid)
        row = by_id.get(rid)
        if not row:
            row = models.UserAddress(id=sid, user_id=int(user_id))
        elif str(getattr(row, 'id', '') or '') != sid:
            # Namespace ids by user to avoid cross-user collisions.
            row.id = sid
        row.user_id = int(user_id)
        row.label = item['label']
        row.notes = item['notes']
        row.barrio = item['barrio']
        row.calle = item['calle']
        row.numeracion = item['numeracion']
        row.postal_code = item['postal_code']
        row.department = item['department']
        row.query_hint = item['query_hint']
        row.full_text = item['full_text']
        row.lat = item['lat']
        row.lon = item['lon']
        row.is_default = bool(rid == target_default)
        db.add(row)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    rows = list_user_addresses(db, user_id)
    if rows and not any(bool(getattr(r, 'is_default', False)) for r in rows):
        rows[0].is_default = True
        db.add(rows[0])
        try:
            db.commit()
        except Exception:
            db.rollback()
        rows = list_user_addresses(db, user_id)
    return rows


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
