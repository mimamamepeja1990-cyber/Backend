from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Union
from datetime import datetime

class ProductBase(BaseModel):
    code: Optional[str] = None
    name: str
    price: float
    price_retail: Optional[float] = None
    description: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    active: Optional[bool] = True
    stock: Optional[int] = 0
    stock_kg: Optional[float] = 0.0
    kg_per_unit: Optional[float] = 1.0
    discount: Optional[float] = 0.0
    sale_unit: Optional[str] = 'unit'

class ProductCreate(ProductBase):
    pass

class ProductUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    price: Optional[float] = None
    price_retail: Optional[float] = None
    description: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    active: Optional[bool] = None
    stock: Optional[int] = None
    stock_kg: Optional[float] = None
    kg_per_unit: Optional[float] = None
    discount: Optional[float] = None
    sale_unit: Optional[str] = None

class ProductResponse(ProductBase):
    id: int
    image_url: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    stock: Optional[int] = 0
    stock_kg: Optional[float] = 0.0
    kg_per_unit: Optional[float] = 1.0
    discount: Optional[float] = 0.0

    model_config = {
        "from_attributes": True
    }
class StatsResponse(BaseModel):
    total: int
    average_price: float


# --- Users / Auth ---
class UserCreate(BaseModel):
    full_name: str
    email: str
    barrio: Optional[str] = None
    calle: Optional[str] = None
    numeracion: Optional[str] = None
    password: str


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: str
    barrio: Optional[str] = None
    calle: Optional[str] = None
    numeracion: Optional[str] = None
    is_active: bool
    created_at: Optional[datetime] = None

    model_config = { 'from_attributes': True }


class UserAddressBase(BaseModel):
    id: str
    label: Optional[str] = None
    notes: Optional[str] = None
    barrio: str
    calle: str
    numeracion: str
    postal_code: Optional[str] = None
    department: Optional[str] = None
    query_hint: Optional[str] = None
    full_text: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    is_default: Optional[bool] = False
    created_at: Optional[float] = None


class UserAddressResponse(UserAddressBase):
    user_id: int
    created_at_db: Optional[datetime] = None
    updated_at_db: Optional[datetime] = None

    model_config = { 'from_attributes': True }


class UserAddressBookSync(BaseModel):
    default_id: Optional[str] = None
    addresses: List[UserAddressBase] = Field(default_factory=list)


class UserAddressBookResponse(BaseModel):
    default_id: Optional[str] = None
    addresses: List[UserAddressResponse] = Field(default_factory=list)


class Token(BaseModel):
    access_token: str
    token_type: str = 'bearer'


class LoginRequest(BaseModel):
    email: str
    password: str


# Orders
class OrderItem(BaseModel):
    id: Union[str, int]
    qty: float
    meta: Optional[dict] = None

class OrderCreate(BaseModel):
    model_config = ConfigDict(extra='allow')

    items: List[OrderItem]
    total: float
    customer_type: Optional[str] = None
    # optional user info (either reference by id or snapshot contact fields)
    user_id: Optional[int] = None
    user_full_name: Optional[str] = None
    user_email: Optional[str] = None
    user_barrio: Optional[str] = None
    user_calle: Optional[str] = None
    user_numeracion: Optional[str] = None
    user_postal_code: Optional[str] = None
    user_department: Optional[str] = None
    # `_token_preview`, `_token_received`, `user_lat`, `user_lon`, etc. are
    # accepted as extra fields and preserved for downstream processing.
    # optional source hint (client can set to 'app' or 'web')
    source: Optional[str] = None
    # payment snapshot
    payment_method: Optional[str] = None
    payment_status: Optional[str] = None
    payment_reference: Optional[str] = None
    # delivery scheduling snapshot
    scheduled_delivery_date: Optional[str] = None
    delivery_cutoff_applied: Optional[bool] = None
    delivery_timezone: Optional[str] = None
    delivery_cutoff_hour: Optional[int] = None

class OrderResponse(BaseModel):
    id: int
    items: List[OrderItem]
    total: float
    status: Optional[str] = 'nuevo'
    customer_type: Optional[str] = None
    user_id: Optional[int] = None
    user_full_name: Optional[str] = None
    user_email: Optional[str] = None
    user_barrio: Optional[str] = None
    user_calle: Optional[str] = None
    user_numeracion: Optional[str] = None
    user_postal_code: Optional[str] = None
    user_department: Optional[str] = None
    maps_url: Optional[str] = None
    created_at: Optional[datetime] = None
    # Optional token preview fields (added so GET /orders can return token previews)
    _token_received: Optional[bool] = None
    _token_preview: Optional[dict] = None
    source: Optional[str] = None
    payment_method: Optional[str] = None
    payment_status: Optional[str] = None
    payment_reference: Optional[str] = None
    scheduled_delivery_date: Optional[str] = None
    delivery_cutoff_applied: Optional[bool] = None
    delivery_timezone: Optional[str] = None
    delivery_cutoff_hour: Optional[int] = None

    model_config = { 'from_attributes': True }


class MercadoPagoPreferenceItem(BaseModel):
    id: Union[str, int]
    title: str
    quantity: int = 1
    unit_price: float
    currency_id: Optional[str] = 'ARS'
    description: Optional[str] = None


class MercadoPagoPreferencePayer(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None


class MercadoPagoPreferenceCreate(BaseModel):
    order_id: Union[str, int]
    items: List[MercadoPagoPreferenceItem]
    total: Optional[float] = None
    external_reference: Optional[str] = None
    payer: Optional[MercadoPagoPreferencePayer] = None
    back_urls: Optional[dict] = None


class MercadoPagoPreferenceResponse(BaseModel):
    preference_id: str
    init_point: str
    sandbox_init_point: Optional[str] = None
