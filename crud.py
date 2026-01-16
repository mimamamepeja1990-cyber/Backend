from app import models, schemas
from sqlalchemy.orm import Session
import os
from typing import Optional, List
from sqlalchemy import func


def get_products(db: Session, skip: int = 0, limit: int = 100, q: Optional[str]=None, category: Optional[str]=None, active: Optional[bool]=None, sort: Optional[str]=None) -> List[models.Product]:
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

def create_product(db: Session, payload: schemas.ProductCreate) -> models.Product:
    obj = models.Product(
        name=payload.name,
        price=payload.price,
        description=payload.description,
        category=payload.category,
        image_url=payload.image_url,
        active=payload.active
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj

def get_product(db: Session, product_id: int) -> Optional[models.Product]:
    return db.query(models.Product).filter(models.Product.id == product_id).first()

def update_product(db: Session, product_id: int, payload: schemas.ProductUpdate) -> models.Product:
    obj = get_product(db, product_id)
    if not obj:
        raise Exception("Not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(obj, field, value)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj

def delete_product(db: Session, product_id: int):
    obj = get_product(db, product_id)
    if obj:
        db.delete(obj)
        db.commit()

def export_all(db: Session):
    return db.query(models.Product).all()

def stats(db: Session):
    total = db.query(models.Product).count()
    avg = db.query(models.Product).with_entities(func.avg(models.Product.price)).scalar()
    return {"total": total, "average_price": float(avg) if avg else 0.0}
