/**
 * Canonical example — the acid/cube corrosion-test container worked throughout
 * the TRIZ Power Tools books: acid corrodes test cubes (the primary useful
 * function) but also corrodes the expensive pan that contains it (the classic
 * dual-tool side effect), with the "acid reactivity must be high AND low"
 * lynchpin contradiction.
 */
import { FmeaState } from './model'

export function buildExample(): FmeaState {
  return {
    objects: [
      { id: 'oCubes', name: 'Test cubes', parentId: null, kind: 'superSystem', isSystemProduct: true, virtual: false, notes: 'The material samples whose corrosion resistance the lab exists to measure.' },
      { id: 'oAcid', name: 'Acid', parentId: null, kind: 'system', isSystemProduct: false, virtual: false, notes: '' },
      { id: 'oPan', name: 'Pan', parentId: null, kind: 'system', isSystemProduct: false, virtual: false, notes: 'Expensive corrosion-resistant container — replaced yearly (~$5000/yr).' },
      { id: 'oOven', name: 'Oven', parentId: null, kind: 'system', isSystemProduct: false, virtual: false, notes: '' },
      { id: 'oOperator', name: 'Operator', parentId: null, kind: 'superSystem', isSystemProduct: false, virtual: false, notes: '' },
    ],
    functions: [
      {
        id: 'fCorrode', toolId: 'oAcid', productId: 'oCubes', verb: 'corrodes',
        longhandOp: 'changes', attribute: 'material integrity', type: 'useful', parentFnId: null,
        requirements: { level: 'measurable mass loss', metric: 'g per 100 g per 100 h', band: '±5%', duration: '≤ 200 h per test', sequence: 'after preheat', dutyCycle: 'continuous during test', zeroCondition: 'during loading/unloading' },
        rationale: 'The Job Function: generate corrosion data on the cube materials.',
      },
      {
        id: 'fPosition', toolId: 'oPan', productId: 'oAcid', verb: 'positions',
        longhandOp: 'controls', attribute: 'position', type: 'useful', parentFnId: 'fCorrode',
        requirements: { level: 'acid fully covers cubes', metric: '', band: '', duration: '', sequence: '', dutyCycle: '', zeroCondition: '' },
        rationale: 'The pan exists only to hold the acid against the cubes — a compensating element.',
      },
      {
        id: 'fHeat', toolId: 'oOven', productId: 'oAcid', verb: 'heats',
        longhandOp: 'changes', attribute: 'temperature', type: 'useful', parentFnId: 'fCorrode',
        requirements: { level: '60 °C', metric: 'bath temperature', band: '±3 °C', duration: '', sequence: '', dutyCycle: '', zeroCondition: '' },
        rationale: '',
      },
      {
        id: 'fHarm', toolId: 'oAcid', productId: 'oPan', verb: 'corrodes',
        longhandOp: 'changes', attribute: 'wall thickness', type: 'harmful', parentFnId: null,
        requirements: { level: '', metric: '', band: '', duration: '', sequence: '', dutyCycle: '', zeroCondition: '' },
        rationale: 'Dual-tool side effect of the acid — the same tool performs useful and harmful functions.',
      },
      {
        id: 'fInform', toolId: 'oCubes', productId: 'oOperator', verb: 'informs',
        longhandOp: 'changes', attribute: 'mass reading', type: 'informing', parentFnId: 'fCorrode',
        requirements: { level: '', metric: 'coupon weight change', band: '±0.1 g', duration: '', sequence: 'after each 50 h interval', dutyCycle: '', zeroCondition: '' },
        rationale: 'The cubes (subject) inform the operator (observer) via weighing.',
      },
    ],
    modes: [
      { id: 'mSlow', fnId: 'fCorrode', guideword: 'insufficient', description: 'Cubes corrode too slowly — test exceeds schedule, weak data', dismissed: false, dismissReason: '', harmedObjectId: null },
      { id: 'mSide', fnId: 'fCorrode', guideword: 'unintended', description: 'Acid simultaneously corrodes the pan (container destroyed)', dismissed: false, dismissReason: '', harmedObjectId: 'oPan' },
      { id: 'mAbsent', fnId: 'fCorrode', guideword: 'absent', description: 'No corrosion — acid depleted or neutralized before test end', dismissed: false, dismissReason: '', harmedObjectId: null },
      { id: 'mExcess', fnId: 'fCorrode', guideword: 'excessive', description: '', dismissed: true, dismissReason: 'Reaction rate is bounded by acid concentration and bath temperature; runaway corrosion is not chemically credible here.', harmedObjectId: null },
      { id: 'mInter', fnId: 'fCorrode', guideword: 'intermittent', description: '', dismissed: true, dismissReason: 'Static bath at controlled temperature — no fluctuation mechanism present.', harmedObjectId: null },
      { id: 'mWrong', fnId: 'fCorrode', guideword: 'wrongTime', description: 'Corrosion continues during loading/unloading (zero-function violation) — operator exposure', dismissed: false, dismissReason: '', harmedObjectId: 'oOperator' },
      { id: 'mLeak', fnId: 'fPosition', guideword: 'insufficient', description: 'Pan positions acid poorly — level drops below cubes / leaks into oven', dismissed: false, dismissReason: '', harmedObjectId: null },
    ],
    causes: [
      {
        id: 'cReact', parentModeId: 'mSide', parentCauseId: null, objectId: 'oAcid',
        knobCategory: 'Bulk properties', attribute: 'acid reactivity', setting: 'high',
        knobType: 'worsensOther', terminal: null, afdResourcesPresent: true,
        afdNote: 'Saboteur: the acid is present by design — nothing extra needed to attack the pan.',
        contradiction: true,
        contradictionNote: 'Reactivity must be HIGH to corrode the cubes (the Job Function) and LOW to spare the pan.',
      },
      {
        id: 'cArea', parentModeId: null, parentCauseId: 'cReact', objectId: 'oPan',
        knobCategory: 'Surface properties', attribute: 'acid–pan contact area', setting: 'large',
        knobType: 'easy', terminal: null, afdResourcesPresent: true, afdNote: '',
        contradiction: false, contradictionNote: '',
      },
      {
        id: 'cMat', parentModeId: 'mSide', parentCauseId: null, objectId: 'oPan',
        knobCategory: 'Bulk properties', attribute: 'pan material corrodibility', setting: 'corrodible',
        knobType: 'oneFlavor', terminal: 'designParam', afdResourcesPresent: null, afdNote: '',
        contradiction: false, contradictionNote: '',
      },
      {
        id: 'cWeakReact', parentModeId: 'mSlow', parentCauseId: null, objectId: 'oAcid',
        knobCategory: 'Bulk properties', attribute: 'acid reactivity', setting: 'low',
        knobType: 'worsensOther', terminal: null, afdResourcesPresent: true, afdNote: '',
        contradiction: true,
        contradictionNote: 'Reactivity must be LOW to spare the pan and HIGH to corrode the cubes in schedule.',
      },
      {
        id: 'cTemp', parentModeId: 'mSlow', parentCauseId: null, objectId: 'oOven',
        knobCategory: 'Timing', attribute: 'bath temperature', setting: 'below setpoint',
        knobType: 'easy', terminal: null, afdResourcesPresent: true, afdNote: '',
        contradiction: false, contradictionNote: '',
      },
      {
        id: 'cVolume', parentModeId: 'mLeak', parentCauseId: null, objectId: 'oPan',
        knobCategory: 'Structure', attribute: 'pan wall thickness', setting: 'thin (corroded through)',
        knobType: 'outcome', terminal: null, afdResourcesPresent: true,
        afdNote: 'The harm chain feeds back: the side-effect corrosion CAUSES this positioning failure.',
        contradiction: false, contradictionNote: '',
      },
    ],
    detections: [
      {
        id: 'dWall', modeId: 'mSide', subject: 'pan wall thickness', observer: 'operator',
        transformations: '2', contact: true, destructive: false, addedParts: false, periodic: true,
        note: 'Periodic thickness gauging — contact measurement between tests.',
      },
      {
        id: 'dMass', modeId: 'mSlow', subject: 'cube mass change', observer: 'operator',
        transformations: '1', contact: false, destructive: false, addedParts: false, periodic: true,
        note: 'Interval weighing (the informing function of the system).',
      },
    ],
    mitigations: [
      { id: 'mtSep', modeId: 'mSide', causeId: 'cReact', family: 'contradiction', note: 'Lynchpin: separate reactivity in space (acid only where cubes are) or make the pan from the cube material batch (self-service).' },
      { id: 'mtNeut', modeId: 'mSide', causeId: null, family: 'neutralize', note: 'Sacrificial anode / pre-weakened element to draw the corrosion field off the pan.' },
      { id: 'mtWhy', modeId: 'mLeak', causeId: null, family: 'eliminateProduct', note: 'Why is the pan required at all? Position the acid differently (gel, absorbed film on cubes) and the pan — and its failure modes — disappear.' },
    ],
    ratings: [
      { modeId: 'mSide', causeId: 'cReact', severity: '7', occurrence: '8', detection: '5' },
      { modeId: 'mSide', causeId: 'cMat', severity: '7', occurrence: '6', detection: '5' },
      { modeId: 'mSlow', causeId: 'cWeakReact', severity: '5', occurrence: '4', detection: '3' },
      { modeId: 'mSlow', causeId: 'cTemp', severity: '5', occurrence: '3', detection: '2' },
      { modeId: 'mWrong', causeId: null, severity: '9', occurrence: '3', detection: '6' },
      { modeId: 'mLeak', causeId: 'cVolume', severity: '8', occurrence: '5', detection: '6' },
    ],
    sweptPairs: [
      ['oCubes', 'oAcid'], ['oAcid', 'oPan'], ['oAcid', 'oOven'], ['oCubes', 'oOperator'],
      ['oCubes', 'oPan'], ['oPan', 'oOven'], ['oPan', 'oOperator'], ['oOven', 'oOperator'],
      ['oCubes', 'oOven'], ['oAcid', 'oOperator'],
    ].map(p => p.sort().join('|')),
    seq: 0,
  }
}
