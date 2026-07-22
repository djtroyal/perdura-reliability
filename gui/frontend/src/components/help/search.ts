import type {
  GlossaryEntry, HelpBlock, HelpModuleDefinition, HelpSearchResult, HelpTopic,
} from './types'

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
function words(value: string): string[] {
  return normalize(value).split(/[^a-z0-9²³λβησμ]+/).filter(Boolean)
}

function blockText(block: HelpBlock): string {
  if (block.type === 'paragraph' || block.type === 'callout') return block.text
  if (block.type === 'list') return block.items.join(' ')
  if (block.type === 'equation') return [block.label, block.latex, block.explanation,
    ...(block.symbols ?? []).flatMap(symbol => [symbol.symbol, symbol.meaning, symbol.unit])]
    .filter(Boolean).join(' ')
  if (block.type === 'example') return [block.title, block.scenario, ...block.steps,
    block.result, block.caution].filter(Boolean).join(' ')
  if (block.type === 'code') return [block.caption, block.language, block.code].filter(Boolean).join(' ')
  return [block.caption, ...block.columns, ...block.rows.flat()].filter(Boolean).join(' ')
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const old = previous[j]
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      diagonal = old
    }
  }
  return previous[b.length]
}

function tokenScore(query: string, haystack: string, hayWords: string[], weight: number): number {
  const q = normalize(query)
  if (!q) return 0
  if (haystack === q) return weight * 5
  if (haystack.startsWith(q)) return weight * 3
  if (haystack.includes(q)) return weight * 2
  const threshold = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0
  if (threshold && hayWords.some(word => editDistance(q, word) <= threshold)) return weight
  return 0
}

function scoreFields(queryTokens: string[], fields: Array<[string, number]>): number {
  return queryTokens.reduce((total, query) => {
    let best = 0
    for (const [field, weight] of fields) {
      const normalized = normalize(field)
      best = Math.max(best, tokenScore(query, normalized, words(normalized), weight))
    }
    return total + best
  }, 0)
}

function snippet(text: string, queryTokens: string[]): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= 180) return compact
  const normalized = normalize(compact)
  const index = queryTokens.map(token => normalized.indexOf(token)).find(position => position >= 0) ?? 0
  const start = Math.max(0, index - 55)
  const end = Math.min(compact.length, start + 175)
  return `${start ? '…' : ''}${compact.slice(start, end).trim()}${end < compact.length ? '…' : ''}`
}

export function searchHelp(
  query: string,
  topics: HelpTopic[],
  glossary: GlossaryEntry[],
  modules: HelpModuleDefinition[],
  activeModuleId?: string,
): HelpSearchResult[] {
  const queryTokens = words(query)
  if (!queryTokens.length) return []
  const moduleById = new Map(modules.map(module => [module.id, module]))
  const results: HelpSearchResult[] = []

  for (const topic of topics) {
    let bestSection: { id?: string; title?: string; text: string; score: number } = {
      text: [topic.summary, topic.basics.purpose, ...(topic.basics.useWhen ?? []),
        ...(topic.basics.inputs ?? []), ...(topic.basics.outputs ?? []),
        ...(topic.basics.assumptions ?? [])].join(' '),
      score: 0,
    }
    const baseScore = scoreFields(queryTokens, [
      [topic.title, 12], [(topic.aliases ?? []).join(' '), 10],
      [(topic.keywords ?? []).join(' '), 8], [bestSection.text, 3],
    ])
    for (const section of topic.sections) {
      const text = section.blocks.map(blockText).join(' ')
      const score = scoreFields(queryTokens, [[section.title, 8], [text, 3]])
      if (score > bestSection.score) bestSection = { id: section.id, title: section.title, text, score }
    }
    const score = baseScore + bestSection.score + (topic.moduleId === activeModuleId ? 2 : 0)
    if (score <= 0) continue
    const module = moduleById.get(topic.moduleId)
    results.push({
      id: `topic:${topic.id}:${bestSection.id ?? ''}`,
      kind: 'topic', title: topic.title, moduleId: topic.moduleId, topicId: topic.id,
      sectionId: bestSection.id,
      breadcrumb: [module?.title ?? topic.moduleId, bestSection.title].filter(Boolean).join(' › '),
      snippet: snippet(bestSection.text || topic.summary, queryTokens), score,
    })
  }

  for (const entry of glossary) {
    const detail = [entry.short, entry.detail, ...(entry.aliases ?? [])].filter(Boolean).join(' ')
    const score = scoreFields(queryTokens, [
      [entry.term, 12], [(entry.aliases ?? []).join(' '), 10], [detail, 4],
    ])
    if (score <= 0) continue
    results.push({
      id: `glossary:${entry.id}`, kind: 'glossary', title: entry.term,
      breadcrumb: 'Glossary', snippet: snippet(detail, queryTokens), score,
    })
  }
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 60)
}

export function helpTopicSearchText(topic: HelpTopic): string {
  return [topic.title, topic.summary, ...(topic.aliases ?? []), ...(topic.keywords ?? []),
    topic.basics.purpose, ...(topic.basics.useWhen ?? []), ...(topic.basics.inputs ?? []),
    ...(topic.basics.outputs ?? []), ...(topic.basics.assumptions ?? []),
    ...topic.sections.flatMap(section => [section.title, ...section.blocks.map(blockText)]),
  ].join(' ')
}
