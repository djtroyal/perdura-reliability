/** Build identity and compatibility constants shared by diagnostics and files. */
export const APP_VERSION = __APP_VERSION__
export const APP_COMMIT = __APP_COMMIT__
export const BUILD_TIMESTAMP = __BUILD_TIMESTAMP__
export const BUILD_VERIFICATION_REPORT_SHA256 = __BUILD_VERIFICATION_REPORT_SHA256__
export const BUILD_VERIFICATION_RUN_URL = __BUILD_VERIFICATION_RUN_URL__
export const OFFICIAL_REPOSITORY = 'djtroyal/perdura-reliability'

export const PROJECT_FILE_TYPE = 'Perdura'
export const APP_SUBTITLE = 'Reliability Engineering and Statistics Suite'
export const APP_WEBSITE = 'https://perdurareliability.com'
export const PROJECT_SCHEMA_VERSION = 4

/**
 * Increment the affected key whenever an analytical implementation, equation,
 * assumption, or default changes while its persisted inputs remain compatible.
 */
export const CURRENT_ENGINE_REVISIONS: Readonly<Record<string, number>> = Object.freeze({
  lifeData: 1,
  alt: 1,
  degradation: 1,
  marginTest: 1,
  expChiSquared: 1,
  rdtBayesian: 1,
  differenceDetection: 1,
  reliabilityTestingTools: 1,
  system: 1,
  faultTree: 1,
  markov: 1,
  prediction: 1,
  pof: 1,
  growth: 1,
  softwareReliability: 1,
  reliabilityProgram: 1,
  maintenance: 1,
  ram: 1,
  maintReplacement: 1,
  maintPMInterval: 1,
  maintCostForecast: 1,
  maintAvailability: 1,
  maintVirtualAge: 1,
  hra: 1,
  hraTherp: 1,
  hraHeart: 1,
  hraSparH: 1,
  hraCream: 1,
  hraCreamExt: 1,
  hraSlim: 1,
  hraJhedi: 1,
  hraSherpa: 1,
  hraAtheana: 1,
  hraMermos: 1,
  reliabilityAllocation: 1,
  warranty: 1,
  descriptive: 1,
  hypothesis: 1,
  regression: 1,
  dataAnalysis: 1,
  dataAnalysisData: 1,
  dataModeling: 1,
  dataAnalysisFolios: 1,
  doe: 1,
  msa: 1,
  sixSigma: 1,
  'sixSigma.capability': 1,
  'sixSigma.spc': 1,
})

export function engineRevisionFor(sliceKey: string): number {
  return CURRENT_ENGINE_REVISIONS[sliceKey] ?? 1
}
