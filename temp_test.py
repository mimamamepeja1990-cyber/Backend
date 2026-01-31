from app import schemas, crud
from app.database import SessionLocal

p = schemas.ProductCreate(
    name='UpdateTest',
    price=10.0,
    description='before',
    category='T',
    image_url=None,
    active=True,
    stock=3
)

db = SessionLocal()
try:
    res = crud.create_product(db, p)
    print('created:', res)
    pid = res.get('id')
    print('pid:', pid)
    upd = schemas.ProductUpdate(description='after', price=12.0)
    upd_res = crud.update_product(db, pid, upd)
    print('updated:', upd_res)
finally:
    try:
        db.rollback()
    except:
        pass
    db.close()
