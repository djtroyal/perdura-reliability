# NIST example datasets

This directory contains the source manifest, normalized numeric snapshots, and
standalone Perdura import files for the curated NIST Dataplot examples exposed
through **Import → Example dataset…**.

The official catalog is the [NIST Dataplot dataset
index](https://www.itl.nist.gov/div898/software/dataplot/datasets.htm). Each
manifest source records its direct NIST URL and SHA-256 digest. The normalized
CSV snapshots contain only the numeric table from the corresponding `.DAT`
file; descriptive headers remain represented by manifest metadata.

Regenerate the normalized sources from downloaded `.DAT` files and rebuild all
payloads:

```bash
python tools/build_nist_examples.py --raw-dir /path/to/dat/files --write-sources --write
```

Validate committed sources and generated outputs without modifying files:

```bash
python tools/build_nist_examples.py --check
```

Grouped ALT count datasets are intentionally excluded. Perdura currently
accepts row-level exact failure times for ALT; expanding grouped counts into
invented failure times would materially change the source data. The two-stress
`TOB201` degradation file is exposed as separate 105 °C and 125 °C examples
because the current degradation input has no stress column.
