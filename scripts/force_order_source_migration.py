import os
import sqlalchemy
from sqlalchemy import text

# Solo ejecuta si la variable de entorno está presente
if os.environ.get('FORCE_ORDER_SOURCE_MIGRATION') == '1':
    # Usa la URL de tu base de datos Postgres desde la variable de entorno DATABASE_URL
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        print('DATABASE_URL no está definida')
        exit(1)
    engine = sqlalchemy.create_engine(db_url)
    with engine.connect() as conn:
        print('Agregando columna source si no existe...')
        try:
            conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS source VARCHAR(16);"))
        except Exception as e:
            print('Columna source ya existe o error:', e)
        print('Creando índice si no existe...')
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source);"))
        except Exception as e:
            print('Índice ya existe o error:', e)
        print('Actualizando pedidos antiguos...')
        try:
            conn.execute(text("UPDATE orders SET source = 'web' WHERE source IS NULL OR TRIM(source) = '';"))
        except Exception as e:
            print('Error actualizando pedidos:', e)
        print('¡Migración completada!')
else:
    print('FORCE_ORDER_SOURCE_MIGRATION no está activa, no se ejecuta migración.')
