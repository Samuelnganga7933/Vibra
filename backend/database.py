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


def _clean_database_url(value: str) -> str:
    """Tolerate the ways DATABASE_URL usually gets mangled in dashboards:
    surrounding quotes, a pasted `DATABASE_URL=` prefix, stray whitespace."""
    v = value.strip()
    if v.startswith("DATABASE_URL="):
        v = v[len("DATABASE_URL="):]
    return v.strip().strip("\"'").strip()


DATABASE_URL = _clean_database_url(os.getenv("DATABASE_URL") or "") or f"sqlite:///{_sqlite_path}"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgres://"):]
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgresql://"):]
IS_SQLITE = DATABASE_URL.startswith("sqlite")

try:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False} if IS_SQLITE else {},
        echo=False,
        pool_pre_ping=True,
    )
except Exception as exc:  # noqa: BLE001 — a bad env var must not kill every request
    print(
        f"[database] invalid DATABASE_URL ({exc}); falling back to SQLite at {_sqlite_path}. "
        "Fix the DATABASE_URL env var in Vercel and redeploy.",
        flush=True,
    )
    DATABASE_URL = f"sqlite:///{_sqlite_path}"
    IS_SQLITE = True
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
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
