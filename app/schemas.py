from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class ProductBase(BaseModel):
    name: str
    price: float
    description: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    active: Optional[bool] = True
    stock: Optional[int] = 0
    discount: Optional[float] = 0.0

class ProductCreate(ProductBase):
    pass

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = None
    description: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    active: Optional[bool] = None
    stock: Optional[int] = None
    discount: Optional[float] = None

class ProductResponse(ProductBase):
    id: int
    image_url: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    stock: Optional[int] = 0
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


class Token(BaseModel):
    access_token: str
    token_type: str = 'bearer'


class LoginRequest(BaseModel):
    email: str
    password: str


# Orders
class OrderItem(BaseModel):
    id: str
    qty: int
    meta: Optional[dict] = None

class OrderCreate(BaseModel):
    items: List[OrderItem]
    total: float
    # optional user info (either reference by id or snapshot contact fields)
    user_id: Optional[int] = None
    user_full_name: Optional[str] = None
    user_email: Optional[str] = None
    user_barrio: Optional[str] = None
    user_calle: Optional[str] = None
    user_numeracion: Optional[str] = None
    # token preview fields (may be populated server-side when a bearer token is provided)
    _token_received: Optional[bool] = None
    _token_preview: Optional[dict] = None
    # optional source hint (client can set to 'app' or 'web')
    source: Optional[str] = None

class OrderResponse(BaseModel):
    id: int
    items: List[OrderItem]
    total: float
    status: Optional[str] = 'nuevo'
    user_id: Optional[int] = None
    user_full_name: Optional[str] = None
    user_email: Optional[str] = None
    user_barrio: Optional[str] = None
    user_calle: Optional[str] = None
    user_numeracion: Optional[str] = None
    created_at: Optional[datetime] = None
    # Optional token preview fields (added so GET /orders can return token previews)
    _token_received: Optional[bool] = None
    _token_preview: Optional[dict] = None
    source: Optional[str] = None

    model_config = { 'from_attributes': True }
