import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parseAst } from 'rolldown/parseAst'
import { build } from 'vite'
import { renameRe2Prefilter, re2PrefilterPlugin } from '../tools/re2Prefilter.mjs'

const entry = fileURLToPath(import.meta.resolve('re2js'))
const original = readFileSync(entry, 'utf8')
const renamed = renameRe2Prefilter(original, parseAst, entry)
const loadSource = code => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const before = await loadSource(original)
const after = await loadSource(renamed.code)
const zapEvalPattern = /\beval\s{0,5}\(/gi

test('renames only the four private predicate tokens and preserves exports and source mapping', () => {
  assert.equal(original.match(zapEvalPattern)?.length, 4)
  assert.equal(renamed.code.match(zapEvalPattern), null)
  assert.equal(renamed.code.replaceAll('matchesInput', 'eval'), original)
  assert.deepEqual(Object.keys(after), Object.keys(before))
  assert.ok(!Object.hasOwn(after, 'Prefilter'))
  assert.deepEqual(renamed.map.sourcesContent, [original])
  assert.ok(renamed.map.mappings.length > 0)
})

test('preserves matching, captures, positions, replacements, and invalid-pattern handling', () => {
  const cases = [
    ['(alpha|beta).*omega', 'none alpha mid omega beta omega'],
    ['(alpha.*zeta|beta.*omega)', 'none beta mid omega alpha zeta'],
    ['alpha|beta|gamma', 'gamma alpha beta none'],
    ['(left|right) (motor|pump)', 'left motor; right pump; right fan'],
    ['(café|東京).*([0-9]+)', '東京 output 42 café 17'],
    ['(left|right).*motor', 'neither matches'],
    ['^([a-z]+)-(\\d+)$', 'pump-42'],
    ['a*', 'baac'],
  ]
  function snapshot(module, pattern, input) {
    const compiled = module.RE2JS.compile(pattern)
    const matcher = compiled.matcher(input)
    const matches = []
    while (matcher.find()) {
      matches.push(Array.from({ length: matcher.groupCount() + 1 }, (_, index) => [
        matcher.group(index), matcher.start(index), matcher.end(index),
      ]))
    }
    return { matches, full: compiled.matches(input), replaced: compiled.matcher(input).replaceAll('replacement') }
  }
  for (const [pattern, input] of cases) {
    assert.deepEqual(snapshot(after, pattern, input), snapshot(before, pattern, input), pattern)
  }
  assert.throws(() => after.RE2JS.compile('('), after.RE2JSSyntaxException)
})

test('preserves all boolean prefilter branches, including recursive AND and OR', async () => {
  const { Prefilter } = await loadSource(`${renamed.code}\nexport { Prefilter };`)
  const exact = value => {
    const node = new Prefilter(Prefilter.Type.EXACT)
    node.str = value
    return node
  }
  const input = { hasString: (node, pos) => 'left motor'.slice(pos).includes(node.str) }
  const none = new Prefilter(Prefilter.Type.NONE)
  assert.equal(none.matchesInput(input, 0), true)
  assert.equal(exact('left').matchesInput(input, 0), true)
  assert.equal(exact('left').matchesInput(input, 5), false)
  const and = new Prefilter(Prefilter.Type.AND)
  and.subs = [exact('left'), exact('motor')]
  assert.equal(and.matchesInput(input, 0), true)
  and.subs.push(exact('pump'))
  assert.equal(and.matchesInput(input, 0), false)
  const or = new Prefilter(Prefilter.Type.OR)
  or.subs = [exact('right'), exact('motor')]
  assert.equal(or.matchesInput(input, 0), true)
  or.subs = [exact('right'), exact('pump')]
  assert.equal(or.matchesInput(input, 0), false)
})

test('fails closed when dependency call sites or method shape change', () => {
  const mutations = [
    original.replace('this.prefilter.eval(input, pos)', 'this.other.eval(input, pos)'),
    original.replace('this.prefilter.eval(input, pos)', 'this.prefilter["eval"](input, pos)'),
    original.replace('this.prefilter.eval(input, pos)', 'this.prefilter.eval'),
    original.replace('this.prefilter.eval(input, pos)', 'this.prefilter.eval(pos, input)'),
    original.replace('this.prefilter.eval(input, pos)', 'true'),
    original.replace('eval(input, pos) {', 'static eval(input, pos) {'),
    original.replace('eval(input, pos) {', 'matchesInput() {}\n eval(input, pos) {'),
    original.replace('eval(input, pos) {', '"matchesInput"() {}\n eval(input, pos) {'),
    original.replace('eval(input, pos) {', '["matchesInput"]() {}\n eval(input, pos) {'),
    `${original}\nglobalThis.unrelated.eval(input, pos);`,
    `${original}\neval(userInput);`,
  ]
  for (const code of mutations) {
    assert.notEqual(code, original)
    assert.throws(() => renameRe2Prefilter(code, parseAst, entry), /Prefilter shape changed/)
  }
})

test('leaves app code, other dependencies, strings and comments untouched', () => {
  const plugin = re2PrefilterPlugin()
  assert.equal(plugin.apply, 'build')
  const unrelated = 'eval(userInput); other.eval(input, pos);'
  for (const id of ['/app/src/example.js', '/app/node_modules/other/build/index.js']) {
    assert.equal(plugin.transform(unrelated, id), null)
  }
  const withComment = `${original}\n// eval(userInput) remains a comment\nconst example = "eval(userInput)";`
  const result = renameRe2Prefilter(withComment, parseAst, entry)
  assert.ok(result.code.endsWith('// eval(userInput) remains a comment\nconst example = "eval(userInput)";'))
})

test('production bundling removes the false positive while retaining the public API', async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [re2PrefilterPlugin()],
    build: { write: false, minify: true, lib: { entry, formats: ['es'] } },
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output)
  const chunks = outputs.filter(output => output.type === 'chunk')
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].code.match(zapEvalPattern), null)
  const bundled = await loadSource(chunks[0].code)
  assert.deepEqual(Object.keys(bundled), Object.keys(before))
  assert.equal(bundled.RE2JS.compile('(left|right).*motor').matcher('left main motor').find(), true)
  assert.equal(bundled.RE2JS.compile('(left|right).*motor').matcher('spare pump').find(), false)
})
