#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";


const here = path.dirname(fileURLToPath(import.meta.url));


function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((values) => Object.fromEntries(
    header.map((name, index) => [name, values[index] ?? ""]),
  ));
}


function readCsv(name) {
  return parseCsv(fs.readFileSync(path.join(here, name), "utf8"));
}


function numbers(row, fields) {
  const result = { ...row };
  for (const field of fields) {
    if (result[field] !== "") result[field] = Number(result[field]);
  }
  return result;
}


const findings = readCsv("re-audit-findings.csv");
const probes = readCsv("re-audit-probe-results.csv");
const statusCounts = readCsv("re-audit-status-counts.csv").map((row) => numbers(
  row, ["finding_count", "share"],
));
const scope = readCsv("re-audit-scope-comparison.csv").map((row) => numbers(
  row, ["original", "current", "delta", "percent_change"],
));
const summary = numbers(readCsv("re-audit-summary.csv")[0], [
  "changed_files", "insertions", "deletions", "original_findings",
  "resolved_findings", "partially_resolved_findings",
  "unresolved_original_findings", "new_findings", "current_critical_risks",
  "current_high_risks", "current_medium_risks", "current_low_risks",
  "original_root_tests", "current_root_tests", "current_root_warnings",
  "current_backend_tests", "focused_standard_core_tests",
  "focused_standard_backend_tests", "current_public_core_symbols",
  "current_calculation_endpoints", "current_python_lines", "current_core_modules",
]);
summary.resolved_share = summary.resolved_findings / summary.original_findings;
summary.root_test_delta = summary.current_root_tests - summary.original_root_tests;

const originalCritical = findings.filter((row) => row.original_severity === "Critical");
const remediationClosureIds = new Set(["F005", "F009", "F048", "F051"]);
const remediationClosures = findings.filter((row) => remediationClosureIds.has(row.id));
const generatedAt = new Date().toISOString();

const sources = [
  {
    id: "summary_source",
    label: "Re-audit summary and validation run",
    path: "docs/audit/re-audit-summary.csv",
    query: {
      engine: "duckdb",
      language: "sql",
      sql: "SELECT * FROM read_csv_auto('docs/audit/re-audit-summary.csv')",
      description: "Loads the original/current audit counts, repository-diff scope, and fresh validation results.",
      tables_used: ["docs/audit/re-audit-summary.csv"],
      filters: ["Baseline is commit 5362069^; current implementation is c24f96d plus the recommended-step remediation working tree"],
      metric_definitions: [
        "Resolved share = resolved original findings / 50 original findings.",
        "Current risk counts include residual severity for partially resolved original findings plus newly discovered findings.",
        "Root tests are the pyproject-configured tests/ suite; backend tests are reported separately.",
      ],
    },
  },
  {
    id: "findings_source",
    label: "Finding-by-finding re-audit reconciliation",
    path: "docs/audit/re-audit-findings.csv",
    query: {
      engine: "duckdb",
      language: "sql",
      sql: "SELECT * FROM read_csv_auto('docs/audit/re-audit-findings.csv') ORDER BY CAST(SUBSTR(id, 2) AS INTEGER)",
      description: "Reconciles every original finding with current code/tests and adds newly discovered findings.",
      tables_used: [
        "docs/audit/findings.csv",
        "docs/audit/re-audit-findings.csv",
      ],
      filters: ["All 50 original findings retained; no finding omitted because its backlog item was marked complete"],
      metric_definitions: [
        "Resolved = the original defect/gap no longer reproduces and its definition of done is materially met.",
        "Partially resolved = the primary defect is corrected but a specified semantic or diagnostic gap remains.",
        "New = not present in the original register; F051 was discovered by the re-audit and resolved in this follow-up.",
      ],
    },
  },
  {
    id: "status_source",
    label: "Original-finding disposition aggregation",
    path: "docs/audit/re-audit-status-counts.csv",
    query: {
      engine: "duckdb",
      language: "sql",
      sql: "SELECT status, finding_count, share FROM read_csv_auto('docs/audit/re-audit-status-counts.csv')",
      description: "Counts resolved, partially resolved, and unresolved dispositions across the original 50 findings.",
      tables_used: ["docs/audit/re-audit-status-counts.csv"],
      metric_definitions: ["Share denominator is the 50 original findings; the new F051 is reported separately."],
    },
  },
  {
    id: "probe_source",
    label: "Fresh analytic and adversarial probe results",
    path: "docs/audit/re-audit-probe-results.csv",
    query: {
      engine: "duckdb",
      language: "sql",
      sql: "SELECT * FROM read_csv_auto('docs/audit/re-audit-probe-results.csv') ORDER BY finding, probe",
      description: "Loads direct dimensional, analytic, monotonicity, censoring, and fail-closed probes generated by docs/audit/re-audit-probes.py.",
      tables_used: [
        "docs/audit/re-audit-probes.py",
        "docs/audit/re-audit-probe-results.csv",
      ],
      filters: ["Deterministic probes except seeded tests already recorded by the main test suite"],
      metric_definitions: ["Pass means the current output agrees with an independently stated identity or reference behavior."],
    },
  },
  {
    id: "scope_source",
    label: "Original-versus-current calculation-surface inventory",
    path: "docs/audit/re-audit-scope-comparison.csv",
    query: {
      engine: "duckdb",
      language: "sql",
      sql: "SELECT * FROM read_csv_auto('docs/audit/re-audit-scope-comparison.csv') ORDER BY metric",
      description: "Compares the current calculation surface with the inventory frozen by the original audit.",
      tables_used: ["docs/audit/audit-summary.csv", "docs/audit/re-audit-scope-comparison.csv"],
      filters: ["Core reliability modules and backend calculation routers"],
      metric_definitions: [
        "Current public-symbol count includes the 73 MIL-HDBK implementation symbols exported through the public facade.",
        "Python line count covers src/reliability and gui/backend/routers.",
      ],
    },
  },
  {
    id: "research_source",
    label: "Primary and official methodology references",
    path: "docs/audit/research-sources.md",
    query: {
      engine: "document review",
      language: "text",
      query: "Original research register plus fresh NIST interval-censoring/degradation and official scikit-learn Lasso review on 2026-07-11",
      description: "Supports the methodological distinction between observed censoring intervals and projection uncertainty, and the sparse-regression optimality assessment.",
      tables_used: ["docs/audit/research-sources.md"],
      filters: ["Primary publications or official technical documentation"],
    },
  },
];

const artifact = {
  surface: "report",
  manifest: {
    version: 1,
    surface: "report",
    title: "Perdura Methodology Re-audit",
    description: "A finding-by-finding re-audit of Perdura's mathematical, statistical, reliability, prediction, PoF, quality, and decision algorithms against the original 50-finding baseline.",
    generatedAt,
    cards: [
      {
        id: "resolved_card",
        description: "Original audit findings whose defect or gap no longer reproduces and whose completion criterion is materially met.",
        dataset: "summary",
        sourceId: "summary_source",
        metrics: [
          { label: "Original findings resolved", field: "resolved_findings", format: "number" },
          { label: "Resolved share", field: "resolved_share", format: "percent" },
        ],
      },
      {
        id: "partial_card",
        description: "Original findings that still have a corrected primary path but a remaining semantic or diagnostic gap.",
        dataset: "summary",
        sourceId: "summary_source",
        metrics: [{ label: "Partially resolved", field: "partially_resolved_findings", format: "number" }],
      },
      {
        id: "new_card",
        description: "Material findings discovered by the fresh audit; the count remains historical even after closure.",
        dataset: "summary",
        sourceId: "summary_source",
        metrics: [{ label: "New findings", field: "new_findings", format: "number" }],
      },
      {
        id: "risk_card",
        description: "Current residual/open risks after completing the re-audit's recommended remediation steps.",
        dataset: "summary",
        sourceId: "summary_source",
        metrics: [
          { label: "Current High risks", field: "current_high_risks", format: "number" },
          { label: "Current Critical risks", field: "current_critical_risks", format: "number" },
          { label: "Current Low risks", field: "current_low_risks", format: "number" },
        ],
      },
      {
        id: "tests_card",
        description: "Fresh root regression-suite result, with the original audit baseline retained as comparison context.",
        dataset: "summary",
        sourceId: "summary_source",
        metrics: [
          { label: "Root tests passing", field: "current_root_tests", format: "number" },
          { label: "Original audit", field: "original_root_tests", format: "number" },
          { label: "Delta", field: "root_test_delta", format: "number", signed: true },
        ],
      },
    ],
    charts: [
      {
        id: "finding_disposition",
        title: "Disposition of the original audit findings",
        subtitle: "All 50 original findings are resolved; partial and unresolved counts are zero.",
        intent: "comparison",
        question: "How many original findings are resolved, partial, or unresolved?",
        rationale: "Three exact disposition categories are most directly compared by bar length.",
        type: "bar",
        dataset: "status_counts",
        sourceId: "status_source",
        xAxisTitle: "Disposition",
        yAxisTitle: "Original findings",
        encodings: {
          x: { field: "status", type: "ordinal", label: "Disposition" },
          y: { field: "finding_count", type: "quantitative", label: "Original findings", format: "number" },
          tooltip: [
            { field: "share", type: "quantitative", label: "Share of original findings", format: "percent" },
            { field: "scope", type: "text", label: "Denominator" },
          ],
        },
        valueFormat: "number",
        layout: "full",
        surface: { viewMode: "both", interactiveLegend: false },
      },
    ],
    tables: [
      {
        id: "critical_resolution_table",
        title: "Original Critical finding disposition",
        subtitle: "All five primary failure modes now meet their closure criteria, including F005's former optional-path residual.",
        dataset: "original_critical",
        sourceId: "findings_source",
        defaultSort: { field: "id", direction: "asc" },
        density: "spacious",
        layout: "full",
        columns: [
          { field: "id", label: "Finding", type: "text" },
          { field: "status", label: "Current status", type: "text" },
          { field: "resolution", label: "How it changed", type: "text" },
          { field: "residual_or_limitation", label: "Remaining limitation", type: "text" },
        ],
      },
      {
        id: "remediation_closure_table",
        title: "Recommended-step implementation closure",
        subtitle: "The three residual findings and the ALT warning caveat now have direct implementation and test evidence.",
        dataset: "remediation_closures",
        sourceId: "findings_source",
        defaultSort: { field: "id", direction: "asc" },
        density: "spacious",
        layout: "full",
        columns: [
          { field: "id", label: "Finding", type: "text" },
          { field: "status", label: "Status", type: "text" },
          { field: "domain", label: "Domain", type: "text" },
          { field: "resolution", label: "Implemented change", type: "text" },
          { field: "evidence", label: "Verification evidence", type: "text" },
          { field: "residual_or_limitation", label: "Disclosed scope", type: "text" },
        ],
      },
      {
        id: "reconciliation_table",
        title: "Complete original-to-current finding reconciliation",
        subtitle: "All 50 original findings plus F051; use the evidence column to trace implementation and tests.",
        dataset: "findings",
        sourceId: "findings_source",
        defaultSort: { field: "id", direction: "asc" },
        density: "dense",
        layout: "full",
        columns: [
          { field: "id", label: "ID", type: "text" },
          { field: "original_severity", label: "Original severity", type: "text" },
          { field: "status", label: "Current status", type: "text" },
          { field: "residual_severity", label: "Residual severity", type: "text" },
          { field: "domain", label: "Domain", type: "text" },
          { field: "resolution", label: "Resolution", type: "text" },
          { field: "residual_or_limitation", label: "Residual / limitation", type: "text" },
          { field: "evidence", label: "Evidence", type: "text" },
        ],
      },
      {
        id: "scope_table",
        title: "Original versus current audit surface",
        subtitle: "Current implementation (c24f96d plus recommended-step remediation) compared with the source state assessed by the original audit.",
        dataset: "scope",
        sourceId: "scope_source",
        defaultSort: { field: "metric", direction: "asc" },
        density: "spacious",
        layout: "full",
        columns: [
          { field: "metric", label: "Measure", type: "text" },
          { field: "original", label: "Original", format: "number" },
          { field: "current", label: "Current", format: "number" },
          { field: "delta", label: "Delta", format: "number", semantic: "movement" },
          { field: "percent_change", label: "Change", format: "percent", semantic: "movement" },
          { field: "definition", label: "Definition", type: "text" },
        ],
      },
      {
        id: "probe_table",
        title: "Fresh analytic and adversarial probes",
        subtitle: "All 19 checks pass their independently stated identities or fail-closed reference behavior.",
        dataset: "probes",
        sourceId: "probe_source",
        defaultSort: { field: "finding", direction: "asc" },
        density: "spacious",
        layout: "full",
        columns: [
          { field: "finding", label: "Finding", type: "text" },
          { field: "probe", label: "Probe", type: "text" },
          { field: "current", label: "Current output", type: "text" },
          { field: "reference", label: "Reference", type: "text" },
          { field: "result", label: "Result", type: "text" },
          { field: "basis", label: "Independent basis", type: "text" },
        ],
      },
    ],
    sources,
    blocks: [
      { id: "title", type: "markdown", body: "# Perdura Methodology Re-audit" },
      {
        id: "technical_summary",
        type: "markdown",
        sourceId: "summary_source",
        body: `## Technical summary\n\n**All 50 original audit findings now meet their closure criteria, and the newly discovered F051 is also resolved.** Partial, unresolved, and current residual-severity counts are zero. The follow-up separated degradation projection uncertainty from censoring likelihood, added KKT and support-stability diagnostics to sparse regression, replaced FTA/RBD probability defaults with typed fail-closed contracts, removed non-finite ALT optimizer arithmetic, and made the reconciliation executable as a release gate.\n\n**Overall assessment: release gate passed within disclosed scope.** This means the recorded counterexamples, evidence links, and regression contracts pass; it is not regulatory certification or proof of model adequacy for every application.\n\nThe final validation baseline is ${summary.current_root_tests.toLocaleString()} passing root tests with ${summary.current_root_warnings} warnings, ${summary.current_backend_tests} passing backend tests, ${summary.focused_standard_core_tests} focused MIL/VITA core tests, ${summary.focused_standard_backend_tests} focused standards-API tests, and a ${summary.frontend_build} production frontend build.`,
      },
      { id: "headline_metrics", type: "metric-strip", cardIds: ["resolved_card", "partial_card", "new_card", "risk_card", "tests_card"] },
      {
        id: "disposition_narrative",
        type: "markdown",
        sourceId: "status_source",
        body: "## One hundred percent of the original findings now meet their closure criteria\n\nThe chart counts disposition, not effort: a finding is resolved only when the original behavior no longer reproduces and the implementation has corresponding code/test evidence. F051 remains outside the original denominator because it was discovered during the re-audit, but it is resolved and retained in the full reconciliation.",
      },
      { id: "disposition_chart", type: "chart", chartId: "finding_disposition" },
      {
        id: "critical_narrative",
        type: "markdown",
        sourceId: "findings_source",
        body: "## The five original Critical failure modes now meet full closure criteria\n\nMission-rate units, RDT boundary search, exact FTA semantics, and cumulative step-stress exposure match direct identities. Degradation uses one likelihood contribution per unit: genuine interval likelihood only for observed crossing intervals, point inputs for projected crossings, and right-censoring for non-crossing units. Delta-method projection bounds are retained as explicitly display-only uncertainty.",
      },
      { id: "critical_table_block", type: "table", tableId: "critical_resolution_table" },
      {
        id: "remediation_narrative",
        type: "markdown",
        sourceId: "findings_source",
        body: "## Every recommended remediation step is implemented\n\n**F051 now fails closed** through typed direct-probability and eight-family distribution contracts at both request and computation boundaries. **F005 now separates projection uncertainty from censoring:** only observed inspection brackets enter interval likelihood. **F048 now requires coefficient-change and KKT optimality checks** and reports a ten-times-stricter tolerance support comparison. **The ALT warning path uses an excluded finite penalty** so Powell interpolation cannot perform infinity arithmetic. **The audit register is enforced by tests** for identity retention, severity preservation, evidence paths, closure state, and fresh probes.",
      },
      { id: "remediation_table_block", type: "table", tableId: "remediation_closure_table" },
      {
        id: "reconciliation_narrative",
        type: "markdown",
        body: "## Every original finding is retained in the comparison\n\nThe table below is the audit diff: original severity, present status, implementation mechanism, evidence, and residual limitation. Broad method additions were credited only when the original decision risk was removed or made explicit; disclosed scope limitations remain visible even for resolved findings.",
      },
      { id: "reconciliation_table_block", type: "table", tableId: "reconciliation_table" },
      {
        id: "scope_narrative",
        type: "markdown",
        sourceId: "scope_source",
        body: "## Closure was tested on a substantially larger calculation surface\n\nThe re-audit did not compare equal-sized snapshots. Public calculation symbols increased by 26%, endpoint count by 6%, Python calculation code by 41%, and root regression coverage by 37%. The new inventory includes the full MIL-HDBK-217F/VITA implementation behind its public facade. This expansion raises—not lowers—the need for domain-specific validation despite the improved finding count.",
      },
      { id: "scope_table_block", type: "table", tableId: "scope_table" },
      {
        id: "standards_result",
        type: "markdown",
        sourceId: "summary_source",
        body: "## Standards conformance is now explicit and MIL/VITA coverage is materially complete\n\nF022 is resolved through machine-readable conformance tiers, clause/example disclosures, and screening labels for incomplete commercial methods. The focused current run passed 284 MIL-HDBK-217F/VITA core tests and 15 standards-API tests. MIL-HDBK-217F Notice 2 maps Sections 5–23, 217 Appendix A recipes, and Appendix B mechanisms; ANSI/VITA 51.1 activates only when selected. This is verified implementation evidence within documented scope—not contractual certification of a prediction or independent approval of the disclosed Appendix F engineering interpretation.",
      },
      {
        id: "probe_narrative",
        type: "markdown",
        sourceId: "probe_source",
        body: "## Independent probes confirm the algorithm changes, including the former residual edges\n\nThe 19-row probe harness repeats the original counterexamples using current public calculations and direct identities: FPMH dimensional conversion, the monotone chi-square RDT boundary, shared-event Boolean probability, cumulative exposure, extreme-tail hazard, target conservation, criticality, memorylessness, matrix rank, and bound ordering. Its F005, F048, and F051 negative probes now pass as release-gated closure evidence.",
      },
      { id: "probe_table_block", type: "table", tableId: "probe_table" },
      {
        id: "definitions_methodology",
        type: "markdown",
        sourceId: "summary_source",
        body: "## Scope, definitions, and methodology\n\nThe comparison baseline is the source state immediately before remediation commit `5362069`; the assessed implementation is `c24f96d` plus this recommended-step remediation. The original re-audit diff spans 190 files, 31,387 insertions, and 6,054 deletions; this follow-up changes the affected algorithms, contracts, tests, probes, and report on top of that state. The audit traced every original finding to current code and tests, reran direct probes, reviewed the expanded MIL/VITA evidence, scanned calculation paths for silent defaults and overstated labels, and reran core, backend, focused standards, and frontend validation.\n\n**Resolved** means the original behavior no longer reproduces and the completion criterion is materially met. **Partially resolved** remains a gated status but has zero rows. **New** identifies provenance outside the original register; it does not imply F051 remains open. Current severity is based on present—not historical—exposure and defaults.",
      },
      {
        id: "method_basis",
        type: "markdown",
        sourceId: "research_source",
        body: "## The implemented closures follow standard statistical semantics\n\n[NIST defines interval censoring](https://www.itl.nist.gov/div898/handbook/apr/section1/apr131.htm) as knowing that an event occurred between observation times, while its [degradation guidance](https://www.itl.nist.gov/div898/handbook/apr/section4/apr423.htm) describes fitted crossing times as projections and recommends reality checks against actual failures. Perdura now enforces that distinction: projection intervals are display-only and only observed inspection brackets enter interval likelihood.\n\nFor F048, the official [scikit-learn Lasso contract](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.Lasso.html) follows small coordinate updates with an optimality test. Perdura now evaluates the implemented penalized objective's KKT conditions and separately reports whether a ten-times-stricter tolerance refit preserves the active support.",
      },
      {
        id: "limitations",
        type: "markdown",
        body: "## Limitations, uncertainty, and robustness\n\nThis is a change-focused source-and-algorithm re-audit, not a clean-room reimplementation, regulatory certification, or exhaustive proof over all input combinations. Every original finding received a current trace, but unchanged Tier-2 paths were sampled rather than rederived line by line. Passing tests demonstrate specified behavior; they do not prove model adequacy for a user's population, mechanism, loss function, or contractual standard.\n\nThe former ALT SciPy warning path now passes warning-as-error fitter and refitted-bootstrap tests; invalid objective regions use a large finite sentinel and sentinel-valued optimizer results are ineligible. Controlled MIL/VITA documents were available locally; other commercial standards remain screening-only because licensed clause/table parity is absent. The A/V Appendix F equation uses a documented dimensional repair that should receive independent domain review before contractual use.",
      },
      {
        id: "recommended_next_steps",
        type: "markdown",
        body: "## Recommended next steps — execution complete\n\n1. **F051 complete:** typed, finite, domain-constrained FTA/RBD probability inputs cover all eight supported families; adversarial public-router tests prove there is no default substitution.\n2. **F005 complete:** extrapolated bounds are display-only projection uncertainty; interval likelihood is reserved for observed inspection bounds.\n3. **F048 complete:** lasso and elastic net require objective KKT optimality and report deterministic support stability under a stricter tolerance.\n4. **ALT warning hardening complete:** invalid regions no longer feed infinities to scalar interpolation, and the affected tests run with RuntimeWarning promoted to error.\n5. **Release gate complete:** tests preserve all 50 original identities and severities, require zero partial/open rows, validate evidence paths and scope disclosures, and rerun all 19 probes.",
      },
      {
        id: "further_questions",
        type: "markdown",
        body: "## Further questions\n\n- Is exchangeable beta-factor common cause sufficient for Perdura's intended users, or are partial-group, load-sharing, and conditional-environment models required?\n- Who will independently review the A/V Appendix F dimensional repair and the standards evidence before contractual use?\n- Which small-sample, censored, boundary, weak-identification, and sparse-selection regimes should be added to the uncertainty coverage matrix next?\n- Should degradation projection uncertainty eventually move from first-order delta bounds to a joint hierarchical degradation/life model?",
      },
    ],
  },
  snapshot: {
    version: 1,
    generatedAt,
    status: "ready",
    datasets: {
      summary: [summary],
      status_counts: statusCounts,
      original_critical: originalCritical,
      remediation_closures: remediationClosures,
      findings,
      scope,
      probes,
    },
  },
  sources,
};

const output = process.argv[2] || path.join(here, "re-audit-artifact.json");
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(output);
