# Dependency Management

Perdura is distributed primarily as a cross-platform Python application wheel,
a Linux standalone archive, and a multi-architecture container. Its
dependency policy therefore separates two concerns that are easy to conflate:

- `pyproject.toml` describes the Python APIs that the source tree requires.
- `uv.lock` records the exact dependency graph used to test and build Perdura.

The lock file, not a rolling lower-bound edit, controls what goes into an
application release.

## Source requirements and the binary lock

The bounds in `pyproject.toml`, such as `numpy>=2.0`, are source-install
compatibility metadata. A lower bound changes only when Perdura begins using
an API unavailable in earlier versions or deliberately drops that source
compatibility. It should not be raised merely because a newer package was
published.

Perdura does not claim that every historical combination satisfying those
bounds has been tested. Supported development, CI, container, and desktop
environments are installed from the checked-in `uv.lock`. That lock contains
the exact resolved versions, environment markers, artifact URLs, and hashes.
New upstream releases do not affect an existing checkout or release until the
lock is intentionally refreshed and validated.

Python dependencies have one manifest:

- `[project.dependencies]` contains the reliability library's scientific
  runtime.
- The `app` extra contains FastAPI, Uvicorn, Pydantic, scikit-learn, and the
  ONNX export/runtime stack used by the Perdura application.
- The `dev` dependency group contains test tooling.
- The `release` dependency group contains PyInstaller.
- `tool.uv.build-constraint-dependencies` pins the PEP 517 backend used to
  build Perdura itself, so even the local editable build cannot silently pick
  up a future setuptools release.

The installed Python distribution is named `perdura`. Its long-established
scientific import namespace remains `reliability` (for example,
`from reliability import Weibull_Distribution`); changing the distribution
metadata does not require a disruptive source-wide import rename.

The release version is declared consistently in `pyproject.toml`,
`src/reliability/_version.py`, `src/perdura_app/_version.py`,
`gui/frontend/package.json`, the npm lock, and `uv.lock`. CI runs
`tools/check_version_consistency.py`, and release tags are
rejected if their version does not match those declarations. Use
`tools/bump_version.py`; the complete release and project compatibility policy
is in [`VERSIONING.md`](../VERSIONING.md).

Do not introduce another independently maintained requirements file. Separate
resolver transactions can select different transitive packages and make CI,
containers, and desktop builds disagree.

## Supported environment matrix

The following matrix is encoded in `pyproject.toml` and resolved by
`uv.lock`:

| Purpose | Operating system | Architecture | CPython |
|---|---|---:|---:|
| Python local application | Linux | x86_64, ARM64 | 3.13.14 |
| Python local application | Windows | AMD64 | 3.13.14 |
| Python local application | macOS | arm64, x86_64 | 3.13.14 |
| Standalone archive | Linux | x86_64 | bundled 3.13.14 |
| Container | Linux | x86_64, ARM64 | 3.13.14 |
| Library/application CI | Linux | x86_64 | 3.11, 3.12, 3.13, and 3.14 |

Every listed local-application environment installs the candidate wheel and
runs native dependency and launcher diagnostics on a real hosted runner. The
container is built natively on both advertised architectures and published as
one OCI manifest. Other platforms may work from source but are not supported
release targets until they have equivalent actual-runner evidence.

The project currently supports Python `>=3.11,<3.15`. The default release
interpreter is recorded in `.python-version`; release automation should pin
the same Python patch version rather than relying on a moving minor-version
alias. Application jobs use `uv python install 3.13.14` and `--managed-python` so
Linux, Windows, and macOS all receive that exact patch even when a runner's
built-in Python toolcache does not provide it.

Python 3.13 is the canonical release series because the locked native stack is
available across every supported target, including Intel macOS. Python 3.14
remains a compatibility-test target until the complete native stack publishes
equivalent wheels for every release architecture.

## Tool version

The lock is managed with **uv 0.11.29**, enforced by
`tool.uv.required-version` in `pyproject.toml`. Pin the same uv version in CI,
release automation, and container builds. uv lock-file schema compatibility is
versioned, so an unreviewed tool upgrade is itself a dependency-management
change.

Install this version using an official uv package or installer, then confirm:

```bash
uv --version
```

## Everyday development

Create or exactly synchronize the project environment from the committed lock:

```bash
uv sync --locked --extra app --group dev
```

`uv sync` creates `.venv` automatically and removes undeclared packages. The
`--locked` flag also fails if `pyproject.toml` and `uv.lock` disagree; do not
replace it with `--frozen`, which uses the lock without checking freshness.

Run tools inside that environment without allowing an implicit re-resolution:

```bash
uv run --locked --no-sync pytest tests gui/backend/tests
uv run --locked --no-sync python tools/check_model_assurance.py
```

For a library-only environment, omit `--extra app`. For an application runtime
without development tools, use:

```bash
uv sync --locked --extra app --no-dev
```

## Adding or changing a dependency

Add a dependency to the narrowest appropriate set. For example:

```bash
uv add --optional app PACKAGE
uv add --group dev PACKAGE
uv add --group release PACKAGE
```

Review both `pyproject.toml` and `uv.lock`. A direct requirement belongs in the
manifest; transitive requirements belong only in the lock. Never edit
`uv.lock` by hand.

If the new dependency supports only a subset of the release matrix, either
select a compatible version or make the platform limitation an explicit,
reviewed product decision. Do not allow an unplanned source build to make one
release target differ from the others.

## Refreshing locked versions

Use a targeted refresh when possible:

```bash
uv lock --upgrade-package PACKAGE
```

Use a full refresh only as a deliberate coordinated stack update:

```bash
uv lock --upgrade
```

After either command:

1. Run `uv lock --check`.
2. Run the complete Python and backend test suites on Python 3.11 through 3.14.
3. On each local-application target, prove all third-party packages have wheels,
   install the candidate `perdura-<version>-py3-none-any.whl[app]`, and run
   `perdura doctor` plus native-import/ONNX checks.

4. On Linux x86-64, validate the standalone build environment and add Perdura's
   local project:

   ```bash
   uv sync --locked --extra app --no-dev --group release \
     --no-install-project --no-build --no-cache
   uv sync --locked --extra app --no-dev --group release --no-cache
   ```

5. Build with `uv run --locked --no-sync pyinstaller perdura.spec` on Linux
   x86-64. Direct unsigned macOS and Windows bundles are not release targets.
6. Build both Linux container architectures from the same lock and publish one
   multi-architecture manifest.
7. Review numerical or plotting changes introduced by scientific packages,
   even when unit tests pass.

Both `--no-build` and `--no-cache` matter for the release gate. `--no-build`
rejects a dependency that needs an sdist build, while `--no-cache` prevents a
wheel built during an earlier job from concealing that missing published
wheel. Because `--no-build` also rejects Perdura's editable source package,
the first sync deliberately excludes the project. The second locked sync adds
that project to the already-validated environment.

## CI and release rules

- CI checks the lock and synchronizes with `--locked`; it never refreshes the
  lock as a side effect.
- Release jobs consume the committed lock on the real target operating system.
- Dependency-change pull requests must run the candidate application wheel,
  native-import, backend-import, and ONNX inference checks on Linux x86-64/ARM64,
  Windows x86-64, and macOS x86-64/ARM64—not only the Ubuntu unit-test matrix.
  The release workflow additionally builds PyInstaller on Linux x86-64 and OCI
  images on both Linux architectures.
- Python, uv, runner images, container base images, and GitHub Actions should
  be pinned independently. `uv.lock` makes Python packages reproducible; it
  does not freeze the operating system or build toolchain.
- Each release retains a complete installed-package manifest, the `uv.lock`
  digest, and critical native-import/ONNX results inside its consolidated
  verification-evidence bundle so the contents of a shipped artifact can be
  audited later without crowding the release page with individual records.

## Dependabot policy

Dependabot monitors the root project with the `uv` ecosystem and
`versioning-strategy: lockfile-only`. This updates the resolved environment
instead of turning broad source API bounds into rolling latest-version floors.

Updates are grouped by compatibility surface:

- NumPy, SciPy, Matplotlib, pandas, and scikit-learn;
- ONNX, ONNX Runtime, and skl2onnx;
- FastAPI, Uvicorn, Pydantic, PyInstaller, and setuptools.

Routine groups are limited to minor and patch changes. Major changes require a
deliberate migration and the complete release-matrix validation above.
Security updates still receive priority. If a security fix falls outside a
manifest bound, update that bound explicitly with the rationale rather than
bypassing the lock.

## End-user application rule

The PyPI wheel contains the built interface and an exact, lock-derived `app`
extra. Install it with uv as an isolated tool, not into an unrelated Python
environment:

```bash
uv tool install --python 3.13.14 'perdura[app]'
perdura doctor
```

The attached `Perdura-<version>-application-constraints.txt` makes the resolved
application set independently inspectable. The ordinary base dependencies stay
as API lower bounds for library consumers; the `app` extra is what makes a local
application installation release-exact.

## Source-deployment rule

A deployment host installs, but does not resolve, dependencies:

```bash
uv sync --locked --extra app --no-dev
```

Do not run `uv lock`, `uv lock --upgrade`, or an unconstrained `pip install` on
the deployment host. Build a new reviewed artifact when dependencies change.

## Frontend Plotly dependency exception

The React wrapper uses `react-plotly.js` 4.1.0 through its public ESM
`react-plotly.js/factory` export. Its bundled framework declarations replace
`@types/react-plotly.js`; the application explicitly declares plot data, layout,
and configuration with the direct `@types/plotly.js` development dependency.
Vite prebundles the lazy factory and deduplicates React without forcing the
legacy CommonJS export shape.

As checked on 2026-09-14, Plotly 3.7.0 is the newest stable 3.x release and
requires MapLibre `^4.7.1`. Plotly 4.1.0 still requires MapLibre `^5.24.0`, so
changing Plotly's major version does not resolve the reviewed MapLibre advisory.
The manifest therefore overrides only `plotly.js`'s MapLibre dependency to
the patched **6.4.1** for
[GHSA-jrc7-96c5-q579](https://github.com/advisories/GHSA-jrc7-96c5-q579), pinned
for explicit review. This is a scoped exception
for Perdura's existing custom bundle, which registers no map traces. The Vite
build rejects MapLibre/Mapbox runtime modules if future imports bring them into
the application. This does not establish Plotly map compatibility with MapLibre
6; adding maps requires a separate compatibility and security review. Remove
the override when a supported upstream Plotly dependency resolves the advisory.

Interactive HTML downloads and ZIP plot exports share a serializer that
preserves supported trace data and explicitly rejects unsupported trace types
and map layouts. The exported documents continue to load the compatible full
Plotly **3.7.0 CDN bundle**. That separately sourced runtime is not modified by
the npm override or covered by the application lockfile audit. Export documents
require access to that CDN; do not claim that its embedded MapLibre dependency
has been patched by this change. Previously exported files remain unchanged.

For dependency changes run `npm ci`, `npm run build`,
`npm run test:plotly-interop`, and `npm audit` from `gui/frontend`. Also exercise
the production application with `npm run assurance:plotly -- --base-url
http://127.0.0.1:8000 --output-dir plotly-browser-assurance`. This browser check
covers Cartesian, 3D and Sankey rendering, resizing, annotations, reset, and
SVG and HTML downloads. The product assurance workflow retains its evidence.
Keep `postcss-selector-parser` at the reviewed compatible 6.1.4 lock resolution
or a subsequent reviewed fix within the parent ranges.

## References

- [uv: locking and syncing](https://docs.astral.sh/uv/concepts/projects/sync/)
- [uv: universal and platform-specific resolution](https://docs.astral.sh/uv/concepts/resolution/)
- [setup-uv: uv-managed Python on GitHub Actions](https://github.com/astral-sh/setup-uv#faq)
- [uv: locking requirements](https://docs.astral.sh/uv/pip/compile/)
- [GitHub: Dependabot versioning strategies](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#versioning-strategy)
