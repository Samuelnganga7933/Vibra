from pathlib import Path
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BASE_DIR = Path(__file__).resolve().parent
# Project root .env (pulled by `neon env pull`); real env vars still win.
load_dotenv(BASE_DIR.parent / ".env")
# Vercel's filesystem is read-only outside /tmp — SQLite must land there.
_sqlite_path = Path(os.environ.get("TMPDIR") or "/tmp") / "vibra_users.db" if os.getenv("VERCEL") else BASE_DIR / "vibra_users.db"
DATABASE_URL = (os.getenv("DATABASE_URL") or f"sqlite:///{_sqlite_path}").strip()
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgres://"):]
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgresql://"):]
IS_SQLITE = DATABASE_URL.startswith("sqlite")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if IS_SQLITE else {},
    echo=False,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
