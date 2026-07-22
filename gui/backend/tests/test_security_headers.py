import asyncio
import inspect
import sys
from pathlib import Path

from starlette.requests import Request
from starlette.responses import Response


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from main import _browser_security_headers


def test_browser_security_headers_are_present_without_reference_proxy():
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})

    async def call_next(_request):
        return Response()

    response = asyncio.run(_browser_security_headers(request, call_next))

    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
    assert "camera=()" in response.headers["permissions-policy"]
    assert "strict-transport-security" not in response.headers


def test_spa_fallback_never_maps_request_path_to_filesystem():
    module_source = inspect.getsource(main)
    assert "_static_dir / full_path" not in module_source
    assert 'str(_static_dir / "index.html")' in module_source

    if main._static_dir is None:
        return

    route = next(route for route in main.app.routes
                 if getattr(route, "path", None) == "/{full_path:path}")
    response = asyncio.run(route.endpoint("../../../../etc/passwd"))
    assert Path(response.path).resolve() == (main._static_dir / "index.html").resolve()
