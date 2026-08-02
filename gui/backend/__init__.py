"""Packaged Perdura backend.

The backend historically runs with ``gui/backend`` on ``sys.path``.  Installable
wheel builds place it under :mod:`perdura_app.backend`; these aliases keep the
existing, thoroughly tested router imports working in both contexts.
"""

from __future__ import annotations

from importlib import import_module
import sys


for _name in ("api_contract", "schemas", "utils"):
    sys.modules.setdefault(_name, import_module(f".{_name}", __name__))

sys.modules.setdefault("routers", import_module(".routers", __name__))
sys.modules.setdefault("api_catalog", import_module(".api_catalog", __name__))
sys.modules.setdefault("project_api", import_module(".project_api", __name__))

del _name
