# Local reference library search

Help → Reference library provides read-only keyword and phrase search over
three selected editions already listed in the local evidence catalog:

| Local edition | Official source record |
|---|---|
| MIL-HDBK-217F Notice 2 | [DLA ASSIST](https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=53939) |
| ANSI/VITA 51.1-2013 (R2018) | [VITA standards catalog](https://www.vita.com/Standards) |
| MIL-HDBK-338B | [DLA ASSIST](https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=54022) |

The local edition and date are retained even when an official record offers a
newer revision. Each result includes its one-based physical PDF page, a short
context excerpt, verified SHA-256 and official source link. PDF page numbers
are not asserted to equal printed pagination. Copy citation preserves the
edition, date, page, hash and link. All-word, any-word and exact-phrase searches
are case-insensitive literal matches; at most 50 matching pages are returned
per API request (30 in the Help interface).

`GET /api/references/catalog` supplies metadata without extracting text.
`POST /api/references/search` accepts document IDs from the explicit allowlist,
never filesystem paths or uploads. Only a single PDF basename directly under
`docs/references` is accepted; symlinks escaping that directory are rejected.
The SHA-256 must match `docs/standards/mil-hdbk-217f-evidence.json` before any
page text is returned. A mismatched or absent file is reported as unavailable.
The existing local-library policy continues to govern source acquisition;
this feature adds no PDFs or PDF download endpoint.

Text extraction is lazy, using `pdftotext` when available and an already
installed `pypdf` otherwise. A missing extractor produces an explicit
unavailable status while metadata and worked examples remain accessible.
No OCR is performed. Extraction is limited to 100 MB source files, 2,500 pages
and 32 MB text. The external extractor has a 30-second timeout. Text is cached
only in process memory for at most three sources. A changed file identity
(inode, size, modification or change timestamp) or catalog hash invalidates
that entry and requires another hash check. A source changing during
extraction is rejected.

The library also includes existing bibliography links and independent worked
examples for conditional mean life, mechanical age replacement and inspection
prediction. Opening an example navigates Help without editing an analysis.
Their implementation and numerical checks are described in
[`lifetime-planning-tools.md`](lifetime-planning-tools.md).

Verification: `gui/backend/tests/test_reference_search.py` checks citation
identity, real supplied PDF extraction, cache invalidation, hash mismatch,
search modes, allowlist/path boundaries and extractor absence.
`gui/frontend/tests/referenceLibraryBrowser.mjs` exercises the production Help
interface against the real backend handlers and supplied 217F PDF, including
read-only navigation to the worked example. The existing Help contract test
validates all new topics, equations, references and related-topic links.

## Installed applications and containers

The application package carries only selected catalog metadata in
`perdura_app/data/reference-catalog.json`; no reference PDFs are bundled with
the wheel, desktop application or container. The metadata is checked against
the source evidence catalog in the backend tests. A source checkout continues
to use `docs/standards/mil-hdbk-217f-evidence.json` and `docs/references`.

Set `PERDURA_REFERENCE_DIRECTORY` before launching Perdura to choose the folder
containing your local copies. The same filename/hash allowlist applies there.
Installed Python and desktop applications otherwise look in
`~/.perdura/references`; a missing folder is allowed and is never created by
page search. The container defaults to `/references`, which can be mounted
read-only, for example `--mount type=bind,src=/absolute/local/references,dst=/references,readonly`.
The Help library remains usable for source metadata, links and worked examples
when no PDFs are installed, and reports each document as not installed.

The application dependency set includes `pypdf` for platforms without
`pdftotext`. PyInstaller includes its modules and the metadata resource. A
forced-fallback test reads the actual controlled 217F PDF using `pypdf`; it is
skipped only when that local PDF or the optional application dependency is
absent from the test environment.
