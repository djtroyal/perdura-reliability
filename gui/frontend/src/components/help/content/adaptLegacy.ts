import { HELP_CONTENT } from '../../shared/helpContent'
import type { HelpTopic } from '../types'
import { list } from '../types'

/** Preserve the existing reviewed module guidance as the overview layer. */
export const LEGACY_OVERVIEW_TOPICS: HelpTopic[] = Object.entries(HELP_CONTENT).map(
  ([moduleId, help]) => ({
    id: `${moduleId}.overview`,
    moduleId,
    title: help.title,
    summary: help.overview,
    basics: {
      purpose: help.overview,
      useWhen: ['Start here for the module workflow, terminology, and interpretation guidance.'],
      outputs: ['Module-specific calculations, diagnostics, plots, tables, and reusable project assets.'],
    },
    sections: help.sections.map((section, index) => ({
      id: `legacy-${index + 1}`,
      title: section.heading,
      depth: index === 0 ? 'practice' as const : 'interpretation' as const,
      defaultOpen: index === 0,
      blocks: [list(section.items.map(item => typeof item === 'string'
        ? item
        : `${item.term} — ${item.def}`))],
    })),
    reviewed: '2026-07-17',
    exampleKind: 'walkthrough',
  }),
)
