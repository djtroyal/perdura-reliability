"""Installable Perdura application runtime.

The numerical library intentionally keeps its historical :mod:`reliability`
import namespace.  This package owns the browser application launcher and the
packaged FastAPI application.
"""

from ._version import __version__

__all__ = ["__version__"]
