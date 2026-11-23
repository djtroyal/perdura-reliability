"""Reject exception details flowing into public backend responses.

This is a bounded, per-function AST regression check, not an interprocedural
security proof. It follows caught/annotated exceptions, rendered details and
local aliases into response calls, returns, and yields. Calls receiving a raw
exception may deliberately map it to authored messages; their implementations
are scanned separately. CodeQL and HTTP disclosure tests remain complementary.
"""
from __future__ import annotations

import argparse
import ast
from dataclasses import asdict, dataclass
import json
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
EXCEPTION = 1
DETAIL = 2
RESPONSE_CALLS = {
    'HTTPException', 'JSONResponse', 'Response', 'PlainTextResponse',
    'HTMLResponse', 'ORJSONResponse', 'UJSONResponse', 'error_payload',
    'PublicValidationError',
}
DETAIL_ATTRIBUTES = {
    'args', '__traceback__', '__cause__', '__context__', '__dict__',
    'message', 'filename', 'filename2', 'strerror', 'text',
}
TRACEBACK_FORMATTERS = {
    'format_exc', 'format_exception', 'format_exception_only', 'format_tb',
    'format_stack', 'extract_tb', 'extract_stack', 'TracebackException',
}
LOG_METHODS = {'debug', 'info', 'warning', 'warn', 'error', 'exception', 'critical', 'log'}


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    column: int
    message: str


def _name(node: ast.AST | None) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _name(node.value)
        return f'{parent}.{node.attr}' if parent else node.attr
    return ''


def _combined(values: Iterable[int]) -> int:
    result = 0
    for value in values:
        result |= value
    return result


class _State(dict[str, int]):
    """Local value flow, including aliases used to mutate the same payload."""
    def __init__(self, source: '_State | None' = None):
        super().__init__(source or {})
        self.aliases = {name: set(peers) for name, peers in source.aliases.items()} if source is not None else {}

    def detach(self, name: str) -> None:
        for peer in self.aliases.pop(name, set()):
            if peer in self.aliases:
                self.aliases[peer].discard(name)

    def link(self, names: set[str]) -> None:
        peers = set(names)
        for name in names:
            peers.update(self.aliases.get(name, set()))
        for name in peers:
            self.aliases[name] = set(peers)

    def clear(self) -> None:
        super().clear()
        self.aliases.clear()


class _FunctionScan:
    def __init__(self, path: str, imports: dict[str, str]):
        self.path = path
        self.imports = imports
        self.findings: dict[int, Finding] = {}

    def _resolved(self, node: ast.AST) -> str:
        name = _name(node)
        first, _, rest = name.partition('.')
        base = self.imports.get(first, first)
        return f'{base}.{rest}' if rest else base

    def _report(self, node: ast.AST, sink: str) -> None:
        self.findings.setdefault(node.lineno, Finding(
            self.path, node.lineno, node.col_offset + 1,
            f'Exception-derived details reach {sink}; use an authored public message and log diagnostics server-side.',
        ))

    def _assign(self, target: ast.AST, value: int, state: _State, *, merge: bool = False) -> None:
        if isinstance(target, ast.Name):
            if merge:
                for name in state.aliases.get(target.id, {target.id}):
                    state[name] = state.get(name, 0) | value
            else:
                state.detach(target.id)
                state[target.id] = value
        elif isinstance(target, (ast.Tuple, ast.List)):
            for element in target.elts:
                self._assign(element, value, state, merge=merge)
        elif isinstance(target, (ast.Subscript, ast.Attribute)):
            # Mutating a nested payload makes its containing local value tainted.
            self._assign(target.value, value, state, merge=True)

    def _expression(self, node: ast.AST | None, state: _State) -> int:
        if node is None or isinstance(node, ast.Constant):
            return 0
        if isinstance(node, ast.Name):
            return state.get(node.id, 0)
        if isinstance(node, ast.Attribute):
            base = self._expression(node.value, state)
            if base & DETAIL:
                return DETAIL
            return DETAIL if base & EXCEPTION and node.attr in DETAIL_ATTRIBUTES else 0
        if isinstance(node, ast.Subscript):
            # Selecting an authored mapping value by error code does not expose
            # the selector. Slicing/indexing raw details still exposes details.
            self._expression(node.slice, state)
            return self._expression(node.value, state)
        if isinstance(node, ast.IfExp):
            self._expression(node.test, state)
            return self._expression(node.body, state) | self._expression(node.orelse, state)
        if isinstance(node, ast.Compare):
            for child in ast.iter_child_nodes(node):
                self._expression(child, state)
            return 0
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            self._expression(node.operand, state)
            return 0
        if isinstance(node, ast.NamedExpr):
            value = self._expression(node.value, state)
            self._assign(node.target, value, state)
            return value
        if isinstance(node, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
            local = _State(state)
            for generator in node.generators:
                self._assign(generator.target, self._expression(generator.iter, local), local)
                for condition in generator.ifs:
                    self._expression(condition, local)
            if isinstance(node, ast.DictComp):
                return self._expression(node.key, local) | self._expression(node.value, local)
            return self._expression(node.elt, local)
        if isinstance(node, ast.Call):
            function = self._resolved(node.func)
            method = function.rsplit('.', 1)[-1]
            receiver = self._expression(node.func.value, state) if isinstance(node.func, ast.Attribute) else 0
            positional = [self._expression(arg, state) for arg in node.args]
            keywords = {kw.arg: self._expression(kw.value, state) for kw in node.keywords}
            arguments = _combined(positional) | _combined(keywords.values())
            if method in RESPONSE_CALLS and arguments:
                self._report(node, f'the {method} response')
            if function.startswith('traceback.'):
                if method in {'print_exc', 'print_exception', 'print_tb', 'print_stack'}:
                    for keyword in node.keywords:
                        if keyword.arg == 'file':
                            self._assign(keyword.value, DETAIL, state, merge=True)
                    return 0
                if method in TRACEBACK_FORMATTERS or 'TracebackException.' in function:
                    return DETAIL
            if isinstance(node.func, ast.Attribute) and method in {'append', 'extend', 'insert', 'update', 'add', 'setdefault'}:
                self._assign(node.func.value, arguments, state, merge=True)
            logger_name = _name(node.func.value).rsplit('.', 1)[-1].lstrip('_').lower() if isinstance(node.func, ast.Attribute) else ''
            logger_factory = (isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Call)
                              and self._resolved(node.func.value.func).endswith('.getLogger'))
            if isinstance(node.func, ast.Attribute) and method in LOG_METHODS and (logger_name in {'logger', 'log', 'logging'} or logger_factory):
                return 0
            if (isinstance(node.func, ast.Name) or function.startswith('builtins.')) and function in {
                'str', 'repr', 'ascii', 'format', 'builtins.str', 'builtins.repr', 'builtins.ascii', 'builtins.format',
            }:
                return DETAIL if arguments else 0
            if method in {'__str__', '__repr__', '__format__', 'format', 'format_map'}:
                return DETAIL if arguments or receiver else 0
            if function in {'getattr', 'builtins.getattr'} and positional and positional[0] & EXCEPTION:
                if len(node.args) > 1 and isinstance(node.args[1], ast.Constant) and node.args[1].value in DETAIL_ATTRIBUTES:
                    return DETAIL
            if isinstance(node.func, ast.Attribute) and method in {'get', 'pop', '__getitem__'}:
                return receiver | _combined(positional[1:]) | _combined(keywords.values())
            if method in {'dumps', 'jsonable_encoder'}:
                return DETAIL if arguments or receiver else 0
            # Passing an exception object to a mapper is allowed. Passing text
            # already derived from it is tracked through arbitrary helpers.
            return (arguments | receiver) & DETAIL
        if isinstance(node, (ast.Yield, ast.YieldFrom)):
            value = self._expression(node.value, state)
            if value:
                self._report(node, 'a yielded response')
            return value
        if isinstance(node, (ast.FormattedValue, ast.JoinedStr)):
            value = _combined(self._expression(child, state) for child in ast.iter_child_nodes(node))
            return DETAIL if value else 0
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mod):
            value = self._expression(node.left, state) | self._expression(node.right, state)
            return DETAIL if value else 0
        return _combined(self._expression(child, state) for child in ast.iter_child_nodes(node))

    @staticmethod
    def _merge(state: _State, branches: Iterable[_State]) -> None:
        for branch in branches:
            for name, value in branch.items():
                state[name] = state.get(name, 0) | value
            for name, peers in branch.aliases.items():
                state.link({name, *peers})

    def _statements(self, statements: list[ast.stmt], state: _State) -> None:
        for statement in statements:
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            if isinstance(statement, ast.Return):
                if self._expression(statement.value, state):
                    self._report(statement, 'a returned response')
            elif isinstance(statement, ast.Assign):
                value = self._expression(statement.value, state)
                peers = (set(state.aliases.get(statement.value.id, {statement.value.id}))
                         if isinstance(statement.value, ast.Name) else set())
                for target in statement.targets:
                    self._assign(target, value, state)
                    if isinstance(target, ast.Name) and peers:
                        state.link({target.id, *peers})
            elif isinstance(statement, ast.AnnAssign):
                self._assign(statement.target, self._expression(statement.value, state), state)
            elif isinstance(statement, ast.AugAssign):
                self._assign(statement.target, self._expression(statement.value, state), state, merge=True)
            elif isinstance(statement, ast.If):
                self._expression(statement.test, state)
                branches = []
                for body in (statement.body, statement.orelse):
                    branch = _State(state)
                    self._statements(body, branch)
                    branches.append(branch)
                state.clear()
                self._merge(state, branches)
            elif isinstance(statement, (ast.Try, ast.TryStar)):
                original = _State(state)
                self._statements(statement.body, state)
                self._statements(statement.orelse, state)
                branches = [_State(state)]
                for handler in statement.handlers:
                    branch = _State(original)
                    self._merge(branch, [state])
                    if handler.name:
                        branch[handler.name] = EXCEPTION
                    self._statements(handler.body, branch)
                    if handler.name:
                        branch.detach(handler.name)
                        branch.pop(handler.name, None)
                    branches.append(branch)
                self._merge(state, branches)
                self._statements(statement.finalbody, state)
            elif isinstance(statement, (ast.For, ast.AsyncFor, ast.While)):
                branch = _State(state)
                if isinstance(statement, ast.While):
                    self._expression(statement.test, branch)
                else:
                    self._assign(statement.target, self._expression(statement.iter, branch), branch)
                self._statements(statement.body, branch)
                self._merge(state, [branch])
                self._statements(statement.orelse, state)
            elif isinstance(statement, (ast.With, ast.AsyncWith)):
                for item in statement.items:
                    value = self._expression(item.context_expr, state)
                    if item.optional_vars:
                        self._assign(item.optional_vars, value, state)
                self._statements(statement.body, state)
            elif isinstance(statement, ast.Raise):
                # A safe literal HTTPException raised "from exc" is safe; the
                # chained cause belongs in server diagnostics, not the payload.
                self._expression(statement.exc, state)
            else:
                self._expression(statement, state)

    def scan(self, function: ast.FunctionDef | ast.AsyncFunctionDef) -> list[Finding]:
        state = _State()
        arguments = [*function.args.posonlyargs, *function.args.args, *function.args.kwonlyargs]
        for argument in arguments:
            annotation = ast.unparse(argument.annotation).strip('\'"') if argument.annotation else ''
            if any(part.endswith(('Error', 'Exception')) for part in annotation.replace('|', ' ').split()):
                state[argument.arg] = EXCEPTION
        if any(isinstance(decorator, ast.Call) and _name(decorator.func).endswith('.exception_handler')
               for decorator in function.decorator_list) and len(arguments) >= 2:
            state[arguments[1].arg] = EXCEPTION
        self._statements(function.body, state)
        return list(self.findings.values())


def scan_source(source: str, path: str = '<source>') -> list[Finding]:
    tree = ast.parse(source, filename=path)
    imports: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports[alias.asname or alias.name.split('.')[0]] = alias.name if alias.asname else alias.name.split('.')[0]
        elif isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                imports[alias.asname or alias.name] = f'{node.module}.{alias.name}'
    findings = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            findings.extend(_FunctionScan(path, imports).scan(node))
    return sorted(findings, key=lambda finding: (finding.path, finding.line, finding.column))


def scan_backend(root: Path = ROOT) -> dict:
    backend = root / 'gui' / 'backend'
    sources = sorted(path for path in backend.rglob('*.py') if 'tests' not in path.relative_to(backend).parts)
    if not sources:
        raise ValueError(f'No production backend Python sources found under {backend}.')
    findings = []
    for path in sources:
        relative = path.relative_to(root).as_posix()
        try:
            findings.extend(scan_source(path.read_text(encoding='utf-8'), relative))
        except SyntaxError as exc:
            findings.append(Finding(relative, exc.lineno or 1, exc.offset or 1, 'Backend source could not be parsed.'))
    return {
        'schema': 'perdura.api-error-disclosure/v1',
        'status': 'failed' if findings else 'passed',
        'source_count': len(sources),
        'findings': [asdict(finding) for finding in findings],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args(argv)
    report = scan_backend(args.root.resolve())
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    for finding in report['findings']:
        print(f"{finding['path']}:{finding['line']}:{finding['column']}: {finding['message']}")
    print(f"API exception disclosure guard: {report['status']} ({report['source_count']} production files, {len(report['findings'])} findings).")
    return 1 if report['findings'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
