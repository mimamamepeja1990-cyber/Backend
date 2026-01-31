"""Smoke test script: verifica conexión a la base de datos, CRUD básico y escritura de snapshots.

Uso:
  - Desde la raíz del repo: `python Backend/scripts/smoke_test.py`
  - Si quieres probar Postgres, exporta `DATABASE_URL` antes de ejecutar.
"""
import os
import json
import traceback

from app import models
from app.database import engine, SessionLocal, Base
from app import crud

from app.main import write_catalog_snapshot, write_promotions_snapshot, CATALOG_DIR


def main():
    print('SMOKE TEST START')
    print('DATABASE_URL=', os.environ.get('DATABASE_URL') or '(not set, using sqlite)')

    # ensure tables exist
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    created = None
    try:
        # Create a test product
        p = models.Product(name='SMOKETEST', price=1.23, description='Prueba', category='Test', image_url=None, active=True)
        db.add(p)
        db.commit()
        db.refresh(p)
        created = p.id
        print('Created product id=', created)

        # Export snapshot
        write_catalog_snapshot()
        prod_path = os.path.join(CATALOG_DIR, 'products.json')
        if os.path.exists(prod_path):
            with open(prod_path, 'r', encoding='utf-8') as f:
                items = json.load(f)
            print('products.json exists, count=', len(items))
        else:
            print('products.json NOT FOUND')

        # Write promotions snapshot
        promos = [{ 'id': 999999, 'name': 'SMOKE PROMO', 'description': 'Auto', 'productIds': [created], 'type': 'percent', 'value': 10 }]
        write_promotions_snapshot(promos)
        prom_path = os.path.join(CATALOG_DIR, 'promotions.json')
        if os.path.exists(prom_path):
            with open(prom_path, 'r', encoding='utf-8') as f:
                pitems = json.load(f)
            print('promotions.json exists, count=', len(pitems))
        else:
            print('promotions.json NOT FOUND')

        print('SMOKE TEST OK')
    except Exception as e:
        print('SMOKE TEST FAILED')
        traceback.print_exc()
    finally:
        try:
            if created:
                obj = db.query(models.Product).get(created)
                if obj:
                    db.delete(obj)
                    db.commit()
                    print('Cleaned up test product')
        except Exception:
            pass
        db.close()


if __name__ == '__main__':
    main()
