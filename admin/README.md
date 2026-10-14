# Panel admin de DistriAr

## Render: un solo Web Service

Usar `backend/Backend-master` como Root Directory. Build Command:

```bash
python -m pip install -r requirements.txt && corepack enable && corepack prepare pnpm@12.3.4 --activate && cd admin && pnpm install --frozen-lockfile && pnpm run build
```

El build genera `admin/out/`. El Start Command sigue siendo `./start.sh` y solo inicia FastAPI; no se ejecuta `next start`.

Para dibujar el mapa del panel, Render debe tener `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` configurada durante el build. También se acepta la variable existente `GOOGLE_MAPS_JS_API_KEY`. Debe ser una clave de navegador restringida por HTTP referrer y con Maps JavaScript API habilitada; nunca uses una clave privada de servidor.

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
- Mapa y rutas: Google Maps se carga en el navegador sólo con una clave pública configurada; las posiciones se consultan desde `/admin/driver-locations` cada 30 segundos.
- Asignaciones: `/admin/orders/{order_id}/assign` y `/admin/routes/auto-assign`.
- Promociones y consumos: `/api/promos` y `/api/consumos`.
- Usuarios y sucursales: `/admin/users`, `/admin/branches` y `/admin/zones`. El backend expone crear/editar/eliminar usuarios y listar/crear/eliminar sucursales; no expone edición de sucursales ni desactivación de usuarios.
- Consola owner: `/admin/stress-test/status`, `/admin/stress-test/start`, `/admin/stress-test/ready` y `/admin/stress-test/cancel`.

La carga inicial sigue siendo HTTP; el WebSocket sólo refresca las vistas compatibles después de recibir eventos. Las operaciones siguen pasando por PostgreSQL y las reglas de autorización del backend.

## Verificación

```powershell
pnpm exec tsc --noEmit
pnpm run build
```
