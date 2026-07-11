# Perdura methodology audit — visual map

These visual contracts follow the data-visualization workflow used for the portable report. Both charts are native report charts backed by bounded snapshot datasets; exact rows remain available through the source view and semantic fallback tables.

## `finding_severity`

- Decision question: How much of the audited risk requires immediate or near-term remediation?
- Source: `docs/audit/findings.csv`.
- Grain: one row per severity level after counting the 50 reviewed findings.
- Chart: vertical bar.
- X: severity, ordered Critical, High, Medium, Low.
- Y: finding count.
- Context retained in the snapshot: risk weight, share of all findings and cumulative count.
- Why this form: four exact categories are fastest to compare by length; a pie would make the combined Critical+High threshold harder to judge.
- QA: counts sum to 50; Critical=5, High=21, Medium=21, Low=3; axis begins at zero; no redundant color encoding or legend.

## `remediation_workload`

- Decision question: How is the proposed engineering work distributed across release priorities?
- Source: `docs/audit/backlog-summary.csv` and `docs/audit/implementation-backlog.md`.
- Grain: one row per priority tier.
- Chart: vertical bar.
- X: priority, ordered P0 through P3.
- Y: backlog item count.
- Context retained in the snapshot: objective and a relative effort index using S=1, M=2, L=3 and XL=5. The index is for comparison only and is not a duration estimate.
- Why this form: the chart emphasizes release-gate workload; the exact ordered backlog remains the primary implementation artifact.
- QA: item counts sum to 22; priority order is explicit; the effort index is tooltip context, not a second mixed-scale series.

## Accessibility and rendering

- Every chart has a descriptive title, decision-oriented subtitle and explicit axis labels.
- Exact chart data is embedded in the self-contained report and rendered as a semantic fallback table when charts are unavailable.
- The report uses no custom SVG, CSS bars, external script, remote font or CDN dependency.
