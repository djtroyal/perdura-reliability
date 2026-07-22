import type { HelpSection, HelpTopic } from '../types'
import { code, equation, example, list, note, p } from '../types'

const REVIEWED = '2026-07-17'

const section = (
  id: string,
  title: string,
  depth: HelpSection['depth'],
  blocks: HelpSection['blocks'],
): HelpSection => ({ id, title, depth, blocks })

export const OPERATIONS_HELP_TOPICS: HelpTopic[] = [
  {
    id: 'api.overview',
    moduleId: 'api',
    title: 'Perdura API',
    summary: 'Use the versioned, stateless HTTP API to run Perdura calculations or automate a collection of analyses from a project recipe.',
    aliases: ['REST API', 'HTTP API', 'automation', 'integration'],
    keywords: ['openapi', 'swagger', 'curl', 'python', 'ndjson', 'api v1'],
    basics: {
      purpose: 'Expose the same numerical engines used by the interactive application to scripts, controlled pipelines, and external engineering tools.',
      useWhen: ['Repeating a validated calculation', 'Integrating Perdura with a data pipeline', 'Batch-running related analyses'],
      inputs: ['JSON matching the selected operation schema or a Perdura project plus an API run recipe'],
      outputs: ['JSON results, NDJSON progress streams, or a checksummed structured-results ZIP'],
      assumptions: ['The API is stateless and stores no projects or jobs.', 'Network deployments must place Perdura behind an authenticated TLS proxy.'],
    },
    sections: [
      section('discover', 'Discover the live contract', 'practice', [
        list([
          'Open /api/v1/docs for interactive Swagger documentation or /api/v1/redoc for a reference view.',
          'Call GET /api/v1/catalog to enumerate modules, analyses, operation IDs, paths, and streaming support.',
          'Use /api/v1/openapi.json to generate a client or validate requests in a controlled build pipeline.',
        ]),
        code('curl http://localhost:8000/api/v1/health\ncurl http://localhost:8000/api/v1/catalog', 'bash', 'Check the service and discover analyses'),
      ]),
      section('identity', 'Version and traceability', 'interpretation', [
        p('Every response identifies the API version, Perdura version, source commit, and request ID in HTTP headers. Complete non-streaming responses also carry X-Perdura-Content-SHA256 for byte-level integrity checking.'),
        note('important', 'A checksum detects changed bytes but is not a digital signature and does not establish the identity of the producer.', 'Integrity is not authentication'),
      ]),
      section('boundary', 'Stateless deployment boundary', 'advanced', [
        p('Ordinary calls finish in one response. Long-capable operations provide an adjacent /stream route using newline-delimited JSON. No polling database, session affinity, or server-side project storage is required.'),
      ]),
      section('evidence', 'Contract verification evidence', 'advanced', [
        p('Each CI build publishes the exact OpenAPI document, a module-by-module API contract matrix, and the backend JUnit contract results in the build-verification evidence bundle. The matrix fails closed for unversioned routes, duplicate operation IDs, missing response schemas or standard errors, incomplete stream declarations, and catalog mismatches.'),
      ]),
    ],
    related: ['api.calculations', 'api.projects', 'api.security'],
    reviewed: '2026-07-21',
    exampleKind: 'none',
  },
  {
    id: 'api.calculations', moduleId: 'api', title: 'Run an Analysis',
    summary: 'Send a schema-validated JSON request to the operation listed in the API catalog and retain its identity headers with the result.',
    aliases: ['API request', 'calculation endpoint'], keywords: ['post', 'json', 'response', 'python requests'],
    basics: {
      purpose: 'Run one Perdura numerical operation without opening the graphical interface.',
      inputs: ['An operation path and request body taken from the live OpenAPI schema'],
      outputs: ['A typed JSON result or a structured error'],
      assumptions: ['Input units and confidence conventions remain operation-specific and are declared in its schema.'],
    },
    sections: [
      section('curl', 'Call an operation', 'practice', [
        code("curl -sS http://localhost:8000/api/v1/life-data/calculate \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"distribution\":\"Weibull_2P\",\"params\":{\"eta\":1000,\"beta\":2},\"mission_end\":500}'", 'bash', 'Evaluate a fitted life distribution'),
      ]),
      section('python', 'Use Python requests', 'interpretation', [
        code("import requests\n\nurl = 'http://localhost:8000/api/v1/life-data/calculate'\npayload = {\n    'distribution': 'Weibull_2P',\n    'params': {'eta': 1000, 'beta': 2},\n    'mission_end': 500,\n}\nresponse = requests.post(url, json=payload, timeout=60)\nresponse.raise_for_status()\nprint(response.json())\nprint(response.headers['X-Perdura-Content-SHA256'])", 'python', 'Run and identify a calculation'),
      ]),
      section('errors', 'Handle rejected requests', 'advanced', [
        p('Errors contain error.code, error.message, error.issues, and error.request_id. A 422 response identifies schema violations; a 400 response identifies mathematically or semantically invalid model inputs. Do not parse human-readable messages as stable codes.'),
      ]),
    ], related: ['api.overview', 'api.progress'], reviewed: '2026-07-21', exampleKind: 'none',
  },
  {
    id: 'api.progress', moduleId: 'api', title: 'Progress Streams',
    summary: 'Consume NDJSON start, progress, result, and error events for bootstrap, simulation, model-comparison, and project runs.',
    aliases: ['NDJSON', 'streaming API'], keywords: ['progress', 'stream', 'cancel', 'long running'],
    basics: { purpose: 'Display progress without introducing server-side job storage.', inputs: ['The same request body as the corresponding synchronous operation'], outputs: ['One JSON event per line'], assumptions: ['The client must read the response incrementally and treat result or error as terminal.'] },
    sections: [
      section('consume', 'Consume events incrementally', 'practice', [
        code("import json\nimport requests\n\nwith requests.post(url + '/stream', json=payload, stream=True, timeout=300) as response:\n    response.raise_for_status()\n    for line in response.iter_lines():\n        if line:\n            event = json.loads(line)\n            print(event['type'], event)", 'python', 'Read an NDJSON stream'),
      ]),
      section('meaning', 'Interpret terminal events', 'interpretation', [list(['start declares the work scope.', 'progress reports completed and total work where measurable.', 'result contains the completed calculation and its provenance.', 'error is terminal and carries a stable code plus a reviewable message.'])]),
      section('disconnect', 'Cancellation boundary', 'advanced', [p('Closing a streaming connection requests cancellation where the numerical engine supports it. Some compiled numerical calls can only stop at their next safe progress boundary.')]),
    ], related: ['api.calculations', 'api.projects'], reviewed: '2026-07-21', exampleKind: 'none',
  },
  {
    id: 'api.projects', moduleId: 'api', title: 'Validate, Run & Export Projects',
    summary: 'Submit a portable project and explicit analysis recipe, resolve dependencies, and receive updated results without creating server-side state.',
    aliases: ['project runner', 'batch API'], keywords: ['validate', 'dependencies', 'zip', 'apiRuns', 'batch'],
    basics: { purpose: 'Run multiple related analyses reproducibly and package their machine-readable evidence.', inputs: ['Current Perdura project schema and API run items with stable operation IDs'], outputs: ['Updated project JSON, per-analysis status, or a structured ZIP'], assumptions: ['Dependencies form an acyclic graph.', 'Report PDF and rendered plot images remain interactive-UI exports.'] },
    sections: [
      section('workflow', 'Project-run workflow', 'practice', [list(['Export a results-included project from Perdura.', 'Use GET /api/v1/catalog to choose project-runnable operation IDs.', 'POST the project and analysis recipe to /api/v1/projects/validate.', 'Run /api/v1/projects/run or /run/stream after validation succeeds.', 'Use /api/v1/projects/export for project.json, result JSON/CSV, and a checksum manifest in one ZIP.'], undefined, true)]),
      section('references', 'Pass upstream results', 'interpretation', [p('Declare depends_on IDs to establish execution order. Within a later input, an object containing $result and an optional JSON Pointer is replaced with the referenced upstream result before validation and execution.')]),
      section('partial', 'Partial completion', 'advanced', [p('Independent analyses continue after a failure by default. Dependents become blocked, and the summary distinguishes completed, failed, blocked, and skipped work. Set fail_fast only when the controlled workflow requires immediate termination.')]),
    ], related: ['api.overview', 'api.progress', 'dashboard.artifact-verification'], reviewed: '2026-07-21', exampleKind: 'none',
  },
  {
    id: 'api.security', moduleId: 'api', title: 'API Security & Deployment',
    summary: 'Treat Perdura as an internal compute service and put every network-accessible deployment behind authenticated TLS.',
    aliases: ['API authentication', 'reverse proxy'], keywords: ['TLS', 'CORS', 'proxy', 'credentials', 'rate limit'],
    basics: { purpose: 'Prevent unauthorized use of data-bearing and CPU-intensive endpoints.', inputs: ['A localhost deployment or authenticated reverse proxy'], outputs: ['A bounded, attributable integration path'], assumptions: ['Perdura does not issue or validate API keys itself.'] },
    sections: [
      section('rules', 'Required controls', 'practice', [list(['Use localhost directly only on a trusted workstation.', 'For central use, terminate TLS and authenticate at Caddy, nginx, an identity-aware proxy, or a VPN boundary.', 'Apply request-size, concurrency, and rate limits at that boundary.', 'Set PERDURA_CORS_ORIGINS only for browser origins that require cross-origin API access.'])]),
      section('meaning', 'CORS is not authentication', 'interpretation', [note('important', 'CORS influences browsers; it does not prevent scripts, servers, or command-line clients from calling a reachable endpoint.', 'Keep the proxy boundary')]),
      section('records', 'Operational records', 'advanced', [p('Retain request IDs, software identity headers, response checksums, project manifests, and the release build-verification report with controlled outputs. Avoid logging sensitive request bodies by default.')]),
    ], related: ['api.overview', 'dashboard.artifact-verification'], reviewed: '2026-07-21', exampleKind: 'none',
  },
  {
    id: 'dashboard.overview',
    moduleId: 'dashboard',
    title: 'Dashboard & Projects',
    summary: 'Use the Dashboard to understand project status, reopen recent work, and move directly to analyses that need attention.',
    aliases: ['home', 'project dashboard', 'start page'],
    keywords: ['open', 'save', 'recent', 'stale', 'unsaved', 'project'],
    basics: {
      purpose: 'Give a project-level view of saved work, unsaved edits, analysis freshness, and navigation.',
      useWhen: ['Opening Perdura', 'Returning to an existing project', 'Checking which analyses need to be recalculated'],
      inputs: ['The currently open project and its saved analysis state'],
      outputs: ['Module status cards, project summary counts, recent projects, and navigation shortcuts'],
      assumptions: ['Dashboard status describes saved and in-memory project state; it does not independently rerun analyses.'],
    },
    sections: [
      section('first-look', 'A 30-second project check', 'practice', [
        list([
          'Confirm the project name and save state in the application header.',
          'Scan module cards for completed, empty, or stale analyses.',
          'Hover a stale or unsaved indicator for the affected analyses and the reason.',
          'Open the module card that needs attention; recalculate there when inputs have changed.',
        ], undefined, true),
        note('tip', 'A module can contain both current and stale analyses. Use the hover detail instead of treating the whole module as uniformly current.', 'Read the detail, not only the badge'),
      ]),
      section('walkthrough', 'Walkthrough: resume a project safely', 'interpretation', [
        example(
          'Resume yesterday’s analysis',
          'A project appears under Recent and its Failure Rate Prediction card is marked stale.',
          [
            'Open the project from Recent and verify its last-modified timestamp.',
            'Hover the stale badge to identify the analysis and upstream change.',
            'Open Failure Rate Prediction and review the changed inputs before recalculating.',
            'Save the project after confirming the refreshed result.',
          ],
          'The Dashboard returns to a current state and the saved timestamp advances.',
        ),
      ]),
      section('bookmarks', 'Bookmark important results', 'practice', [
        list([
          'Use Results in the application header to bookmark any plot, table, or metric available to Report Builder.',
          'Use the bookmark icon on an interactive plot or beside an asset in Report Builder for the same action.',
          'Select a compact bookmark card on Dashboard to restore its module and analysis and focus the result.',
          'Remove obsolete bookmarks from Dashboard or toggle their bookmark icon again.',
        ], undefined, true),
        note('info', 'A bookmark is a live project reference, not a copied result. Recalculation updates its target; deleting the source leaves an unavailable bookmark that can still lead back to the analysis.', 'Live result references'),
      ]),
      section('limits', 'What status indicators do not prove', 'advanced', [
        p('A current badge means the result matches the tracked inputs and dependencies. It is not a validation of the model choice, data quality, assumptions, or engineering conclusion.'),
      ]),
    ],
    related: ['dashboard.project-files', 'dashboard.recent-projects', 'dashboard.analysis-status', 'dashboard.unsaved-changes', 'reportBuilder.assets'],
    reviewed: REVIEWED,
    exampleKind: 'walkthrough',
  },
  {
    id: 'dashboard.project-files',
    moduleId: 'dashboard',
    title: 'Open, Save, Import & Export Projects',
    summary: 'Save and Open manage named projects in this browser; Export and Import create or restore portable project files.',
    aliases: ['project lifecycle', 'save project', 'open project'],
    keywords: ['new', 'open', 'save as', 'import', 'export', 'project file'],
    basics: {
      purpose: 'Persist named browser projects and create portable snapshots containing Perdura inputs, results, report layouts, units, and analysis relationships.',
      useWhen: ['Starting a new study', 'Creating a checkpoint', 'Moving work between computers'],
      inputs: ['A project name for browser storage and, when importing, a compatible Perdura JSON project export'],
      outputs: ['A named project stored in this browser, a downloaded portable export, or a newly imported workspace'],
      assumptions: ['Save and Open use this browser profile; Export and Import are the file-based transfer operations.', 'Saving preserves the current workspace but does not refresh stale calculations automatically.'],
    },
    sections: [
      section('workflow', 'Safe project workflow', 'practice', [
        list([
          'Use New for an empty workspace, enter a clear project name, and Save to store it in this browser.',
          'Use Open for browser-saved projects; Recent is a shortcut to the projects most recently opened in this browser profile.',
          'To branch a study, change the editable project name before Save so the baseline and variant have different browser-storage names.',
          'Use Export → Entire project with results for a portable full snapshot; use Import → Everything in file to restore its JSON or .perdura.zip package on this or another device.',
          'After importing or opening, inspect stale and unsaved indicators before relying on results.',
        ], undefined, true),
      ]),
      section('walkthrough', 'Walkthrough: branch an engineering study', 'interpretation', [
        example(
          'Preserve a baseline before a design change',
          'A baseline project is complete and a proposed duty-cycle change must be evaluated separately.',
          [
            'Save the baseline project.',
            'Change the project name to one that identifies the proposed design, then Save it as a separate named browser project.',
            'Change the duty cycle in the copied project and recalculate affected analyses.',
            'Use the Dashboard to confirm which modules changed before saving the variant; export a full snapshot if it must be portable.',
          ],
          'The baseline and design variant remain independently reproducible.',
        ),
      ]),
      section('failure-modes', 'Recovery and compatibility', 'advanced', [
        note('caution', 'Browser-saved projects can be lost if site storage is cleared or the browser profile is removed. Export important checkpoints, and preserve external source data that the project never imported or documented.', 'Keep a portable backup'),
        p('Portable JSON exports identify the producing software with app “Perdura,” subtitle “Reliability Engineering and Statistics Suite,” https://perdurareliability.com, the project schema, version, source commit, and build timestamp.'),
      ]),
    ],
    related: ['dashboard.overview', 'dashboard.unsaved-changes', 'reportBuilder.templates'],
    reviewed: REVIEWED,
    exampleKind: 'walkthrough',
  },
  {
    id: 'dashboard.artifact-verification',
    moduleId: 'dashboard',
    title: 'Checksums, Provenance & Verified Export Packages',
    summary: 'Package an exported artifact with its SHA-256 checksum, project identity, software build, and completed-analysis fingerprints.',
    aliases: ['verified export', 'artifact manifest', 'checksum package', 'provenance'],
    keywords: ['sha-256', 'hash', 'integrity', 'traceability', 'authenticity', 'regulatory', 'sidecar', 'manifest'],
    basics: {
      purpose: 'Detect byte changes and preserve a verifiable link from an output to the project, analysis run, and Perdura build that produced it.',
      useWhen: ['Archiving an engineering result', 'Sending an output for independent review', 'Preparing audit or regulatory evidence'],
      inputs: ['Optional controlled project identity fields and a generated export'],
      outputs: ['One .perdura.zip containing the exact artifact and a JSON verification manifest'],
      assumptions: ['SHA-256 establishes change detection, not the identity of the person or organization that produced the package.', 'Analysis fingerprints describe the calculation state recorded by Perdura; they do not validate whether the chosen model is appropriate.'],
    },
    sections: [
      section('workflow', 'Create a traceable export', 'practice', [
        list([
          'Open Export → Provenance & verify and enter any controlled organization, analyst, project-number, document-number, or classification fields required by your process.',
          'Turn on Export → Verification package.',
          'Run or refresh the analysis so the export can link to a current completed-run fingerprint.',
          'Export the report, plot, diagram, table, model, or project. Preserve the complete .perdura.zip file.',
          'Verify the package in Perdura or with tools/verify_perdura_artifact.py before submission.',
        ], undefined, true),
      ]),
      section('contents', 'What the package proves', 'interpretation', [
        p('The manifest records the artifact byte count and SHA-256 digest, stable artifact and project IDs, software version and source commit, release-build evidence when available, and the latest applicable analysis-run fingerprints. A successful check proves that the artifact bytes still match that manifest.'),
        note('important', 'A checksum is not a digital signature. A person who can replace both the artifact and manifest can create a matching new checksum. Perdura therefore reports authenticity as “not established (checksum only).”', 'Integrity is not authenticity'),
      ]),
      section('worked-example', 'Worked example: review a PDF result', 'advanced', [
        example('Independent PDF integrity check', 'A reviewer receives pump-system-results.pdf.perdura.zip.', ['Open Provenance & verify and select the ZIP.', 'Confirm Integrity verified and compare the project/artifact identifiers with the transmittal record.', 'Confirm the linked software version and analysis count.', 'Treat “Authenticity: not established” as expected for this checksum-only profile.', 'If release build evidence is retained separately, run the CLI with --verification-report to cross-check its declared digest.'], 'The reviewer can detect modified bytes and trace the output metadata without overstating who signed it.'),
      ]),
      section('retention', 'Records and limitations', 'references', [
        p('Project files retain bounded analysis-run and export ledgers. Hosted CI evidence can have finite retention, so regulated records should preserve the verification report alongside the export package. Disabling the toggle produces the original artifact without a verification manifest.'),
      ]),
    ],
    related: ['dashboard.project-files', 'dashboard.analysis-status', 'reportBuilder.export'],
    reviewed: '2026-07-21',
    exampleKind: 'walkthrough',
  },
  {
    id: 'dashboard.recent-projects',
    moduleId: 'dashboard',
    title: 'Recent Projects',
    summary: 'Recent projects provide a timestamped shortcut to named projects saved and opened in this browser profile.',
    aliases: ['recent files', 'open recent'],
    keywords: ['last modified', 'last opened', 'history', 'browser storage'],
    basics: {
      purpose: 'Reopen recent work without browsing for its file.',
      useWhen: ['Returning to an active project'],
      outputs: ['The selected project loaded into the workspace'],
      assumptions: ['The named project must still exist in this browser’s site storage.'],
    },
    sections: [
      section('workflow', 'Choose the correct recent project', 'practice', [
        list(['Compare the project name, last-modified timestamp, and last-opened timestamp.', 'Open the entry, then verify the module summary and save state.', 'If it is no longer listed, look under Saved projects; if browser storage was cleared, import a previously exported project snapshot.'], undefined, true),
      ]),
      section('walkthrough', 'Walkthrough: distinguish two revisions', 'interpretation', [
        example('Select the latest revision', 'Two similarly named projects appear under Recent.', ['Compare their full names and last-modified timestamps.', 'Open the newer candidate.', 'Confirm its analysis count and latest results on the Dashboard.'], 'The intended revision is identified without modifying either file.'),
      ]),
    ],
    related: ['dashboard.project-files'],
    reviewed: REVIEWED,
    exampleKind: 'walkthrough',
  },
  {
    id: 'dashboard.analysis-status',
    moduleId: 'dashboard',
    title: 'Current, Empty & Stale Analyses',
    summary: 'Freshness tracking identifies results that no longer match their inputs or upstream dependencies.',
    aliases: ['stale badge', 'analysis freshness', 'out of date result'],
    keywords: ['dependency', 'recalculate', 'status', 'module card'],
    basics: {
      purpose: 'Prevent an old result from being mistaken for a result of the current inputs.',
      useWhen: ['A stale badge appears', 'An upstream distribution, block, or dataset changed'],
      outputs: ['A reason for staleness and the affected analysis identifiers'],
      assumptions: ['Only dependencies represented in the project model can participate in freshness tracking.'],
    },
    sections: [
      section('interpret', 'Interpret the states', 'practice', [
        list([
          'Empty: no completed result has been saved for that analysis.',
          'Current: the saved result matches its tracked inputs and upstream assets.',
          'Stale: a tracked input or dependency changed after the result was calculated.',
        ]),
        note('important', 'Recalculation is deliberate. Review the changed input and model assumptions before replacing the prior result.', 'Stale is a warning, not an automatic rerun'),
      ]),
      section('walkthrough', 'Walkthrough: trace a stale result', 'interpretation', [
        example('Trace an upstream fit change', 'A Maintenance PM Interval analysis uses a Life Data distribution that was refitted.', ['Hover the Maintenance stale badge.', 'Confirm that PM Interval and the linked distribution are named.', 'Open PM Interval and verify the newly selected parameters.', 'Run the calculation and inspect the changed interval.'], 'The downstream result now corresponds to the revised life model.'),
      ]),
    ],
    related: ['dashboard.unsaved-changes', 'maintenance.pm-interval'],
    reviewed: REVIEWED,
    exampleKind: 'walkthrough',
  },
  {
    id: 'dashboard.unsaved-changes',
    moduleId: 'dashboard',
    title: 'Unsaved Changes',
    summary: 'The unsaved indicator shows when in-memory project content differs from the last saved snapshot.',
    aliases: ['dirty project', 'last save'],
    keywords: ['timestamp', 'hover details', 'modified analyses'],
    basics: {
      purpose: 'Show whether closing or replacing the project could discard work.',
      useWhen: ['The Unsaved Changes indicator is visible', 'Before opening another project or closing Perdura'],
      outputs: ['Last-save timestamp and the modules, analyses, or reports with changes'],
      assumptions: ['The detail identifies tracked project mutations, not unsaved files in other applications.'],
    },
    sections: [
      section('workflow', 'Before leaving the project', 'practice', [
        list(['Hover the indicator and review each changed analysis or report.', 'Decide whether each change belongs in this project revision.', 'Save, Save As, or intentionally discard only after that review.'], undefined, true),
      ]),
      section('walkthrough', 'Walkthrough: save the intended edits', 'interpretation', [
        example('Review a mixed set of edits', 'The indicator lists a Warranty analysis and two Report Builder reports.', ['Open Warranty and confirm the revised inputs/results.', 'Open Report Builder and inspect both named reports.', 'Save the project and verify that the unsaved indicator clears.'], 'The snapshot includes all intended edits and records a new save timestamp.'),
      ]),
    ],
    related: ['dashboard.project-files', 'reportBuilder.workflow'],
    reviewed: REVIEWED,
    exampleKind: 'walkthrough',
  },
  {
    id: 'dashboard.plot-interactions',
    moduleId: 'dashboard',
    title: 'Working with Plots',
    summary: 'Explore Plotly charts with consistent navigation, visibility, annotation, projection, and export controls.',
    aliases: ['plot toolbar', 'Plotly controls', 'chart interaction'],
    keywords: ['zoom', 'pan', 'legend', 'fullscreen', 'annotation', 'axis projection', 'export'],
    basics: {
      purpose: 'Inspect plotted evidence without changing the underlying calculation.',
      useWhen: ['Reading any interactive Perdura plot', 'Preparing a plot for a report or export'],
      inputs: ['A generated plot and optional user markup'],
      outputs: ['A changed view, toggled traces, or saved plot annotations'],
      assumptions: ['View changes do not alter model inputs or recompute results.'],
    },
    sections: [
      section('navigation', 'Navigate and compare', 'practice', [
        list([
          'Use the mouse wheel over the plot to zoom; drag with Pan selected to move the visible window.',
          'Use reset/autoscale to return to the calculated data extent, and fullscreen when labels need more room.',
          'Click a legend item to toggle one trace; double-click it to isolate that trace. Drag the legend when it obscures data.',
          'Treat a hidden trace as a view choice only—the underlying analysis result remains present.',
        ]),
      ]),
      section('annotations', 'Add explanatory markup', 'interpretation', [
        list([
          'Text callout: choose the annotation action, click a data location, and enter concise explanatory text.',
          'Line/shape tools: mark a region or threshold without modifying the source series.',
          'Axis projection: select a data line and point to draw its intersection to both axes, including x- and y-value labels.',
          'Remove or clear markup that is no longer valid before publishing the plot.',
        ]),
        note('important', 'User markup is evidence commentary, not calculated data. A successful source recalculation clears source-plot markup because its data coordinates may no longer be valid.', 'Annotations and calculations are distinct'),
      ]),
      section('walkthrough', 'Walkthrough: annotate an operating point', 'advanced', [
        example('Project a selected curve point', 'A reliability curve contains the mission-time operating point that must be discussed in a review.', ['Zoom or pan until the point is easy to select.', 'Choose the axis-projection annotation and select the intended trace/point.', 'Verify that both projection lines and x/y labels correspond to the axes.', 'Add a short text callout stating why the point matters.', 'Export the plot or insert its asset into Report Builder and verify the markup there.'], 'The exported and project-backed plot communicates both the curve and the reviewed operating point.'),
      ]),
      section('export', 'Export and persistence', 'references', [
        p('Plot markup is saved with the project and included in supported PNG, SVG, HTML, ZIP, Report Builder, and PDF outputs. Always inspect the destination artifact: font scaling, clipping, and page layout can differ from the interactive canvas.'),
      ]),
    ],
    related: ['reportBuilder.assets', 'reportBuilder.export'],
    reviewed: REVIEWED,
    exampleKind: 'walkthrough',
  },
  {
    id: 'dashboard.help-center',
    moduleId: 'dashboard',
    title: 'Using the Help Center',
    summary: 'Open context-sensitive guidance, search every module and glossary term, and reveal deeper material only when it is useful.',
    aliases: ['Help menu', 'documentation search'],
    keywords: ['contextual help', 'search', 'glossary', 'equations', 'citations', 'references'],
    basics: {
      purpose: 'Provide concise task guidance first, with equations, examples, limitations, and sources available on demand.',
      useWhen: ['Choosing or interpreting an analysis', 'Looking up a term, equation, assumption, or reference'],
      inputs: ['The active module/analysis or a search phrase'],
      outputs: ['A Help topic, glossary definition, worked example, or bibliography record'],
      assumptions: ['Help explains the implementation and its intended use; it does not replace project-specific engineering review.'],
    },
    sections: [
      section('open-search', 'Open and find the right depth', 'practice', [
        list([
          'Open Help from an analysis to land on its contextual topic; use module navigation to browse elsewhere.',
          'Search globally by method name, acronym, parameter, equation term, alias, or glossary concept.',
          'Read the always-visible Basics first, then expand Workflow, Interpretation, Advanced, or References sections as needed.',
          'Select a glossary term by hover, keyboard focus, or click for its short definition and related topics.',
        ]),
      ]),
      section('citations', 'Equations, claims, and citations', 'interpretation', [
        p('Equation blocks define symbols and units where meaningful. Numbered citations resolve to offline bibliography metadata and may offer a public source link. A section/page/clause locator identifies the relevant portion of a larger source.'),
        note('info', 'A missing external link does not mean a source is absent. Controlled standards retain offline citation metadata and locator guidance without redistributing a local or licensed document.', 'Offline-first references'),
      ]),
      section('walkthrough', 'Walkthrough: investigate an unfamiliar symbol', 'advanced', [
        example('Move from quick answer to source', 'A maintenance equation contains virtual age V and repair factor q.', ['Open Help from Virtual Age.', 'Read Basics to confirm the method’s purpose and assumptions.', 'Expand the model section and inspect symbol definitions.', 'Open the glossary entry for virtual age and follow related topics.', 'Expand References and use the Kijima locator when deeper methodological review is required.'], 'The user obtains an immediate definition, implementation context, worked example, limitation, and traceable source without being shown all layers at once.'),
      ]),
    ],
    related: ['dashboard.plot-interactions', 'dashboard.overview'],
    reviewed: REVIEWED,
    exampleKind: 'walkthrough',
  },

  // Maintenance
  {
    id: 'maintenance.availability',
    moduleId: 'maintenance',
    title: 'Availability',
    summary: 'Compute inherent, achieved, and operational availability from steady-state mean uptime and downtime quantities.',
    aliases: ['Ai', 'Aa', 'Ao', 'RAM availability'],
    keywords: ['MTBF', 'MTBM', 'MTTR', 'MDT', 'administrative delay', 'logistics delay'],
    basics: {
      purpose: 'Separate intrinsic repair performance from maintenance-policy and support-delay effects.',
      useWhen: ['Mean uptime and downtime inputs are defensible', 'A quick steady-state availability roll-up is appropriate'],
      inputs: ['MTBF and MTTR for inherent availability', 'MTBM and mean active maintenance time for achieved availability', 'Administrative and logistics delays for operational availability'],
      outputs: ['Ai, Aa, Ao, mean downtime, and a downtime breakdown'],
      assumptions: ['Stationary mean cycles', 'No finite-horizon startup effect', 'A ratio of means is adequate for the decision'],
    },
    sections: [
      section('equations', 'Equations and meanings', 'practice', [
        equation('A_i=\\frac{MTBF}{MTBF+MTTR},\\quad A_a=\\frac{MTBM}{MTBM+\\bar M}', { explanation: 'Inherent availability includes corrective repair only. Achieved availability includes active corrective and preventive maintenance.', symbols: [{ symbol: 'MTBF', meaning: 'mean time between failures', unit: 'time' }, { symbol: 'MTTR', meaning: 'mean time to repair', unit: 'time' }, { symbol: 'MTBM', meaning: 'mean time between all maintenance actions', unit: 'time' }, { symbol: '\\bar M', meaning: 'mean active maintenance time', unit: 'time' }] }),
        equation('MDT=MTTR+D_a+D_l,\\qquad A_o=\\frac{U}{U+MDT}', { explanation: 'U is MTBM when supplied, otherwise MTBF. Administrative and logistics delay affect operational availability.', symbols: [{ symbol: 'D_a', meaning: 'administrative delay', unit: 'time' }, { symbol: 'D_l', meaning: 'logistics delay', unit: 'time' }, { symbol: 'U', meaning: 'mean uptime basis', unit: 'time' }] }),
      ]),
      section('worked-example', 'Worked example', 'interpretation', [
        example('Availability with support delays', 'MTBF = 1,000 h, MTTR = 8 h, administrative delay = 4 h, and logistics delay = 12 h.', ['Compute Ai = 1000/(1000+8).', 'Compute MDT = 8+4+12 = 24 h.', 'Compute Ao = 1000/(1000+24).'], 'Ai = 99.206%; Ao = 97.656%. Support delays create most of the difference.'),
      ]),
      section('limitations', 'Choose a richer model when needed', 'advanced', [
        note('caution', 'Use Markov analysis for degraded states, standby logic, state-dependent repairs, finite-horizon transients, or other behavior a single uptime/down-time ratio cannot represent.', 'Closed-form scope'),
      ]),
    ],
    related: ['maintenance.availability-sensitivity', 'systemModeling.markov'],
    reviewed: REVIEWED,
    exampleKind: 'worked',
  },
  {
    id: 'maintenance.maintainability',
    moduleId: 'maintenance',
    title: 'Maintainability',
    summary: 'Model positive repair times with a lognormal distribution and report mean and percentile corrective times.',
    aliases: ['Mct', 'Mmax', 'repair time'],
    keywords: ['lognormal', 'repair duration', 'percentile', 'survival curve'],
    basics: {
      purpose: 'Summarize typical repair duration and a planning percentile for long repairs.',
      useWhen: ['Repair times are positive and plausibly lognormal', 'A percentile service-time requirement is needed'],
      inputs: ['Either log-space μ and σ or at least two positive repair-time observations', 'A percentile between 0 and 1'],
      outputs: ['Mct, Mmax, median, fitted parameters, and exceedance curve'],
      assumptions: ['A single lognormal population adequately describes repair time', 'Samples represent the maintenance process of interest'],
    },
    sections: [
      section('equations', 'Lognormal repair-time model', 'practice', [
        equation('\\ln T\\sim\\mathcal N(\\mu,\\sigma^2),\\quad M_{ct}=E[T]=e^{\\mu+\\sigma^2/2}', { symbols: [{ symbol: 'T', meaning: 'corrective repair time', unit: 'time' }, { symbol: '\\mu', meaning: 'mean of log repair time' }, { symbol: '\\sigma', meaning: 'standard deviation of log repair time' }] }),
        equation('M_{max}(p)=\\exp(\\mu+\\sigma\\Phi^{-1}(p))', { explanation: 'Mmax is the requested lognormal quantile, not the observed sample maximum.', symbols: [{ symbol: 'p', meaning: 'selected cumulative percentile' }, { symbol: '\\Phi^{-1}', meaning: 'standard-normal quantile function' }] }),
      ]),
      section('worked-example', 'Worked example', 'interpretation', [
        example('Plan to the 95th percentile', 'A manual model uses μ = 2.0 and σ = 0.5 in natural-log units.', ['Compute Mct = exp(2 + 0.5²/2).', 'Use Φ⁻¹(0.95) ≈ 1.645.', 'Compute Mmax = exp(2 + 0.5×1.645).'], 'Mct ≈ 8.37 time units; the 95th-percentile Mmax ≈ 16.82 time units.'),
      ]),
      section('diagnostics', 'Interpretation and checks', 'advanced', [
        list(['Compare the fitted survival curve with the observed repair-time range.', 'Investigate multimodality caused by different maintenance tasks or skill levels.', 'Do not interpret Mmax as a guaranteed upper bound.']),
      ]),
    ],
    related: ['maintenance.availability', 'maintenance.availability-sensitivity'],
    reviewed: REVIEWED,
    exampleKind: 'worked',
  },
  {
    id: 'maintenance.spares',
    moduleId: 'maintenance',
    title: 'Maintenance Spares',
    summary: 'Size serviceable stock against a target no-stockout probability using analytic demand models or finite-horizon pipeline simulation.',
    aliases: ['spare parts provisioning', 'stockout protection'],
    keywords: ['Poisson', 'negative binomial', 'renewal pipeline', 'lead time', 'common shock'],
    basics: {
      purpose: 'Estimate the smallest spare count that reaches a target protection probability.',
      useWhen: ['Installed population, exposure, failure behavior, and target confidence are known'],
      inputs: ['Installed quantity, operating hours, duty cycle, MTBF or failure rate', 'Demand-model settings and target confidence', 'For pipeline simulation: renewal, replenishment, shock, replicate, and seed settings'],
      outputs: ['Required spares, expected demand, achieved protection, and a protection curve'],
      assumptions: ['The selected demand model matches dispersion, renewal, and replenishment behavior'],
    },
    sections: [
      section('models', 'Choose the demand model', 'practice', [
        equation('\\lambda=N\\,t\\,d\\,r=\\frac{Ntd}{MTBF}', { explanation: 'Expected period demand for constant-rate analytic models.', symbols: [{ symbol: 'N', meaning: 'installed quantity' }, { symbol: 't', meaning: 'calendar exposure', unit: 'time' }, { symbol: 'd', meaning: 'duty-cycle fraction' }, { symbol: 'r', meaning: 'failure rate per unit operating time' }] }),
        list([
          'Poisson: independent constant-rate demands; variance equals λ; no replenishment during the period.',
          'Negative binomial: period demand variance is λ + λ²/k, allowing aggregate overdispersion.',
          'Renewal pipeline: simulates exponential or Weibull ordinary failures, stochastic return lead time, and optional common shocks; stock covers maximum concurrent outstanding demand.',
        ]),
        equation('s^*=\\min\\{s:\\Pr(D\\le s)\\ge c\\}', { explanation: 'Analytic models choose the smallest integer stock level reaching confidence c.' }),
      ]),
      section('worked-example', 'Worked example', 'interpretation', [
        example('Constant-rate Poisson stock', 'Ten installed units operate 2,000 h at 50% duty cycle with MTBF 10,000 h. Target protection is 95%.', ['Compute λ = 10×2000×0.5/10000 = 1 expected demand.', 'Find the smallest s with Poisson(1) CDF at least 0.95.', 'CDF at 2 is about 0.920; CDF at 3 is about 0.981.'], 'Provision 3 spares under the stated no-replenishment Poisson assumptions.'),
      ]),
      section('limits', 'Model risk and simulation precision', 'advanced', [
        note('caution', 'The target confidence is model-conditional. Correlated failures, uncertain rates, cannibalization, nonreturnable items, repair-capacity queues, or nonstationary demand can materially change stock needs.', 'Protection is not a guarantee'),
        p('For renewal-pipeline simulation, use a fixed seed for reproducibility and enough replicates that the reported stock interval is acceptably narrow.'),
      ]),
    ],
    related: ['maintenance.availability', 'maintenance.virtual-age'],
    reviewed: REVIEWED,
    exampleKind: 'worked',
  },
  {
    id: 'maintenance.replacement',
    moduleId: 'maintenance',
    title: 'Replacement Policy',
    summary: 'Compare age replacement, periodic block replacement, and run-to-failure on a long-run Weibull cost-rate basis.',
    aliases: ['age replacement', 'block replacement', 'optimal replacement'],
    keywords: ['Weibull wear-out', 'preventive cost', 'corrective cost', 'cost rate'],
    basics: {
      purpose: 'Find whether scheduled replacement is economically justified and, if so, which policy and interval has the lowest qualified cost rate.',
      useWhen: ['The item follows a defensible two-parameter Weibull model', 'Preventive and corrective event costs are comparable'],
      inputs: ['Preventive and corrective replacement costs', 'Weibull scale α and shape β'],
      outputs: ['Recommended policy, optimal intervals, cost rates, event rates, and run-to-failure baseline'],
      assumptions: ['Age replacement renews the item after failure or planned replacement', 'Block failures receive minimal repair until periodic replacement', 'Long-run average cost is the decision criterion'],
    },
    sections: [
      section('equations', 'Policy cost rates', 'practice', [
        equation('C_A(T)=\\frac{C_pR(T)+C_cF(T)}{\\int_0^T R(t)\\,dt}', { explanation: 'Age replacement ends a renewal cycle at failure or age T, whichever occurs first.', symbols: [{ symbol: 'C_p', meaning: 'planned replacement cost' }, { symbol: 'C_c', meaning: 'corrective replacement cost' }, { symbol: 'R,F', meaning: 'Weibull survival and cumulative failure functions' }] }),
        equation('C_B(T)=\\frac{C_p+C_cH(T)}{T},\\quad H(T)=\\left(\\frac{T}{\\alpha}\\right)^{\\beta}', { explanation: 'Block replacement occurs every T; intermediate failures are minimally repaired.' }),
        equation('C_0=\\frac{C_c}{MTTF},\\qquad MTTF=\\alpha\\Gamma\\left(1+\\frac{1}{\\beta}\\right)', { explanation: 'Run-to-failure is the baseline. A finite preventive optimum is expected only for wear-out, β > 1.' }),
      ]),
      section('worked-example', 'Worked example', 'interpretation', [
        example('Screen a wear-out item', 'A component has α = 1,000 h, β = 2, planned cost Cp = 100, and corrective cost Cc = 1,000.', ['Confirm Cp < Cc and β > 1.', 'Compute MTTF = 1000Γ(1.5) ≈ 886.2 h and run-to-failure cost rate ≈ 1.128/h.', 'Evaluate the age and block cost-rate minima and compare each with 1.128/h.'], 'A finite candidate can be recommended only if its interior minimum is below the run-to-failure baseline; a sampled boundary is not labeled an optimum.'),
      ]),
      section('limits', 'Decision limits', 'advanced', [
        note('caution', 'Costs must represent the same scope. Add downtime, labor, logistics, safety, and collateral-loss consequences consistently before treating the cheapest curve as an operating policy.', 'Cost inputs drive the recommendation'),
      ]),
    ],
    related: ['maintenance.cost-forecast', 'maintenance.virtual-age', 'lifeData.weibull-2p'],
    reviewed: REVIEWED,
    exampleKind: 'worked',
  },
  {
    id: 'maintenance.pm-interval',
    moduleId: 'maintenance',
    title: 'PM Interval (MFOP)',
    summary: 'Set the perfect-renewal maintenance interval at the life-distribution age where reliability reaches a target.',
    aliases: ['MFOP', 'maintenance-free operating period', 'preventive interval'],
    keywords: ['target reliability', 'quantile', 'sawtooth', 'as good as new'],
    basics: {
      purpose: 'Schedule preventive renewal so modeled reliability between actions does not fall below a chosen target.',
      useWhen: ['Preventive maintenance restores the item to as-good-as-new', 'A fitted life distribution is available'],
      inputs: ['Life distribution and parameters', 'Target reliability', 'Planning horizon'],
      outputs: ['PM interval, number of actions, MTTF, and maintained/unmaintained reliability curves'],
      assumptions: ['Every PM perfectly renews the item', 'The life distribution remains stable over the horizon'],
    },
    sections: [
      section('equation', 'Target-reliability interval', 'practice', [
        equation('\\tau=F^{-1}(1-R_{target}),\\qquad n_{PM}=\\left\\lfloor\\frac{H}{\\tau}\\right\\rfloor', { explanation: 'At age τ, the failure CDF is 1−Rtarget. After each perfect PM, modeled age resets to zero.', symbols: [{ symbol: '\\tau', meaning: 'PM interval / MFOP', unit: 'time' }, { symbol: 'H', meaning: 'planning horizon', unit: 'time' }] }),
        equation('\\tau=\\alpha[-\\ln(R_{target})]^{1/\\beta}', { label: 'Weibull special case', symbols: [{ symbol: '\\alpha', meaning: 'Weibull scale', unit: 'time' }, { symbol: '\\beta', meaning: 'Weibull shape' }] }),
      ]),
      section('worked-example', 'Worked example', 'interpretation', [
        example('Maintain 90% reliability', 'A Weibull item has α = 1,000 h and β = 2. The target reliability is 0.90 over a 5,000 h horizon.', ['Compute τ = 1000[−ln(0.90)]^(1/2).', 'τ ≈ 324.6 h.', 'Compute floor(5000/324.6) = 15 PM actions.'], 'Service at approximately 325 h under the perfect-renewal assumption.'),
      ]),
      section('limits', 'When MFOP is optimistic', 'advanced', [
        note('caution', 'If maintenance is imperfect, use Virtual Age. If PM can introduce failures or if resources constrain scheduling, incorporate those effects outside this perfect-renewal calculation.', 'Perfect renewal is a strong assumption'),
      ]),
    ],
    related: ['maintenance.virtual-age', 'maintenance.cost-forecast'],
    reviewed: REVIEWED,
    exampleKind: 'worked',
  },
  {
    id: 'maintenance.cost-forecast',
    moduleId: 'maintenance',
    title: 'Maintenance Cost Forecast',
    summary: 'Project long-run preventive and corrective event rates and cost across a chosen planning horizon.',
    aliases: ['maintenance budget', 'cost projection'],
    keywords: ['corrective only', 'age policy', 'block policy', 'horizon'],
    basics: {
      purpose: 'Translate a selected Weibull maintenance policy’s long-run renewal/reward rates into a horizon-scaled budget profile.',
      useWhen: ['A policy and interval are specified or the corresponding long-run optimum is acceptable'],
      inputs: ['Policy, PM/CM costs, Weibull α and β, horizon, and optional interval'],
      outputs: ['Long-run-rate projections of PM and CM events, total cost, interval used, and cumulative-cost curve'],
      assumptions: ['A steady-state long-run rate is adequate for the chosen horizon', 'The Weibull process and costs remain constant'],
    },
    sections: [
      section('method', 'How policy changes the forecast', 'practice', [
        list([
          'Corrective only: the long-run renewal rate is the reciprocal of Weibull mean life.',
          'Age replacement: the long-run cycle rates assume each cycle ends at failure or scheduled age, whichever comes first.',
          'Block replacement: scheduled-event and minimal-repair rates are computed per block interval.',
          'A blank interval uses the selected policy’s qualified cost-optimal interval.',
        ]),
        equation('\widehat C(H)=H\{C_p r_{PM}+C_c r_{CM}\}', { explanation: 'Perdura multiplies the selected policy’s long-run renewal/reward rates by H; it does not solve the exact transient renewal count over [0,H].', symbols: [{ symbol: 'H', meaning: 'forecast horizon', unit: 'time' }, { symbol: 'r_{PM}', meaning: 'long-run preventive-event rate', unit: 'events/time' }, { symbol: 'r_{CM}', meaning: 'long-run corrective-event rate', unit: 'events/time' }] }),
      ]),
      section('worked-example', 'Worked example', 'interpretation', [
        example('Budget a block policy', 'Use a 250 h block interval for H = 1,000 h, Cp = 100, Cc = 800, α = 1,000 h, β = 2.', ['Projected PM events = H/T = 4.', 'Projected CM events from the long-run block rate = (H/T)×(T/α)^β = 4×0.25² = 0.25.', 'Projected cost = 4×100 + 0.25×800.'], 'The long-run-rate projection is 600 over the horizon under the minimal-repair block assumptions.'),
      ]),
      section('limits', 'Budget uncertainty', 'advanced', [
        note('caution', 'The display is a long-run-rate projection, not an exact finite-horizon expectation or a cash-flow prediction interval. Startup/transient bias can matter over short horizons, especially for corrective-only and age-replacement policies. Parameter uncertainty, event-count variation, cost escalation, and resource contention require scenario or simulation analysis.', 'Steady-state rates can hide transients and variability'),
      ]),
    ],
    related: ['maintenance.replacement', 'maintenance.virtual-age'],
    reviewed: REVIEWED,
    exampleKind: 'worked',
  },
  {
    id: 'maintenance.virtual-age',
    moduleId: 'maintenance',
    title: 'Virtual Age',
    summary: 'Simulate finite-horizon failures, maintenance, downtime, cost, and availability when repairs only partially rejuvenate an item.',
    aliases: ['Kijima Type II', 'imperfect maintenance', 'effective age'],
    keywords: ['repair effectiveness', 'preventive effectiveness', 'Monte Carlo'],
    basics: {
      purpose: 'Represent repair quality between as-good-as-new and as-bad-as-old instead of forcing perfect renewal.',
      useWhen: ['Maintenance changes effective age without necessarily resetting it to zero', 'Finite-horizon variability matters'],
      inputs: ['Weibull α and β, horizon, optional PM interval', 'Corrective and preventive q fractions, costs, downtime, simulations, confidence, and seed'],
      outputs: ['Intervals for failures and cost, PM count, finite-horizon availability, and cumulative-failure curve'],
      assumptions: ['Kijima Type-II virtual-age updates adequately represent maintenance effectiveness', 'Simulated replications share fixed input parameters'],
    },
    sections: [
      section('model', 'Kijima Type-II update', 'practice', [
        equation('V^+=qV^-', { explanation: 'After an intervention, post-maintenance virtual age is q times pre-maintenance virtual age.', symbols: [{ symbol: 'V^-', meaning: 'virtual age immediately before maintenance', unit: 'time' }, { symbol: 'V^+', meaning: 'virtual age immediately after maintenance', unit: 'time' }, { symbol: 'q', meaning: 'remaining-age fraction: 0 is perfect renewal; 1 is minimal repair' }], citations: [{ id: 'kijima-1989', locator: 'Type-II virtual-age model' }] }),
        equation('A_H=1-\\frac{D_{CM}N_{CM}+D_{PM}N_{PM}}{H}', { explanation: 'Per-replication finite-horizon availability clips total downtime to the simulated horizon.', symbols: [{ symbol: 'D', meaning: 'downtime per event', unit: 'time' }, { symbol: 'N', meaning: 'event count' }] }),
      ]),
      section('worked-example', 'Worked example', 'interpretation', [
        example('Compare imperfect and perfect repair', 'Immediately before corrective repair the item’s virtual age is 600 h.', ['With qCM = 0, V+ = 0 h: as-good-as-new.', 'With qCM = 0.4, V+ = 240 h: partial rejuvenation.', 'With qCM = 1, V+ = 600 h: minimal repair.'], 'The next-failure distribution is conditioned on a different effective age in each case, so finite-horizon failures and costs differ.', 'Effectiveness values are model inputs requiring engineering justification.'),
      ]),
      section('simulation', 'Simulation quality', 'advanced', [
        list(['Set a seed when a result must be reproduced.', 'Increase simulations until decision-relevant intervals are stable.', 'Run sensitivity cases for q values; they are often more uncertain than the Monte Carlo error.']),
      ]),
    ],
    related: ['maintenance.pm-interval', 'maintenance.replacement', 'maintenance.cost-forecast'],
    reviewed: REVIEWED,
    exampleKind: 'worked',
  },
  {
    id: 'maintenance.availability-sensitivity',
    moduleId: 'maintenance',
    title: 'Availability Sensitivity',
    summary: 'Rank local availability drivers and solve for the repair-time requirement associated with a target operational availability.',
    aliases: ['availability tornado', 'solve for MTTR'],
    keywords: ['sensitivity swing', 'target availability', 'maximum downtime'],
    basics: {
      purpose: 'Show which mean input most changes operational availability over a chosen local swing.',
      useWhen: ['A closed-form operational-availability model is appropriate', 'Improvement targets must be allocated among uptime and downtime drivers'],
      inputs: ['MTBF, MTTR, administrative and logistics delays, swing percent, and optional target Ao'],
      outputs: ['Baseline Ao, tornado ranges, most sensitive driver, maximum downtime, and required MTTR'],
      assumptions: ['One-at-a-time local swings are meaningful', 'Interactions and parameter uncertainty are not being quantified'],
    },
    sections: [
      section('method', 'Sensitivity and target equation', 'practice', [
        equation('A_o=\\frac{MTBF}{MTBF+MTTR+D_a+D_l}', {}),
        equation('MDT_{max}=MTBF\\frac{1-A_{target}}{A_{target}},\\quad MTTR_{req}=MDT_{max}-D_a-D_l', { explanation: 'A negative or zero required MTTR means the target cannot be reached without reducing delays or increasing MTBF.' }),
        p('The tornado independently changes each nonzero driver by ± the selected percentage and ranks the absolute range in resulting Ao.'),
      ]),
      section('worked-example', 'Worked example', 'interpretation', [
        example('Solve a 99% target', 'MTBF = 1,000 h, administrative delay = 2 h, logistics delay = 3 h, and target Ao = 0.99.', ['Compute MDTmax = 1000×0.01/0.99 ≈ 10.101 h.', 'Subtract 2+3 h of delays.', 'Required MTTR ≈ 5.101 h.'], 'The repair process must average about 5.10 h or less if the delays and MTBF remain fixed.'),
      ]),
      section('limits', 'Interpret local sensitivity carefully', 'advanced', [
        note('caution', 'A tornado bar is not a variance contribution and does not establish causality. Compare feasible intervention costs and uncertainty before selecting an improvement project.', 'One-at-a-time result'),
      ]),
    ],
    related: ['maintenance.availability'],
    reviewed: REVIEWED,
    exampleKind: 'worked',
  },

  // Human Reliability Analysis. The shared legacy content supplies hra.overview.
  {
    id: 'hra.therp', moduleId: 'hra', title: 'THERP',
    summary: 'Adjust a nominal human error probability for stress and experience, with an optional two-task dependency calculation.',
    aliases: ['Technique for Human Error Rate Prediction'], keywords: ['HEP', 'dependency', 'ZD', 'LD', 'MD', 'HD', 'CD'],
    basics: { purpose: 'Quantify procedural task error from a defensible nominal HEP and explicit modifiers.', useWhen: ['A task-specific nominal HEP and dependency judgment are available'], inputs: ['Nominal HEP, stress level, experience level, and optional second-task HEP/dependency'], outputs: ['Adjusted HEP, conditional second-task HEP, and joint HEP'], assumptions: ['The selected nominal probability and modifiers apply to the defined task', 'Dependency is represented by the selected discrete level'] },
    sections: [
      section('equations', 'Adjustment and dependency', 'practice', [
        equation('p_1=\\min(1,p_0m_sm_e)', { citations: [{ id: 'nrc-therp', locator: 'nominal HEP adjustment and dependence treatment' }] }),
        equation('p_{2|1}=\\begin{cases}N&ZD\\\\(1+19N)/20&LD\\\\(1+6N)/7&MD\\\\(1+N)/2&HD\\\\1&CD\\end{cases},\\quad p_{joint}=p_1p_{2|1}', { symbols: [{ symbol: 'N', meaning: 'basic probability for the second task' }], citations: [{ id: 'nrc-therp', locator: 'dependence model' }] }),
      ]),
      section('example', 'Worked example', 'interpretation', [example('Two dependent actions', 'Task 1 has nominal HEP 0.01, moderately high stress (×2), and a skilled operator (×1). Task 2 has N = 0.02 with medium dependency.', ['Adjusted p1 = 0.01×2×1 = 0.02.', 'p2|1 = (1+6×0.02)/7 = 0.16.', 'Joint HEP = 0.02×0.16.'], 'The joint HEP is 0.0032 for the specifically defined pair.')]),
      section('limits', 'Analysis discipline', 'advanced', [note('caution', 'Do not select a nominal HEP or dependency level solely to obtain a desired result. Document task boundaries, cues, recovery, sequence, and evidence.', 'Trace the judgment')]),
    ], related: ['hra.spar-h', 'hra.heart'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'hra.heart', moduleId: 'hra', title: 'HEART',
    summary: 'Combine a generic task-type nominal unreliability with weighted error-producing-condition effects.',
    aliases: ['Human Error Assessment and Reduction Technique'], keywords: ['GTT', 'EPC', 'proportion of affect', 'HEP'],
    basics: { purpose: 'Produce a traceable first-pass HEP from a generic task class and applicable error-producing conditions.', useWhen: ['A HEART task type is a reasonable analog and EPC applicability can be justified'], inputs: ['Generic task type and zero or more EPCs with assessed proportions'], outputs: ['Nominal HEP, each EPC multiplier, and final HEP'], assumptions: ['EPC effects are multiplicative and proportions adequately describe applicability'] },
    sections: [
      section('equation', 'HEART calculation', 'practice', [equation('HEP=p_0\\prod_i[(E_i-1)a_i+1]', { symbols: [{ symbol: 'p_0', meaning: 'generic task nominal unreliability' }, { symbol: 'E_i', meaning: 'maximum effect of EPC i' }, { symbol: 'a_i', meaning: 'assessed proportion of effect, 0 to 1' }], citations: [{ id: 'williams-1986-heart' }] })]),
      section('example', 'Worked example', 'interpretation', [example('Apply two partial EPCs', 'Nominal HEP is 0.003. EPC effects are 5 at 25% and 3 at 50%.', ['First multiplier = (5−1)×0.25+1 = 2.', 'Second multiplier = (3−1)×0.5+1 = 2.', 'HEP = 0.003×2×2.'], 'Final HEP = 0.012.')]),
      section('limits', 'Avoid double counting', 'advanced', [note('caution', 'Overlapping EPCs can count the same context more than once. Record why each EPC is distinct and why its assessed proportion is credible.', 'Correlated conditions')]),
    ], related: ['hra.therp', 'hra.spar-h'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'hra.spar-h', moduleId: 'hra', title: 'SPAR-H',
    summary: 'Apply eight performance-shaping factors to a diagnosis or action nominal HEP, then assess formal dependency and uncertainty.',
    aliases: ['SPAR H', 'Standardized Plant Analysis Risk HRA'], keywords: ['PSF', 'dependency', 'beta uncertainty', 'diagnosis', 'action'],
    basics: { purpose: 'Estimate HEP with the standardized SPAR-H worksheet logic.', useWhen: ['The event can be framed as diagnosis or action and the eight PSFs can be rated'], inputs: ['Task type, eight PSF levels, dependency context, failure number, and confidence'], outputs: ['Independent and dependency-adjusted HEP, uncertainty interval, and applied corrections'], assumptions: ['SPAR-H scope and PSF definitions fit the event', 'Correlated PSFs are not double counted'] },
    sections: [
      section('equations', 'Independent and dependent HEP', 'practice', [
        equation('p_{ind}=\\frac{p_0\\prod_i m_i}{p_0(\\prod_i m_i-1)+1}', { explanation: 'The implemented SPAR-H correction uses this normalization when three or more PSF multipliers are negative (>1); otherwise the nominal HEP times the PSF product is used. The 10⁻⁵ minimum cutoff is then applied.', citations: [{ id: 'nrc-spar-h', locator: 'Parts II–III and Appendices' }] }),
        equation('p_{dep}=\\begin{cases}p_{ind}&Zero\\\\(1+19p_{ind})/20&Low\\\\(1+6p_{ind})/7&Moderate\\\\(1+p_{ind})/2&High\\\\1&Complete\\end{cases}', { explanation: 'The dependency level comes from analyst assignment or the crew/time/location/cue context matrix, with sequence rules applied by the worksheet.', citations: [{ id: 'nrc-spar-h', locator: 'Part IV dependency equations' }] }),
      ]),
      section('example', 'Worked example', 'interpretation', [example('Apply the negative-PSF correction', 'An action has nominal HEP 0.001 and three or more negative-rated PSFs whose multiplier product is 10, with no dependency adjustment.', ['Compute numerator = 0.001×10 = 0.01.', 'Compute denominator = 0.001×(10−1)+1 = 1.009.', 'Divide to obtain the independent HEP.'], 'pind ≈ 0.00991 before any sequence dependency.', 'Use the application’s exact worksheet corrections and review flags for a real case.')]),
      section('limits', 'Scope and uncertainty', 'advanced', [note('caution', 'SPAR-H is a simplified HRA method. The beta interval describes the implemented uncertainty approximation; it does not cover event-definition error, missing dependencies, or alternative HRA methods.', 'Model uncertainty remains')]),
    ], related: ['hra.therp', 'hra.heart', 'hra.atheana'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'hra.cream', moduleId: 'hra', title: 'CREAM (Basic)',
    summary: 'Map nine common performance conditions to a contextual control mode and its HEP interval.',
    aliases: ['basic CREAM', 'control mode'], keywords: ['CPC', 'strategic', 'tactical', 'opportunistic', 'scrambled'],
    basics: { purpose: 'Screen how operating context supports or degrades cognitive control.', useWhen: ['A contextual second-generation assessment is more appropriate than a task-rate lookup'], inputs: ['Levels for nine common performance conditions'], outputs: ['Improved/reduced counts, control mode, HEP interval, and geometric-midpoint display value'], assumptions: ['The CPC ratings and implemented control-mode map represent the context'] },
    sections: [
      section('mapping', 'Control-mode mapping', 'practice', [
        equation('d=n_{improved}-n_{reduced}', { citations: [{ id: 'hollnagel-1998-cream' }] }),
        list(['Strategic when d ≥ 4.', 'Scrambled when nreduced − nimproved ≥ 6.', 'Tactical when nreduced − nimproved ≤ 1.', 'Opportunistic for the band between tactical and scrambled.']),
        equation('p_{display}=\\sqrt{p_Lp_U}', { explanation: 'The geometric midpoint is a convenient display value; the control-mode interval is the primary result.' }),
      ]),
      section('example', 'Worked example', 'interpretation', [example('Classify a nominal context', 'All nine CPCs are rated not significant.', ['Count nreduced = 0 and nimproved = 0.', 'The difference falls in the tactical region.', 'Read the tactical HEP interval 10⁻³ to 10⁻¹.'], 'The displayed geometric midpoint is 0.01, but the interval communicates the method’s resolution.')]),
      section('limits', 'Do not overread the midpoint', 'advanced', [note('caution', 'Basic CREAM produces a broad contextual interval, not a calibrated task-specific point estimate. Use Extended CREAM only when the cognitive decomposition and failure types can be defended.', 'Interval-first interpretation')]),
    ], related: ['hra.cream-extended'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'hra.cream-extended', moduleId: 'hra', title: 'CREAM Extended',
    summary: 'Decompose a task into cognitive activities and credible failure types, then adjust step probabilities for context.',
    aliases: ['extended CREAM', 'cognitive failure probability', 'CFP'], keywords: ['observation', 'interpretation', 'planning', 'execution', 'CPC'],
    basics: { purpose: 'Estimate a task HEP from step-level cognitive failure mechanisms under common performance conditions.', useWhen: ['A defensible cognitive task decomposition is available'], inputs: ['CPC ratings and task steps with cognitive activity/failure type'], outputs: ['Adjusted step CFPs, dominant step, and combined task HEP'], assumptions: ['Selected failure types match each activity', 'Step failures are combined as independent for the aggregate'] },
    sections: [
      section('equations', 'Step and task combination', 'practice', [
        equation('p_j=\\min(1,p_{0j}w_{f(j)}),\\qquad HEP=1-\\prod_j(1-p_j)', { explanation: 'The relevant cognitive-function context weight adjusts each nominal CFP; the overall task result is the probability of at least one modeled step failure.', citations: [{ id: 'hollnagel-1998-cream' }] }),
      ]),
      section('example', 'Worked example', 'interpretation', [example('Combine two cognitive failures', 'Two adjusted step CFPs are 0.002 and 0.01.', ['Compute joint success = (1−0.002)(1−0.01) = 0.98802.', 'Subtract from 1.'], 'Task HEP = 0.01198 under the step-independence aggregation.')]),
      section('limits', 'Dependency and decomposition', 'advanced', [note('caution', 'A finer decomposition can create artificial precision. Explicitly address shared cues, recovery, and dependence; the simple product aggregation does not do so.', 'Step independence is consequential')]),
    ], related: ['hra.cream'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'hra.slim', moduleId: 'hra', title: 'SLIM-MAUD',
    summary: 'Convert expert-weighted performance-shaping-factor ratings into HEP through calibration against anchor tasks.',
    aliases: ['SLIM', 'Success Likelihood Index Method'], keywords: ['SLI', 'anchor tasks', 'calibration', 'PSF weights'],
    basics: { purpose: 'Quantify tasks when experts can make structured relative judgments but no suitable handbook nominal HEP exists.', useWhen: ['PSF weights/ratings and credible calibration anchors are available'], inputs: ['PSF weights and ratings plus two known-HEP anchor tasks, or validated calibration coefficients'], outputs: ['Success Likelihood Index, calibration coefficients, and HEP'], assumptions: ['Weights represent relative importance', 'Anchor HEPs support linear log10 calibration over the task range'] },
    sections: [
      section('equations', 'Index and calibration', 'practice', [
        equation('SLI=\\frac{\\sum_i w_ir_i}{\\sum_i w_i},\\qquad \\log_{10}(HEP)=a\\,SLI+b', { symbols: [{ symbol: 'w_i', meaning: 'expert importance weight' }, { symbol: 'r_i', meaning: 'task rating on PSF i' }], citations: [{ id: 'embrey-1984-slim' }] }),
      ]),
      section('example', 'Worked example', 'interpretation', [example('Calibrated SLI', 'A task has SLI = 0.60 and calibration log10(HEP) = −3×SLI − 1.', ['Compute log10(HEP) = −3×0.6−1 = −2.8.', 'Compute HEP = 10⁻²·⁸.'], 'HEP ≈ 0.001585, conditional on the anchor calibration.')]),
      section('limits', 'Calibration is the model', 'advanced', [note('caution', 'A precise SLI does not compensate for weak anchors or group bias. Preserve elicitation rationale, sensitivity to weights, and anchor provenance.', 'Expert judgment requires traceability')]),
    ], related: ['hra.heart', 'hra.spar-h'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'hra.atheana', moduleId: 'hra', title: 'EFC Elicitation Screen',
    summary: 'Document an unsafe action and error-forcing context, then summarize one triangular expert HEP judgment.',
    aliases: ['error-forcing context', 'EFC screen'], keywords: ['triangular estimate', 'unsafe action', 'ATHEANA'],
    basics: { purpose: 'Capture a transparent screening judgment about an unsafe action in a specific context.', useWhen: ['A rapid context-focused screen is needed and its limitations are acceptable'], inputs: ['Unsafe action, error-forcing context, and minimum/most-likely/maximum HEP'], outputs: ['Triangular mean and entered range'], assumptions: ['The ordered values summarize one analyst’s judgment; they are not calibrated confidence bounds'] },
    sections: [
      section('equation', 'Triangular judgment summary', 'practice', [equation('HEP_{screen}=\\frac{p_{min}+p_{mode}+p_{max}}{3}', { citations: [{ id: 'nrc-atheana', locator: 'contrast with the complete ATHEANA process' }] }), note('important', 'This screen is not an ATHEANA implementation. It omits the structured HFE/unsafe-action search, deviation analysis, dependency treatment, multidisciplinary review, and consensus quantification.', 'Identity of the result')]),
      section('example', 'Worked example', 'interpretation', [example('Summarize an elicitation', 'An analyst enters 0.005, 0.03, and 0.20.', ['Verify 0 ≤ min ≤ mode ≤ max ≤ 1.', 'Add the three values: 0.235.', 'Divide by 3.'], 'Screening HEP ≈ 0.0783; the entered limits are judgment bounds, not a confidence interval.')]),
      section('limits', 'Appropriate use', 'advanced', [p('Use the result to document and prioritize a scenario. Do not substitute it for a complete HRA method in a decision that requires validated quantification.')]),
    ], related: ['hra.spar-h'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'hra.jhedi', moduleId: 'hra', title: 'Category-Factor Screen',
    summary: 'Apply a local task-category anchor and fixed aggravating-factor multiplier for prioritization.',
    aliases: ['category screen'], keywords: ['screening HEP', 'aggravating factors', 'JHEDI'],
    basics: { purpose: 'Rank tasks with a deliberately simple local heuristic.', useWhen: ['Only coarse category and aggravating-condition information is available'], inputs: ['Task category and count of aggravating factors'], outputs: ['Base anchor and capped screening HEP'], assumptions: ['Each aggravating factor multiplies the anchor by 3', 'The local anchors are suitable only for screening'] },
    sections: [
      section('equation', 'Screening rule', 'practice', [equation('HEP_{screen}=\\min(1,p_{category}3^n)', {}), note('important', 'This is not JHEDI and is not a validated conservative bound.', 'Local heuristic')]),
      section('example', 'Worked example', 'interpretation', [example('Complex task with two aggravators', 'The complex category anchor is 0.1 and n = 2.', ['Compute multiplier 3² = 9.', 'Compute 0.1×9 = 0.9.'], 'Screening HEP = 0.9. Use it for prioritization, not decision-grade quantification.')]),
      section('limits', 'Escalate the analysis', 'advanced', [p('A high-priority task should move to a method with explicit task evidence, context, dependency, and uncertainty rather than receiving more digits from this screen.')]),
    ], related: ['hra.heart', 'hra.therp'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'hra.sherpa', moduleId: 'hra', title: 'Error-Mode Screen',
    summary: 'Classify credible task-step error modes, map local L/M/H ratings to anchors, and aggregate the chance of at least one screened error.',
    aliases: ['SHERPA-inspired screen'], keywords: ['Action', 'Checking', 'Retrieval', 'Communication', 'Selection'],
    basics: { purpose: 'Structure an error-mode review and prioritize critical steps.', useWhen: ['A task can be decomposed into steps and only coarse likelihood ratings are available'], inputs: ['Rows with error mode, L/M/H likelihood, and critical flag'], outputs: ['Overall screening probability, worst critical anchor, and mode counts'], assumptions: ['L/M/H map to 0.001/0.01/0.1', 'Rows are independent for aggregation'] },
    sections: [
      section('equation', 'Aggregation', 'practice', [equation('p_{any}=1-\\prod_i(1-p_i)', {}), note('important', 'The taxonomy is SHERPA-inspired, but the fixed numeric anchors and independent-row aggregation are local screening rules—not a complete SHERPA workflow.', 'Method boundary')]),
      section('example', 'Worked example', 'interpretation', [example('Three screened steps', 'Likelihoods are L = 0.001, M = 0.01, and H = 0.1.', ['Compute success product = 0.999×0.99×0.9 = 0.890109.', 'Subtract from 1.'], 'Overall screening probability = 0.109891 under the independence assumption.')]),
      section('limits', 'Dependencies and recovery', 'advanced', [p('Shared causes can make the independent product too low; mutually exclusive modes or recovery can make it too high. Treat the aggregate as a prioritization aid.')]),
    ], related: ['hra.cream-extended', 'hra.therp'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'hra.mermos', moduleId: 'hra', title: 'Mission-Scenario Screen',
    summary: 'Sum analyst-supplied probabilities for explicitly mutually exclusive mission-failure scenarios.',
    aliases: ['mission scenarios'], keywords: ['mutually exclusive', 'scenario probability', 'MERMOS'],
    basics: { purpose: 'Organize and prioritize a small set of disjoint mission-failure scenarios.', useWhen: ['Scenarios are demonstrably mutually exclusive and their probabilities are supplied externally'], inputs: ['Scenario labels/probabilities and mutual-exclusivity confirmation'], outputs: ['Total failure probability and dominant scenario'], assumptions: ['Scenarios do not overlap', 'Inputs sum to no more than one'] },
    sections: [
      section('equation', 'Disjoint-scenario sum', 'practice', [equation('P(\\text{mission failure})=\\sum_iP(S_i),\\quad S_i\\cap S_j=\\varnothing', {}), note('important', 'This arithmetic screen is not a MERMOS implementation. It omits mission analysis, important-configuration construction, crew-response modeling, recovery/dependency treatment, and method-specific quantification.', 'Method boundary')]),
      section('example', 'Worked example', 'interpretation', [example('Three disjoint failure scenarios', 'Scenario probabilities are 0.01, 0.03, and 0.02.', ['Confirm that no outcome can belong to more than one scenario.', 'Sum 0.01+0.03+0.02.'], 'Total screened mission-failure probability = 0.06; the 0.03 scenario is dominant.')]),
      section('limits', 'Overlapping scenarios', 'advanced', [note('caution', 'Do not force an arithmetic sum when scenarios overlap. Redefine them as disjoint outcomes or use a dependency-capable event model.', 'Mutual exclusivity is required')]),
    ], related: ['systemModeling.fault-tree', 'hra.spar-h'], reviewed: REVIEWED, exampleKind: 'worked',
  },

  // Warranty
  {
    id: 'warranty.workflow', moduleId: 'warranty', title: 'Warranty Workflow & Nevada Chart',
    summary: 'Convert shipment-period returns into weighted interval/right-censored observations, fit one selected life family, and forecast expected future returns.',
    aliases: ['Nevada chart', 'warranty forecast'], keywords: ['ship lots', 'grouped likelihood', 'interval censored', 'right censored'],
    basics: { purpose: 'Analyze aggregated warranty cohorts without pretending period counts are exact failure ages.', useWhen: ['Shipment quantities and returns by later calendar period are available'], inputs: ['Upper-triangular shipment/return table, forecast horizon, and one of seven distributions'], outputs: ['Grouped observation summary, fitted parameters, forecast table/plot, and parameter-only interval when available'], assumptions: ['Lots share one life distribution', 'Period grouping is represented by interval censoring', 'Returns are failures under the modeled definition'] },
    sections: [
      section('workflow', 'From chart to forecast', 'practice', [
        list(['Enter each shipment quantity and returns observed in later periods.', 'Confirm a lot’s total returns do not exceed its shipped quantity.', 'Select a scientifically plausible distribution and run Analyze.', 'Inspect parameters and forecast; compare alternative families in separate analyses rather than selecting only by the forecast you prefer.'], undefined, true),
        equation('\\ell(\\theta)=\\sum_jw_j\\log[F_\\theta(u_j)-F_\\theta(l_j)]+\\sum_kw_k\\log S_\\theta(c_k)', { explanation: 'A return in age interval (l,u] contributes interval probability; a unit still in service at age c contributes survival probability.', citations: [{ id: 'nist-apr-censoring' }, { id: 'turnbull-1976' }] }),
        equation('E[N_{ik}]=S_i\\frac{F(a_i+k)-F(a_i+k-1)}{1-F(a_i)}', { explanation: 'Expected future returns for surviving units Si in lot i, conditional on survival to current age ai.' }),
      ]),
      section('walkthrough', 'Walkthrough: analyze a chart', 'interpretation', [example('Forecast three periods', 'Five shipment lots have an upper-triangular returns history.', ['Enter quantities and period returns, leaving structurally unavailable cells disabled.', 'Choose a life family based on mechanism and shape, then set three forecast periods.', 'Analyze and verify failure/right-censored weights.', 'Interpret forecast totals and their parameter-only interval.'], 'The output preserves period uncertainty and conditions forecasts on the selected fitted family.', 'Intervals exclude future claim-count variation and model-selection uncertainty.')]),
      section('diagnostics', 'What to verify', 'advanced', [list(['No-failure data cannot identify a parametric warranty fit.', 'A local covariance interval may be unavailable for weak or nonquadratic fits.', 'Three-parameter threshold families are excluded because grouped periods do not safely identify the threshold here.', 'Forecasts are conditional on current survivors and the selected model.'])],),
    ], related: ['warranty.weibull-2p', 'warranty.lognormal-2p', 'warranty.exponential-1p'], reviewed: REVIEWED, exampleKind: 'walkthrough',
  },
  {
    id: 'warranty.weibull-2p', moduleId: 'warranty', title: 'Warranty: Weibull 2P',
    summary: 'A positive-life family with a shape parameter that can represent decreasing, constant, or increasing hazard.',
    aliases: ['Weibull_2P'], keywords: ['eta', 'beta', 'wear-out'],
    basics: { purpose: 'Model flexible monotone hazard behavior on positive ages.', useWhen: ['Failure ages are positive and a monotone hazard is plausible'], inputs: ['Grouped warranty chart'], outputs: ['Scale η, shape β, fitted likelihood, and forecasts'], assumptions: ['No threshold/location parameter', 'One Weibull population'] },
    sections: [section('equation', 'Distribution', 'practice', [equation('F(t)=1-e^{-(t/\\eta)^\\beta},\\quad h(t)=\\frac{\\beta}{\\eta}(t/\\eta)^{\\beta-1}', { symbols: [{ symbol: '\\eta', meaning: 'characteristic-life scale', unit: 'time' }, { symbol: '\\beta', meaning: 'shape; <1 decreasing, =1 constant, >1 increasing hazard' }] })]), section('example', 'Worked example', 'interpretation', [example('Conditional next-period probability', 'η = 10 periods, β = 2, and a lot has survived to age 3.', ['Compute F(3) and F(4).', 'Compute [F(4)−F(3)]/[1−F(3)].'], 'The conditional return probability in ages (3,4] is about 6.76%; multiply by current survivors for expected returns.')]), section('limits', 'Model check', 'advanced', [p('A curved or nonmonotone underlying hazard, mixtures, changing product revisions, or reporting delays can make one Weibull misleading.')])],
    related: ['warranty.workflow', 'lifeData.weibull-2p'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'warranty.lognormal-2p', moduleId: 'warranty', title: 'Warranty: Lognormal 2P',
    summary: 'A positive-life family for multiplicative degradation or failure-time mechanisms with a unimodal hazard.',
    aliases: ['Lognormal_2P'], keywords: ['log time', 'mu', 'sigma'],
    basics: { purpose: 'Model ages whose logarithms are approximately normal.', useWhen: ['A multiplicative mechanism and right-skewed positive lifetime are plausible'], inputs: ['Grouped warranty chart'], outputs: ['Log-location μ, log-scale σ, and forecasts'], assumptions: ['ln(T) is normal', 'No threshold parameter'] },
    sections: [section('equation', 'Distribution', 'practice', [equation('F(t)=\\Phi\\left(\\frac{\\ln t-\\mu}{\\sigma}\\right),\\quad t>0', { symbols: [{ symbol: '\\mu', meaning: 'mean log lifetime' }, { symbol: '\\sigma', meaning: 'standard deviation of log lifetime' }] })]), section('example', 'Worked example', 'interpretation', [example('Interpret the median', 'A fit gives μ = 2.3 and σ = 0.5.', ['Median = exp(μ).', 'Compute exp(2.3).'], 'Median life ≈ 9.97 periods; σ controls log-scale spread, not time-unit standard deviation.')]), section('limits', 'Model check', 'advanced', [p('The lognormal hazard eventually decreases. Prefer a mechanism-based choice over assuming all right-skewed data are lognormal.')])],
    related: ['warranty.workflow', 'lifeData.lognormal-2p'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'warranty.normal-2p', moduleId: 'warranty', title: 'Warranty: Normal 2P',
    summary: 'A symmetric location-scale family that can assign probability to nonphysical negative ages.',
    aliases: ['Normal_2P', 'Gaussian warranty'], keywords: ['mu', 'sigma', 'symmetric life'],
    basics: { purpose: 'Model approximately symmetric lifetimes far from zero.', useWhen: ['Negative-tail probability is negligible and symmetric variation is defensible'], inputs: ['Grouped warranty chart'], outputs: ['Mean μ, standard deviation σ, and forecasts'], assumptions: ['Normal support is acceptable for the age scale'] },
    sections: [section('equation', 'Distribution', 'practice', [equation('F(t)=\\Phi\\left(\\frac{t-\\mu}{\\sigma}\\right)', {})]), section('example', 'Worked example', 'interpretation', [example('Check negative-life probability', 'μ = 20 periods and σ = 5 periods.', ['Compute z at age 0: (0−20)/5 = −4.', 'Evaluate Φ(−4).'], 'Negative-age probability is about 0.0032%, which may be negligible for this use; repeat the check for the actual fit.')]), section('limits', 'Support check', 'advanced', [note('caution', 'Reject or qualify the normal model when it assigns material mass below age zero.', 'Nonphysical tail')])],
    related: ['warranty.workflow'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'warranty.exponential-1p', moduleId: 'warranty', title: 'Warranty: Exponential 1P',
    summary: 'A one-parameter positive-life model with constant hazard and memoryless conditional risk.',
    aliases: ['Exponential_1P'], keywords: ['Lambda', 'constant failure rate', 'memoryless'],
    basics: { purpose: 'Provide a parsimonious constant-hazard warranty model.', useWhen: ['Failure intensity is plausibly constant over age'], inputs: ['Grouped warranty chart'], outputs: ['Rate Λ and forecasts'], assumptions: ['No aging trend and no threshold'] },
    sections: [section('equation', 'Distribution', 'practice', [equation('F(t)=1-e^{-\\Lambda t},\\quad h(t)=\\Lambda,\\quad MTTF=1/\\Lambda', {})]), section('example', 'Worked example', 'interpretation', [example('One-period conditional risk', 'Λ = 0.02 per period.', ['Use memorylessness: P(fail in next period | survived now) = 1−exp(−0.02).'], 'Conditional probability ≈ 1.98% at every age; 500 current survivors imply about 9.9 expected returns next period.')]), section('limits', 'Model check', 'advanced', [p('A systematic increase or decrease in conditional return rate contradicts the constant-hazard assumption.')])],
    related: ['warranty.workflow', 'warranty.weibull-2p'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'warranty.gamma-2p', moduleId: 'warranty', title: 'Warranty: Gamma 2P',
    summary: 'A flexible positive-life shape/scale family suitable for accumulated waiting-time mechanisms.',
    aliases: ['Gamma_2P'], keywords: ['alpha', 'beta', 'shape scale'],
    basics: { purpose: 'Model positive right-skewed life with gamma shape and scale.', useWhen: ['An accumulated-stage or waiting-time mechanism is plausible'], inputs: ['Grouped warranty chart'], outputs: ['Shape α, scale β, and forecasts'], assumptions: ['One gamma population and zero location'] },
    sections: [section('equation', 'Distribution moments', 'practice', [equation('f(t)=\\frac{t^{\\alpha-1}e^{-t/\\beta}}{\\Gamma(\\alpha)\\beta^{\\alpha}},\\quad E[T]=\\alpha\\beta,\\quad Var(T)=\\alpha\\beta^2', {})]), section('example', 'Worked example', 'interpretation', [example('Interpret fitted parameters', 'α = 4 and β = 3 periods.', ['Compute mean αβ = 12 periods.', 'Compute standard deviation √α β = 6 periods.'], 'The fitted family has mean 12 and standard deviation 6 periods.')]), section('limits', 'Parameter convention', 'advanced', [note('info', 'Perdura uses β as the gamma scale in this warranty fit. Some references use a rate parameter 1/β.', 'Check the convention')])],
    related: ['warranty.workflow'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'warranty.loglogistic-2p', moduleId: 'warranty', title: 'Warranty: Loglogistic 2P',
    summary: 'A positive-life family with a logistic log-time model and potentially heavier upper tail than the lognormal.',
    aliases: ['Loglogistic_2P', 'Fisk'], keywords: ['alpha', 'beta', 'heavy tail'],
    basics: { purpose: 'Model positive lifetimes with a unimodal hazard and comparatively heavy tail.', useWhen: ['Long-lived units are more common than lighter-tailed families predict'], inputs: ['Grouped warranty chart'], outputs: ['Scale α, shape β, and forecasts'], assumptions: ['One log-logistic population and zero location'] },
    sections: [section('equation', 'Distribution', 'practice', [equation('F(t)=\\frac{1}{1+(t/\\alpha)^{-\\beta}},\\quad S(t)=\\frac{1}{1+(t/\\alpha)^{\\beta}}', {})]), section('example', 'Worked example', 'interpretation', [example('Interpret the scale', 'α = 8 periods and β = 3.', ['Evaluate F(α).', 'F(8)=1/[1+1]=0.5.'], 'The scale α is the median: half the modeled population fails by 8 periods.')]), section('limits', 'Tail consequences', 'advanced', [p('Heavy-tail forecasts can be sensitive far beyond the observed chart. Treat long extrapolation cautiously.')])],
    related: ['warranty.workflow', 'warranty.lognormal-2p'], reviewed: REVIEWED, exampleKind: 'worked',
  },
  {
    id: 'warranty.gumbel-2p', moduleId: 'warranty', title: 'Warranty: Gumbel 2P',
    summary: 'A left-skewed extreme-value location-scale family implemented with the minimum-value Gumbel convention.',
    aliases: ['Gumbel_2P', 'minimum Gumbel'], keywords: ['extreme value', 'mu', 'sigma'],
    basics: { purpose: 'Represent minimum-extreme mechanisms on an unbounded age scale.', useWhen: ['An extreme-value mechanism and the minimum-Gumbel skew direction are defensible'], inputs: ['Grouped warranty chart'], outputs: ['Location μ, scale σ, and forecasts'], assumptions: ['Minimum-value Gumbel support and skew are appropriate'] },
    sections: [section('equation', 'Minimum-Gumbel convention', 'practice', [equation('F(t)=1-\\exp\\{-\\exp[(t-\\mu)/\\sigma]\\}', { explanation: 'This is the minimum-value (left-skewed) Gumbel, matching the implemented SciPy gumbel_l convention.' })]), section('example', 'Worked example', 'interpretation', [example('Interpret location', 'At t = μ for any positive σ.', ['Substitute (t−μ)/σ = 0.', 'Compute F(μ)=1−exp(−1).'], 'About 63.2% of the modeled population has failed by μ.')]), section('limits', 'Support and direction', 'advanced', [note('caution', 'Gumbel is unbounded and has two common orientations. Verify both negative-age mass and the minimum-value orientation before using it.', 'Convention matters')])],
    related: ['warranty.workflow'], reviewed: REVIEWED, exampleKind: 'worked',
  },

  // Report Builder. The shared legacy content supplies reportBuilder.overview.
  {
    id: 'reportBuilder.workflow', moduleId: 'reportBuilder', title: 'Report Builder Workflow',
    summary: 'Compose multiple project-backed reports from live analysis assets and narrative blocks.',
    aliases: ['build report', 'report tabs'], keywords: ['multiple reports', 'reorder', 'refresh', 'page format'],
    basics: { purpose: 'Turn project evidence into an organized, exportable report.', useWhen: ['Analyses are complete enough to communicate'], inputs: ['Project assets, report blocks, titles, layout, headers, and footers'], outputs: ['One or more persisted report compositions'], assumptions: ['The analyst remains responsible for narrative, interpretation, and source review'] },
    sections: [section('workflow', 'Build a report', 'practice', [list(['Create or rename a report tab.', 'Add headings and narrative blocks to establish the argument.', 'Insert project assets under the relevant sections.', 'Drag or use move controls to order blocks; add page breaks deliberately.', 'Refresh live data, review every changed block, then export.'], undefined, true)]), section('walkthrough', 'Walkthrough: results summary', 'interpretation', [example('Create a compact reliability report', 'A project contains Life Data, Failure Rate Prediction, and Maintenance results.', ['Create headings for Data, Prediction, and Maintenance.', 'Insert one decision-relevant plot/table from each module.', 'Add text that states assumptions and limitations beside each result.', 'Set page format and header/footer, then refresh live data.', 'Export PDF for controlled distribution and HTML when interactive plots are useful.'], 'The report preserves project-linked evidence and a readable decision narrative.')]), section('limits', 'Review responsibility', 'advanced', [note('important', 'Automatic asset discovery is not automatic editorial judgment. Remove redundant charts, state units and confidence levels, and distinguish model output from engineering conclusions.', 'Curate the evidence')])],
    related: ['reportBuilder.assets', 'reportBuilder.blocks', 'reportBuilder.export'], reviewed: REVIEWED, exampleKind: 'walkthrough',
  },
  {
    id: 'reportBuilder.assets', moduleId: 'reportBuilder', title: 'Project Assets',
    summary: 'Discover plots, tables, and key metrics saved by analyses throughout the current project.',
    aliases: ['asset library', 'live assets'], keywords: ['enumerate', 'refresh', 'analysis results'],
    basics: { purpose: 'Insert analysis-backed evidence without copying values manually.', useWhen: ['An analysis has produced saved results'], inputs: ['Current project analyses and their persisted outputs'], outputs: ['Plot, table, or metric report blocks linked to asset identifiers'], assumptions: ['Only supported, persisted analysis outputs can be enumerated'] },
    sections: [section('workflow', 'Insert, bookmark, and refresh assets', 'practice', [list(['Expand the module and analysis group.', 'Select an asset to insert it at the end of the active report, or use its bookmark icon to add it to Dashboard.', 'Rename its report label if needed without changing the source result.', 'Use Refresh assets to discover new outputs; use Refresh live data to update inserted asset-backed blocks.'], undefined, true)]), section('walkthrough', 'Walkthrough: update after recalculation', 'interpretation', [example('Refresh a changed plot', 'A source analysis has been recalculated after a report was composed.', ['Return to Report Builder.', 'Refresh project assets if new artifacts were created.', 'Use Refresh live data for existing linked blocks.', 'Review axes, annotations, tables, and narrative for consistency.'], 'The report block reflects current project data while retaining report placement and labeling.')]), section('limits', 'Missing assets', 'advanced', [p('If an expected artifact is absent, confirm that its source analysis completed and saved a result. A screen-only UI element or transient preview may not be a report asset. Bookmarks retain their source metadata and appear unavailable if that source result is removed.')])],
    related: ['reportBuilder.workflow', 'reportBuilder.snapshots', 'reportBuilder.blocks'], reviewed: REVIEWED, exampleKind: 'walkthrough',
  },
  {
    id: 'reportBuilder.snapshots', moduleId: 'reportBuilder', title: 'Plot Snapshot Library',
    summary: 'Freeze the current interactive state of any Plotly chart for later reuse as an immutable Report Builder asset.',
    aliases: ['plot snapshot', 'camera button', 'frozen plot', 'snapshot asset'], keywords: ['zoom', 'legend', 'annotations', 'trace visibility', 'checksum'],
    basics: { purpose: 'Preserve a reviewed plot view independently of later recalculation or source deletion.', useWhen: ['A particular zoom, trace selection, legend placement, or annotation state must be retained'], inputs: ['The currently displayed Plotly figure'], outputs: ['A persistent, checksummed interactive plot in the Plot Snapshots library'], assumptions: ['A snapshot is a frozen copy, not a live link to its source analysis'] },
    sections: [
      section('capture', 'Capture and insert a snapshot', 'practice', [list(['Adjust the plot view, trace visibility, legend, and annotations as needed.', 'Select the camera button beside the plot bookmark button; capture is immediate.', 'Open Report Builder and expand Plot Snapshots, then its source module and analysis.', 'Select the snapshot to add an independent copy to the active report.'], undefined, true)]),
      section('contents', 'What the snapshot preserves', 'interpretation', [p('The stored interactive figure preserves trace data and visibility, axis ranges, three-dimensional camera state, legend placement, titles, annotations, and shapes. Pixel dimensions and transient editing modes are removed so the figure can resize within a report.'), p('Each entry records its capture time, source context, serialized size, software identity, and SHA-256 figure checksum. The checksum detects later byte changes but is not a digital signature.')]),
      section('walkthrough', 'Walkthrough: preserve a reviewed CDF view', 'interpretation', [example('Freeze a decision view', 'An LDA CDF has been zoomed to the mission-time region, secondary traces are hidden, and the reviewed point is annotated.', ['Select the camera button beside Bookmark.', 'Confirm that the saved notification identifies the plot.', 'Open Report Builder and insert the new entry from Plot Snapshots.', 'Verify the axis range, visible traces, legend, and annotation before export.'], 'The report contains an interactive frozen copy even if the LDA analysis is later recalculated.')]),
      section('lifecycle', 'Frozen-copy behavior', 'advanced', [note('important', 'Refresh live data never changes snapshot-backed report blocks. Recalculating or deleting the source analysis also leaves the snapshot unchanged.', 'Snapshots are immutable'), p('Renaming or deleting a library entry does not alter copies already inserted into reports. Interactive figures can contain substantial data, so remove snapshots that are no longer needed if browser project storage becomes constrained.')]),
    ],
    related: ['reportBuilder.assets', 'reportBuilder.blocks', 'dashboard.plot-interactions'], reviewed: '2026-07-21', exampleKind: 'walkthrough',
  },
  {
    id: 'reportBuilder.blocks', moduleId: 'reportBuilder', title: 'Report Blocks & Page Layout',
    summary: 'Combine narrative, evidence, structure, and pagination using typed report blocks.',
    aliases: ['heading block', 'text block', 'page break', 'Markdown block', 'import image'], keywords: ['plot', 'table', 'metrics', 'divider', 'drag', 'GFM', 'LaTeX', 'caption'],
    basics: { purpose: 'Create a readable hierarchy around analysis assets.', useWhen: ['Organizing evidence for review or export'], inputs: ['Heading, text, divider, page-break, plot, table, and metric blocks'], outputs: ['Ordered report pages with configured size, orientation, margins, header, and footer'], assumptions: ['Page preview approximates export but final pagination must still be reviewed'] },
    sections: [section('block-types', 'Choose the block', 'practice', [list(['Heading: establish section hierarchy.', 'Text Paragraph: use Rich for direct formatting, Markdown for exact GFM/LaTeX source, and Preview for the export-oriented rendering. Both editors update the same canonical Markdown content.', 'Rich mode provides paragraph/heading styles, emphasis, lists, quotations, code blocks, safe links, tables, equations, and rules. Equations are protected there; switch to Markdown mode to revise their LaTeX source.', 'Use $...$ for inline LaTeX and $$...$$ for a display equation. An amber indicator identifies expressions KaTeX cannot render.', 'Imported Image: select a local PNG, JPEG, or WebP, then set its width, alignment, caption, and meaningful alternative text.', 'Plot/table/metrics: present project-backed evidence.', 'Divider: create visual separation without forcing a new page.', 'Page break: explicitly start a new PDF/print page.'])]), section('walkthrough', 'Walkthrough: document an interpreted result', 'interpretation', [example('Combine narrative, equation, and figure', 'An analysis result needs assumptions, a governing equation, and a supporting laboratory photograph.', ['Add a Text Paragraph and enter assumptions in Rich mode as a formatted list.', 'Use the equation control or Markdown mode to add $$...$$ LaTeX, then switch to Preview.', 'Import the local image, add alternative text and a concise caption, then choose a readable width.', 'Export both PDF and HTML and verify pagination, links, equation rendering, and image legibility.'], 'The report presents structured, accessible narrative and controlled local evidence consistently in both formats.')]), section('security', 'Controlled authored content', 'advanced', [note('important', 'Raw HTML and executable or unsafe links are not rendered. Rich-editor paste is plain text. Markdown image URLs are intentionally omitted; use the Imported Image block so the source is local, bounded, checksummed, and reproducible in exports.', 'Use controlled content')]), section('accessibility', 'Readable reports', 'advanced', [list(['Use descriptive headings and asset labels.', 'Give every imported image meaningful alternative text; use captions for interpretation rather than repeating the alt text.', 'Do not rely on color alone to communicate status.', 'Explain symbols, units, and uncertainty in nearby text.', 'Keep tables compact enough to remain legible at export size.'])])],
    related: ['reportBuilder.assets', 'reportBuilder.snapshots', 'reportBuilder.export'], reviewed: REVIEWED, exampleKind: 'walkthrough',
  },
  {
    id: 'reportBuilder.templates', moduleId: 'reportBuilder', title: 'Report Templates',
    summary: 'Reuse a report’s block structure, page format, header, and footer within or across projects.',
    aliases: ['template JSON', 'save template'], keywords: ['import template', 'export template', 'layout reuse'],
    basics: { purpose: 'Standardize recurring report structure and presentation.', useWhen: ['The same review format is used repeatedly'], inputs: ['The active report or a compatible template JSON file'], outputs: ['A saved local template, exported template file, or populated active report'], assumptions: ['Templates describe report composition; source assets still depend on the current project'] },
    sections: [section('workflow', 'Template lifecycle', 'practice', [list(['Prepare the active report’s structure and formatting.', 'Save as Template for reuse on the device or Export Template File for transfer.', 'In a target project, create/select the destination report and import or load the template.', 'Replace or refresh project-backed assets and review every narrative claim.'], undefined, true)]), section('walkthrough', 'Walkthrough: reuse a review format', 'interpretation', [example('Apply a quarterly template', 'A standardized report has sections for executive summary, evidence, assumptions, and actions.', ['Export the approved template.', 'Open the next project and import it into a new report tab.', 'Insert that project’s assets under the matching headings.', 'Update dates, conclusions, and limitations before export.'], 'The format is consistent without carrying over unreviewed conclusions as if they were new evidence.')]), section('security', 'Treat templates as content', 'advanced', [note('caution', 'Import templates only from trusted sources and review their text and block definitions. A template is not a validated analysis or approval record.', 'Review imported content')])],
    related: ['reportBuilder.workflow', 'dashboard.project-files'], reviewed: REVIEWED, exampleKind: 'walkthrough',
  },
  {
    id: 'reportBuilder.export', moduleId: 'reportBuilder', title: 'Export PDF, HTML & Multiple Reports',
    summary: 'Produce paginated PDF or standalone interactive HTML, and export all report tabs when several deliverables are required.',
    aliases: ['PDF export', 'HTML export', 'Export All'], keywords: ['interactive plot', 'print', 'header footer', 'page number'],
    basics: { purpose: 'Create distributable report artifacts from the active project.', useWhen: ['The report has passed content and layout review'], inputs: ['Active report(s), page settings, optional headers/footers, and export format'], outputs: ['PDF file(s) or standalone HTML file'], assumptions: ['Recipients have an appropriate viewer; HTML interactivity and PDF pagination serve different needs'] },
    sections: [section('formats', 'Choose the format', 'practice', [list(['PDF: fixed pagination for controlled review, printing, and archiving.', 'HTML: standalone report with interactive plots.', 'Export All: emit each report tab as a separate PDF.', 'Header/footer tokens include {date}, {page}, and {pages}.'])]), section('walkthrough', 'Walkthrough: release two formats', 'interpretation', [example('Archive and explore', 'Reviewers require a signed-style fixed record and engineers want interactive plots.', ['Refresh live data and inspect the final report.', 'Export PDF and review page breaks, clipped content, labels, and headers.', 'Export HTML and open it locally to verify plot interaction.', 'Record the project revision used for both artifacts.'], 'The PDF supplies a stable review copy while HTML supplies interactive exploration from the same reviewed content.')]), section('verification', 'Pre-release checklist', 'advanced', [list(['Confirm all source analyses are current.', 'Verify units, model names, confidence levels, and citation locators.', 'Inspect every exported page and interactive plot.', 'Protect sensitive project data according to organizational policy.'])])],
    related: ['reportBuilder.workflow', 'reportBuilder.blocks'], reviewed: REVIEWED, exampleKind: 'walkthrough',
  },
]
