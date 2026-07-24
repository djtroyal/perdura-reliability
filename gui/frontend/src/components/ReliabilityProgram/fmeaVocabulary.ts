import type {
  FMEAKind,
  FMEAVocabularyDomain,
  FMEAVocabularyProfile,
  FMEAVocabularyTerm,
} from '../../api/reliabilityProgram'


type TermSeed = Omit<FMEAVocabularyTerm, 'id'|'domain'|'built_in'|'source'>

const SOURCE_FUNCTIONAL_BASIS =
  'Perdura-curated from the NIST Reconciled Functional Basis and systems-engineering usage.'
const SOURCE_FMEA =
  'Perdura-curated FMEA semantic aid; apply organization and customer rules where required.'

export const FUNCTION_RELATIONSHIPS = [
  'to',
  'from',
  'into',
  'through',
  'across',
  'within',
  'against',
  'between',
  'at',
  'on',
  'with',
  'for',
  'via',
  'over',
  'under',
  'around',
  'using',
  'in response to',
] as const

const term = (
  domain: FMEAVocabularyDomain,
  label: string,
  category: string,
  definition: string,
  selectionQuestion: string,
  useWhen: string,
  avoidWhen: string,
  aliases: string[] = [],
  examples: string[] = [],
  applicability: FMEAVocabularyTerm['applicability'] = ['all'],
  source = SOURCE_FMEA,
): FMEAVocabularyTerm => ({
  id: `${domain}:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  domain,
  label,
  category,
  definition,
  selection_question: selectionQuestion,
  use_when: useWhen,
  avoid_when: avoidWhen,
  aliases,
  examples,
  applicability,
  source,
  built_in: true,
})

const functionTerm = (
  label: string,
  category: string,
  definition: string,
  selectionQuestion: string,
  useWhen: string,
  avoidWhen: string,
  aliases: string[] = [],
  examples: string[] = [],
): FMEAVocabularyTerm => term(
  'function_verb', label, category, definition, selectionQuestion,
  useWhen, avoidWhen, aliases, examples, ['all'], SOURCE_FUNCTIONAL_BASIS,
)

export const FUNCTION_VERBS: FMEAVocabularyTerm[] = [
  functionTerm('Divide', 'Branching', 'Split one substantially uniform flow into multiple outputs.', 'Is one input being split without classifying its contents?', 'A single flow is apportioned into two or more paths.', 'Use Separate when constituents are distinguished by a property.', ['split', 'apportion'], ['Divide hydraulic flow']),
  functionTerm('Separate', 'Branching', 'Distinguish and remove constituents from a mixed flow by a property.', 'Are constituents being selected, filtered, or removed?', 'Filtering, sorting, extracting, or rejecting part of a mixture.', 'Use Divide when every output remains substantially equivalent.', ['filter', 'sort', 'extract', 'remove'], ['Separate particulates']),
  functionTerm('Distribute', 'Branching', 'Deliver a flow among multiple intended recipients or locations.', 'Is one resource being allocated among several destinations?', 'Power, material, or information is allocated to several consumers.', 'Use Divide for the split operation alone; use Supply for availability at one boundary.', ['allocate', 'fan out'], ['Distribute electrical power']),
  functionTerm('Combine', 'Branching', 'Merge multiple flows into one without requiring a homogeneous mixture.', 'Are multiple inputs becoming one output path or collection?', 'Signals, loads, or streams are brought together.', 'Use Mix when interspersing constituents is the intended result; use Join for a durable connection.', ['merge', 'aggregate'], ['Combine sensor signals']),
  functionTerm('Mix', 'Branching', 'Intersperse two or more material flows to achieve a specified mixture.', 'Is mixture uniformity or composition the intended result?', 'Material constituents must be blended.', 'Use Combine when only merging paths or information.', ['blend', 'stir'], ['Mix fuel and air']),
  functionTerm('Import', 'Movement', 'Admit a flow across the analyzed boundary.', 'Is the function defined from the receiving boundary’s perspective?', 'The subject obtains energy, material, or information from outside its boundary.', 'Use Transfer for movement inside the boundary or Supply for making a resource available.', ['receive', 'admit', 'intake', 'acquire'], ['Import command data']),
  functionTerm('Export', 'Movement', 'Release a flow across the analyzed boundary.', 'Is the function defined from the sending boundary’s perspective?', 'The subject emits or discharges a flow outside its boundary.', 'Use Transfer for internal movement or Supply for service availability.', ['emit', 'discharge', 'output'], ['Export status data']),
  functionTerm('Transfer', 'Movement', 'Move a flow between locations without intentionally changing its identity.', 'Is the intended result movement from one location to another?', 'Transporting, conveying, routing, or transmitting a flow.', 'Use Guide when only constraining the path; use Convert when changing domains.', ['transport', 'convey', 'route', 'transmit', 'pump'], ['Transfer coolant']),
  functionTerm('Guide', 'Movement', 'Constrain the path, orientation, or direction of a moving flow or body.', 'Is the path being constrained rather than the flow being moved?', 'A channel, bearing, rail, or logic path directs movement.', 'Use Transfer when providing the motive movement.', ['direct', 'steer', 'align'], ['Guide cable travel']),
  functionTerm('Join', 'Connection', 'Establish an intended physical or logical connection between entities.', 'Is creating or maintaining the connection itself the function?', 'Assembly, coupling, bonding, or logical linkage is required.', 'Use Combine for flows and Secure when preventing unintended separation or motion.', ['assemble', 'couple', 'bond', 'link'], ['Join housing halves']),
  functionTerm('Disconnect', 'Connection', 'Remove an established physical or logical connection.', 'Is deliberate separation of a connection the intended function?', 'Isolation, service, switching, or release requires breaking a connection.', 'Use Interrupt when stopping a flow without removing the connection.', ['decouple', 'unlink', 'detach'], ['Disconnect battery circuit']),
  functionTerm('Actuate', 'Magnitude and state control', 'Initiate a commanded physical action or state change.', 'Does a command cause a mechanism to act?', 'A control input initiates movement or physical switching.', 'Use Command for issuing the instruction or Position for the resulting location.', ['drive', 'trigger'], ['Actuate brake valve']),
  functionTerm('Increase', 'Magnitude and state control', 'Raise a specified measurable magnitude.', 'Must a named quantity become greater?', 'Amplification, pressurization, heating, charging, or acceleration is required.', 'Use Regulate when maintaining a target over disturbances.', ['amplify', 'boost', 'raise', 'heat', 'pressurize'], ['Increase fluid pressure']),
  functionTerm('Decrease', 'Magnitude and state control', 'Lower a specified measurable magnitude.', 'Must a named quantity become smaller?', 'Attenuation, cooling, depressurization, braking, or discharge is required.', 'Use Interrupt for stopping flow or Regulate for target maintenance.', ['attenuate', 'reduce', 'lower', 'cool', 'depressurize'], ['Decrease component temperature']),
  functionTerm('Regulate', 'Magnitude and state control', 'Maintain a variable near a specified target despite disturbances.', 'Must the function hold a quantity within limits over time?', 'Closed-loop or passive regulation maintains a target.', 'Use Increase or Decrease for a one-direction change; use Condition for a broader property change.', ['maintain', 'stabilize value'], ['Regulate output voltage']),
  functionTerm('Condition', 'Magnitude and state control', 'Change a flow property within its domain to meet an acceptance condition.', 'Is quality, form, or compatibility being adjusted without changing domains?', 'Shaping, cleaning, formatting, lubricating, or treating a flow.', 'Use Convert when the output belongs to a different energy, material, or information domain.', ['shape', 'treat', 'format', 'clean', 'lubricate'], ['Condition sensor signal']),
  functionTerm('Permit', 'Magnitude and state control', 'Selectively allow a flow, action, or state transition.', 'Is the function to enable something only under allowed conditions?', 'A valve, interlock, or authorization allows operation.', 'Use Interrupt for active blocking and Supply for providing the resource.', ['allow', 'enable', 'authorize', 'open'], ['Permit coolant flow']),
  functionTerm('Interrupt', 'Magnitude and state control', 'Stop or block a flow, action, or state transition.', 'Is the function to prevent continuation under specified conditions?', 'A switch, valve, interlock, or rule stops operation.', 'Use Disconnect when removing the connection itself or Protect for damage limitation.', ['stop', 'block', 'inhibit', 'prevent', 'close'], ['Interrupt fault current']),
  functionTerm('Convert', 'Conversion and provision', 'Change a flow from one physical or informational domain into another.', 'Does the output have a different fundamental domain or representation?', 'Energy conversion, transduction, encoding, or decoding is intended.', 'Use Condition for changes within the same domain.', ['transform', 'transduce', 'encode', 'decode'], ['Convert pressure to voltage']),
  functionTerm('Generate', 'Conversion and provision', 'Create a new usable resource or informational artifact.', 'Is the resource created rather than merely made available?', 'Energy, pressure, motion, timing, or data is produced.', 'Use Supply when an existing resource is delivered and Compute for derived information.', ['create', 'produce'], ['Generate reference clock']),
  functionTerm('Store', 'Conversion and provision', 'Retain a flow or state for later use.', 'Must the resource remain available after its arrival or creation?', 'Energy, material, data, or state is held over time.', 'Use Contain when preventing physical escape is the primary intent.', ['hold', 'accumulate', 'collect'], ['Store configuration data']),
  functionTerm('Supply', 'Conversion and provision', 'Make an existing resource available at an intended boundary or consumer.', 'Is service availability at the recipient the intended result?', 'Power, material, pressure, or data service is provided.', 'Use Generate for creating the resource, Transfer for movement, or Distribute for multiple recipients.', ['provide', 'feed', 'deliver'], ['Supply actuator power']),
  functionTerm('Sense', 'Information and control', 'Acquire a representation of a physical or logical condition.', 'Must a condition become available as a signal?', 'A sensor or observer acquires a condition without necessarily quantifying it.', 'Use Detect for a classified presence/state or Measure for a numerical value.', ['perceive', 'observe'], ['Sense shaft position']),
  functionTerm('Measure', 'Information and control', 'Determine a numerical value and unit for a property.', 'Is a quantitative result required?', 'The function returns a magnitude, count, duration, or location.', 'Use Detect for a categorical result or Sense for raw acquisition.', ['quantify', 'meter'], ['Measure discharge pressure']),
  functionTerm('Detect', 'Information and control', 'Determine whether a defined condition, object, or event is present.', 'Is the required output a presence, absence, or classified state?', 'Fault, threshold, state, or object recognition is required.', 'Use Measure when a numerical value is required or Diagnose when inferring a cause.', ['recognize', 'discover'], ['Detect overtemperature condition']),
  functionTerm('Monitor', 'Information and control', 'Repeatedly observe a condition over time for change or limit violation.', 'Must the condition be watched continuously or periodically?', 'Trend, health, or limit surveillance is required.', 'Use Sense for a single acquisition and Detect for one classification event.', ['watch', 'track', 'surveil'], ['Monitor battery health']),
  functionTerm('Compare', 'Information and control', 'Determine the relationship between two or more values or states.', 'Is the output based on equality, order, difference, or conformance?', 'Values are checked against each other, a reference, or a limit.', 'Use Decide when selecting an action from the comparison.', ['check against', 'correlate'], ['Compare pressure to limit']),
  functionTerm('Compute', 'Information and control', 'Derive new information through a defined mathematical or logical transformation.', 'Is a new value derived from existing information?', 'Calculation, estimation, aggregation, or algorithmic transformation is required.', 'Use Decide when the result is a selected course or state.', ['calculate', 'estimate', 'derive'], ['Compute control demand']),
  functionTerm('Decide', 'Information and control', 'Select an outcome, state, or course of action using defined criteria.', 'Must one alternative be selected from evaluated information?', 'Logic chooses a mode, route, response, or authorization.', 'Use Compare for the relational evaluation or Command for issuing the selected action.', ['select', 'determine action', 'arbitrate'], ['Decide recovery mode']),
  functionTerm('Command', 'Information and control', 'Issue an instruction that requests a defined action or state.', 'Is an instruction sent to another function or element?', 'Control logic directs an actuator, subsystem, or operator.', 'Use Actuate for executing the physical action or Indicate for informational presentation.', ['instruct', 'request'], ['Command valve closure']),
  functionTerm('Indicate', 'Information and control', 'Present status or information to an intended observer.', 'Must a person or system be informed without commanding an action?', 'Display, annunciation, notification, or status reporting is required.', 'Use Command when requesting action or Record for persistent retention.', ['display', 'annunciate', 'notify', 'report'], ['Indicate system status']),
  functionTerm('Record', 'Information and control', 'Create a persistent representation of information or an event.', 'Must information remain available as evidence or history?', 'Logging, tracing, or recording is the intended result.', 'Use Store for retaining an existing resource or Indicate for immediate presentation.', ['log', 'document'], ['Record fault history']),
  functionTerm('Retrieve', 'Information and control', 'Access previously stored information or state.', 'Is retained information being made available for current use?', 'Configuration, history, or stored values are read from retention.', 'Use Import for crossing the analyzed boundary.', ['read back', 'recall'], ['Retrieve calibration data']),
  functionTerm('Diagnose', 'Information and control', 'Infer a fault, condition, or cause from observations and rules.', 'Must evidence be interpreted to identify what is wrong?', 'Troubleshooting, isolation, or health assessment is required.', 'Use Detect for presence alone or Decide for selecting a response.', ['isolate fault', 'identify cause', 'troubleshoot'], ['Diagnose sensor failure']),
  functionTerm('Position', 'Physical support and barriers', 'Place or maintain an entity at a specified location or orientation.', 'Is location or orientation the required outcome?', 'Translation, rotation, alignment, or placement is intended.', 'Use Guide for constraining motion or Secure for preventing unintended motion.', ['locate', 'orient', 'translate', 'rotate'], ['Position control surface']),
  functionTerm('Support', 'Physical support and barriers', 'Carry an intended mechanical load while preserving required geometry.', 'Is load-bearing the primary function?', 'A frame, bracket, bearing, or foundation carries load.', 'Use Stabilize for limiting unwanted variation or Secure for retention.', ['carry load', 'bear'], ['Support pump assembly']),
  functionTerm('Stabilize', 'Physical support and barriers', 'Limit unintended motion, oscillation, or variation of an entity.', 'Is reducing unwanted physical variation the intended result?', 'Damping, balancing, or bracing maintains physical steadiness.', 'Use Regulate for a measured process variable or Secure for retention.', ['damp', 'brace', 'balance'], ['Stabilize optical platform']),
  functionTerm('Secure', 'Physical support and barriers', 'Prevent unintended separation, access, or movement.', 'Must an entity remain attached, closed, or inaccessible?', 'Fastening, latching, locking, or retention is required.', 'Use Join to establish the connection or Stabilize to reduce variation.', ['fasten', 'retain', 'lock', 'latch'], ['Secure connector']),
  functionTerm('Contain', 'Physical support and barriers', 'Keep a material or energy within a defined physical boundary.', 'Is preventing escape from an enclosure the primary intent?', 'Fluid, pressure, radiation, debris, or stored energy must remain bounded.', 'Use Store when availability for later use is primary or Isolate to prevent interaction.', ['hold within', 'confine'], ['Contain hydraulic fluid']),
  functionTerm('Isolate', 'Physical support and barriers', 'Prevent an unintended interaction or propagation between entities.', 'Must two domains remain separated from each other?', 'Electrical, thermal, vibration, contamination, or fault isolation is required.', 'Use Contain for keeping something inside a boundary or Protect for limiting damage to a target.', ['insulate', 'decouple from', 'shield from'], ['Isolate chassis vibration']),
  functionTerm('Protect', 'Physical support and barriers', 'Keep a target within acceptable damage or exposure limits.', 'Is the intended outcome avoidance or limitation of harm?', 'Protection from overload, contamination, impact, environment, or misuse is required.', 'Use Isolate when preventing interaction itself is the function or Interrupt when stopping a flow.', ['guard', 'safeguard', 'limit damage'], ['Protect operator']),
]

export const FAILURE_DEVIATIONS: FMEAVocabularyTerm[] = [
  term('failure_deviation', 'Absent', 'Availability', 'The intended function is not provided.', 'Is the function completely unavailable?', 'No useful output occurs when demanded.', 'Use Insufficient when some useful function remains.', ['lost', 'missing', 'no function'], ['No pressure output']),
  term('failure_deviation', 'Insufficient', 'Magnitude', 'The function is provided below its required magnitude, quality, or capacity.', 'Is useful output present but below requirement?', 'Partial, weak, degraded, or low output remains.', 'Use Intermittent for a time-varying loss.', ['partial', 'degraded', 'too little', 'low'], ['Insufficient clamping force']),
  term('failure_deviation', 'Excessive', 'Magnitude', 'The function exceeds its required magnitude, quality, or capacity.', 'Is the output above an allowed maximum?', 'Too much, high, or over-range output occurs.', 'Use Unintended when the function should not occur at all.', ['too much', 'high', 'over'], ['Excessive output voltage']),
  term('failure_deviation', 'Intermittent', 'Continuity', 'The function alternates unpredictably between acceptable and unacceptable states.', 'Does the function come and go over time?', 'Dropouts, flicker, unstable availability, or sporadic operation occurs.', 'Use Absent for sustained complete loss.', ['sporadic', 'erratic', 'unstable'], ['Intermittent status signal']),
  term('failure_deviation', 'Unintended', 'Command', 'The function occurs when it was not requested or permitted.', 'Does the function occur without a valid demand?', 'Spurious, inadvertent, or unauthorized operation occurs.', 'Use Early or Late when a valid demand exists but timing is wrong.', ['spurious', 'inadvertent', 'unexpected'], ['Unintended actuator motion']),
  term('failure_deviation', 'Early', 'Timing', 'The function occurs before its permitted or required time.', 'Does a valid function begin too soon?', 'Premature timing is the failure behavior.', 'Use Unintended when no valid demand exists.', ['premature', 'too soon'], ['Early valve opening']),
  term('failure_deviation', 'Late', 'Timing', 'The function occurs after its required time or response interval.', 'Does a valid function begin too late?', 'Delayed response or excessive latency is the failure behavior.', 'Use Fails to start when it never begins.', ['delayed', 'too late'], ['Late protective response']),
  term('failure_deviation', 'Wrong value or state', 'Correctness', 'The function produces an incorrect value, classification, identity, or state.', 'Is output present at the wrong value or in the wrong state?', 'Bias, corruption, misclassification, or wrong selection occurs.', 'Use Insufficient or Excessive when the error is solely magnitude.', ['incorrect', 'biased', 'corrupt', 'wrong output'], ['Wrong pressure indication']),
  term('failure_deviation', 'Wrong direction', 'Direction', 'The function acts or moves in the opposite or otherwise incorrect direction.', 'Is direction incorrect while action still occurs?', 'Reversal, swapped polarity, or misrouting occurs.', 'Use Wrong sequence for correct actions in the wrong order.', ['reversed', 'opposite'], ['Wrong actuator direction']),
  term('failure_deviation', 'Wrong sequence', 'Sequence', 'Functions or states occur in an incorrect order.', 'Are the right actions occurring in the wrong order?', 'Ordering, phasing, or coordination is incorrect.', 'Use Early or Late when only timing of one action is wrong.', ['out of sequence', 'misordered'], ['Wrong startup sequence']),
  term('failure_deviation', 'Fails to start', 'Transition', 'The function cannot enter its required active state following a valid demand.', 'Does the requested function never begin?', 'Startup, engagement, or initialization fails.', 'Use Absent when transition behavior is not important.', ['will not start', 'fails to engage'], ['Pump fails to start']),
  term('failure_deviation', 'Fails to stop', 'Transition', 'The function cannot leave its active state following a valid stop condition.', 'Does the function continue after it should cease?', 'Shutdown, disengagement, or reset fails.', 'Use Unintended when operation begins without demand.', ['will not stop', 'fails to disengage'], ['Motor fails to stop']),
]

export const EFFECT_LEVELS: FMEAVocabularyTerm[] = [
  term('effect_level', 'Focus / local', 'Effect hierarchy', 'Effect on the element or process step being analyzed.', 'What happens at the focus element itself?', 'Recording immediate local consequences.', 'Do not substitute this for the next-higher or end effect.', ['local', 'focus element', 'work element'], ['Connector contact becomes open']),
  term('effect_level', 'Next higher level', 'Effect hierarchy', 'Effect on the parent assembly, next process, or immediate downstream consumer.', 'What does the next level experience?', 'Tracing propagation beyond the focus element.', 'Use System / end user for the final mission, customer, or user consequence.', ['next higher', 'next process', 'downstream'], ['Controller loses pressure feedback']),
  term('effect_level', 'System / end user', 'Effect hierarchy', 'Final effect on system behavior, mission, customer, operator, or public.', 'What is the ultimate externally meaningful consequence?', 'Recording the end effect used for severity assessment.', 'Do not use for an intermediate propagation statement.', ['end effect', 'customer', 'end user', 'mission'], ['Required pumping function is lost']),
]

export const PREVENTION_CONTROLS: FMEAVocabularyTerm[] = [
  term('prevention_control', 'Requirement or design rule', 'Prevention', 'A specified design or process rule prevents the cause.', 'Does an explicit rule constrain the design or process?', 'Standards, design rules, tolerances, and prohibited combinations.', 'Use Margin or derating when quantitative stress margin is the mechanism.', ['design rule', 'standard'], ['Minimum creepage rule']),
  term('prevention_control', 'Margin or derating', 'Prevention', 'Quantified capability-to-demand margin reduces cause occurrence.', 'Is stress or capability margin the preventive mechanism?', 'Load, temperature, voltage, strength, or timing margins are controlled.', 'Use Requirement or design rule for a non-quantitative constraint.', ['design margin', 'derating'], ['Voltage derating']),
  term('prevention_control', 'Mistake-proofing', 'Prevention', 'Physical or logical design prevents an incorrect action or assembly.', 'Can the error be made impossible or self-correcting?', 'Keying, interlocks, constrained workflows, and poka-yoke.', 'Use Process parameter control when variation remains possible but controlled.', ['error proofing', 'poka-yoke', 'keying'], ['Keyed connector']),
  term('prevention_control', 'Process parameter control', 'Prevention', 'A controlled process parameter prevents creation of the cause.', 'Is a process input kept within a validated window?', 'Torque, time, temperature, pressure, or recipe controls.', 'Use Inspection or measurement under detection controls when only discovering defects.', ['process control', 'recipe control'], ['Controlled solder profile']),
  term('prevention_control', 'Material or supplier control', 'Prevention', 'Material definition, qualification, or supplier controls prevent the cause.', 'Is incoming material or supplier capability the preventive mechanism?', 'Approved sources, specifications, qualification, and lot controls.', 'Use Inspection or measurement if the control merely screens incoming product.', ['supplier control', 'material control', 'qualification'], ['Qualified contact plating']),
  term('prevention_control', 'Maintenance or life management', 'Prevention', 'Planned service, replacement, or life limits prevent the cause from developing.', 'Is degradation prevented through scheduled intervention?', 'Lubrication, replacement limits, calibration, or preventive maintenance.', 'Use Monitoring or diagnostics when discovering degradation rather than preventing it.', ['preventive maintenance', 'life limit'], ['Scheduled seal replacement']),
]

export const DETECTION_CONTROLS: FMEAVocabularyTerm[] = [
  term('detection_control', 'Analysis or review', 'Detection', 'Analytical evaluation or independent review detects a weakness before release.', 'Is the weakness found through calculation, modeling, or review?', 'Design analysis, simulation, checklist, peer review, or digital verification.', 'Use Test when physical or executable evidence is exercised.', ['review', 'simulation', 'calculation'], ['Tolerance-stack analysis']),
  term('detection_control', 'Inspection', 'Detection', 'Observation detects a visible, dimensional, or documentary nonconformance.', 'Is conformance assessed primarily by examination?', 'Visual, dimensional, optical, or record inspection.', 'Use Measurement or test when performance is exercised or quantitatively measured.', ['visual inspection', 'audit inspection'], ['Automated optical inspection']),
  term('detection_control', 'Measurement or test', 'Detection', 'Measurement or stimulus-response testing detects nonconformance.', 'Is a characteristic measured or function exercised?', 'Bench, in-process, end-of-line, or acceptance test.', 'Use Monitoring or diagnostics for continuing operational surveillance.', ['functional test', 'measurement', 'screening'], ['End-of-line pressure test']),
  term('detection_control', 'Monitoring or diagnostics', 'Detection', 'Operational surveillance or diagnostics detects a developing or present fault.', 'Is detection performed during use or continued operation?', 'Built-in test, condition monitoring, alarms, or diagnostics.', 'Use Measurement or test for a discrete production or verification event.', ['monitoring', 'diagnostics', 'built-in test'], ['Continuity monitoring']),
  term('detection_control', 'Audit or validation', 'Detection', 'Independent process audit or validation activity detects systemic nonconformance.', 'Is detection based on independent confirmation of the process or outcome?', 'Layered audits, validation runs, certification checks, and process audits.', 'Use Inspection for an individual item.', ['audit', 'validation'], ['Layered process audit']),
]

export const VERIFICATION_METHODS: FMEAVocabularyTerm[] = [
  term('verification_method', 'Inspection', 'Verification', 'Verify by visual, dimensional, documentary, or configuration examination.', 'Can conformance be established without exercising operation?', 'Physical attributes, records, drawings, and configuration are examined.', 'Use Test when operation must be stimulated.', ['examination'], ['Drawing and configuration inspection']),
  term('verification_method', 'Analysis', 'Verification', 'Verify using calculations, models, simulation, or reasoned evaluation.', 'Can conformance be demonstrated analytically from accepted evidence?', 'Direct test is impractical or analysis is the defined method.', 'Use Similarity when compliance rests primarily on a qualified predecessor.', ['calculation', 'simulation'], ['Thermal margin analysis']),
  term('verification_method', 'Demonstration', 'Verification', 'Verify by qualitative operation under representative conditions without precision measurement.', 'Can observable operation demonstrate compliance?', 'A capability or sequence is shown directly.', 'Use Test when measured acceptance limits determine pass/fail.', ['demonstrate'], ['Demonstrate maintenance access']),
  term('verification_method', 'Test', 'Verification', 'Verify by controlled stimulus and measured response against acceptance criteria.', 'Must performance be exercised and measured?', 'Quantitative operational evidence is required.', 'Use Demonstration when observation alone is sufficient.', ['testing'], ['Environmental qualification test']),
  term('verification_method', 'Similarity', 'Verification', 'Verify through justified equivalence to a previously verified item or configuration.', 'Is compliance inherited from a demonstrably equivalent predecessor?', 'Design, application, and environment differences are bounded and documented.', 'Use Analysis when equivalence requires substantial new modeling.', ['heritage', 'qualification by similarity'], ['Similarity to qualified connector']),
  term('verification_method', 'Certification or audit', 'Verification', 'Verify through an authorized certification, audit, or controlled compliance record.', 'Is authorized independent attestation the acceptance basis?', 'Regulatory, supplier, process, or quality-system evidence governs.', 'Use Inspection for direct examination without formal attestation.', ['certification', 'audit'], ['Supplier process certification']),
]

export const OPERATING_MODES: FMEAVocabularyTerm[] = [
  term('operating_mode', 'Normal operation', 'Use state', 'Intended steady-state operation within the declared mission profile.', 'Is the system performing its primary mission normally?', 'Ordinary active use.', 'Use Degraded / emergency when capability or configuration is abnormal.', ['normal', 'operating'], []),
  term('operating_mode', 'Startup', 'Transition', 'Transition from an inactive or uninitialized state into operation.', 'Is the function evaluated while becoming operational?', 'Initialization, energization, warm-up, or launch.', 'Use Normal operation after the transition is complete.', ['start', 'initialization'], []),
  term('operating_mode', 'Shutdown', 'Transition', 'Controlled transition from operation into an inactive state.', 'Is the function evaluated while ceasing operation?', 'Power-down, isolation, cooldown, or safing.', 'Use Dormant after shutdown is complete.', ['stop', 'power-down'], []),
  term('operating_mode', 'Standby', 'Use state', 'Powered or ready state awaiting demand with limited active function.', 'Must the system remain ready without performing its full mission?', 'Hot standby, ready reserve, or idle powered state.', 'Use Dormant when not powered or not immediately ready.', ['idle', 'ready'], []),
  term('operating_mode', 'Degraded / emergency', 'Abnormal state', 'Intended reduced-capability or emergency response configuration.', 'Is the system deliberately operating with reduced or emergency capability?', 'Fallback, limp-home, safe-state, or emergency operation.', 'Do not use for an uncontrolled failed condition.', ['degraded', 'emergency', 'fallback'], []),
  term('operating_mode', 'Maintenance', 'Support state', 'Inspection, service, repair, calibration, or maintenance operation.', 'Are people or support equipment interacting for service?', 'Scheduled or corrective service activities.', 'Use Storage when no servicing occurs.', ['service', 'calibration'], []),
  term('operating_mode', 'Storage', 'Non-operating state', 'Retained non-operating condition in a controlled or declared storage environment.', 'Is the item packaged or retained before future use?', 'Warehouse, shelf, or preserved storage.', 'Use Transport when movement and handling loads apply.', ['stored'], []),
  term('operating_mode', 'Transport', 'Non-operating state', 'Movement, shipment, or handling outside intended operation.', 'Are transportation and handling conditions applicable?', 'Shipping, lifting, carrying, or installed transport.', 'Use Normal operation for mission movement by the operating system itself.', ['shipping', 'handling'], []),
  term('operating_mode', 'Dormant', 'Non-operating state', 'Installed or available but inactive for an extended period.', 'Is the item inactive in place while awaiting future demand?', 'Cold standby, lay-up, or dormant exposure.', 'Use Standby when powered or immediately ready.', ['non-operating', 'cold standby'], []),
]

export const BUILTIN_FMEA_VOCABULARY: FMEAVocabularyTerm[] = [
  ...FUNCTION_VERBS,
  ...FAILURE_DEVIATIONS,
  ...EFFECT_LEVELS,
  ...PREVENTION_CONTROLS,
  ...DETECTION_CONTROLS,
  ...VERIFICATION_METHODS,
  ...OPERATING_MODES,
]

export const EMPTY_FMEA_VOCABULARY_PROFILE: FMEAVocabularyProfile = {
  version: 1,
  custom_terms: [],
  custom_aliases: [],
}

export const AMBIGUOUS_FUNCTION_WORDS: Record<string, string[]> = {
  control: ['function_verb:regulate', 'function_verb:command', 'function_verb:actuate'],
  process: ['function_verb:condition', 'function_verb:convert', 'function_verb:compute'],
  test: ['function_verb:detect', 'function_verb:measure', 'function_verb:compare'],
  handle: ['function_verb:transfer', 'function_verb:guide', 'function_verb:condition'],
  manage: ['function_verb:regulate', 'function_verb:decide', 'function_verb:command'],
  verify: ['function_verb:detect', 'function_verb:measure', 'function_verb:compare'],
}

export function normalizeVocabulary(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function vocabularyEditDistance(left: string, right: string): number {
  const rows = left.length + 1
  const columns = right.length + 1
  const distance = Array.from(
    { length: rows },
    (_, row) => Array.from(
      { length: columns },
      (_, column) => row === 0 ? column : column === 0 ? row : 0,
    ),
  )
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitution = left[row - 1] === right[column - 1] ? 0 : 1
      distance[row][column] = Math.min(
        distance[row - 1][column] + 1,
        distance[row][column - 1] + 1,
        distance[row - 1][column - 1] + substitution,
      )
      if (
        row > 1
        && column > 1
        && left[row - 1] === right[column - 2]
        && left[row - 2] === right[column - 1]
      ) {
        distance[row][column] = Math.min(
          distance[row][column],
          distance[row - 2][column - 2] + 1,
        )
      }
    }
  }
  return distance[left.length][right.length]
}

export function closestVocabularyValue(
  value: string,
  candidates: string[],
): string | undefined {
  const normalized = normalizeVocabulary(value)
  if (normalized.length < 3) return undefined
  const ranked = [...new Set(candidates.map(candidate => candidate.trim())
    .filter(Boolean))]
    .map(candidate => {
      const candidateValue = normalizeVocabulary(candidate)
      const longest = Math.max(normalized.length, candidateValue.length)
      const distance = vocabularyEditDistance(normalized, candidateValue)
      const allowedDistance = longest <= 4
        ? 1
        : longest <= 10
          ? 2
          : Math.max(2, Math.floor(longest * 0.15))
      return {
        candidate,
        candidateValue,
        distance,
        eligible: distance <= allowedDistance
          && (longest - distance) / longest >= 0.75,
      }
    })
    .filter(item =>
      item.eligible
      && item.candidate.trim() !== value.trim())
    .sort((a, b) =>
      a.distance - b.distance
      || a.candidateValue.length - b.candidateValue.length
      || a.candidate.localeCompare(b.candidate))
  if (!ranked.length) return undefined
  if (
    ranked[1]
    && ranked[0].distance === ranked[1].distance
    && ranked[0].candidateValue !== ranked[1].candidateValue
  ) return undefined
  return ranked[0].candidate
}

export function vocabularyTerms(
  profile: FMEAVocabularyProfile | undefined,
  domain?: FMEAVocabularyDomain,
  kind?: FMEAKind,
): FMEAVocabularyTerm[] {
  const customAliases = profile?.custom_aliases ?? []
  const values = [...BUILTIN_FMEA_VOCABULARY, ...(profile?.custom_terms ?? [])]
    .filter(value => !domain || value.domain === domain)
    .filter(value => !kind || value.applicability.includes('all')
      || value.applicability.includes(kind))
    .map(value => ({
      ...value,
      aliases: [
        ...value.aliases,
        ...customAliases.filter(alias => alias.term_id === value.id)
          .map(alias => alias.value),
      ],
    }))
  return values.sort((a, b) =>
    a.category.localeCompare(b.category) || a.label.localeCompare(b.label))
}

export type FunctionVocabularyMatch = {
  status: 'canonical'|'alias'|'ambiguous'|'custom'
  term?: FMEAVocabularyTerm
  candidates: FMEAVocabularyTerm[]
  leading: string
}

export function classifyFunctionStatement(
  value: string,
  profile?: FMEAVocabularyProfile,
): FunctionVocabularyMatch {
  const normalizedStatement = normalizeVocabulary(value)
  const leading = normalizedStatement.split(' ')[0] ?? ''
  if (!leading) return { status: 'custom', candidates: [], leading }
  const terms = vocabularyTerms(profile, 'function_verb')
  const possible = terms.flatMap(item => [
    { term: item, value: normalizeVocabulary(item.label), canonical: true },
    ...item.aliases.map(alias => ({
      term: item, value: normalizeVocabulary(alias), canonical: false,
    })),
  ]).filter(item =>
    normalizedStatement === item.value
    || normalizedStatement.startsWith(`${item.value} `))
    .sort((a, b) => b.value.length - a.value.length)
  const matched = possible[0]
  if (matched?.canonical) {
    return {
      status: 'canonical',
      term: matched.term,
      candidates: [matched.term],
      leading: matched.value,
    }
  }
  if (matched) {
    return {
      status: 'alias',
      term: matched.term,
      candidates: [matched.term],
      leading: matched.value,
    }
  }
  const candidates = (AMBIGUOUS_FUNCTION_WORDS[leading] ?? [])
    .map(id => terms.find(item => item.id === id))
    .filter((item): item is FMEAVocabularyTerm => Boolean(item))
  if (candidates.length) return { status: 'ambiguous', candidates, leading }
  return { status: 'custom', candidates: [], leading }
}

export function splitFunctionDefinition(
  statement: string,
  profile?: FMEAVocabularyProfile,
): { verb: string; what: string; relationship: string; target: string } {
  const words = statement.trim().split(/\s+/).filter(Boolean)
  if (!words.length) {
    return { verb: '', what: '', relationship: '', target: '' }
  }
  const match = classifyFunctionStatement(statement, profile)
  const leadingWords = Math.max(
    1, match.leading.trim().split(/\s+/).filter(Boolean).length)
  const remainder = words.slice(leadingWords)
  const normalizedRemainder = remainder.map(word => word.toLocaleLowerCase())
  const relationships = FUNCTION_RELATIONSHIPS
    .map(value => ({ value, words: value.split(' ') }))
    .sort((a, b) => b.words.length - a.words.length)
  let relationshipIndex = -1
  let relationship = ''
  let relationshipWords = 0
  for (let index = 1; index < remainder.length - 1; index += 1) {
    const found = relationships.find(candidate =>
      candidate.words.every((word, offset) =>
        normalizedRemainder[index + offset] === word)
      && index + candidate.words.length < remainder.length)
    if (found) {
      relationshipIndex = index
      relationship = found.value
      relationshipWords = found.words.length
      break
    }
  }
  return {
    verb: words.slice(0, leadingWords).join(' '),
    what: (relationshipIndex >= 0
      ? remainder.slice(0, relationshipIndex)
      : remainder).join(' '),
    relationship,
    target: relationshipIndex >= 0
      ? remainder.slice(relationshipIndex + relationshipWords).join(' ')
      : '',
  }
}

export function splitFunctionStatement(
  statement: string,
  profile?: FMEAVocabularyProfile,
): { verb: string; object: string } {
  const { verb, what, relationship, target } =
    splitFunctionDefinition(statement, profile)
  return {
    verb,
    object: [
      what,
      target ? `${relationship || 'to'} ${target}` : '',
    ].filter(Boolean).join(' '),
  }
}

export function composeFunctionStatement(verb: string, object: string): string {
  return [verb.trim(), object.trim()].filter(Boolean).join(' ')
}

export function composeFunctionDefinition(
  verb: string,
  what: string,
  target: string,
  relationship = 'to',
): string {
  return [
    verb.trim(),
    what.trim(),
    target.trim() ? `${relationship.trim() || 'to'} ${target.trim()}` : '',
  ].filter(Boolean).join(' ')
}

export function applyFunctionVerb(
  statement: string,
  selected: FMEAVocabularyTerm,
  profile?: FMEAVocabularyProfile,
): string {
  const { what, relationship, target } =
    splitFunctionDefinition(statement, profile)
  const remainder = composeFunctionDefinition(
    '', what, target, relationship || 'to')
  return remainder ? composeFunctionStatement(selected.label, remainder)
    : `${selected.label} `
}

export function failureModeStarter(
  deviation: FMEAVocabularyTerm,
  functionStatement: string,
): string {
  const words = functionStatement.trim().split(/\s+/)
  const object = words.length > 1 ? words.slice(1).join(' ') : 'function'
  const templates: Record<string, string> = {
    Absent: `No ${object}`,
    Insufficient: `Insufficient ${object}`,
    Excessive: `Excessive ${object}`,
    Intermittent: `Intermittent ${object}`,
    Unintended: `Unintended ${object}`,
    Early: `Early ${object}`,
    Late: `Late ${object}`,
    'Wrong value or state': `Wrong ${object} value or state`,
    'Wrong direction': `Wrong ${object} direction`,
    'Wrong sequence': `Wrong ${object} sequence`,
    'Fails to start': `${object} fails to start`,
    'Fails to stop': `${object} fails to stop`,
  }
  return templates[deviation.label] ?? `${deviation.label} ${object}`
}

export function vocabularyConflicts(
  profile: FMEAVocabularyProfile,
): string[] {
  const terms = [...BUILTIN_FMEA_VOCABULARY, ...profile.custom_terms]
  const owners = new Map<string, string>()
  const conflicts = new Set<string>()
  for (const termValue of terms) {
    for (const value of [termValue.label, ...termValue.aliases]) {
      const normalized = normalizeVocabulary(value)
      if (!normalized) continue
      if (!termValue.built_in
          && termValue.domain === 'function_verb'
          && normalized in AMBIGUOUS_FUNCTION_WORDS) {
        conflicts.add(value)
      }
      const key = `${termValue.domain}:${normalized}`
      const owner = owners.get(key)
      if (owner && owner !== termValue.id) conflicts.add(value)
      owners.set(key, termValue.id)
    }
  }
  for (const alias of profile.custom_aliases) {
    const termValue = terms.find(value => value.id === alias.term_id)
    if (!termValue) {
      conflicts.add(alias.value || 'Unknown alias target')
      continue
    }
    if (termValue.domain === 'function_verb'
        && normalizeVocabulary(alias.value) in AMBIGUOUS_FUNCTION_WORDS) {
      conflicts.add(alias.value)
    }
    const key = `${termValue.domain}:${normalizeVocabulary(alias.value)}`
    const owner = owners.get(key)
    if (owner && owner !== termValue.id) conflicts.add(alias.value)
    owners.set(key, termValue.id)
  }
  return [...conflicts].sort()
}

export function createProjectVocabularyTerm(
  seed: Pick<TermSeed, 'label'|'category'|'definition'|'aliases'>
    & { domain: FMEAVocabularyDomain },
): FMEAVocabularyTerm {
  return {
    id: `project:${seed.domain}:${Date.now().toString(36)}-${Math.random()
      .toString(36).slice(2, 7)}`,
    domain: seed.domain,
    label: seed.label.trim(),
    category: seed.category.trim() || 'Project terms',
    definition: seed.definition.trim(),
    selection_question: 'Does this project-defined term precisely describe the intended meaning?',
    use_when: seed.definition.trim(),
    avoid_when: 'Use a built-in term when its defined intent already applies.',
    aliases: seed.aliases.map(value => value.trim()).filter(Boolean),
    examples: [],
    applicability: ['all'],
    source: 'Project-defined controlled terminology.',
    built_in: false,
  }
}
