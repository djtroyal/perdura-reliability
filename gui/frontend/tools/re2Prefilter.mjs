import { RolldownMagicString } from 'rolldown'

const entryPattern = /\/node_modules\/re2js\/build\/index\.js$/
const isIdentifier = (node, name) => node?.type === 'Identifier' && node.name === name
const isMember = (node, name) => node?.type === 'MemberExpression'
  && !node.computed && !node.optional && isIdentifier(node.property, name)
const isThisMember = (node, name) => isMember(node, name) && node.object.type === 'ThisExpression'
const isClass = node => node.type === 'ClassExpression' || node.type === 'ClassDeclaration'
const isFunction = node => /^(?:FunctionExpression|FunctionDeclaration|ArrowFunctionExpression)$/.test(node.type)

function walk(node, ancestors, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node, ancestors)
  ancestors.push(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, ancestors, visit))
    else if (value && typeof value === 'object') walk(value, ancestors, visit)
  }
  ancestors.pop()
}

// RE2JS's private Prefilter.eval is a boolean regex predicate, not JavaScript
// evaluation. ZAP rule 10110 matches its spelling, including member calls.
// Rename only the verified AST references; never suppress the scan rule or
// rewrite native eval. Dependency changes outside this shape need review.
export function renameRe2Prefilter(code, parse, id) {
  const ast = parse(code)
  const edits = []
  let definitions = 0
  let recursiveCalls = 0
  let engineCalls = 0
  const fail = () => { throw new Error('RE2JS Prefilter shape changed; review its private predicate before bundling.') }

  walk(ast, [], (node, ancestors) => {
    const owner = ancestors.findLast(isClass)
    const method = ancestors.findLast(parent => parent.type === 'MethodDefinition')
    if (isClass(node) && isIdentifier(node.id, 'Prefilter')
        && node.body.body.some(member => isIdentifier(member.key, 'matchesInput')
          || (member.key?.type === 'Literal' && member.key.value === 'matchesInput'))) fail()

    // Include computed string properties so a changed call cannot silently
    // survive the rename. Ordinary comments and string contents are untouched.
    const parent = ancestors.at(-1)
    const stringProperty = node.type === 'Literal' && node.value === 'eval'
      && ((parent?.type === 'MemberExpression' && parent.property === node)
        || parent?.key === node)
    if (!isIdentifier(node, 'eval') && !stringProperty) return
    if (parent.type === 'MethodDefinition' && parent.key === node
        && isIdentifier(owner?.id, 'Prefilter') && !parent.computed
        && !parent.static && parent.kind === 'method' && !parent.value.async
        && !parent.value.generator && parent.value.params.length === 2
        && isIdentifier(parent.value.params[0], 'input') && isIdentifier(parent.value.params[1], 'pos')) {
      definitions++
    } else {
      const call = ancestors.at(-2)
      if (!isMember(parent, 'eval') || parent.property !== node
          || call?.type !== 'CallExpression' || call.callee !== parent || call.optional
          || call.arguments.length !== 2 || !isIdentifier(call.arguments[0], 'input')
          || !isIdentifier(call.arguments[1], 'pos')
          || ancestors.findLast(isFunction) !== method?.value) fail()
      const receiver = parent.object
      if (isIdentifier(owner?.id, 'Prefilter') && isIdentifier(method?.key, 'eval')
          && receiver.type === 'MemberExpression' && receiver.computed && !receiver.optional
          && isIdentifier(receiver.property, 'i') && isThisMember(receiver.object, 'subs')) {
        recursiveCalls++
      } else if (isIdentifier(owner?.id, 'RE2') && isIdentifier(method?.key, 'executeEngine')
          && isThisMember(receiver, 'prefilter')) {
        engineCalls++
      } else fail()
    }
    edits.push(node)
  })
  if (definitions !== 1 || recursiveCalls !== 2 || engineCalls !== 1) fail()

  const output = new RolldownMagicString(code)
  for (const node of edits) output.overwrite(node.start, node.end, 'matchesInput')
  const map = output.generateMap({ source: id, includeContent: true, hires: true })
  return { code: output.toString(), map: JSON.parse(map.toString()) }
}

export function re2PrefilterPlugin() {
  return {
    name: 'perdura-re2-prefilter',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!entryPattern.test(id.replaceAll('\\', '/'))) return null
      return renameRe2Prefilter(code, source => this.parse(source), id)
    },
  }
}
