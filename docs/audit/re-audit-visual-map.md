# Perdura re-audit visual map

## `finding_disposition`

- Report segment: original finding disposition.
- Analytical question: how many of the original 50 findings are resolved,
  partially resolved, or wholly unresolved?
- Takeaway: all 50 are resolved; partial and unresolved counts are zero.
- Family and type: categorical comparison, single-series vertical bar.
- Fields: `status` and `finding_count`; `share` and `scope` remain available in
  the tooltip/source table.
- Data sufficiency: three exhaustive categories that sum to 50. A trend or
  distribution chart would imply a structure the evidence does not have.
- Palette: single-root preferred with neutral axes; status is also named on the
  axis and preserved in the semantic table, so color is not the only cue.
- Scale: zero baseline, integer count axis.
- Delivery: native chart in `re-audit-artifact.json`, packaged into
  `perdura-methodology-re-audit.html` with the exact-data semantic fallback.
- QA: canonical validation and payload/semantic structural verification passed.
  Enhanced-reader viewport and source-dialog checks were not run because no
  compatible installed Chromium executable was available.
