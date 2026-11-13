import type { FMEAKind, FMEAFailureChain } from '../api/reliabilityProgram'

export function createFmeaFailureChain(kind: FMEAKind, id: string): FMEAFailureChain {
  return {
    id, effect: '', failure_mode: '', cause: '', effect_level: '',
    cause_noun: '', cause_mechanism_verb: '',
    effect_contexts: [],
    severity: 5,
    occurrence: kind === 'fmea_msr' ? undefined : 5,
    detection: kind === 'fmea_msr' ? undefined : 5,
    frequency: kind === 'fmea_msr' ? 5 : undefined,
    monitoring: kind === 'fmea_msr' ? 5 : undefined,
    prevention_controls: '', detection_controls: '', severity_rationale: '',
    occurrence_rationale: '', detection_rationale: '',
    frequency_rationale: '', monitoring_rationale: '',
    actions: [], no_action_justification: '', post_severity_rationale: '',
    linked_hazard_ids: [], linked_fracas_ids: [], monitoring_system: '',
    system_response: '', safe_state: '',
    mitigated_effect: '', management_review_status: '',
    management_review_evidence_ids: [], remarks: '',
  }
}
