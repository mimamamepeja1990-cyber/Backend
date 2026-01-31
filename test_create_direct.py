from app import schemas
from app.database import SessionLocal
from app import crud

p = schemas.ProductCreate(
    name='PruebaDirect',
    price=2.5,
    description='creado por test directo',
    category='Test',
    image_url=None,
    active=True,
    stock=5,
    discount=0
)

db = SessionLocal()
try:
    prod = crud.create_product(db, p)
    print('Result:', prod)
    try:
        # print attributes
        print('id:', getattr(prod, 'id', None))
        print('name:', getattr(prod, 'name', None))
        print('stock:', getattr(prod, 'stock', None))
    except Exception:
        pass
finally:
    try:
        db.rollback()
    except Exception:
        pass
    db.close()
