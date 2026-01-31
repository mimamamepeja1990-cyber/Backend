"""Smoke test for Settings CRUD: ensures we can set and get JSON-valued settings."""
from app import crud
from app.database import SessionLocal, Base, engine

# Ensure tables exist
Base.metadata.create_all(bind=engine)

db = SessionLocal()
try:
    ok = crud.set_setting(db, 'test_filters', [{'id':1,'name':'A','value':'a'}])
    print('set ok', ok)
    v = crud.get_setting(db, 'test_filters')
    print('got', v)
finally:
    db.close()
