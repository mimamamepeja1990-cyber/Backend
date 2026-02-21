"""Importador de productos: lee Backend/catalogo/products.json y los inserta en la DB.

Uso:
  python Backend/scripts/import_products.py

Notas:
  - Lee la variable de entorno `DATABASE_URL` (si está configurada usa Postgres).
  - Evita duplicados por `name` (si existe un producto con el mismo nombre, lo salta).
"""
import os
import json
import traceback

from app import models
from app.database import engine, SessionLocal, Base


def load_products(path):
    if not os.path.exists(path):
        print('No existe', path)
        return []
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def import_products(path='Backend/catalogo/products.json'):
    print('Importando desde', path)
    items = load_products(path)
    if not items:
        print('No hay productos para importar')
        return

    # Ensure tables exist
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    created = 0
    try:
        existing_names = set([p.name for p in db.query(models.Product).all()])
        for p in items:
            name = p.get('name')
            if not name:
                continue
            if name in existing_names:
                print('Skipping existing:', name)
                continue
            obj = models.Product(
                name=name,
                price=float(p.get('price') or 0),
                description=p.get('description') or '',
                category=p.get('category') or None,
                image_url=p.get('image_url') or None,
                active=bool(p.get('active', True)),
            )
            db.add(obj)
            db.commit()
            db.refresh(obj)
            print('Created:', obj.id, obj.name)
            existing_names.add(obj.name)
            created += 1
    except Exception:
        traceback.print_exc()
    finally:
        db.close()

    print('Import finished. created=', created)


if __name__ == '__main__':
    import_products()
