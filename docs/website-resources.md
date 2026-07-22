# Companion Website Resources

Perdura owns the product screenshot inventory used by
[`perdura-website`](https://github.com/djtroyal/perdura-website). The inventory,
capture instructions, accessible labels, grouping, and preferred image for each
feature live in [`gui/frontend/website/captures.mjs`](../gui/frontend/website/captures.mjs).
The website consumes the generated manifest rather than maintaining a second
hand-written screenshot catalog.

## Generate locally

Install the locked frontend dependencies and the Chromium runtime once:

```bash
npm ci --prefix gui/frontend
npx --prefix gui/frontend playwright install chromium
```

Then build Perdura and generate the complete resource bundle:

```bash
npm run website:resources --prefix gui/frontend
```

The default output is `build/website-resources/`:

- `screenshots/` — deterministic 2280 × 1365 PNG captures;
- `screenshots.generated.json` — ordered website metadata and SHA-256 per image;
- `build-provenance.json` — product version, source commit, demo-project hash,
  browser, viewport, warnings, and comparison summary;
- `diff-report.json` and `diffs/` — informative pixel comparisons when a
  baseline is supplied;
- `index.html` — a local review sheet;
- `SHA256SUMS` — checksums for the unpacked bundle; and
- `Perdura-website-resources.zip` — the portable bundle.

To compare against a local website checkout without making visual changes a
pass/fail criterion:

```bash
npm run website:resources --prefix gui/frontend -- \
  --baseline ../perdura-website/public/screenshots
```

Missing captures, duplicate or incomplete metadata, implausible dimensions,
blank images, application error boundaries, and PNGs over 1 MB fail the build.
Pixel changes are reported for review but do not fail CI. Files over 400 KiB
produce an optimization warning.

## Deterministic capture state

The capture-only `perduraShowcase=1` URL loads the bundled Perdura Demo Project
and selects each registered module or analysis. Results-oriented captures then
load a reviewed, per-analysis state fixture from
`gui/frontend/public/website-showcase/`. Those fixtures contain outputs produced
by the real Perdura API; the ordinary screenshot build never substitutes mock
results or silently recalculates an analysis. Views whose plots are derived
directly from the demo dataset retain the exact source-data slices needed to
reproduce the view.

Regenerate the fixtures explicitly after a calculation contract or example
changes:

```bash
npm run website:seed-results --prefix gui/frontend
```

The seeding command starts the local frontend and API, runs every registered
results-oriented example, rejects HTTP errors and empty result states, and
writes a hashed fixture index. The screenshot build independently rejects any
results-oriented view that still displays “No results yet”, a run prompt, an
analysis failure, or an application error boundary. The provenance record hashes
both the demo project and the completed-analysis fixture index.

External network requests are blocked during capture. Locale, timezone, color
scheme, motion, viewport, and device scale are fixed. The version endpoint is
fulfilled from the checked-out package metadata so the output does not depend
on a separately running API service.

## CI and website synchronization

Every pull request and main-branch build runs the complete capture set. The
resource manifest, checksums, review page, and generated PNGs are included in
Perdura's verification evidence and uploaded as a CI artifact. Main-branch CI
success triggers `.github/workflows/sync-website-resources.yml`, which validates
the companion website and opens or updates the rolling
`automation/perdura-screenshots` pull request.

Configure a GitHub App installed on `djtroyal/perdura-website` with repository
Contents and Pull requests read/write permission. Store its credentials on the
Perdura repository as:

- repository variable `PERDURA_WEBSITE_APP_CLIENT_ID`; and
- repository secret `PERDURA_WEBSITE_APP_PRIVATE_KEY`.

If either value is absent, synchronization is skipped with a workflow warning;
capture validation and resource artifacts still run normally.

## Adding or changing a view

1. Add a stable `data-tab-id` or purpose-specific `data-showcase-control` to
   the relevant Perdura control when one does not already exist.
2. Register the capture in `gui/frontend/website/captures.mjs` with a stable ID,
   website module, group, filename, title, alt text, and deterministic actions.
3. For a results-oriented view, provide valid demo inputs or a reviewed example,
   then run `npm run website:seed-results --prefix gui/frontend`.
4. Run `npm run test:website-resources --prefix gui/frontend`.
5. Generate the bundle against the current website baseline and review
   `index.html` plus `diff-report.json`.

Do not add private customer data, arbitrary delays, or live external services
to a capture. Prefer the bundled demo and explicit readiness selectors.
