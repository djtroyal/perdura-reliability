"""Keep exception diagnostics in logs instead of public API payloads."""
import json
from textwrap import dedent

import pytest

from tools.check_api_error_disclosure import ROOT, main, scan_backend, scan_source


def _handler(body):
    return 'def endpoint():\n    try:\n        calculate()\n    except Exception as exc:\n' + ''.join(
        f'        {line}\n' for line in dedent(body).strip().splitlines())


@pytest.mark.parametrize('expression', [
    'str(exc)', 'repr(exc)', 'ascii(exc)', 'format(exc)',
    'f"failed: {exc}"', 'f"failed: {exc!r}"',
    '"failed: %s" % exc', '"{}".format(exc)', '"{error}".format(error=exc)',
    '"{error}".format_map({"error": exc})', 'exc.__str__()', 'exc.__repr__()',
    'exc.args', 'exc.args[0]', 'getattr(exc, "args")[0]', 'exc.message',
    'exc.filename', 'exc.strerror', 'exc.__cause__', 'exc.__dict__', 'exc.__format__("")',
    'str(exc).replace("token", "redacted")', 'normalize(str(exc))',
    'normalize("%s" % exc)', 'json.dumps({"error": str(exc)})',
    '{"nested": [{"error": str(exc)}]}', '{str(exc): "value"}',
    'exc',
])
def test_rendered_exception_details_are_rejected(expression):
    findings = scan_source(_handler(f'return {expression}'), 'router.py')
    assert findings
    assert all(finding.path == 'router.py' and finding.line >= 5 for finding in findings)


@pytest.mark.parametrize('body', [
    'error_alias = exc\ndetail = str(error_alias)\nreturn {"message": detail}',
    'detail = str(exc)\npayload = {"nested": {"detail": detail}}\nreturn payload',
    'payload = {}\npayload["detail"] = str(exc)\nreturn payload',
    'issues = []\nissues.append({"message": str(exc)})\nreturn {"issues": issues}',
    'payload = {}\npayload.update(detail=str(exc))\nreturn payload',
    'payload = {}\nalias = payload\nalias.update(detail=str(exc))\nreturn payload',
    'payload = []\nalias = payload\nalias.append(str(exc))\nreturn payload',
    'yield {"detail": str(exc)}',
    'yield from [{"detail": str(exc)}]',
    'raise HTTPException(status_code=500, detail=str(exc)) from exc',
    'raise HTTPException(500, repr(exc))',
    'response = JSONResponse({"detail": str(exc)})\nreturn response',
    'return error_payload(request, code="failed", message=f"{exc}")',
    'return PublicResult(message=str(exc))',
    'return public_error_message(exc, message=str(exc))',
    'raise PublicValidationError(str(exc)) from exc',
    'raise PublicValidationError(f"Invalid request: {exc}") from exc',
    'raise PublicValidationError("{}".format(exc)) from exc',
    'raise PublicValidationError("Invalid field: {field}", field=str(exc)) from exc',
    'raise PublicValidationError("Invalid field: {field}", field=exc) from exc',
    'context = {"field": repr(exc)}\nraise PublicValidationError("Invalid field: {field}", **context)',
    'return custom.error(str(exc))',
    'return {"detail": message for message in exc.args}',
])
def test_local_payload_and_response_flows_are_rejected(body):
    assert scan_source(_handler(body))


def test_payload_returned_after_exception_handler_is_rejected():
    assert scan_source(dedent('''
        def endpoint():
            result = {}
            try:
                calculate()
            except Exception as error:
                result['message'] = str(error)
            return result
    '''))


def test_one_unsafe_branch_cannot_hide_behind_a_safe_assignment():
    assert scan_source(_handler('''
        message = 'Unavailable'
        if debug:
            message = str(exc)
        return {'message': message}
    '''))


@pytest.mark.parametrize('source', [
    'def endpoint(exc: Exception):\n    return str(exc)',
    'def endpoint(exc: "Exception"):\n    return str(exc)',
    'def endpoint(error: ValueError | None):\n    return repr(error)',
    '@app.exception_handler(Exception)\nasync def handle(request, error):\n    return JSONResponse({"message": f"{error}"})',
    'import traceback\ndef endpoint():\n    return {"detail": traceback.format_exc()}',
    'import traceback as tb\ndef endpoint():\n    return tb.format_exc()',
    'from traceback import format_exc as current_trace\ndef endpoint():\n    return current_trace()',
    'def endpoint(exc: Exception):\n    return exc.__traceback__',
    'import traceback\ndef endpoint(exc: Exception):\n    return traceback.format_exception(exc)',
    'import traceback\ndef endpoint(exc: Exception):\n    return traceback.TracebackException.from_exception(exc).format()',
    '''import io
import traceback
def endpoint():
    buffer = io.StringIO()
    traceback.print_exc(file=buffer)
    return {'detail': buffer.getvalue()}
''',
])
def test_global_handlers_and_tracebacks_are_rejected(source):
    assert scan_source(source)


@pytest.mark.parametrize('body', [
    'logger.error("Request failed: %s", exc)\nreturn {"message": "Unavailable"}',
    'logger.error(str(exc))\nreturn {"message": "Unavailable"}',
    'logger.exception("Request failed")\nreturn {"message": "Unavailable"}',
    'logging.getLogger(__name__).exception("Request failed: %r", exc)\nreturn "Unavailable"',
    'raise HTTPException(400, "Invalid input") from exc',
    'raise PublicValidationError("A time-terminated analysis requires T.")',
    'raise PublicValidationError("Node {node} needs an exposure.", node="pump-1")',
    'return public_error_message(exc, message="Review the selected inputs.")',
    'unsafe = str(exc)\nreturn "Missing field" if "required" in unsafe else "Invalid input"',
    'messages = {"missing": "Install the PDF"}\nreturn messages.get(str(exc), "Unavailable")',
    'messages = {"missing": "Install the PDF"}\nreturn messages[exc.code]',
    'return {"issues": exc.issues, "readiness": exc.readiness}',
    'return exc.detail',
    'message = str(exc)\nmessage = "Unavailable"\nreturn {"message": message}',
    'payload = {}\nalias = payload\nalias = {}\npayload.update(detail=str(exc))\nreturn alias',
    'return "required" in str(exc)',
])
def test_logs_and_authored_public_messages_are_allowed(body):
    assert scan_source(_handler(body)) == []


def test_ordinary_error_variable_is_not_assumed_to_be_an_exception():
    assert scan_source('def endpoint(error):\n    return {"relative_error": str(error)}') == []


def test_exception_names_do_not_leak_into_unrelated_function_scopes():
    source = _handler('logger.exception("failed")\nreturn "Unavailable"')
    source += '\ndef ordinary(exc):\n    return str(exc)\n'
    assert scan_source(source) == []


def _source_tree(tmp_path, source):
    backend = tmp_path / 'gui' / 'backend'
    backend.mkdir(parents=True)
    (backend / 'endpoint.py').write_text(source)
    tests = backend / 'tests'
    tests.mkdir()
    (tests / 'test_intentionally_unsafe_fixture.py').write_text(_handler('return str(exc)'))
    return backend


def test_cli_emits_failure_evidence_and_source_location(tmp_path, capsys):
    _source_tree(tmp_path, _handler('return str(exc)'))
    output = tmp_path / 'evidence' / 'api-errors.json'
    assert main(['--root', str(tmp_path), '--output', str(output)]) == 1
    report = json.loads(output.read_text())
    assert report['status'] == 'failed'
    assert report['source_count'] == 1
    assert report['findings'][0]['path'] == 'gui/backend/endpoint.py'
    assert report['findings'][0]['line'] == 5
    assert 'gui/backend/endpoint.py:5:' in capsys.readouterr().out


def test_cli_passes_authored_messages_and_excludes_test_fixtures(tmp_path):
    _source_tree(tmp_path, _handler('return "Unavailable"'))
    output = tmp_path / 'evidence.json'
    assert main(['--root', str(tmp_path), '--output', str(output)]) == 0
    assert json.loads(output.read_text()) == {
        'schema': 'perdura.api-error-disclosure/v1', 'status': 'passed',
        'source_count': 1, 'findings': [],
    }


def test_unparseable_production_source_fails_closed(tmp_path):
    _source_tree(tmp_path, 'def broken(:')
    report = scan_backend(tmp_path)
    assert report['status'] == 'failed'
    assert report['findings'][0]['message'] == 'Backend source could not be parsed.'


def test_missing_backend_source_is_not_a_success(tmp_path):
    with pytest.raises(ValueError, match='No production backend Python sources'):
        scan_backend(tmp_path)


def test_repository_has_no_detected_exception_disclosures():
    report = scan_backend(ROOT)
    assert report['status'] == 'passed', json.dumps(report['findings'], indent=2)


def test_required_preflight_runs_and_records_disclosure_guard():
    workflow = (ROOT / '.github' / 'workflows' / 'ci.yml').read_text()
    assert 'python tools/check_api_error_disclosure.py --output evidence/preflight/api-error-disclosure.json' in workflow
    assert '--result api-errors=${{ steps.api-errors.outcome }}' in workflow
    assert 'api-error-disclosure=api-error-disclosure.json' in workflow
