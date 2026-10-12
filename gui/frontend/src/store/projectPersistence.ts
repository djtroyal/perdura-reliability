/** Incremental browser persistence. No project-sized JSON serialization on edits. */
export interface StoredProject {
  projectName: string
  identity: { projectId: string }
  units: string
  analysisRuns: unknown[]
  exportLedger: unknown[]
  lastSavedAt?: string | null
  modules: Record<string, unknown>
}
interface DocumentRecord {
  id: string
  sequence: number
  snapshot: Omit<StoredProject, 'modules'>
  moduleKeys: string[]
  fta?: { wrapped: boolean; wrapper: Record<string, unknown>; folios: Record<string, unknown>[] }
  reports?: { wrapper: Record<string, unknown>; reportIds: string[]; snapshotIds?: string[] }
}
interface DataRecord { documentId: string; key: string; value: unknown }
interface Baseline { sequence: number; records: Map<string, unknown> }
export interface StoredProjectSummary { id: string; name: string; savedAt: string }

const DB_NAME = 'perdura:project-schema:8'
const DB_VERSION = 1
const splitCache = new WeakMap<object, { input: unknown; result: unknown }>()
interface BlobReference { path: (string | number)[]; key: string }
interface PackedReport { value: unknown; references: BlobReference[] }
interface PackedNode extends PackedReport { blobs: Map<string, Blob> }
const reportCache = new WeakMap<object, Promise<PackedNode>>()

/** Blob references are separate paths, so user-authored objects cannot collide
 * with an internal sentinel. Immutable subtrees avoid reprocessing other images. */
async function packReport(value: unknown): Promise<PackedNode> {
  if (typeof value === 'string' && /^data:image\//i.test(value)) {
    const bytes = new TextEncoder().encode(value)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const key = `report-blob:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
    return { value: null, references: [{ path: [], key }], blobs: new Map([[key, new Blob([value], { type: 'text/plain' })]]) }
  }
  if (!value || typeof value !== 'object') return { value, references: [], blobs: new Map() }
  const cached = reportCache.get(value)
  if (cached) return cached
  const pending = (async () => {
    const output: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {}
    const references: BlobReference[] = []
    const blobs = new Map<string, Blob>()
    for (const [key, child] of Object.entries(value)) {
      const packed = await packReport(child)
      Object.defineProperty(output, key, { value: packed.value, enumerable: true, writable: true, configurable: true })
      const segment = Array.isArray(value) ? Number(key) : key
      for (const reference of packed.references) references.push({ path: [segment, ...reference.path], key: reference.key })
      for (const [blobKey, blob] of packed.blobs) blobs.set(blobKey, blob)
    }
    return { value: output, references, blobs }
  })()
  reportCache.set(value, pending)
  return pending
}

async function unpackReport(packed: PackedReport, records: Map<string, unknown>): Promise<unknown> {
  const value = structuredClone(packed.value)
  for (const reference of packed.references) {
    const blob = records.get(reference.key)
    if (!(blob instanceof Blob)) throw new Error('Saved report is missing an image; the project was not opened.')
    const image = await blob.text()
    if (!reference.path.length) return image
    let target = value as Record<string | number, unknown>
    for (const part of reference.path.slice(0, -1)) target = target[part] as Record<string | number, unknown>
    Object.defineProperty(target, reference.path[reference.path.length - 1], { value: image, enumerable: true, writable: true, configurable: true })
  }
  if (value && typeof value === 'object') reportCache.set(value, Promise.resolve({ ...packed,
    blobs: new Map(packed.references.map(reference => [reference.key, records.get(reference.key) as Blob])),
  }))
  return value
}
function splitFta(value: unknown) {
  if (!value || typeof value !== 'object') return { input: value, result: undefined }
  const cached = splitCache.get(value)
  if (cached) return cached
  const { result, ...input } = value as Record<string, unknown>
  const parts = { input, result }
  splitCache.set(value, parts)
  return parts
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Browser storage request failed.'))
  })
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Browser storage transaction was aborted.'))
    tx.onerror = () => { /* onabort supplies the final transaction outcome */ }
  })
}

export class ProjectPersistence {
  private connection?: Promise<IDBDatabase>
  private baselines = new Map<string, Baseline>()
  private queue: Promise<unknown> = Promise.resolve()
  private prepared = new WeakMap<object, unknown>()
  constructor(private readonly prepareModule: (key: string, value: unknown) => unknown = (_, value) => value) {}

  private database(): Promise<IDBDatabase> {
    if (!this.connection) this.connection = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is unavailable. Export your project to preserve your work.'))
        return
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        db.createObjectStore('documents', { keyPath: 'id' })
        db.createObjectStore('records', { keyPath: ['documentId', 'key'] })
        db.createObjectStore('settings')
      }
      req.onerror = () => reject(req.error ?? new Error('Cannot open browser storage.'))
      req.onblocked = () => reject(new Error('Another Perdura tab is blocking the storage upgrade. Close it and retry.'))
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => { db.close(); this.connection = undefined }
        db.onclose = () => { this.connection = undefined }
        resolve(db)
      }
    }).catch(error => { this.connection = undefined; throw error })
    return this.connection!
  }

  async list(): Promise<StoredProjectSummary[]> {
    const db = await this.database()
    const tx = db.transaction('documents', 'readonly')
    const done = complete(tx)
    const rows = await request(tx.objectStore('documents').getAll()) as DocumentRecord[]
    await done
    return rows.filter(row => row.id.startsWith('named:')).map(row => ({
      id: row.id, name: row.snapshot.projectName, savedAt: row.snapshot.lastSavedAt ?? '',
    })).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  async read(id: string): Promise<StoredProject | null> {
    const db = await this.database()
    const tx = db.transaction(['documents', 'records'], 'readonly')
    const done = complete(tx)
    const metaRequest = request(tx.objectStore('documents').get(id))
    const dataRequest = request(tx.objectStore('records').getAll(IDBKeyRange.bound([id, ''], [id, '\uffff'])))
    const [meta, rows] = await Promise.all([metaRequest, dataRequest]) as [DocumentRecord | undefined, DataRecord[]]
    await done
    const records = new Map(rows.map(row => [row.key, row.value]))
    this.baselines.set(id, { sequence: meta?.sequence ?? 0, records })
    if (!meta) return null
    const modules: Record<string, unknown> = {}
    for (const key of meta.moduleKeys) {
      if ((key === 'faultTree' && meta.fta) || (key === 'reportBuilder' && meta.reports)) continue
      const recordKey = `module:${key}`
      if (!records.has(recordKey)) throw new Error(`Saved project is missing module ${key}; it was not opened.`)
      modules[key] = records.get(recordKey)
    }
    if (meta.fta) {
      const folios = meta.fta.folios.map(header => {
        const inputKey = `fta-input:${String(header.id)}`
        if (!records.has(inputKey)) throw new Error(`Saved project is missing FTA ${header.id}; it was not opened.`)
        const input = records.get(inputKey)
        const result = records.get(`fta-result:${String(header.id)}`)
        const state = { ...(input as Record<string, unknown>), ...(result === undefined ? {} : { result }) }
        splitCache.set(state, { input, result })
        return { ...header, state }
      })
      modules.faultTree = meta.fta.wrapped ? { ...meta.fta.wrapper, folios } : folios[0]?.state
    }
    if (meta.reports) {
      const readItem = async (key: string) => {
        if (!records.has(key)) throw new Error(`Saved project is missing ${key}; it was not opened.`)
        const restored = await unpackReport(records.get(key) as PackedReport, records)
        if (restored && typeof restored === 'object') records.set(key, await reportCache.get(restored))
        return restored
      }
      modules.reportBuilder = { ...meta.reports.wrapper,
        reports: await Promise.all(meta.reports.reportIds.map(id => readItem(`report:${id}`))),
        ...(meta.reports.snapshotIds === undefined ? {} : {
          plotSnapshots: await Promise.all(meta.reports.snapshotIds.map(id => readItem(`report-snapshot:${id}`))),
        }),
      }
    }
    return { ...meta.snapshot, modules }
  }

  /** Serialized writes compare the last observed sequence inside the transaction. */
  save(id: string, snapshot: StoredProject): Promise<void> {
    const work = this.queue.then(() => this.write(id, snapshot))
    this.queue = work.catch(() => {})
    return work
  }

  private async write(id: string, snapshot: StoredProject): Promise<void> {
    const db = await this.database()
    const baseline = this.baselines.get(id)
    const records = new Map<string, unknown>()
    let fta: DocumentRecord['fta']
    let reports: DocumentRecord['reports']
    for (const [key, value] of Object.entries(snapshot.modules)) {
      if (key === 'faultTree' && value && typeof value === 'object') {
        const raw = value as Record<string, unknown>
        const wrapped = raw._folioWrap === true && Array.isArray(raw.folios)
        const { folios: _, ...wrapper } = raw
        const folios = wrapped ? raw.folios as Record<string, unknown>[] : [{ id: 'f0', name: 'Analysis 1', state: value }]
        const ids = new Set<string>()
        const headers = folios.map(folio => {
          const { state, ...header } = folio
          const treeId = String(header.id ?? '')
          if (!treeId || ids.has(treeId)) throw new Error('Cannot save FTA trees with missing or duplicate IDs.')
          ids.add(treeId)
          const parts = splitFta(state)
          records.set(`fta-input:${treeId}`, parts.input)
          if (parts.result !== undefined) records.set(`fta-result:${treeId}`, parts.result)
          return header
        })
        fta = { wrapped, wrapper: wrapped ? wrapper : {}, folios: headers }
      } else if (key === 'reportBuilder' && value && typeof value === 'object'
          && Array.isArray((value as Record<string, unknown>).reports)) {
        const { reports: reportValues, plotSnapshots, ...wrapper } = value as Record<string, unknown>
        const addItems = async (items: unknown[], prefix: string) => {
          const ids = new Set<string>()
          for (const item of items) {
            const itemId = item && typeof item === 'object' ? (item as Record<string, unknown>).id : undefined
            if (typeof itemId !== 'string' || !itemId || ids.has(itemId)) throw new Error('Cannot save reports or snapshots with missing or duplicate IDs.')
            ids.add(itemId)
            const packed = await packReport(item)
            // Cache the envelope with the node so unchanged reports retain identity.
            records.set(`${prefix}:${itemId}`, packed)
            for (const [blobKey, blob] of packed.blobs) records.set(blobKey, blob)
          }
          return [...ids]
        }
        reports = { wrapper, reportIds: await addItems(reportValues as unknown[], 'report'),
          ...(Array.isArray(plotSnapshots) ? { snapshotIds: await addItems(plotSnapshots, 'report-snapshot') } : {}),
        }
      } else {
        let prepared = value && typeof value === 'object' ? this.prepared.get(value) : undefined
        if (prepared === undefined) {
          prepared = this.prepareModule(key, value)
          if (value && typeof value === 'object') this.prepared.set(value, prepared)
        }
        records.set(`module:${key}`, prepared)
      }
    }
    const { modules: _, ...metadata } = snapshot
    const tx = db.transaction(['documents', 'records'], 'readwrite')
    const done = complete(tx)
    let failure: Error | undefined
    const metaStore = tx.objectStore('documents')
    const dataStore = tx.objectStore('records')
    const lookup = metaStore.get(id)
    lookup.onsuccess = () => {
      try {
      const current = lookup.result as DocumentRecord | undefined
      if ((current?.sequence ?? 0) !== (baseline?.sequence ?? 0)) {
        failure = new Error('This project changed in another browser tab. Reopen it or save a copy under another name.')
        tx.abort()
        return
      }
      for (const key of baseline?.records.keys() ?? []) {
        if (!records.has(key)) dataStore.delete([id, key])
      }
      for (const [key, value] of records) {
        if (!baseline?.records.has(key) || (!key.startsWith('report-blob:') && baseline.records.get(key) !== value)) {
          // Blob payloads belong only in their own records, never duplicated in report envelopes.
          const stored = key.startsWith('report:') || key.startsWith('report-snapshot:')
            ? { value: (value as PackedNode).value, references: (value as PackedNode).references } : value
          dataStore.put({ documentId: id, key, value: stored } satisfies DataRecord)
        }
      }
      metaStore.put({ id, sequence: (baseline?.sequence ?? 0) + 1, snapshot: metadata,
        moduleKeys: Object.keys(snapshot.modules), fta, reports } satisfies DocumentRecord)
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error))
        tx.abort()
      }
    }
    try { await done } catch (error) { throw failure ?? error }
    this.baselines.set(id, { sequence: (baseline?.sequence ?? 0) + 1, records })
  }

  remove(id: string): Promise<void> {
    const work = this.queue.then(() => this.deleteDocument(id))
    this.queue = work.catch(() => {})
    return work
  }

  private async deleteDocument(id: string): Promise<void> {
    const db = await this.database()
    const tx = db.transaction(['documents', 'records'], 'readwrite')
    const done = complete(tx)
    tx.objectStore('documents').delete(id)
    tx.objectStore('records').delete(IDBKeyRange.bound([id, ''], [id, '\uffff']))
    await done
    this.baselines.delete(id)
  }

  forget(id: string): void { this.baselines.delete(id) }

  async migrationComplete(): Promise<boolean> {
    const db = await this.database()
    return Boolean(await request(db.transaction('settings').objectStore('settings').get('legacy-migrated')))
  }
  async markMigrationComplete(): Promise<void> {
    const db = await this.database()
    const tx = db.transaction('settings', 'readwrite')
    const done = complete(tx)
    tx.objectStore('settings').put(true, 'legacy-migrated')
    await done
  }
}
