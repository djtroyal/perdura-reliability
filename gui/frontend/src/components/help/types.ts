export type HelpDepth = 'basics' | 'practice' | 'interpretation' | 'advanced' | 'references'

export type HelpCalloutTone = 'info' | 'tip' | 'caution' | 'important'

export interface HelpCitationRef {
  id: string
  locator?: string
}

export interface HelpParagraphBlock {
  type: 'paragraph'
  text: string
  citations?: HelpCitationRef[]
}

export interface HelpListBlock {
  type: 'list'
  items: string[]
  ordered?: boolean
  citations?: HelpCitationRef[]
}

export interface HelpCalloutBlock {
  type: 'callout'
  tone: HelpCalloutTone
  title?: string
  text: string
  citations?: HelpCitationRef[]
}

export interface HelpEquationSymbol {
  symbol: string
  meaning: string
  unit?: string
}

export interface HelpEquationBlock {
  type: 'equation'
  label?: string
  latex: string
  explanation?: string
  symbols?: HelpEquationSymbol[]
  citations?: HelpCitationRef[]
}

export interface HelpExampleBlock {
  type: 'example'
  title: string
  scenario: string
  steps: string[]
  result: string
  caution?: string
}

export interface HelpTableBlock {
  type: 'table'
  caption?: string
  columns: string[]
  rows: string[][]
}

export interface HelpCodeBlock {
  type: 'code'
  code: string
  language?: string
  caption?: string
  citations?: HelpCitationRef[]
}

export type HelpBlock =
  | HelpParagraphBlock
  | HelpListBlock
  | HelpCalloutBlock
  | HelpEquationBlock
  | HelpExampleBlock
  | HelpCodeBlock
  | HelpTableBlock

export interface HelpSection {
  id: string
  title: string
  depth: Exclude<HelpDepth, 'basics'>
  blocks: HelpBlock[]
  defaultOpen?: boolean
}

export interface HelpBasics {
  purpose: string
  useWhen?: string[]
  inputs?: string[]
  outputs?: string[]
  assumptions?: string[]
}

export interface HelpTopic {
  id: string
  moduleId: string
  title: string
  summary: string
  aliases?: string[]
  keywords?: string[]
  basics: HelpBasics
  sections: HelpSection[]
  related?: string[]
  reviewed?: string
  /** Mathematical analyses require an example; workflow topics use a walkthrough. */
  exampleKind?: 'worked' | 'walkthrough' | 'none'
}

export interface HelpModuleDefinition {
  id: string
  title: string
  shortTitle?: string
  description: string
  overviewTopicId: string
}

export interface GlossaryEntry {
  id: string
  term: string
  aliases?: string[]
  short: string
  detail?: string
  relatedTopics?: string[]
  citations?: HelpCitationRef[]
}

export interface BibliographyEntry {
  id: string
  author: string
  title: string
  year?: string
  edition?: string
  url?: string
  note?: string
  publicAccess: boolean
}

export interface HelpSearchResult {
  id: string
  kind: 'topic' | 'glossary'
  title: string
  moduleId?: string
  topicId?: string
  sectionId?: string
  breadcrumb: string
  snippet: string
  score: number
}

export const p = (text: string, citations?: HelpCitationRef[]): HelpParagraphBlock =>
  ({ type: 'paragraph', text, citations })

export const list = (
  items: string[],
  citations?: HelpCitationRef[],
  ordered = false,
): HelpListBlock => ({ type: 'list', items, citations, ordered })

export const note = (
  tone: HelpCalloutTone,
  text: string,
  title?: string,
  citations?: HelpCitationRef[],
): HelpCalloutBlock => ({ type: 'callout', tone, text, title, citations })

export const code = (
  value: string,
  language?: string,
  caption?: string,
): HelpCodeBlock => ({ type: 'code', code: value, language, caption })

export const equation = (
  latex: string,
  options: Omit<HelpEquationBlock, 'type' | 'latex'> = {},
): HelpEquationBlock => ({ type: 'equation', latex, ...options })

export const example = (
  title: string,
  scenario: string,
  steps: string[],
  result: string,
  caution?: string,
): HelpExampleBlock => ({ type: 'example', title, scenario, steps, result, caution })
