"""Vercel ASGI entry point — exposes `main:app` as a Python serverless function."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import app  # noqa: E402, F401
