# Repository guidance

## API exception handling

Raw exception messages have repeatedly caused security findings in Perdura.
Never put `str(exc)`, `repr(exc)`, exception interpolation, exception arguments,
or tracebacks into HTTP responses, result diagnostics, or streamed events.
`ValueError` is not a trusted public-message type.

Use `api_contract.public_error_message(exc, message="authored guidance")` to
retain diagnostics in server logs. Supply a fixed message or select one from an
explicit error-code map. Preserve actionable validation guidance with authored
HTTP errors or coded domain errors; never restore raw exception text to satisfy
an existing message assertion. Preserve reviewed structured issue fields.
For application-authored schema constraints, use `PublicValidationError` with
an authored template and explicitly public input context. Never wrap an
arbitrary exception's text in that type.

For backend changes, run `python tools/check_api_error_disclosure.py` and the
relevant HTTP regression tests. See
[`docs/assurance/SECURITY_PERFORMANCE_ASSURANCE.md`](docs/assurance/SECURITY_PERFORMANCE_ASSURANCE.md#api-error-contract)
for the error contract and the source guard's limits.

## Pull-request readiness

A successful scanner workflow only establishes that the scan completed. Before
recommending a merge, inspect new code-scanning findings and unresolved review
threads as well as the required checks on the current PR revision. Resolve a
security thread only after its concern is fixed and verified.
