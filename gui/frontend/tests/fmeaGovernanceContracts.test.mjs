import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const api = readFileSync(new URL('../src/api/fmea.ts', import.meta.url), 'utf8')
const workspace = readFileSync(new URL(
  '../src/components/FMEA/index.tsx', import.meta.url,
), 'utf8')
const aiagWorkspace = readFileSync(new URL(
  '../src/components/ReliabilityProgram/AiagVdaWorkspace.tsx',
  import.meta.url,
), 'utf8')
const vocabularyAid = readFileSync(new URL(
  '../src/components/ReliabilityProgram/FmeaVocabularyAid.tsx',
  import.meta.url,
), 'utf8')
const blockDiagram = readFileSync(new URL(
  '../src/components/ReliabilityProgram/FmeaBlockDiagramCanvas.tsx',
  import.meta.url,
), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const store = readFileSync(new URL('../src/store/project.ts', import.meta.url), 'utf8')
const assets = readFileSync(new URL(
  '../src/store/assetExtractors.ts', import.meta.url,
), 'utf8')
const methodology = readFileSync(new URL(
  '../../../docs/methodology/fmea-controlled-workflows.md', import.meta.url,
), 'utf8')
const failureFlow = readFileSync(new URL(
  '../src/components/FMEA/failureFlow.ts', import.meta.url,
), 'utf8')
const failureFlowManager = readFileSync(new URL(
  '../src/components/FMEA/FailureFlowManager.tsx', import.meta.url,
), 'utf8')
const workbook = readFileSync(new URL(
  '../src/components/ReliabilityProgram/fmeaModel.ts', import.meta.url,
), 'utf8')

assert.match(app, /id: 'fmea'.*moduleKey: 'fmea'/,
  'FMEA must be a dedicated top-level module')
assert.match(store, /fmea: \{ tab: 'fmea' \}/,
  'undo, bookmarks, and assets must navigate to dedicated FMEA')
assert.match(workspace, /Analysis.*Evidence.*FMEDA.*Review & Release.*Methods/s,
  'the workspace must expose analysis and governance views')
assert.match(workspace, /identity not authenticated/,
  'local named attestations must not imply authenticated identity')
assert.match(workspace, /Reference required/,
  'reference-gated standards must be clear in the UI')
assert.match(workspace, /Residual \/ hour/,
  'generic FMEDA accounting must label residual rate without an ISO PMHF claim')
assert.match(workspace, /Failure-rate sources/,
  'FMEDA must define source rates separately from failure-mode allocations')
assert.match(workspace, /Foundation and family library/,
  'controlled reusable knowledge must be exposed in the workspace')
assert.match(workspace, /Evidence-grounded guidance/,
  'proposal-only cited guidance must be exposed in the workspace')
assert.match(workspace, /Submit for review.*Approve baseline.*Release/s,
  'lifecycle actions must be explicit and ordered')
assert.match(workspace, /function LinkSelector/,
  'semantic references must use human-readable selectors instead of raw ID text')
assert.match(aiagWorkspace, /block_diagram\.nodes[\s\S]*node\.kind === 'external'[\s\S]*node\.label/,
  'Function target suggestions must include Block Diagram external context')
assert.match(aiagWorkspace, /blocks\.every\(block => !block\.inside_boundary\)/,
  'Function targets must derive boundary status from Block Diagram records')
assert.match(blockDiagram, /FMEA_EXTERNAL_CONTEXT_TARGETS/,
  'the Block Diagram external-context library must expose Function targets')
assert.match(aiagWorkspace, /for \(const label of FMEA_EXTERNAL_CONTEXT_TARGETS\)[\s\S]*add\(label, 'outside'\)/,
  'standard external contexts must remain targets without diagram nodes')
assert.match(vocabularyAid, /In-bounds targets[\s\S]*Out-of-bounds targets/,
  'Function target picker must visibly separate boundary groups')
assert.match(api, /\/fmea\/releases\/verify/,
  'release verification must have a public API contract')
assert.match(api, /\/fmea\/evidence\/impact/,
  'evidence impact analysis must have a public API contract')
assert.match(api, /\/fmea\/library\/instantiate/,
  'controlled library instantiation must have a public API contract')
assert.match(api, /\/fmea\/suggestions/,
  'proposal-only guidance must have a public API contract')
assert.match(api, /source_checksum/,
  'evidence links must support content-addressed sources')
assert.match(assets, /FMEA Portfolio Summary/,
  'FMEA governance outputs must be Report Builder assets')
assert.match(assets, /Failure Flow Traceability/,
  'failure hierarchy links must be Report Builder assets')
assert.match(failureFlow, /higher_mode_to_lower_effect[\s\S]*higher_cause_to_lower_mode/,
  'both standard failure hierarchy rules must be executable')
assert.match(failureFlowManager, /Explicit portfolio hierarchy/,
  'cross-analysis hierarchy must require explicit analyst mapping')
assert.match(workbook, /Failure Flow Statements[\s\S]*Failure Flow History/,
  'controlled workbooks must carry failure-flow identity and audit sheets')
assert.match(store, /fmeaFailureFlow/,
  'failure-flow registry must travel with FMEA module import and export')
assert.match(methodology, /Reference-gated/,
  'methodology must disclose standards-profile verification status')
assert.match(methodology, /Mode.*Effect.*Cause.*Mode/s,
  'methodology must describe both hierarchy identities')
assert.match(methodology, /Semantic comparison addresses list/,
  'methodology must describe stable semantic diffs')

console.log('FMEA governance contracts passed')
