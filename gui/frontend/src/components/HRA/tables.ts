// Display tables for the HRA method tools. The numeric multipliers live in the
// backend (reliability.HRA, the authoritative source); these lists carry the
// keys + human labels the UI needs for its selectors. Level/id keys MUST match
// the backend tables exactly.

// ── HEART generic task types ──
export const HEART_GTT: { key: string; nominal: number; label: string }[] = [
  { key: 'A', nominal: 0.55, label: 'A — Totally unfamiliar, at speed, no idea of consequences' },
  { key: 'B', nominal: 0.26, label: 'B — Restore system, single attempt, no supervision/procedures' },
  { key: 'C', nominal: 0.16, label: 'C — Complex task, high comprehension and skill' },
  { key: 'D', nominal: 0.09, label: 'D — Fairly simple, performed rapidly or scant attention' },
  { key: 'E', nominal: 0.02, label: 'E — Routine, highly practised, low skill' },
  { key: 'F', nominal: 0.003, label: 'F — Restore system following procedures, some checking' },
  { key: 'G', nominal: 0.0004, label: 'G — Familiar, well-designed, highest standards' },
  { key: 'H', nominal: 0.00002, label: 'H — Respond correctly with automated supervisory system' },
  { key: 'M', nominal: 0.03, label: 'M — Miscellaneous (no description found)' },
]

// ── HEART error-producing conditions (id, max affect, label) ──
export const HEART_EPC: { id: number; max: number; label: string }[] = [
  { id: 1, max: 17, label: 'Unfamiliarity with a potentially important but novel situation' },
  { id: 2, max: 11, label: 'Shortage of time for error detection and correction' },
  { id: 3, max: 10, label: 'Low signal-to-noise ratio' },
  { id: 4, max: 9, label: 'Means of overriding/suppressing information too easily accessible' },
  { id: 5, max: 8, label: 'No means of conveying spatial/functional information easily' },
  { id: 6, max: 8, label: "Mismatch between operator's and designer's model of the world" },
  { id: 7, max: 8, label: 'No obvious means of reversing an unintended action' },
  { id: 8, max: 6, label: 'Channel capacity overload (simultaneous non-redundant information)' },
  { id: 9, max: 6, label: 'Need to unlearn a technique and apply an opposing philosophy' },
  { id: 10, max: 5.5, label: 'Need to transfer specific knowledge task-to-task without loss' },
  { id: 11, max: 5, label: 'Ambiguity in the required performance standards' },
  { id: 12, max: 4, label: 'Mismatch between perceived and real risk' },
  { id: 13, max: 4, label: 'Poor, ambiguous or ill-matched system feedback' },
  { id: 14, max: 4, label: 'No clear/direct/timely confirmation of an intended action' },
  { id: 15, max: 3, label: 'Operator inexperience (newly qualified but not expert)' },
  { id: 16, max: 3, label: 'Impoverished quality of information from procedures/interaction' },
  { id: 17, max: 3, label: 'Little or no independent checking or testing of output' },
  { id: 18, max: 2.5, label: 'Conflict between immediate and long-term objectives' },
  { id: 19, max: 2.5, label: 'No diversity of information input for veracity checks' },
  { id: 20, max: 2, label: 'Mismatch between educational achievement and task requirements' },
  { id: 21, max: 2, label: 'Incentive to use other, more dangerous, procedures' },
  { id: 22, max: 1.8, label: 'Little opportunity to exercise mind and body outside the job' },
  { id: 23, max: 1.6, label: 'Unreliable instrumentation (noticed)' },
  { id: 24, max: 1.6, label: 'Need for absolute judgements beyond capability/experience' },
  { id: 25, max: 1.6, label: 'Unclear allocation of function and responsibility' },
  { id: 26, max: 1.4, label: 'No obvious way to keep track of progress during an activity' },
  { id: 27, max: 1.4, label: 'Danger that finite physical capabilities will be exceeded' },
  { id: 28, max: 1.4, label: 'Little or no intrinsic meaning in a task' },
  { id: 29, max: 1.3, label: 'High-level emotional stress' },
  { id: 30, max: 1.2, label: 'Evidence of ill-health amongst operatives, especially fever' },
  { id: 31, max: 1.2, label: 'Low workforce morale' },
  { id: 32, max: 1.15, label: 'Inconsistency of meaning of displays and procedures' },
  { id: 33, max: 1.1, label: 'A poor or hostile environment' },
  { id: 34, max: 1.06, label: 'Prolonged inactivity / repetitious low mental workload' },
  { id: 35, max: 1.03, label: 'Disruption of normal work-sleep cycles' },
  { id: 36, max: 1.02, label: 'Task pacing caused by the intervention of others' },
  { id: 37, max: 1.01, label: 'Additional team members over those necessary' },
  { id: 38, max: 1.0, label: 'Age of personnel performing perceptual tasks' },
]

// ── SPAR-H PSFs. `tasks` marks levels valid only for one task type. ──
export type SparhTask = 'both' | 'diagnosis' | 'action'
export interface SparhLevel { key: string; label: string; tasks?: SparhTask }
export interface SparhPsf { key: string; label: string; levels: SparhLevel[] }

export const SPARH_PSFS: SparhPsf[] = [
  { key: 'available_time', label: 'Available time', levels: [
    { key: 'inadequate', label: 'Inadequate (guaranteed failure)' },
    { key: 'barely_adequate', label: 'Barely adequate (×10)' },
    { key: 'nominal', label: 'Nominal (×1)' },
    { key: 'extra', label: 'Extra time (×0.1)' },
    { key: 'expansive', label: 'Expansive time (×0.01)' },
  ] },
  { key: 'stress', label: 'Stress / stressors', levels: [
    { key: 'nominal', label: 'Nominal (×1)' },
    { key: 'high', label: 'High (×2)' },
    { key: 'extreme', label: 'Extreme (×5)' },
  ] },
  { key: 'complexity', label: 'Complexity', levels: [
    { key: 'obvious', label: 'Obvious diagnosis (×0.1)', tasks: 'diagnosis' },
    { key: 'nominal', label: 'Nominal (×1)' },
    { key: 'moderately_complex', label: 'Moderately complex (×2)' },
    { key: 'highly_complex', label: 'Highly complex (×5)' },
  ] },
  { key: 'experience', label: 'Experience / training', levels: [
    { key: 'high', label: 'High (×0.5)' },
    { key: 'nominal', label: 'Nominal (×1)' },
    { key: 'low', label: 'Low (×10 diagnosis / ×3 action)' },
  ] },
  { key: 'procedures', label: 'Procedures', levels: [
    { key: 'diagnostic', label: 'Diagnostic / symptom-oriented (×0.5)', tasks: 'diagnosis' },
    { key: 'nominal', label: 'Nominal (×1)' },
    { key: 'available_poor', label: 'Available but poor (×5)' },
    { key: 'incomplete', label: 'Incomplete (×20)' },
    { key: 'not_available', label: 'Not available (×50)' },
  ] },
  { key: 'ergonomics', label: 'Ergonomics / HMI', levels: [
    { key: 'good', label: 'Good (×0.5)' },
    { key: 'nominal', label: 'Nominal (×1)' },
    { key: 'poor', label: 'Poor (×10)' },
    { key: 'missing_misleading', label: 'Missing / misleading (×50)' },
  ] },
  { key: 'fitness', label: 'Fitness for duty', levels: [
    { key: 'nominal', label: 'Nominal (×1)' },
    { key: 'degraded', label: 'Degraded fitness (×5)' },
    { key: 'unfit', label: 'Unfit (guaranteed failure)' },
  ] },
  { key: 'work_processes', label: 'Work processes', levels: [
    { key: 'good', label: 'Good (×0.8 diagnosis / ×0.5 action)' },
    { key: 'nominal', label: 'Nominal (×1)' },
    { key: 'poor', label: 'Poor (×2)' },
  ] },
]

// ── CREAM common performance conditions. Each level carries its effect. ──
export interface CreamLevel { key: string; label: string; effect: 'improved' | 'not_significant' | 'reduced' }
export interface CreamCpc { key: string; label: string; levels: CreamLevel[] }

export const CREAM_CPCS: CreamCpc[] = [
  { key: 'organisation', label: 'Adequacy of organisation', levels: [
    { key: 'very_efficient', label: 'Very efficient', effect: 'improved' },
    { key: 'efficient', label: 'Efficient', effect: 'not_significant' },
    { key: 'inefficient', label: 'Inefficient', effect: 'reduced' },
    { key: 'deficient', label: 'Deficient', effect: 'reduced' },
  ] },
  { key: 'working_conditions', label: 'Working conditions', levels: [
    { key: 'advantageous', label: 'Advantageous', effect: 'improved' },
    { key: 'compatible', label: 'Compatible', effect: 'not_significant' },
    { key: 'incompatible', label: 'Incompatible', effect: 'reduced' },
  ] },
  { key: 'mmi_support', label: 'Adequacy of MMI & operational support', levels: [
    { key: 'supportive', label: 'Supportive', effect: 'improved' },
    { key: 'adequate', label: 'Adequate', effect: 'not_significant' },
    { key: 'tolerable', label: 'Tolerable', effect: 'not_significant' },
    { key: 'inappropriate', label: 'Inappropriate', effect: 'reduced' },
  ] },
  { key: 'procedures', label: 'Availability of procedures / plans', levels: [
    { key: 'appropriate', label: 'Appropriate', effect: 'improved' },
    { key: 'acceptable', label: 'Acceptable', effect: 'not_significant' },
    { key: 'inappropriate', label: 'Inappropriate', effect: 'reduced' },
  ] },
  { key: 'simultaneous_goals', label: 'Number of simultaneous goals', levels: [
    { key: 'fewer_than_capacity', label: 'Fewer than capacity', effect: 'not_significant' },
    { key: 'matching_capacity', label: 'Matching current capacity', effect: 'not_significant' },
    { key: 'more_than_capacity', label: 'More than capacity', effect: 'reduced' },
  ] },
  { key: 'available_time', label: 'Available time', levels: [
    { key: 'adequate', label: 'Adequate', effect: 'improved' },
    { key: 'temporarily_inadequate', label: 'Temporarily inadequate', effect: 'not_significant' },
    { key: 'continuously_inadequate', label: 'Continuously inadequate', effect: 'reduced' },
  ] },
  { key: 'time_of_day', label: 'Time of day (circadian rhythm)', levels: [
    { key: 'day_adjusted', label: 'Day-time / adjusted', effect: 'not_significant' },
    { key: 'night_unadjusted', label: 'Night-time / unadjusted', effect: 'reduced' },
  ] },
  { key: 'training_experience', label: 'Adequacy of training & experience', levels: [
    { key: 'adequate_high_experience', label: 'Adequate, high experience', effect: 'improved' },
    { key: 'adequate_limited_experience', label: 'Adequate, limited experience', effect: 'not_significant' },
    { key: 'inadequate', label: 'Inadequate', effect: 'reduced' },
  ] },
  { key: 'crew_collaboration', label: 'Crew collaboration quality', levels: [
    { key: 'very_efficient', label: 'Very efficient', effect: 'improved' },
    { key: 'efficient', label: 'Efficient', effect: 'not_significant' },
    { key: 'inefficient', label: 'Inefficient', effect: 'not_significant' },
    { key: 'deficient', label: 'Deficient', effect: 'reduced' },
  ] },
]

// ── Extended CREAM: cognitive activities and generic failure types ──
// (keys/ids must match the backend CREAM_ACTIVITIES / CREAM_CFP tables)
export type CogFunction = 'observation' | 'interpretation' | 'planning' | 'execution'

export const CREAM_ACTIVITIES: { key: string; label: string; functions: CogFunction[] }[] = [
  { key: 'coordinate', label: 'Co-ordinate', functions: ['planning', 'execution'] },
  { key: 'communicate', label: 'Communicate', functions: ['execution'] },
  { key: 'compare', label: 'Compare', functions: ['interpretation'] },
  { key: 'diagnose', label: 'Diagnose', functions: ['interpretation', 'planning'] },
  { key: 'evaluate', label: 'Evaluate', functions: ['interpretation', 'planning'] },
  { key: 'execute', label: 'Execute', functions: ['execution'] },
  { key: 'identify', label: 'Identify', functions: ['interpretation'] },
  { key: 'maintain', label: 'Maintain', functions: ['planning', 'execution'] },
  { key: 'monitor', label: 'Monitor', functions: ['observation', 'interpretation'] },
  { key: 'observe', label: 'Observe', functions: ['observation'] },
  { key: 'plan', label: 'Plan', functions: ['planning'] },
  { key: 'record', label: 'Record', functions: ['interpretation', 'execution'] },
  { key: 'regulate', label: 'Regulate', functions: ['observation', 'execution'] },
  { key: 'scan', label: 'Scan', functions: ['observation'] },
  { key: 'verify', label: 'Verify', functions: ['observation', 'interpretation'] },
]

export const CREAM_FAILURE_TYPES: { id: string; fn: CogFunction; label: string; nominal: number }[] = [
  { id: 'O1', fn: 'observation', label: 'Wrong object observed', nominal: 1.0e-3 },
  { id: 'O2', fn: 'observation', label: 'Wrong identification', nominal: 7.0e-2 },
  { id: 'O3', fn: 'observation', label: 'Observation not made', nominal: 7.0e-2 },
  { id: 'I1', fn: 'interpretation', label: 'Faulty diagnosis', nominal: 2.0e-1 },
  { id: 'I2', fn: 'interpretation', label: 'Decision error', nominal: 1.0e-2 },
  { id: 'I3', fn: 'interpretation', label: 'Delayed interpretation', nominal: 1.0e-2 },
  { id: 'P1', fn: 'planning', label: 'Priority error', nominal: 1.0e-2 },
  { id: 'P2', fn: 'planning', label: 'Inadequate plan', nominal: 1.0e-2 },
  { id: 'E1', fn: 'execution', label: 'Action of wrong type', nominal: 3.0e-3 },
  { id: 'E2', fn: 'execution', label: 'Action at wrong time', nominal: 3.0e-3 },
  { id: 'E3', fn: 'execution', label: 'Action on wrong object', nominal: 5.0e-4 },
  { id: 'E4', fn: 'execution', label: 'Action out of sequence', nominal: 3.0e-3 },
  { id: 'E5', fn: 'execution', label: 'Missed action', nominal: 3.0e-2 },
]

/** Format a HEP for display (scientific notation for small values). */
export function fmtHep(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—'
  if (v === 0) return '0'
  if (v >= 0.01) return v.toFixed(4)
  return v.toExponential(2)
}
