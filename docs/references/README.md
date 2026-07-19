# Local reference library

This directory is a working library for standards and technical reports used
during Perdura reviews. New PDFs are intentionally ignored by Git: licensing,
redistribution terms, and source-site conditions vary even when a report is
publicly readable.

Do not force-add a reference PDF. Record its identity, SHA-256, acquisition and
review status, relevant findings, and redistribution status in the applicable
evidence catalog. The current catalog is
[`../standards/mil-hdbk-217f-evidence.json`](../standards/mil-hdbk-217f-evidence.json);
its `documents` collection also records related derating and lineage sources.
The repository keeps only metadata for newly supplied sources.

The two existing controlled PDFs allowlisted by policy are:

- `MIL-HDBK-217F-Notice2.pdf`
- `AV51DOT1-2013-R2018.pdf`

Run `python tools/check_reference_evidence.py` after adding or reviewing a local
source. The check verifies known hashes when the corresponding local file is
present and prevents accidental PDF tracking.
