"""Source-checkout bridge to the backend package.

Wheel builds map :mod:`perdura_app.backend` directly to ``gui/backend``.  This
small bridge gives an uninstalled source checkout the same import path without
changing the backend test layout.
"""

from __future__ import annotations

from importlib import import_module
from pathlib import Path
import sys


_backend = Path(__file__).resolve().parents[3] / "gui" / "backend"
if _backend.is_dir():
    __path__.append(str(_backend))  # type: ignore[name-defined]

for _name in ("api_contract", "schemas", "utils"):
    sys.modules.setdefault(_name, import_module(f".{_name}", __name__))

sys.modules.setdefault("routers", import_module(".routers", __name__))
sys.modules.setdefault("api_catalog", import_module(".api_catalog", __name__))
sys.modules.setdefault("project_api", import_module(".project_api", __name__))

del _name
