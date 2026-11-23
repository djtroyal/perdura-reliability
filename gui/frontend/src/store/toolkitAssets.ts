/** Saved analysis assets remain available without mounting the source tool. */
import type { AssetDescriptor } from './reportAssets'
import { inferenceResultStatus } from '../components/ALT/inferenceToolContracts'
import type { getProjectState } from './project'
import { lifecycleSourceStatus } from '../components/shared/systemLifecycleSource'
import { lifetimeResultStatus, inventoryResultStatus } from './toolkitFreshness'
import { comparePredictionScenarios, type ComparisonFolio } from '../components/Prediction/scenarioComparisonModel'
import type { SystemDefinitionModel } from '../api/systemDefinition'

type RecordValue = Record<string, unknown>
const record = (v: unknown): RecordValue => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : {}
const friendly = (key: string) => key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())
const display = (v: unknown): string => v == null ? 'Not available' : typeof v === 'number' ? (Number.isFinite(v) ? String(Number(v.toPrecision(10))) : 'Not finite') : typeof v === 'object' ? JSON.stringify(v) : String(v)

export function toolkitAssets(project: ReturnType<typeof getProjectState>): AssetDescriptor[] {
  const assets: AssetDescriptor[] = []
  function add(module: string, group: string, label: string, result: RecordValue, current = true, reason = '', analysisId?: string, view?: string) {
    if (!Object.keys(result).length) return
    const common = { module, moduleLabel: module === 'reliabilityTestingTools' ? 'Reliability Testing' : module === 'predictionComparison' ? 'Prediction' : ['system','faultTree'].includes(module) ? 'System Modeling' : 'Maintenance', group, analysisId, targetView: view,
      source: { module, tab: '', analysisName: group, assetKey: '', resultStatus: current ? 'current' as const : 'stale' as const } }
    const scalars = Object.entries(result).flatMap(([key, value]) => {
      if (key.startsWith('_') || ['assumptions','sources','csv','python_expression'].includes(key)) return []
      if (Array.isArray(value)) return []
      if (value && typeof value === 'object') return Object.entries(record(value)).filter(([, v]) => v == null || typeof v !== 'object').map(([k,v]) => ({ label: `${friendly(key)} · ${friendly(k)}`, value: display(v) }))
      return [{ label: friendly(key), value: display(value) }]
    })
    assets.push({ ...common, id: `${module}-${label}-metrics`, label: `${label} Summary`, type: 'metrics', getData: () => ({ metrics: [
      { label: 'Source status', value: current ? 'Current' : reason || 'Source changed' }, ...scalars,
      ...(Array.isArray(result.assumptions) ? [{ label: 'Assumptions', value: result.assumptions.join(' | ') }] : []),
    ] }) })
    for (const key of ['rows','trace','boundaries','phase_table','risk_points','exposure_rows','oc_curve','components','events']) {
      const rows = result[key]
      if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') continue
      const keys = Array.from(new Set(rows.flatMap(row => Object.keys(record(row)))))
      assets.push({ ...common, id: `${module}-${label}-${key}`, label: `${label} ${friendly(key)}`, type: 'table',
        getData: () => ({ tableHeaders: keys.map(friendly), tableRows: rows.map(row => keys.map(k => display(record(row)[k]))) }) })
    }
    if (Array.isArray(result.ages) && Array.isArray(result.durations) && Array.isArray(result.survival)) {
      const ages = result.ages as number[], durations = result.durations as number[], values = result.survival as number[][]
      assets.push({ ...common, id: `${module}-${label}-matrix`, label: `${label} Matrix`, type: 'table',
        getData: () => ({ tableHeaders: ['Attained age', ...durations.map(t => `Additional ${t} ${result._units ?? project.units}`)], tableRows: ages.map((a,i) => [a,...values[i].map(display)]) }) })
      assets.push({ ...common, id: `${module}-${label}-heatmap`, label: `${label} Heatmap`, type: 'plot',
        getData: () => ({ plotData: [{ type: 'heatmap', x: durations, y: ages, z: values, zmin:0, zmax:1, colorscale:'Viridis', colorbar:{ title:{ text:'Survival' } } }], plotLayout: { title:{text:'Conditional survival'},xaxis:{title:{text:'Additional duration'}},yaxis:{title:{text:'Attained age'}} } }) })
    }
    const curve = result.curve
    if (Array.isArray(curve) && curve.length && 'time' in record(curve[0])) {
      const keys = Object.keys(record(curve[0])).filter(k => k !== 'time' && typeof record(curve[0])[k] === 'number')
      assets.push({ ...common, id: `${module}-${label}-curve`, label: `${label} Curve`, type: 'plot',
        getData: () => ({ plotData: keys.map(k => ({ x: curve.map(row => record(row).time), y: curve.map(row => record(row)[k]), mode:'lines', name:friendly(k) })), plotLayout: {title:{text:label},xaxis:{title:{text:`Time (${project.units})`}}} }) })
    }
  }
  const life = record(project.modules.lifeTools)
  for (const [key,label] of [['matrixResult','Conditional Survival'],['mechanicalResult','Mechanical Equivalent Rate'],['inspectionResult','Inspection Prediction']]) {
    const r = record(life[key]); if (!Object.keys(r).length) continue
    const status = lifetimeResultStatus(project,life,key)
    add('lifeTools','Lifetime Tools',label,r,status.current,status.reason,undefined,key.replace('Result',''))
  }
  const inventory = record(project.modules.maintInventory), inventoryResult = record(inventory.result)
  const inventoryStatus = inventoryResultStatus(project)
  add('maintInventory','Inventory Planning','Inventory Plan',inventoryResult,inventoryStatus.current,inventoryStatus.reason)
  const comparison = record(project.modules.predictionComparison)
  if (comparison.baselineId && comparison.candidateId) {
    const folios = record(project.modules.prediction).folios as ComparisonFolio[] | undefined
    const model = record(project.modules.systemDefinition).model as SystemDefinitionModel | undefined
    if (model && Array.isArray(folios)) {
      const baseline = folios.find(f => f.id === comparison.baselineId), candidate = folios.find(f => f.id === comparison.candidateId)
      const pair = comparePredictionScenarios(model,baseline,candidate)
      add('predictionComparison','Scenario Comparison','Prediction Scenario Comparison',{
        baseline: baseline?.name, candidate: candidate?.name,
        rate_ratio: pair.rateRatio, mtbf_ratio: pair.mtbfRatio, rate_difference_fpmh: pair.rateDifference,
        assumptions: pair.reasons,
        rows: pair.rows.map(row => ({ part: row.name, identity: row.id, baseline_fpmh: row.baselineRate, candidate_fpmh: row.candidateRate, rate_ratio: row.ratio,
          changed_factors: row.factors, changed_inputs: row.inputs })),
      },!pair.reasons.length,pair.reasons.join(' '),undefined,'comparison')
    }
  }
  for (const [key,label,view] of [['aggregateMTBF','Field MTBF','field-mtbf'],['normalSummary','Normal Mean','normal-summary'],['discreteProbability','Discrete Acceptance','discrete-probability'],['oneProportion','Binomial Interval','one-proportion'],['sequentialSampling','Sequential Testing','sequential']]) {
    const saved = record(record(project.modules.reliabilityTestingTools)[key]), status = inferenceResultStatus(saved, project.units)
    add('reliabilityTestingTools','Test Planning',label,record(saved.result),status.current,status.reason,undefined,view)
  }
  for (const module of ['system','faultTree'] as const) {
    const raw = record(project.modules[module])
    const folios = Array.isArray(raw.folios) ? raw.folios.map(f => ({ ...record(f), ...record(record(f).state) })) : [raw]
    for (const state of folios) {
      const lifecycle = record(state.lifecycle)
      if (!Object.keys(lifecycle).length) continue
      let current = false, reason = 'Source cannot be resolved'
      try { const status = lifecycleSourceStatus(project,module === 'system' ? 'rbd' : 'fta',state as Parameters<typeof lifecycleSourceStatus>[2]); current = status.current; reason = status.reason } catch { /* retained historical result */ }
      for (const [key,label] of [['renewalResult','System Renewal'],['stateResult','System State Table'],['simulationResult','Repairable System Simulation']])
        add(module,String(state.name ?? 'Analysis'),label,record(lifecycle[key]),current,reason,typeof state.id === 'string' ? state.id : undefined,'lifecycle')
    }
  }
  return assets
}
