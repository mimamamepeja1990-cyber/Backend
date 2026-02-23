from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, func, LargeBinary
from sqlalchemy import JSON as _JSON
from sqlalchemy import Text
from app.database import Base

class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    price = Column(Float, nullable=False, default=0.0)
    # Retail price (minorista). If null, frontend falls back to wholesale `price`.
    price_retail = Column(Float, nullable=True)
    description = Column(String(1000), nullable=True)
    category = Column(String(200), nullable=True)
    image_url = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    active = Column(Boolean, default=True)
    # Inventory and simple per-product discount (percentage, e.g. 10 == 10%)
    stock = Column(Integer, default=0)
    # Available weight (kg) for kg-based products
    stock_kg = Column(Float, nullable=True, default=0.0)
    # For kg-based products, how many kilograms represent one full unit ("1")
    kg_per_unit = Column(Float, nullable=True, default=1.0)
    discount = Column(Float, default=0.0)
    # Unit of sale: 'unit' or 'kg'
    sale_unit = Column(String(50), nullable=True, default='unit')


class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True, index=True)
    # items stored as JSON/JSONB when supported; use generic JSON type so
    # Postgres stores JSONB and SQLite stores JSON as TEXT.
    items = Column(_JSON, nullable=False)
    total = Column(Float, nullable=False, default=0.0)
    status = Column(String(50), default='nuevo')
    customer_type = Column(String(50), nullable=True, default='mayorista')
    # Associate order with a user (store snapshot of contact info)
    user_id = Column(Integer, nullable=True)
    user_full_name = Column(String(200), nullable=True)
    user_email = Column(String(320), nullable=True)
    user_barrio = Column(String(200), nullable=True)
    user_calle = Column(String(200), nullable=True)
    user_numeracion = Column(String(100), nullable=True)
    # Persist token preview info to allow admin to see user data even if user_* columns are missing
    _token_received = Column(Boolean, nullable=True)
    _token_preview = Column(Text, nullable=True)
    # source of the order (e.g. 'web' or 'app')
    source = Column(String(50), nullable=True, default='web')
    # payment snapshot
    payment_method = Column(String(50), nullable=True)
    payment_status = Column(String(50), nullable=True)
    payment_reference = Column(String(200), nullable=True)
    # Delivery scheduling snapshot (computed at order creation time).
    # Date is persisted as YYYY-MM-DD in the business timezone.
    scheduled_delivery_date = Column(String(10), nullable=True)
    delivery_cutoff_applied = Column(Boolean, nullable=True, default=False)
    delivery_timezone = Column(String(80), nullable=True)
    delivery_cutoff_hour = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Image(Base):
    __tablename__ = "images"
    id = Column(Integer, primary_key=True, index=True)
    data = Column(LargeBinary, nullable=False)
    mime = Column(String(128), nullable=True)
    filename = Column(String(256), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class OrderTokenPreview(Base):
    """Persist token previews independently so they survive schema drift or missing columns.
    Stores the preview for a given order id (stored as text to support debug IDs)."""
    __tablename__ = "order_token_previews"
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(String(100), nullable=False, index=True)
    token_preview = Column(Text, nullable=True)
    token_received = Column(Boolean, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(200), nullable=False)
    email = Column(String(320), nullable=False, unique=True, index=True)
    barrio = Column(String(200), nullable=True)
    calle = Column(String(200), nullable=True)
    numeracion = Column(String(100), nullable=True)
    hashed_password = Column(String(200), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Setting(Base):
    """Simple key/value store for admin-managed configuration such as
    filters and product-category mappings. Storing these in the DB makes
    them durable across deploys and easier to query from other services.
    """
    __tablename__ = 'settings'
    key = Column(String(200), primary_key=True, index=True)
    value = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class PromoImage(Base):
    __tablename__ = 'promo_images'
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(256), nullable=False)
    url = Column(String(512), nullable=True)
    alt = Column(String(256), nullable=True)
    selected = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
