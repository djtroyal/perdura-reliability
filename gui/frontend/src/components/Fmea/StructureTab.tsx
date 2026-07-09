/**
 * Structure tab — the system object tree (indenture levels). Objects are
 * classified by design authority (system vs super-system), one object is the
 * SYSTEM PRODUCT (what the whole system exists to modify), and non-physical
 * objects must be explicitly declared virtual (software/business carve-out).
 */
import { Plus, Trash2 } from 'lucide-react'
import InfoLabel from '../shared/InfoLabel'
import { FmeaState, SysObject, newId } from './model'

const INPUT = 'text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white'

export default function StructureTab({ s, patch }: {
  s: FmeaState
  patch: (p: Partial<FmeaState>) => void
}) {
  const upd = (id: string, p: Partial<SysObject>) =>
    patch({ objects: s.objects.map(o => o.id === id ? { ...o, ...p } : o) })

  const add = (parentId: string | null = null) =>
    patch({
      objects: [...s.objects, {
        id: newId('obj'), name: '', parentId, kind: 'system',
        isSystemProduct: false, virtual: false, notes: '',
      }],
    })

  const remove = (id: string) => {
    const doomed = new Set<string>([id])
    // remove descendants too
    let grew = true
    while (grew) {
      grew = false
      for (const o of s.objects) {
        if (o.parentId && doomed.has(o.parentId) && !doomed.has(o.id)) { doomed.add(o.id); grew = true }
      }
    }
    patch({
      objects: s.objects.filter(o => !doomed.has(o.id)),
      functions: s.functions.filter(f => !doomed.has(f.productId) && !(f.toolId && doomed.has(f.toolId))),
    })
  }

  const setProduct = (id: string) =>
    patch({ objects: s.objects.map(o => ({ ...o, isSystemProduct: o.id === id })) })

  // Depth-first ordering for indentation
  const ordered: { obj: SysObject; depth: number }[] = []
  const visit = (parentId: string | null, depth: number) => {
    for (const o of s.objects.filter(x => x.parentId === parentId)) {
      ordered.push({ obj: o, depth })
      visit(o.id, depth + 1)
    }
  }
  visit(null, 0)
  // Orphans (parent deleted) surface at root
  for (const o of s.objects) if (!ordered.some(e => e.obj.id === o.id)) ordered.push({ obj: o, depth: 0 })

  return (
    <div className="p-4 max-w-4xl flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <InfoLabel tip="Break the system into physical elements, then add the super-system elements it interacts with. Classification is by design authority: 'System' = you control its design; 'Super-system' = the environment (customer parts, ambient substances). Exactly one object is the SYSTEM PRODUCT — the element the whole system exists to modify.">
          System structure ({s.objects.length} objects)
        </InfoLabel>
        <button onClick={() => add(null)}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
          <Plus size={13} /> Add object
        </button>
      </div>

      {ordered.length === 0 ? (
        <p className="text-xs text-gray-400 border border-dashed border-gray-300 rounded p-6 text-center">
          Start by listing the physical objects of your system — then the super-system elements it touches
          (the things you don&apos;t control). Mark the one object the system exists to modify as the system product.
        </p>
      ) : (
        <div className="border border-gray-200 rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium text-gray-500">Object</th>
                <th className="px-2 py-1.5 text-left font-medium text-gray-500 w-32">Authority</th>
                <th className="px-2 py-1.5 text-center font-medium text-gray-500 w-20" title="The element the whole system exists to modify">Product</th>
                <th className="px-2 py-1.5 text-center font-medium text-gray-500 w-16" title='Non-physical object (software/business) — exempts it from the "drop on your foot" physicality test'>Virtual</th>
                <th className="px-2 py-1.5 text-left font-medium text-gray-500 w-40">Parent</th>
                <th className="w-14"></th>
              </tr>
            </thead>
            <tbody>
              {ordered.map(({ obj, depth }) => (
                <tr key={obj.id} className="border-t border-gray-100 group">
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
                      {depth > 0 && <span className="text-gray-300">└</span>}
                      <input value={obj.name} placeholder="name"
                        onChange={e => upd(obj.id, { name: e.target.value })}
                        className={`${INPUT} flex-1 ${obj.isSystemProduct ? 'bg-yellow-50 border-yellow-300' : ''}`} />
                    </div>
                  </td>
                  <td className="px-2 py-1">
                    <select value={obj.kind}
                      onChange={e => upd(obj.id, { kind: e.target.value as SysObject['kind'] })}
                      className={INPUT}>
                      <option value="system">System</option>
                      <option value="superSystem">Super-system</option>
                    </select>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input type="radio" name="sysProduct" checked={obj.isSystemProduct}
                      onChange={() => setProduct(obj.id)} />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input type="checkbox" checked={obj.virtual}
                      onChange={e => upd(obj.id, { virtual: e.target.checked })} />
                  </td>
                  <td className="px-2 py-1">
                    <select value={obj.parentId ?? ''}
                      onChange={e => upd(obj.id, { parentId: e.target.value || null })}
                      className={INPUT}>
                      <option value="">— top level —</option>
                      {s.objects.filter(o => o.id !== obj.id).map(o => (
                        <option key={o.id} value={o.id}>{o.name || '(unnamed)'}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 text-center">
                    <button tabIndex={-1} onClick={() => add(obj.id)}
                      title="Add child object"
                      className="text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 mr-1"><Plus size={12} /></button>
                    <button tabIndex={-1} onClick={() => remove(obj.id)}
                      title="Delete object (and children)"
                      className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-400 leading-relaxed">
        The parent column builds the indenture hierarchy. Yellow marks the system product.
        Super-system objects (things outside your design authority) matter because harms that
        reach them are the severest effects.
      </p>
    </div>
  )
}
