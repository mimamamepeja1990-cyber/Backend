# Panel admin de DistriAr

Este directorio contiene la interfaz administrativa React/Next integrada con el backend FastAPI existente. No reemplaza el panel legado de `../admin`; ambos pueden convivir durante la migración.

## Desarrollo local

1. Iniciar FastAPI desde `backend/Backend-master` con el comando habitual del proyecto.
2. Copiar `.env.example` como `.env.local` y configurar `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000` si Next corre en otro puerto.
3. Ejecutar:

```powershell
pnpm install
pnpm dev
```

La interfaz quedará disponible en `http://localhost:3000`. El login usa `POST /admin/auth/token` y conserva el bearer token únicamente en `localStorage`.

## Integración realizada

- Resumen y operaciones: `/admin/operations/overview`, `/admin/resumen-ejecutivo`, `/admin/sales/stats`.
- Pedidos: `/admin/orders` y actualización de estado mediante `/orders/{order_id}/status`.
- Catálogo e inventario: `/products/paged`, `/products`, `/products/{product_id}`.
- Repartidores: `/admin/users`, `/admin/driver-locations` y `/ws/products` para refrescos incrementales.
- Promociones y consumos: `/api/promos` y `/api/consumos`.
- Usuarios y sucursales: `/admin/users` y `/admin/branches`.

La carga inicial sigue siendo HTTP; el WebSocket sólo refresca las vistas compatibles después de recibir eventos. Las operaciones siguen pasando por PostgreSQL y las reglas de autorización del backend.

## Verificación

```powershell
pnpm exec tsc --noEmit
pnpm run build
```
