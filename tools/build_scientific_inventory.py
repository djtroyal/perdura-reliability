#!/usr/bin/env python3
"""Inventory the public scientific code surface separately from assurance claims.

Discovery is deliberately conservative: public core definitions and statically
declared router operations are included even when they still need classification.
An entry proves discoverability, never mathematical validity or model completeness.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / 'docs/audit/scientific-surface-inventory.json'


def _fingerprint(node: ast.AST) -> str:
    return hashlib.sha256(ast.dump(node, include_attributes=False).encode()).hexdigest()


def build_inventory(root: Path = ROOT) -> dict:
    matrix_path = root / 'docs/audit/model-assurance-matrix.json'
    matrix = json.loads(matrix_path.read_text()) if matrix_path.exists() else {'models': []}
    records = []
    for directory, surface in [('src/reliability', 'core'), ('gui/backend/routers', 'api')]:
        for path in sorted((root / directory).glob('*.py')):
            if path.name.startswith('_'):
                continue
            source = path.relative_to(root).as_posix()
            tree = ast.parse(path.read_text(encoding='utf-8'))
            for node in tree.body:
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    continue
                if surface == 'core':
                    if node.name.startswith('_'):
                        continue
                    symbols = [(node.name, node)]
                    if isinstance(node, ast.ClassDef):
                        symbols += [(f'{node.name}.{child.name}', child) for child in node.body
                                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
                                    and not child.name.startswith('_')]
                    for symbol, definition in symbols:
                        records.append({
                            'id': f'core.{path.stem}.{symbol}', 'surface': surface,
                            'kind': 'class' if isinstance(definition, ast.ClassDef) else 'callable',
                            'source': source, 'symbol': symbol,
                            'definition_sha256': _fingerprint(definition),
                        })
                else:
                    for decorator in node.decorator_list:
                        if (not isinstance(decorator, ast.Call)
                                or not isinstance(decorator.func, ast.Attribute)
                                or decorator.func.attr not in {'get', 'post', 'put', 'patch', 'delete'}
                                or not decorator.args
                                or not isinstance(decorator.args[0], ast.Constant)
                                or not isinstance(decorator.args[0].value, str)):
                            continue
                        route = decorator.args[0].value
                        method = decorator.func.attr.upper()
                        records.append({
                            'id': f'api.{path.stem}.{method}.{route}', 'surface': surface,
                            'kind': 'router_operation', 'source': source, 'symbol': node.name,
                            'router': path.stem, 'method': method, 'route': route,
                            'definition_sha256': _fingerprint(node),
                        })

    for record in records:
        mappings = []
        for model in matrix['models']:
            for reference in model.get('implementation', []):
                file, _, symbol = reference.partition('::')
                if file == record['source'] and symbol == record['symbol']:
                    mappings.append({
                        'procedure_id': model['id'], 'status': model['status'],
                        'claim_ids': [claim['id'] for claim in model.get('claims', [])],
                    })
                    break
        record['assurance_records'] = mappings
        record['assessment'] = 'mapped' if mappings else 'classification_pending'

    records.sort(key=lambda row: row['id'])
    ids = [row['id'] for row in records]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate public scientific surface identity.')
    return {
        'schema_version': 1,
        'discovery_scope': 'public_core_definitions_and_static_router_operations',
        'model_inventory_complete': False,
        'interpretation': (
            'Discovery is not certification. Unmapped entries require classification; '
            'a route or callable may implement multiple models, estimands and regimes. '
            'Public methods and output claims are recorded separately. Imported aliases '
            'and dynamically registered operations require the independent OpenAPI audit.'),
        'summary': {
            'entries': len(records),
            'core_entries': sum(row['surface'] == 'core' for row in records),
            'router_operations': sum(row['surface'] == 'api' for row in records),
            'mapped_entries': sum(bool(row['assurance_records']) for row in records),
        },
        'entries': records,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    payload = build_inventory()
    if args.write:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n')
    else:
        if not args.output.exists() or json.loads(args.output.read_text()) != payload:
            print('Scientific surface inventory is stale; regenerate with --write.')
            return 1
    print(json.dumps(payload['summary'], sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
