import type { HelpModuleDefinition } from './types'

export const HELP_MODULES: HelpModuleDefinition[] = [
  { id: 'dashboard', title: 'Dashboard & Projects', description: 'Projects, recents, module status, saving, importing, and navigation.', overviewTopicId: 'dashboard.overview' },
  { id: 'lifeData', title: 'Life Data Analysis', shortTitle: 'Life Data', description: 'Lifetime distributions, censoring, nonparametric estimates, and probabilistic calculations.', overviewTopicId: 'lifeData.overview' },
  { id: 'alt', title: 'Reliability Testing', description: 'Accelerated tests, demonstrations, planning, degradation, and screening.', overviewTopicId: 'alt.overview' },
  { id: 'systemModeling', title: 'System Modeling', description: 'Reliability block diagrams, fault trees, and Markov state models.', overviewTopicId: 'systemModeling.overview' },
  { id: 'reliabilityAllocation', title: 'Reliability Allocation', shortTitle: 'Allocation', description: 'Top-down apportionment of system reliability and MTBF targets.', overviewTopicId: 'reliabilityAllocation.overview' },
  { id: 'prediction', title: 'Failure Rate Prediction', shortTitle: 'Prediction', description: 'Standards-based component and system failure-rate prediction.', overviewTopicId: 'prediction.overview' },
  { id: 'pof', title: 'Physics of Failure', description: 'Mechanism-specific stress, damage, fatigue, and acceleration models.', overviewTopicId: 'pof.overview' },
  { id: 'growth', title: 'Reliability Growth', description: 'Repairable-system trends, Crow-AMSAA, Duane, ROCOF, and MCF.', overviewTopicId: 'growth.overview' },
  { id: 'maintenance', title: 'Maintenance', description: 'Availability, maintainability, spares, replacement, and maintenance planning.', overviewTopicId: 'maintenance.overview' },
  { id: 'hra', title: 'Human Reliability', description: 'Human-error quantification methods and explicitly identified screening worksheets.', overviewTopicId: 'hra.overview' },
  { id: 'warranty', title: 'Warranty Analysis', description: 'Grouped warranty returns, life-model fitting, and forecasts.', overviewTopicId: 'warranty.overview' },
  { id: 'hypothesis', title: 'Hypothesis Tests', description: 'Parametric, nonparametric, ANOVA, and proportion tests.', overviewTopicId: 'hypothesis.overview' },
  { id: 'dataAnalysis', title: 'Statistical Modeling', description: 'Descriptive statistics, regression, machine learning, and prediction.', overviewTopicId: 'dataAnalysis.overview' },
  { id: 'sixSigma', title: 'Six Sigma', description: 'Capability, measurement systems, process control, and experimental design.', overviewTopicId: 'sixSigma.overview' },
  { id: 'reportBuilder', title: 'Report Builder', description: 'Composing, refreshing, and exporting project-backed reports.', overviewTopicId: 'reportBuilder.overview' },
  { id: 'api', title: 'Perdura API', description: 'Automate individual analyses and complete stateless project runs.', overviewTopicId: 'api.overview' },
]

export const HELP_MODULE_BY_ID = new Map(HELP_MODULES.map(module => [module.id, module]))
