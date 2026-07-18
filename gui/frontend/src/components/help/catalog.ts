import { HELP_BIBLIOGRAPHY } from './bibliography'
import { HELP_GLOSSARY } from './glossary'
import { HELP_MODULES } from './modules'
import { LEGACY_OVERVIEW_TOPICS } from './content/adaptLegacy'
import { OPERATIONS_HELP_TOPICS } from './content/operations'
import { RELIABILITY_HELP_TOPICS } from './content/reliability'
import { STATISTICS_HELP_TOPICS } from './content/statistics'
import type { HelpTopic } from './types'

const authored = [
  ...LEGACY_OVERVIEW_TOPICS,
  ...OPERATIONS_HELP_TOPICS,
  ...RELIABILITY_HELP_TOPICS,
  ...STATISTICS_HELP_TOPICS,
]

/** Last definition wins, allowing a rich authored overview to replace the legacy adapter. */
const topicById = new Map<string, HelpTopic>()
for (const topic of authored) topicById.set(topic.id, topic)

export const HELP_TOPICS = Array.from(topicById.values())
export const HELP_TOPIC_BY_ID = topicById
export const HELP_TOPICS_BY_MODULE = new Map(HELP_MODULES.map(module => [
  module.id,
  HELP_TOPICS.filter(topic => topic.moduleId === module.id).sort((a, b) => {
    if (a.id === module.overviewTopicId) return -1
    if (b.id === module.overviewTopicId) return 1
    return a.title.localeCompare(b.title)
  }),
]))

export { HELP_BIBLIOGRAPHY, HELP_GLOSSARY, HELP_MODULES }
