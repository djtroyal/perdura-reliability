# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Perdura Reliability Engineering and Statistics Suite.

Bundles:
  - The reliability Python library      (src/reliability/)
  - The FastAPI backend                  (gui/backend/)
  - The pre-built Vite frontend          (gui/frontend/dist/)
  - All scientific-Python dependencies   (numpy, scipy, pandas, sklearn, etc.)

Build with:
    pyinstaller perdura.spec
"""

import os, sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

repo = Path(SPECPATH)

# Collect every sub-module of our own library and heavy deps so nothing is
# missed by PyInstaller's import tracer.
hiddenimports = (
    collect_submodules('reliability')
    + collect_submodules('scipy')
    + collect_submodules('sklearn')
    + collect_submodules('numpy')
    + collect_submodules('pandas')
    + collect_submodules('uvicorn')
    + collect_submodules('fastapi')
    + collect_submodules('pydantic')
    + [
        'multiprocessing',
        'encodings',
        'encodings.idna',
    ]
)

# Data trees that must ship alongside the code.
datas = [
    # Reliability library
    (str(repo / 'src' / 'reliability'), os.path.join('src', 'reliability')),
    # FastAPI backend (routers, schemas, etc.)
    (str(repo / 'gui' / 'backend'), os.path.join('gui', 'backend')),
    # Built frontend — must run `npm run build` before packaging.
    (str(repo / 'gui' / 'frontend' / 'dist'), os.path.join('dist')),
]

# Scipy / numpy / sklearn ship data files the hooks normally collect.
datas += collect_data_files('scipy')
datas += collect_data_files('sklearn')

a = Analysis(
    [str(repo / 'perdura.py')],
    pathex=[
        str(repo / 'src'),
        str(repo / 'gui' / 'backend'),
    ],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'test', 'xmlrpc'],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Perdura',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,        # Keep console so the user sees "running at ..."
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Perdura',
)
