from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, func, LargeBinary
from sqlalchemy import JSON as _JSON
from sqlalchemy import Text
from app.database import Base

class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True, index=True)
    # Internal ERP/product code shown in admin and used for search.
    code = Column(String(100), nullable=True)
    name = Column(String(200), nullable=False)
    price = Column(Float, nullable=False, default=0.0)
    # Retail price (minorista). If null, frontend falls back to wholesale `price`.
    price_retail = Column(Float, nullable=True)
    # Internal cost for margin calculations (admin-only).
    cost = Column(Float, nullable=True)
    description = Column(String(1000), nullable=True)
    category = Column(String(200), nullable=True)
    # Optional brand label shown in catalog/admin.
    brand = Column(String(200), nullable=True)
    image_url = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    active = Column(Boolean, default=True)
    # Inventory and simple per-product discount (percentage, e.g. 10 == 10%)
    stock = Column(Integer, default=0)
    # Minimum desired stock. When current stock is below this value, admin can alert.
    min_stock = Column(Integer, default=0)
    # Available weight (kg) for kg-based products
    stock_kg = Column(Float, nullable=True, default=0.0)
    # For kg-based products, how many kilograms represent one full unit ("1")
    kg_per_unit = Column(Float, nullable=True, default=1.0)
    discount = Column(Float, default=0.0)
    # Unit of sale: 'unit' or 'kg'
    sale_unit = Column(String(50), nullable=True, default='unit')

class ProductChange(Base):
    __tablename__ = "product_changes"
    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, nullable=True, index=True)
    action = Column(String(50), nullable=False)  # create/update/delete/bulk
    actor = Column(String(200), nullable=True)
    before = Column(_JSON, nullable=True)
    after = Column(_JSON, nullable=True)
    changed_fields = Column(_JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AdminUser(Base):
    __tablename__ = "admin_users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(80), nullable=False, unique=True, index=True)
    full_name = Column(String(200), nullable=True)
    role = Column(String(50), nullable=False, default='admin')
    zone = Column(String(120), nullable=True)
    hashed_password = Column(String(200), nullable=False)
    is_active = Column(Boolean, default=True)
    created_by = Column(String(80), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AdminDriverLocation(Base):
    __tablename__ = "admin_driver_locations"
    id = Column(Integer, primary_key=True, index=True)
    admin_user_id = Column(Integer, nullable=True, index=True)
    username = Column(String(80), nullable=True, index=True)
    full_name = Column(String(200), nullable=True)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    accuracy = Column(Float, nullable=True)
    speed = Column(Float, nullable=True)
    heading = Column(Float, nullable=True)
    battery = Column(Float, nullable=True)
    recorded_at = Column(DateTime(timezone=True), server_default=func.now())


class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True, index=True)
    # items stored as JSON/JSONB when supported; use generic JSON type so
    # Postgres stores JSONB and SQLite stores JSON as TEXT.
    items = Column(_JSON, nullable=False)
    total = Column(Float, nullable=False, default=0.0)
    # Order lifecycle: recibido -> visto -> preparado -> enviado -> entregado
    status = Column(String(50), default='recibido')
    customer_type = Column(String(50), nullable=True, default='mayorista')
    # Associate order with a user (store snapshot of contact info)
    user_id = Column(Integer, nullable=True)
    user_full_name = Column(String(200), nullable=True)
    user_email = Column(String(320), nullable=True)
    user_barrio = Column(String(200), nullable=True)
    user_calle = Column(String(200), nullable=True)
    user_numeracion = Column(String(100), nullable=True)
    user_postal_code = Column(String(20), nullable=True)
    user_department = Column(String(120), nullable=True)
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
    # Assignment to delivery driver (admin users)
    assigned_driver_id = Column(Integer, nullable=True)
    assigned_driver_username = Column(String(80), nullable=True)
    assigned_driver_name = Column(String(200), nullable=True)
    assigned_driver_zone = Column(String(120), nullable=True)
    assigned_at = Column(DateTime(timezone=True), nullable=True)
    delivery_lat = Column(Float, nullable=True)
    delivery_lon = Column(Float, nullable=True)
    route_id = Column(String(120), nullable=True)
    route_order = Column(Integer, nullable=True)
    route_generated_at = Column(DateTime(timezone=True), nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    delivered_by_id = Column(Integer, nullable=True)
    delivered_by_username = Column(String(80), nullable=True)
    delivery_issues = Column(Text, nullable=True)
    closed_attempts = Column(Integer, nullable=True, default=0)
    last_delivery_issue_type = Column(String(50), nullable=True)
    last_delivery_issue_note = Column(Text, nullable=True)
    last_delivery_issue_photo_url = Column(String(500), nullable=True)
    last_delivery_issue_at = Column(DateTime(timezone=True), nullable=True)
    last_delivery_issue_by_id = Column(Integer, nullable=True)
    last_delivery_issue_by_username = Column(String(80), nullable=True)
    cancel_reason = Column(String(240), nullable=True)
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


class UserAddress(Base):
    __tablename__ = "user_addresses"
    # Keep string ids so frontend-generated address ids can be persisted as-is.
    id = Column(String(80), primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    label = Column(String(80), nullable=True)
    notes = Column(String(240), nullable=True)
    barrio = Column(String(200), nullable=False)
    calle = Column(String(200), nullable=False)
    numeracion = Column(String(100), nullable=False)
    postal_code = Column(String(20), nullable=True)
    department = Column(String(120), nullable=True)
    query_hint = Column(String(200), nullable=True)
    full_text = Column(String(300), nullable=True)
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


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
