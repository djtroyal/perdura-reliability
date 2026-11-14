/** Build-time authoring helper; no runtime migration of old alpha projects. */
export function adaptAircraftDemo(payload, { materializeFmeaAnalysis, systemInputFingerprint, layoutProfiles,
  createSystemRequirement, createVerificationCase, stripSharedRequirementProjections }) {
  const project = structuredClone(payload)
  const model = project.modules.systemDefinition.model
  const oldModelId = 'system-demo-pumps'
  const instanceById = new Map(model.instances.map(instance => [instance.id, instance]))
  const definitionById = new Map(model.definitions.map(definition => [definition.id, definition]))
  const diagram = model.diagrams[0]
  const childrenById = new Map(model.instances.map(instance => [instance.id, []]))
  model.instances.forEach(instance => childrenById.get(instance.parent_instance_id)?.push(instance.id))
  const diagramNodes = new Map(diagram.nodes.filter(node => node.instance_id).map(node => [node.instance_id, node]))
  // Reserve the full descendant footprint within each L2 system, even while its
  // blocks are initially collapsed. Fixed-height sibling slots overlapped as soon
  // as a focused FMEA exposed an L3 assembly's L4 interface endpoints.
  for (const system of model.instances.filter(instance => instance.parent_instance_id === model.root_instance_id)) {
    const ids = [], pending = [system.id]
    for (let index = 0; index < pending.length; index++) {
      const id = pending[index], node = diagramNodes.get(id)
      if (!node || definitionById.get(instanceById.get(id).definition_id).kind === 'piece_part') continue
      ids.push(id)
      pending.push(...childrenById.get(id))
    }
    const included = new Set(ids), sizes = new Map(), offsets = new Map()
    const gap = layoutProfiles[diagram.layoutOptions.mode].nodeGap
    // Use normal canvas spacing, sizing children before their parents. A compact
    // grid reserves the expanded footprint without producing a very tall column.
    for (const id of [...ids].reverse()) {
      const node = diagramNodes.get(id), children = childrenById.get(id).filter(child => included.has(child))
      if (!children.length) { sizes.set(id, { width: node.width, height: node.height }); continue }
      let best
      for (let columns = 1; columns <= Math.min(4, children.length); columns++) {
        const widths = Array(columns).fill(0), heights = Array(Math.ceil(children.length / columns)).fill(0)
        children.forEach((child, index) => {
          const size = sizes.get(child)
          widths[index % columns] = Math.max(widths[index % columns], size.width)
          heights[Math.floor(index / columns)] = Math.max(heights[Math.floor(index / columns)], size.height)
        })
        const width = Math.max(node.width, 48 + widths.reduce((a, b) => a + b, 0) + gap * (columns - 1))
        const height = Math.max(node.height, 76 + heights.reduce((a, b) => a + b, 0) + gap * (heights.length - 1))
        const cost = width * height + 0.3 * (width - 1.6 * height) ** 2
        if (!best || cost < best.cost) best = { columns, widths, heights, width, height, cost }
      }
      children.forEach((child, index) => offsets.set(child, {
        x: 24 + best.widths.slice(0, index % best.columns).reduce((a, b) => a + b + gap, 0),
        y: 52 + best.heights.slice(0, Math.floor(index / best.columns)).reduce((a, b) => a + b + gap, 0),
      }))
      sizes.set(id, { width: best.width, height: best.height })
    }
    for (const id of ids.filter(id => id !== system.id)) {
      const node = diagramNodes.get(id), parent = diagramNodes.get(instanceById.get(id).parent_instance_id)
      node.x = parent.x + offsets.get(id).x
      node.y = parent.y + offsets.get(id).y
    }
  }
  // The controller study opens both the hydraulic and crew-interface branches.
  // Give their initial expanded footprints separate lanes while keeping the L2
  // overview compact. Assign targets, rather than accumulating offsets on refresh.
  const avionics = diagramNodes.get('avionics')
  if (avionics) {
    const dx = 1310 - avionics.x, pending = ['avionics']
    for (let index = 0; index < pending.length; index++) {
      const id = pending[index], node = diagramNodes.get(id)
      if (node) node.x += dx
      pending.push(...childrenById.get(id))
    }
  }
  for (const node of diagram.nodes) if (node.external_id && node.x > 0) node.x = 1700
  const rootNode = diagramNodes.get(model.root_instance_id)
  const descendants = diagram.nodes.filter(node => node.instance_id && node.instance_id !== model.root_instance_id)
  rootNode.width = Math.max(rootNode.width, ...descendants.map(node => node.x + node.width + 40 - rootNode.x))
  rootNode.height = Math.max(rootNode.height, ...descendants.map(node => node.y + node.height + 40 - rootNode.y))
  diagram.boundary.width = Math.max(diagram.boundary.width, ...diagram.nodes.map(node => node.x + node.width + 40 - diagram.boundary.x))
  diagram.boundary.height = Math.max(diagram.boundary.height, ...diagram.nodes.map(node => node.y + node.height + 40 - diagram.boundary.y))
  diagram.viewport = { x: 190, y: 80, zoom: 0.5 }
  Object.assign(project.modules.systemDefinition, {
    selectedInstanceId: model.root_instance_id,
    selectedModeId: model.modes.some(mode => mode.id === 'run') ? 'run' : model.modes[0]?.id,
    structureCollapsedIds: model.instances.filter(instance => instance.parent_instance_id === model.root_instance_id).map(instance => instance.id),
    view: 'structure',
    projectionPreview: null,
    propagation: null,
    decisions: [],
  })
  const systemRef = instanceId => {
    const instance = instanceById.get(instanceId)
    if (!instance) throw new Error(`Aircraft example is missing ${instanceId}`)
    return { system_model_id: model.id, instance_id: instance.id, definition_id: instance.definition_id }
  }
  const remapReferences = value => {
    if (Array.isArray(value)) return value.map(remapReferences)
    if (!value || typeof value !== 'object') return value
    const next = Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      ['system_model_id', 'systemModelId'].includes(key) && child === oldModelId ? model.id : remapReferences(child)]))
    if (next.module === 'system_definition' && next.analysis_id === oldModelId) {
      next.analysis_id = model.id
      next.analysis_name = model.name
    }
    return next
  }
  const studyNames = {
    'DFMEA-DEMO': 'Aircraft Hydraulic Controller DFMEA',
    'PFMEA-DEMO': 'Aircraft Hydraulic Controller Assembly PFMEA',
    'FMEA-MSR-DEMO': 'Aircraft Hydraulic Controller Monitoring Supplement',
  }
  // Authored aircraft design targets preserve the example's correlation identities.
  // Their values are teaching assumptions, with no fabricated verification evidence.
  const hydraulicRequirements = [
    { id: 'DFREQ-1', statement: 'The hydraulic controller power connector shall deliver protected 28 V DC power without an interruption longer than 20 ms.',
      requirement_type: 'performance', measure: 'Maximum power interruption', target: '20', unit: 'ms',
      acceptance_criteria: 'No interruption longer than 20 ms and contact resistance below 20 mΩ during the defined qualification exposure.',
      verification_method: 'Continuity monitoring during vibration and thermal testing', instance_id: 'power-connector', function_ids: ['DFN-1'],
      parent: 'DFREQ-3', study: 'DFMEA-DEMO', owner: 'Electrical lead' },
    { id: 'DFREQ-2', statement: 'The hydraulic pressure sensor shall report delivery manifold pressure within ±2% of full scale.',
      requirement_type: 'interface', measure: 'Pressure measurement error', target: '±2', unit: '% full scale',
      acceptance_criteria: 'Absolute error does not exceed 2% of full scale over the defined calibration and temperature points.',
      verification_method: 'Multi-point calibration over temperature', instance_id: 'pressure-sensor', function_ids: ['DFN-2'],
      parent: 'DFREQ-3', study: 'DFMEA-DEMO', owner: 'Controls lead' },
    { id: 'DFREQ-3', statement: 'The hydraulic controller shall maintain commanded hydraulic pressure during its 1,000-hour ground qualification exposure.',
      requirement_type: 'performance', measure: 'Controller mission reliability', target: 'R(1000 h) ≥ 0.99', unit: '',
      acceptance_criteria: 'No loss of commanded hydraulic pressure for more than 2 seconds; demonstrate R(1000 h) ≥ 0.99 at 90% confidence.',
      verification_method: 'Reliability demonstration with an agreed exposure and failure definition', instance_id: 'b1', function_ids: ['DFN-3'],
      parent: 'REQ-AIRCRAFT-CONTROL', study: 'DFMEA-DEMO', owner: 'Reliability lead' },
    { id: 'MFREQ-1', statement: 'The hydraulic controller shall issue a safe-state command and maintenance indication within 100 ms of a detectable power-path fault.',
      requirement_type: 'safety', measure: 'Detection and response time', target: '≤ 100', unit: 'ms',
      acceptance_criteria: 'The safe-state command and maintenance indication occur within the illustrative 100 ms fault-tolerant interval.',
      verification_method: 'Boundary fault injection with timestamped response capture', instance_id: 'b1', function_ids: ['MFN-1', 'MFN-2'],
      parent: 'DFREQ-3', study: 'FMEA-MSR-DEMO', owner: 'Systems lead' },
  ].map(({ instance_id, function_ids, parent, study, ...fields }) => ({ ...createSystemRequirement(fields.id), ...fields,
    source: 'Illustrative aircraft hydraulic controller design target', lifecycle: 'draft',
    mission_profile: 'Controller ground qualification exposure', operating_condition: 'Defined controller qualification environment',
    derived_from_ids: [parent], allocations: function_ids.map(function_id => ({ ...systemRef(instance_id), function_id })),
    supporting_analyses: [{ module_key: 'fmea', analysis_id: study }],
  }))
  const hydraulicIds = new Set(hydraulicRequirements.map(item => item.id))
  model.requirements = [...(model.requirements ?? []).filter(item => !hydraulicIds.has(item.id)), ...hydraulicRequirements]
  model.verification_cases = [...(model.verification_cases ?? []).filter(item => item.id !== 'DVP-DEMO-1'), {
    ...createVerificationCase('DVP-DEMO-1', 'DFREQ-1'), objective: 'Verify hydraulic controller power continuity through its qualification exposure.',
    failure_chain_ids: ['DFC-1'], method: 'Instrumented vibration and thermal test', level: 'Controller', sample_size: '3 controllers',
    acceptance_criteria: hydraulicRequirements[0].acceptance_criteria, owner: 'Test lead',
  }]
  const folio = project.modules.fmea.folios[0]
  folio.name = 'Aircraft Hydraulic Controller FMEA Portfolio'
  folio.state.analyses = folio.state.analyses.map(source => {
    let study = remapReferences(source)
    study.name = studyNames[study.id] ?? study.name
    study.planning = { ...study.planning,
      model_program: 'Illustrative Aircraft — Hydraulic Power System',
      customer: 'Perdura demonstration aircraft program',
      assumptions: 'Illustrative training analysis of the aircraft hydraulic controller. Existing example ratings, test identifiers, and numerical assumptions are demonstration inputs, not substantiated aircraft safety or reliability evidence.',
    }
    if (study.kind === 'pfmea') {
      study.planning.subject = 'Hydraulic controller connector assembly process'
      return study
    }
    study.planning.subject = 'Aircraft hydraulic controller and immediate electrical, pressure, and status interfaces'
    study.planning.scope = 'L3 Hydraulic Controller Assembly and its L4 power connector, pressure sensor, and voltage monitor; shared aircraft electrical supply, hydraulic pump commands, and crew status interfaces.'
    study.planning.exclusions = 'Complete aircraft safety assessment, flight certification, and unmodeled failure combinations.'
    study.planning.intent = 'Identify illustrative causes and effects of loss or degradation of commanded aircraft hydraulic pressure.'
    // New canonical edges resolve installed aircraft equipment. Rebuild only the
    // generated display context; retain original chain, requirement and action IDs.
    study.function_links = study.function_links.filter(link => !link.id.startsWith('SD-FLINK-'))
    const liveExternalBlocks = new Set(study.interfaces.flatMap(edge => {
      const canonical = model.interfaces.find(item => item.id === edge.system_definition_ref?.interface_id)
      return [canonical?.source.external_id ? edge.source_block_id : undefined,
        canonical?.target.external_id ? edge.target_block_id : undefined].filter(Boolean)
    }))
    study.block_diagram.nodes = study.block_diagram.nodes.filter(node => node.kind !== 'external' || liveExternalBlocks.has(node.id))
    study = materializeFmeaAnalysis(model, study)
    return study
  })

  const hydraulicRbd = project.modules.system.folios.find(item => item.id === 'f0')
  hydraulicRbd.name = 'Aircraft Hydraulics — Redundant Pump Supply'
  for (const [nodeId, instanceId] of [['c3', 'pump-a'], ['c4', 'pump-b'], ['c5', 'b1']]) {
    const node = hydraulicRbd.state.nodes.find(item => item.id === nodeId)
    const instance = instanceById.get(instanceId)
    node.data = { ...node.data, label: instance.name || definitionById.get(instance.definition_id).name,
      description: 'Illustrative hydraulic-subsystem mission model. This independent exponential input is a teaching assumption, not an aircraft component prediction.',
      systemRef: systemRef(instanceId) }
  }
  const backup = project.modules.system.folios.find(item => item.id === 'f1')
  backup.name = 'Aircraft Essential Power — Backup Supply'
  const backupNode = backup.state.nodes.find(item => item.id === 'c1')
  backupNode.data.description = 'Illustrative backup power RBD; the 0.98 mission reliability is a teaching input, not a substantiated aircraft reliability result.'
  // Recalculate the newly linked hydraulic definition. The independent backup
  // example retains its real calculated 0.98 result; its numerical model is unchanged.
  delete hydraulicRbd.state.result
  delete hydraulicRbd.state.resultProvenance

  const fta = project.modules.faultTree.folios.find(item => item.id === 'f0')
  fta.name = 'Aircraft Hydraulics — Loss of Pressure'
  fta.state.nodes.find(item => item.id === 'g1').data = {
    ...fta.state.nodes.find(item => item.id === 'g1').data,
    label: 'Loss of Hydraulic Pressure',
    description: 'Illustrative loss of required hydraulic supply through both pump paths, controller failure, or electrical power loss. Basic-event probabilities are separate teaching inputs, not calibrated aircraft failure probabilities.' }
  fta.state.result = null
  delete fta.state.resultProvenance
  const catalog = { schemaVersion: 1, byTreeId: {} }
  project.modules.faultTree.folios.forEach((item, index) => {
    catalog.byTreeId[item.id] = { code: `FTA-${String(index + 1).padStart(3, '0')}`,
      description: item.id === 'f0' ? 'Hydraulic Power System example. The event probabilities are illustrative and are not derived from the separate RBD or prediction examples.' : 'Independent fault-tree logic teaching example; not an aircraft safety allocation.',
      tags: item.id === 'f0' ? ['aircraft', 'hydraulics', 'illustrative'] : ['teaching example'],
      ...(item.id === 'f0' ? { systemLinks: [{ systemModelId: model.id, instanceId: 'pump-system' }] } : {}) }
  })
  project.modules.faultTreeCatalog = catalog

  const prediction = project.modules.prediction.folios.find(item => item.id === 'f0')
  prediction.name = 'Aircraft Hydraulic Controller — Ground Qualification Example'
  prediction.state.contributionScope = 'blocks'
  prediction.state.contributionBlockIds = ['b1']
  prediction.state.sourceSystemFingerprint = systemInputFingerprint(model)
  prediction.state.blockInputs.b1.notes = 'Illustrative controller-board ground qualification case only, using the original 75% operating / 25% nonoperating exposure and GF / GB environments. This is not an airborne environment or a whole-aircraft reliability prediction. Operating rates use MIL-HDBK-217F; nonoperating rates use the selected RADC-TR-85-91 models.'
  delete prediction.state.result
  delete prediction.state.deratingResult
  for (const key of ['pump-a', 'pump-b']) delete prediction.state.blockInputs[key]

  const program = project.modules.reliabilityProgram.folios[0]
  program.name = 'Aircraft Hydraulics Assurance — Training Example'
  for (const item of project.modules.fmea.folios)
    item.state = stripSharedRequirementProjections(item.state, model, 'analyses', 'fmea')
  for (const item of project.modules.reliabilityProgram.folios)
    item.state = stripSharedRequirementProjections(item.state, model, 'aiagAnalyses', 'reliabilityProgram')
  project.modules.library.items.forEach(item => {
    if (!item.source.startsWith('Illustrative training assumption — ')) item.source = `Illustrative training assumption — ${item.source}`
  })

  const depth = instance => instance.parent_instance_id ? 1 + depth(instanceById.get(instance.parent_instance_id)) : 1
  const blockInstances = model.instances.filter(instance => definitionById.get(instance.definition_id).kind !== 'piece_part')
  const l2 = blockInstances.filter(instance => depth(instance) === 2)
  const treeRows = l2.map(instance => [instance.name,
    blockInstances.filter(child => child.parent_instance_id === instance.id).map(child => child.name).join('; '),
    String(blockInstances.filter(child => depth(child) === 4 && instanceById.get(child.parent_instance_id)?.parent_instance_id === instance.id).length),
  ])
  const report = project.modules.reportBuilder.reports[0]
  report.title = 'Aircraft System — Demonstration Summary'
  report.blocks = [
    { id: 'demo-heading', type: 'heading', text: 'Illustrative Aircraft System', level: 1 },
    { id: 'demo-text', type: 'text', content: 'A fictional aircraft architecture organized from the L1 aircraft through L2 systems, L3 subsystems and L4 components. The canonical System Model supplies the shared hierarchy, resource functions and interfaces for FMEA, prediction, and linked hydraulic analysis examples. Aircraft architecture, numerical engineering inputs, ratings, test identifiers and evidence references are illustrative training material; the NIST statistical datasets retain their documented source attribution.' },
    { id: 'aircraft-hierarchy', type: 'table', label: 'Aircraft architecture coverage', headers: ['L2 system', 'L3 subsystems', 'L4 components'], rows: treeRows },
    { id: 'aircraft-reference-note', type: 'text', content: 'Architecture background: FAA Pilot’s Handbook of Aeronautical Knowledge, Chapter 7 — Aircraft Systems (https://www.faa.gov/regulationspolicies/handbooksmanuals/aviation/phak/chapter-7-aircraft-systems); NASA X-57 technical papers (https://www.nasa.gov/directorates/armd/x-57-technical-papers/). These sources inform the fictional example’s organization and system interfaces; they do not substantiate its illustrative reliability inputs.' },
    ...report.blocks.filter(block => !['demo-heading', 'demo-text', 'demo-metrics', 'aircraft-hierarchy', 'aircraft-reference-note'].includes(block.id)),
    { id: 'demo-metrics', type: 'metrics', label: 'Project coverage', items: [
      { label: 'Installed system blocks', value: String(blockInstances.length) },
      { label: 'L2 systems', value: String(l2.length) },
      { label: 'L4 components', value: String(blockInstances.filter(instance => depth(instance) === 4).length) },
      { label: 'Canonical interfaces', value: String(model.interfaces.length) },
      { label: 'NIST source cases', value: '7' },
      { label: 'Analysis status', value: 'Illustrative inputs ready to run' },
    ] },
  ]
  report.header.center = 'Aircraft demonstration'
  return project
}
