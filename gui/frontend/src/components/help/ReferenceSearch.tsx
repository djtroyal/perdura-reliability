import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { HELP_BIBLIOGRAPHY } from './catalog'
import { inputCls } from '../shared/styles'

interface ReferenceDocument { id: string; title: string; edition: string; date: string; authority: string; review_status: string; source_url: string
  available: boolean; status: string; sha256: string | null; filename: string | null; reason?: string }
interface SearchResult { document_id: string; edition: string; title: string; date: string; pdf_page: number; sha256: string; source_url: string; snippet: string }
interface SearchResponse { query: string; total_matching_pages: number; truncated: boolean; results: SearchResult[]; page_basis: string
  documents: { id: string; status: string; reason?: string; pages?: number }[] }
const EXAMPLES = [
  { title: 'Conditional Weibull lifetime', topic: 'maintenance.lifetime-tools', query: 'Weibull', text: 'η=13, β=2, survived age 6.5: mean additional life 7.09333769, median additional life 6.12504945. Means and percentile lives answer different questions.', url: 'https://www.itl.nist.gov/div898/handbook/apr/section1/apr162.htm' },
  { title: 'Age-replacement mechanical rate', topic: 'maintenance.lifetime-tools', query: 'replacement', text: 'η=50,000 hours, β=1.3, replace at attained age 87,600 hours: corrective intensity 20.61752860 failures per million operating hours. Calendar intensity also depends on downtime.', url: 'https://www.itl.nist.gov/div898/handbook/apr/section1/apr162.htm' },
  { title: 'Inspection-count prediction', topic: 'maintenance.lifetime-tools', query: 'prediction', text: '20,000 original units, 8 failed by age 3, inspect again at 10, fixed β=3: plug-in expected additional failures 286.17071065. Predictive uncertainty also includes count variation and parameter uncertainty.', url: 'https://doi.org/10.1198/004017002753398191' },
]

export default function ReferenceSearch({ onTopic }: { onTopic: (id: string) => void }) {
  const [documents, setDocuments] = useState<ReferenceDocument[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('failure rate'), [match, setMatch] = useState<'all' | 'any' | 'phrase'>('all')
  const [result, setResult] = useState<SearchResponse | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [extractor, setExtractor] = useState(true)
  useEffect(() => {
    let active = true
    api.get<{ documents: ReferenceDocument[]; extractor_available: boolean }>('/references/catalog').then(({ data }) => {
      if (active) { setDocuments(data.documents); setSelected(data.documents.filter(d => d.available).map(d => d.id)); setExtractor(data.extractor_available) }
    }).catch(err => { if (active) setError(String(err)) })
    return () => { active = false }
  }, [])
  const run = async () => {
    setLoading(true); setError('')
    try { setResult((await api.post<SearchResponse>('/references/search', { query, document_ids: selected, match, limit: 30 })).data) }
    catch (err) { setError(String(err)) } finally { setLoading(false) }
  }
  return <section className="mx-auto max-w-4xl pb-12 space-y-6">
    <div><p className="text-xs font-semibold text-blue-700">Reference library</p><h1 className="mt-1 text-2xl font-semibold">Search local source pages</h1>
      <p className="mt-2 text-sm text-slate-600">Search selected cataloged PDFs without changing an analysis. Citations identify the local edition, physical PDF page and file hash; official source records can contain other editions.</p></div>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); void run() }}>
      <div className="flex gap-2"><input aria-label="Search reference pages" className={inputCls} value={query} onChange={e => setQuery(e.target.value)} placeholder="Keywords or phrase" maxLength={160} />
        <select aria-label="Reference match mode" className={inputCls} value={match} onChange={e => setMatch(e.target.value as typeof match)}><option value="all">All words</option><option value="any">Any word</option><option value="phrase">Exact phrase</option></select>
        <button className="primary-button whitespace-nowrap" disabled={loading || selected.length===0 || query.trim().length<2}>{loading ? 'Searching…' : 'Search pages'}</button></div>
      <div className="grid gap-2 sm:grid-cols-2">{documents.map(doc => <label className="flex gap-2 rounded border bg-white p-3 text-xs" key={doc.id}>
        <input type="checkbox" aria-label={`Search ${doc.edition}`} checked={selected.includes(doc.id)} disabled={!doc.available || loading} onChange={e => setSelected(old => e.target.checked ? [...old,doc.id] : old.filter(id => id!==doc.id))} />
        <span><strong>{doc.edition}</strong> · {doc.date}<span className="block text-slate-600">{doc.title}</span><span className="block text-slate-500">{doc.available ? 'Local file; hash checked before indexing' : 'Not installed locally'} · {doc.review_status.replace(/_/g,' ')}</span>
          <a href={doc.source_url} target="_blank" rel="noreferrer" className="text-blue-700 underline">Official source record</a>
          {!doc.available && doc.filename && <span className="block font-mono text-[10px]">Expected file: {doc.filename}</span>}
          {doc.sha256 && <details className="mt-1"><summary>Catalog SHA-256</summary><code className="break-all text-[10px]">{doc.sha256}</code></details>}</span></label>)}</div>
    </form>
    {documents.length > 0 && documents.every(doc => !doc.available) && <p className="text-xs text-slate-600">To search your local copies, set PERDURA_REFERENCE_DIRECTORY to their folder before starting Perdura. Use the cataloged filenames and editions shown above.</p>}
    {!extractor && <p role="status" className="text-sm text-amber-800">PDF text extraction is unavailable in this installation. Source metadata and worked examples remain available.</p>}
    {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
    {result && <div className="space-y-3"><p role="status" className="text-sm font-medium">{result.total_matching_pages} matching PDF pages for “{result.query}”{result.truncated ? ' — showing the first 30' : ''}</p>
      <p className="text-xs text-slate-500">{result.page_basis}</p>
      {result.documents.filter(d => d.status !== 'searched').map(d => <p className="text-xs text-amber-800" key={d.id}>{d.id}: {d.reason}</p>)}
      {result.results.map(row => <article className="rounded-lg border bg-white p-4" key={`${row.document_id}-${row.pdf_page}`}>
        <h2 className="font-semibold text-sm">{row.edition} · PDF page {row.pdf_page}</h2><p className="text-xs text-slate-500">{row.title} · local edition dated {row.date}</p>
        <p className="mt-2 text-xs leading-5 whitespace-pre-wrap">{row.snippet}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs"><a className="text-blue-700 underline" href={row.source_url} target="_blank" rel="noreferrer">Official source record</a>
          <button className="text-blue-700 underline" onClick={() => void navigator.clipboard.writeText(`${row.edition} (${row.date}), PDF page ${row.pdf_page}, SHA-256 ${row.sha256}. ${row.source_url}`).catch(err => setError(String(err)))}>Copy citation</button></div>
        <details className="mt-2 text-xs"><summary>Verified source identity</summary><code className="break-all text-[10px]">SHA-256 {row.sha256}</code></details>
      </article>)}
    </div>}
    <section><h2 className="text-lg font-semibold">Worked examples</h2><p className="text-xs text-slate-500 mt-1">Independent numerical examples reproduced in Perdura's tests. Open the related Help topic or use the keywords above to inspect handbook context.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">{EXAMPLES.map(example => <article className="rounded-lg border bg-white p-3" key={example.title}><h3 className="font-semibold text-sm">{example.title}</h3><p className="mt-2 text-xs leading-5">{example.text}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs"><button className="text-blue-700 underline" onClick={() => onTopic(example.topic)}>Open Help</button><button className="text-blue-700 underline" onClick={() => setQuery(example.query)}>Search keyword</button><a className="text-blue-700 underline" href={example.url} target="_blank" rel="noreferrer">Method reference</a></div></article>)}</div></section>
    <details><summary className="text-lg font-semibold">Books, standards and public references</summary><div className="mt-3 space-y-3">{HELP_BIBLIOGRAPHY.map(ref => <article className="rounded border bg-white p-3 text-xs" key={ref.id}>
      <p className="font-semibold">{ref.title}</p><p>{ref.author}{ref.year ? ` (${ref.year})` : ''}{ref.edition ? ` · ${ref.edition}` : ''}</p>{ref.note && <p className="mt-1 text-slate-600">{ref.note}</p>}
      {ref.url && <a className="text-blue-700 underline" href={ref.url} target="_blank" rel="noreferrer">{ref.publicAccess ? 'Public source' : 'Publisher record'}</a>}
    </article>)}</div></details>
  </section>
}
