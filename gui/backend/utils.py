"""Shared backend helpers.

`safe()` is the JSON sanitizer that was previously copy-pasted into ~11 routers:
it turns NaN/inf floats into None (JSON null) and recurses through dicts/lists so
responses never contain values that break JSON serialisation on the client.
"""

import math


def safe(obj):
    """Recursively replace NaN/inf floats with None for JSON-safe output."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [safe(v) for v in obj]
    if isinstance(obj, tuple):
        return [safe(v) for v in obj]
    return obj
