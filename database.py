import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv('DATABASE_URL', f"sqlite:///{os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend','catalog.db'))}")
# If the above path seems odd when extracted, use a local file:
if DATABASE_URL.endswith('backend/catalog.db') and not os.path.exists(os.path.join(os.path.dirname(__file__), '..', 'backend','catalog.db')):
    # fallback to sqlite in package folder
    DATABASE_URL = f"sqlite:///{os.path.abspath(os.path.join(os.path.dirname(__file__), 'catalog.db'))}"

engine = create_engine(
    DATABASE_URL,
    connect_args={'check_same_thread': False} if DATABASE_URL.startswith('sqlite') else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
