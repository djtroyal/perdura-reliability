import type { AIAGVDAFMEAAnalysis } from '../api/reliabilityProgram'
import { processArchitectureModel, validateArchitectureIntegrity } from './systemArchitecture'

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const fail = (path: string, reason: string): never => { throw new Error(`Invalid current-format FMEA at ${path}: ${reason}`) }
const record = (value: unknown, path: string) => { if (!object(value)) fail(path, 'expected an object.'); return value as Record<string, unknown> }
const list = (value: unknown, path: string) => { if (!Array.isArray(value)) fail(path, 'expected an array.'); return value as unknown[] }
const string = (value: unknown, path: string, nonempty = false) => {
  if (typeof value !== 'string' || nonempty && !value.trim()) fail(path, `expected ${nonempty ? 'a nonempty' : 'a'} string.`)
  return value as string
}
const strings = (value: unknown, path: string) => list(value, path).map((item, index) => string(item, `${path}[${index}]`))
const choices = (value: unknown, allowed: string[], path: string) => {
  if (typeof value !== 'string' || !allowed.includes(value)) fail(path, `choose ${allowed.join(', ')}.`)
  return value as string
}
const rows = (value: unknown, path: string) => {
  const found = new Set<string>()
  return list(value, path).map((item, index) => {
    const row = record(item, `${path}[${index}]`), id = string(row.id, `${path}[${index}].id`, true)
    if (found.has(id)) fail(path, `duplicate identity ${id}.`)
    found.add(id); return row
  })
}
const optionalStrings = (row: Record<string, unknown>, keys: string[], path: string) => {
  for (const key of keys) if (row[key] != null) string(row[key], `${path}.${key}`)
}
const knownFields = (row: Record<string, unknown>, allowed: string[], path: string) => {
  const extra = Object.keys(row).find(key => !allowed.includes(key))
  if (extra) fail(`${path}.${extra}`, 'unknown field in the current contract.')
}
const optionalBoolean = (row: Record<string, unknown>, key: string, path: string) => {
  if (row[key] != null && typeof row[key] !== 'boolean') fail(`${path}.${key}`, 'expected a boolean.')
}

const reference = (value: unknown, path: string) => {
  if (value == null) return
  const ref = record(value, path)
  string(ref.system_model_id, `${path}.system_model_id`, true)
  optionalStrings(ref, ['instance_id', 'definition_id', 'function_id', 'failure_mode_id', 'interface_id', 'revision', 'checksum'], path)
}

/** Validate the current wire shape without manufacturing values or migrating prose.
 * Semantic incompleteness is saved as a draft; malformed data cannot enter stores. */
export function assertFmeaDraftIntegrity(value: unknown): asserts value is AIAGVDAFMEAAnalysis {
  const analysis = record(value, 'analysis')
  string(analysis.id, 'id', true); string(analysis.name, 'name'); string(analysis.revision, 'revision')
  const kind = choices(analysis.kind, ['dfmea', 'pfmea', 'fmea_msr'], 'kind')
  choices(analysis.status, ['draft', 'in_review', 'finalized'], 'status')
  const planning = record(analysis.planning, 'planning')
  for (const key of ['subject', 'scope', 'intent']) string(planning[key], `planning.${key}`)
  strings(planning.team, 'planning.team')
  if (analysis.system_binding != null) {
    const binding = record(analysis.system_binding, 'system_binding')
    if (binding.version !== 1) fail('system_binding.version', 'expected contract 1.')
    string(binding.system_model_id, 'system_binding.system_model_id', true); string(binding.scope_instance_id, 'system_binding.scope_instance_id', true)
    optionalStrings(binding, ['mode_id'], 'system_binding')
    if (binding.included_piece_part_ids != null) strings(binding.included_piece_part_ids, 'system_binding.included_piece_part_ids')
    if (kind === 'pfmea') fail('system_binding', 'process hierarchy must remain independent of physical equipment.')
  }
  const resources = rows(analysis.resources, 'resources'), resourceIds = new Set(resources.map(item => item.id))
  for (const resource of resources) {
    string(resource.name, 'resource.name'); choices(resource.category, ['physical','energy','information','material','human_machine','clearance','state'], 'resource.category')
    optionalStrings(resource, ['quantity', 'unit'], 'resource')
  }
  const structures = rows(analysis.structure_nodes, 'structure_nodes'), structureIds = new Set(structures.map(item => item.id))
  const functions = rows(analysis.functions, 'functions'), functionIds = new Set(functions.map(item => item.id))
  const interfaces = rows(analysis.interfaces, 'interfaces')
  const requiredReference = (id: unknown, ids: Set<unknown>, path: string, retained = false) => {
    if (id == null || id === '') return
    string(id, path)
    if (!ids.has(id) && !retained) fail(path, 'reference does not exist in this study.')
  }
  for (const node of structures) {
    string(node.name, 'structure.name'); string(node.level, 'structure.level')
    optionalStrings(node, ['description', 'interface', 'element_type'], 'structure')
    requiredReference(node.parent_id, structureIds, 'structure.parent_id', Boolean(node.system_definition_ref))
    reference(node.system_definition_ref, 'structure.system_definition_ref')
  }
  const byNode = new Map(structures.map(node => [node.id, node]))
  for (const node of structures) {
    const seen = new Set<unknown>(); let cursor: unknown = node.id
    while (cursor && byNode.has(cursor)) {
      if (seen.has(cursor)) fail('structure_nodes.parent_id', 'hierarchy contains a cycle.')
      seen.add(cursor); cursor = byNode.get(cursor)?.parent_id
    }
  }
  const ioIds = new Map<string, Set<string>>()
  for (const fn of functions) {
    if (['requirement', 'specification', 'interface_origin'].some(key => key in fn)) fail('functions', 'older freeform function records are not accepted.')
    string(fn.structure_node_id, 'function.structure_node_id'); string(fn.description, 'function.description')
    choices(fn.function_type, ['primary','supporting','interface','monitoring','system_response'], 'function.function_type')
    strings(fn.operating_modes, 'function.operating_modes'); optionalStrings(fn, ['owner', 'notes', 'canonical_verb_id'], 'function')
    reference(fn.system_definition_ref, 'function.system_definition_ref')
    requiredReference(fn.structure_node_id, structureIds, 'function.structure_node_id', Boolean(fn.system_definition_ref))
    if (fn.definition != null) {
      const definition = record(fn.definition, 'function.definition')
      knownFields(definition, ['role', 'action', 'state_verb', 'io'], 'function.definition')
      choices(definition.role, ['transform','source','maintain_state'], 'function.definition.role')
      if ('verb_id' in definition) fail('function.definition', 'older controlled verb records are not accepted.')
      string(definition.action, 'function.definition.action')
      if (definition.state_verb != null) choices(definition.state_verb, ['maintain','secure','support','contain','isolate','protect'], 'function.definition.state_verb')
      const io = rows(definition.io, 'function.definition.io')
      ioIds.set(String(fn.id), new Set(io.map(item => String(item.id))))
      for (const item of io) {
        knownFields(item, ['id', 'resource_id', 'direction', 'port_id'], 'function.definition.io')
        string(item.resource_id, 'function.definition.io.resource_id')
        requiredReference(item.resource_id, resourceIds, 'function.definition.io.resource_id')
        choices(item.direction, ['input','output'], 'function.definition.io.direction')
        optionalStrings(item, ['port_id'], 'function.definition.io')
      }
    }
  }
  const diagram = record(analysis.block_diagram, 'block_diagram')
  if (diagram.version !== 2) fail('block_diagram.version', 'expected diagram contract 2.')
  const diagramNodes = rows(diagram.nodes, 'block_diagram.nodes'), blockIds = new Set(diagramNodes.map(item => item.id))
  const externals = new Set(diagramNodes.filter(item => item.kind === 'external').map(item => item.id))
  for (const node of diagramNodes) {
    choices(node.kind, ['structure','external'], 'block_diagram.node.kind')
    for (const key of ['x','y','width','height']) if (typeof node[key] !== 'number' || !Number.isFinite(node[key])) fail(`block_diagram.node.${key}`, 'expected a finite number.')
    optionalStrings(node, ['label', 'structure_node_id', 'container_parent_block_id'], 'block_diagram.node')
    if (node.ports !== undefined) for (const port of rows(node.ports, 'block_diagram.node.ports')) {
      knownFields(port, ['id', 'name', 'interface_type', 'direction', 'description', 'properties', 'resource_id'], 'external.port')
      string(port.name, 'external.port.name', true)
      choices(port.interface_type, ['physical','energy','information','material','human_machine','clearance'], 'external.port.interface_type')
      choices(port.direction, ['input','output','bidirectional'], 'external.port.direction')
      optionalStrings(port, ['description', 'resource_id'], 'external.port')
      requiredReference(port.resource_id, resourceIds, 'external.port.resource_id')
      if (port.properties !== undefined) for (const [key, value] of Object.entries(record(port.properties, 'external.port.properties'))) {
        const parameter = record(value, `external.port.properties.${key}`)
        const type = choices(parameter.kind, ['number','text','boolean','choice'], 'external.port.property.kind')
        knownFields(parameter, type === 'number' ? ['kind','value','unit'] : type === 'choice' ? ['kind','value','option_ids'] : ['kind','value'], 'external.port.property')
        if (type === 'number') {
          if (typeof parameter.value !== 'number' || !Number.isFinite(parameter.value)) fail('external.port.property.value', 'expected a finite number.')
          string(parameter.unit, 'external.port.property.unit')
        } else if (type === 'boolean') {
          if (typeof parameter.value !== 'boolean') fail('external.port.property.value', 'expected a boolean.')
        } else {
          string(parameter.value, 'external.port.property.value')
          if (type === 'choice') strings(parameter.option_ids, 'external.port.property.option_ids')
        }
      }
    }
    if (kind === 'pfmea') {
      requiredReference(node.structure_node_id, structureIds, 'block_diagram.node.structure_node_id')
      requiredReference(node.container_parent_block_id, blockIds, 'block_diagram.node.container_parent_block_id')
    }
  }
  for (const edge of interfaces) {
    string(edge.name, 'interface.name'); choices(edge.interface_type, ['physical','energy','information','material','human_machine','clearance'], 'interface.interface_type')
    choices(edge.directionality, ['directed','bidirectional','undirected'], 'interface.directionality')
    choices(edge.linkage, ['direct','indirect'], 'interface.linkage')
    strings(edge.function_ids, 'interface.function_ids'); strings(edge.requirement_ids, 'interface.requirement_ids')
    reference(edge.system_definition_ref, 'interface.system_definition_ref')
    optionalBoolean(edge, 'generated', 'interface')
    if (edge.mode_ids !== undefined) strings(edge.mode_ids, 'interface.mode_ids')
    const retained = kind !== 'pfmea' && Boolean(edge.system_definition_ref)
    for (const side of ['source', 'target']) {
      requiredReference(edge[`${side}_structure_node_id`], structureIds, `interface.${side}_structure_node_id`, retained)
      requiredReference(edge[`${side}_block_id`], blockIds, `interface.${side}_block_id`, retained)
    }
    if (edge.transfers !== undefined) for (const transfer of rows(edge.transfers, 'interface.transfers')) {
      choices(transfer.kind, ['flow','relation'], 'transfer.kind'); strings(transfer.mode_ids, 'transfer.mode_ids')
      knownFields(transfer, transfer.kind === 'flow' ? ['id','kind','resource_id','source','target','mode_ids'] : ['id','kind','source','target','mode_ids'], 'transfer')
      if (transfer.kind === 'flow') {
        string(transfer.resource_id, 'transfer.resource_id', true); requiredReference(transfer.resource_id, resourceIds, 'transfer.resource_id')
      } else if ('resource_id' in transfer) fail('transfer.resource_id', 'a structural relation does not carry a resource.')
      for (const side of ['source','target']) {
        const endpoint = record(transfer[side], `transfer.${side}`)
        choices(endpoint.kind, transfer.kind === 'flow' ? ['function','external'] : ['block','external'], `transfer.${side}.kind`)
        knownFields(endpoint, endpoint.kind === 'function' ? ['kind','instance_id','function_id','io_id']
          : endpoint.kind === 'block' ? ['kind','instance_id','function_id'] : ['kind','external_id','port_id'], `transfer.${side}`)
        if (endpoint.kind === 'function') {
          string(endpoint.instance_id, 'transfer.instance_id', true); string(endpoint.function_id, 'transfer.function_id', true); string(endpoint.io_id, 'transfer.io_id', true)
          if (kind === 'pfmea') {
            requiredReference(endpoint.instance_id, structureIds, 'transfer.instance_id')
            requiredReference(endpoint.function_id, functionIds, 'transfer.function_id')
            if (!ioIds.get(String(endpoint.function_id))?.has(String(endpoint.io_id))) fail('transfer.io_id', 'function I/O does not exist.')
            if (functions.find(fn => fn.id === endpoint.function_id)?.structure_node_id !== endpoint.instance_id) fail('transfer.instance_id', 'function belongs to a different process step.')
          }
        } else if (endpoint.kind === 'block') {
          string(endpoint.instance_id, 'transfer.instance_id', true)
          optionalStrings(endpoint, ['function_id'], 'transfer')
          if (kind === 'pfmea') {
            requiredReference(endpoint.instance_id, structureIds, 'transfer.instance_id')
            requiredReference(endpoint.function_id, functionIds, 'transfer.function_id')
            if (endpoint.function_id && functions.find(fn => fn.id === endpoint.function_id)?.structure_node_id !== endpoint.instance_id) fail('transfer.instance_id', 'function belongs to a different process step.')
          }
        } else {
          string(endpoint.external_id, 'transfer.external_id', true)
          if (transfer.kind === 'flow') string(endpoint.port_id, 'transfer.port_id', true)
          else optionalStrings(endpoint, ['port_id'], 'transfer')
          if (kind === 'pfmea') requiredReference(endpoint.external_id, externals, 'transfer.external_id')
        }
      }
    }
  }
  for (const link of rows(analysis.function_links, 'function_links')) {
    requiredReference(link.source_function_id, functionIds, 'function_link.source_function_id', kind !== 'pfmea')
    requiredReference(link.target_function_id, functionIds, 'function_link.target_function_id', kind !== 'pfmea')
    choices(link.relationship, ['decomposes_to','depends_on','provides_input','enables','monitors','responds_to'], 'function_link.relationship')
    if (link.mode_ids != null) strings(link.mode_ids, 'function_link.mode_ids')
    optionalBoolean(link, 'generated', 'function_link')
  }
  for (const field of ['functional_requirements','function_requirement_links','p_diagrams','control_plan']) rows(analysis[field], field)
  for (const chain of rows(analysis.failure_chains, 'failure_chains')) {
    requiredReference(chain.function_id, functionIds, 'failure_chain.function_id', kind !== 'pfmea')
    for (const field of ['effect','failure_mode','cause']) string(chain[field], `failure_chain.${field}`)
    if (chain.effect_contexts !== undefined) rows(chain.effect_contexts, 'failure_chain.effect_contexts')
    for (const action of rows(chain.actions, 'failure_chain.actions')) if (action.evidence_ids !== undefined) strings(action.evidence_ids, 'action.evidence_ids')
    reference(chain.system_definition_ref, 'failure_chain.system_definition_ref')
  }
  if (kind === 'pfmea') {
    const issues = validateArchitectureIntegrity(processArchitectureModel(value as AIAGVDAFMEAAnalysis))
    if (issues.length) fail(issues[0].field ?? 'architecture', issues[0].message)
  }

}
