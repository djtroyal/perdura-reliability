import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const stored = new Map()
let blockStorage = false
const storage = {
  getItem(key) {
    if (blockStorage) throw new Error('Browser storage is blocked')
    return stored.get(key) ?? null
  },
  setItem(key, value) {
    if (blockStorage) throw new Error('Browser storage is full')
    stored.set(key, String(value))
  },
}
const storageListeners = []
globalThis.localStorage = storage
const prefix = 'perdura:ui-preferences:'
stored.set(`${prefix}saved`, 'true')
stored.set(`${prefix}badJson`, '{')
stored.set(`${prefix}wrongType`, '"true"')
stored.set(`${prefix}removedOption`, '"retired"')
stored.set(`${prefix}size`, '22')
stored.set(`${prefix}invalidSize`, 'null')

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const preferences = await vite.ssrLoadModule('/src/store/uiPreferences.ts')
  const project = await vite.ssrLoadModule('/src/store/project.ts')
  const state = project.getProjectState()
  const dirty = project.isDirty()
  const undoHistory = project.getUndoHistory()
  globalThis.window = {
    localStorage: storage,
    addEventListener: (name, listener) => {
      if (name === 'storage') storageListeners.push(listener)
    },
  }
  assert.equal(preferences.UI_PREFERENCE_PREFIX, prefix)
  assert.equal(preferences.readUiPreference('missing', false), false)
  assert.equal(preferences.readUiPreference('saved', false), true,
    'saved browser display preferences must be restored')
  assert.equal(preferences.readUiPreference('badJson', false), false)
  assert.equal(preferences.readUiPreference('wrongType', false), false,
    'the string false/true must not accidentally become a checked checkbox')
  assert.equal(preferences.readUiPreference('removedOption', 'normal', ['compact', 'normal']), 'normal')
  assert.equal(preferences.readUiPreference('size', 12), 22)
  assert.equal(preferences.readUiPreference('invalidSize', 12), 12)

  preferences.setUiPreference('systemDefinition.showPieceParts', true)
  assert.equal(preferences.readUiPreference('systemDefinition.showPieceParts', false), true)
  assert.equal(stored.get(`${prefix}systemDefinition.showPieceParts`), 'true')
  preferences.setUiPreference('systemDefinition.showPieceParts', false)
  assert.equal(preferences.readUiPreference('systemDefinition.showPieceParts', true), false,
    'false must persist as a value rather than falling back to the default')

  preferences.setUiPreference('layout', 'compact')
  assert.equal(preferences.readUiPreference('layout', 'normal', ['compact', 'normal']), 'compact')
  preferences.setUiPreference('finite', Number.NaN)
  assert.equal(preferences.readUiPreference('finite', 12), 12)
  assert.equal(stored.has(`${prefix}finite`), false)

  blockStorage = true
  assert.equal(preferences.readUiPreference('blockedDefault', false), false)
  assert.doesNotThrow(() => preferences.setUiPreference('blockedDefault', true))
  assert.equal(preferences.readUiPreference('blockedDefault', false), true,
    'storage write failures must retain the preference for later module mounts')
  blockStorage = false

  assert.equal(storageListeners.length, 1, 'reading preferences must register only one storage listener')
  stored.set(`${prefix}saved`, 'false')
  storageListeners[0]({ key: `${prefix}saved`, storageArea: storage })
  assert.equal(preferences.readUiPreference('saved', true), false,
    'changes from other browser tabs must invalidate the local preference cache')
  stored.clear()
  storageListeners[0]({ key: null, storageArea: storage })
  assert.equal(preferences.readUiPreference('layout', 'normal', ['compact', 'normal']), 'normal')

  assert.equal(project.getProjectState(), state, 'view preferences must never rewrite analytical project data')
  assert.equal(project.isDirty(), dirty, 'view preferences must not dirty the project')
  assert.deepEqual(project.getUndoHistory(), undoHistory, 'view preferences must not create undo entries')
  console.log('UI preferences restore, validate, tolerate unavailable storage, and leave project data unchanged')
} finally {
  await vite.close()
  hmrServer.close()
  delete globalThis.localStorage
  delete globalThis.window
}
