/**
 * The Modification verb dictionary — a comprehensive, MUTUALLY EXCLUSIVE
 * vocabulary for TRIZ function statements.
 *
 * Exclusivity scheme: every canonical verb occupies exactly ONE cell of
 * (operation × attribute class). Operations say what happens to the attribute
 * (increase / decrease / control / create / destroy); the ten attribute
 * classes are physically disjoint. Picking a verb therefore pins down the
 * longhand form ("changes|controls|creates <attribute>") automatically — the
 * part of classical TRIZ interfaces users find most cumbersome.
 *
 * Non-canonical words are handled two ways:
 *  - SYNONYMS redirect silently to their canonical verb (warms → heats).
 *  - TRAPS are the classic "confusing function" verbs (protects, seals,
 *    measures…) that don't name a physical modification at all — they carry a
 *    corrective hint plus the canonical verbs to consider instead.
 */

export type VerbOp = 'increase' | 'decrease' | 'control' | 'create' | 'destroy'

export interface VerbCategory {
  id: number
  name: string
  /** What kind of product attribute this class modifies. */
  scope: string
}

export const VERB_CATEGORIES: VerbCategory[] = [
  { id: 1, name: 'Position & orientation', scope: 'where the product is and which way it faces' },
  { id: 2, name: 'Motion', scope: 'how the product moves (speed, vibration)' },
  { id: 3, name: 'Shape & surface', scope: 'the product\'s geometry and surface texture' },
  { id: 4, name: 'Cohesion & division', scope: 'whether parts are one piece or many' },
  { id: 5, name: 'Composition & mixture', scope: 'what substances the product contains or carries' },
  { id: 6, name: 'Material state & integrity', scope: 'phase, hardness, and material degradation' },
  { id: 7, name: 'Thermal', scope: 'the product\'s temperature' },
  { id: 8, name: 'Fields & charge', scope: 'electric, magnetic and radiant states' },
  { id: 9, name: 'Flow & transmission', scope: 'movement of substance/energy THROUGH or PAST the product' },
  { id: 10, name: 'Information', scope: 'the informed state of an observer (informing functions)' },
]

export interface VerbDef {
  verb: string
  category: number
  op: VerbOp
  /** Canonical product attribute for the longhand form. */
  attribute: string
  longhandOp: 'changes' | 'controls' | 'creates'
  definition: string
  example: string
  antiVerb?: string
  informingOnly?: boolean
}

const V = (verb: string, category: number, op: VerbOp, attribute: string,
  definition: string, example: string, antiVerb?: string, informingOnly?: boolean): VerbDef => ({
  verb, category, op,
  attribute,
  longhandOp: op === 'control' ? 'controls' : op === 'create' ? 'creates' : 'changes',
  definition, example, antiVerb, informingOnly,
})

export const VERBS: VerbDef[] = [
  // ── 1 · Position & orientation ────────────────────────────────────────────
  V('moves', 1, 'increase', 'position', 'Displaces the product to a different place.', 'conveyor moves box', 'holds'),
  V('holds', 1, 'control', 'position', 'Keeps the product where it is against disturbing forces.', 'bearing holds rod', 'moves'),
  V('guides', 1, 'control', 'path', 'Constrains the product to follow a path while it moves.', 'rail guides carriage', 'deflects'),
  V('deflects', 1, 'decrease', 'approach', 'Turns the product away from a place it would otherwise reach.', 'paint deflects water from wood', 'attracts'),
  V('positions', 1, 'increase', 'location accuracy', 'Places the product at a specific target location.', 'fixture positions workpiece'),
  V('rotates', 1, 'increase', 'angular position', 'Turns the product about an axis.', 'motor rotates shaft'),
  V('orients', 1, 'control', 'orientation', 'Sets or maintains which way the product faces.', 'vane orients weathercock'),
  V('lifts', 1, 'increase', 'height', 'Raises the product against gravity.', 'jack lifts car', 'lowers'),
  V('lowers', 1, 'decrease', 'height', 'Brings the product down in a controlled way.', 'winch lowers load', 'lifts'),
  V('transports', 1, 'increase', 'distance travelled', 'Carries the product over a distance.', 'truck transports cargo'),
  V('ejects', 1, 'decrease', 'containment', 'Expels the product out of the system that held it.', 'spring ejects cartridge'),
  V('attracts', 1, 'decrease', 'separation distance', 'Pulls the product toward the tool.', 'magnet attracts filings', 'repels'),
  V('repels', 1, 'increase', 'separation distance', 'Pushes the product away from the tool.', 'like charges repel each other', 'attracts'),

  // ── 2 · Motion ────────────────────────────────────────────────────────────
  V('accelerates', 2, 'increase', 'speed', 'Increases the product\'s speed.', 'engine accelerates car', 'decelerates'),
  V('decelerates', 2, 'decrease', 'speed', 'Reduces the product\'s speed.', 'brake decelerates wheel', 'accelerates'),
  V('stops', 2, 'destroy', 'motion', 'Brings the product\'s motion to zero.', 'chock stops wheel'),
  V('launches', 2, 'create', 'motion', 'Sets a resting product into motion.', 'catapult launches projectile'),
  V('vibrates', 2, 'create', 'oscillation', 'Imparts oscillating motion to the product.', 'shaker vibrates screen', 'steadies'),
  V('steadies', 2, 'destroy', 'oscillation', 'Removes oscillation/jitter from the product.', 'damper steadies platform', 'vibrates'),
  V('spins', 2, 'increase', 'angular speed', 'Increases the product\'s rotational speed.', 'lathe spins workpiece'),
  V('paces', 2, 'control', 'speed', 'Maintains the product\'s speed at a set value.', 'governor paces engine'),

  // ── 3 · Shape & surface ───────────────────────────────────────────────────
  V('deforms', 3, 'increase', 'shape deviation', 'Changes the product\'s overall shape.', 'press deforms blank', 'straightens'),
  V('bends', 3, 'increase', 'curvature', 'Curves the product about an axis.', 'brake press bends sheet', 'straightens'),
  V('straightens', 3, 'decrease', 'curvature', 'Removes curvature/waviness from the product.', 'roller straightens wire', 'bends'),
  V('compresses', 3, 'decrease', 'volume', 'Squeezes the product into less space.', 'piston compresses gas', 'expands'),
  V('expands', 3, 'increase', 'volume', 'Enlarges the space the product occupies.', 'heat expands rail', 'compresses'),
  V('stretches', 3, 'increase', 'length', 'Extends the product along an axis.', 'tensioner stretches belt'),
  V('twists', 3, 'increase', 'torsion angle', 'Rotates one end of the product relative to the other.', 'wrench twists bolt'),
  V('flattens', 3, 'decrease', 'thickness variation', 'Makes the product uniformly flat.', 'rolling mill flattens slab'),
  V('smooths', 3, 'decrease', 'surface roughness', 'Reduces the product\'s surface roughness.', 'polisher smooths lens', 'roughens'),
  V('roughens', 3, 'increase', 'surface roughness', 'Increases the product\'s surface roughness.', 'blaster roughens casting', 'smooths'),
  V('engraves', 3, 'create', 'surface pattern', 'Forms a deliberate pattern in the product\'s surface.', 'laser engraves plate'),

  // ── 4 · Cohesion & division ───────────────────────────────────────────────
  V('joins', 4, 'increase', 'cohesion', 'Unites separate parts into one piece.', 'weld joins plates', 'separates'),
  V('separates', 4, 'decrease', 'cohesion', 'Parts previously-united pieces without damage.', 'solvent separates label from jar', 'joins'),
  V('cuts', 4, 'decrease', 'continuity', 'Divides the product along a controlled line.', 'blade cuts tape'),
  V('breaks', 4, 'destroy', 'continuity', 'Divides the product by fracture (uncontrolled surface).', 'ball breaks glass'),
  V('pierces', 4, 'create', 'hole', 'Makes a hole through the product.', 'punch pierces sheet'),
  V('splits', 4, 'increase', 'number of pieces', 'Divides the product along its natural planes.', 'wedge splits log'),
  V('fastens', 4, 'control', 'relative attachment', 'Holds parts together releasably.', 'bolt fastens flange', 'detaches'),
  V('detaches', 4, 'decrease', 'relative attachment', 'Releases a fastened connection.', 'quick-release detaches wheel', 'fastens'),

  // ── 5 · Composition & mixture ─────────────────────────────────────────────
  V('mixes', 5, 'increase', 'homogeneity', 'Distributes substances uniformly through the product.', 'stirrer mixes batter', 'precipitates'),
  V('dissolves', 5, 'increase', 'dissolved fraction', 'Takes the product into solution.', 'water dissolves salt', 'precipitates'),
  V('precipitates', 5, 'decrease', 'dissolved fraction', 'Brings dissolved substance out of solution.', 'cooling precipitates crystals', 'dissolves'),
  V('dilutes', 5, 'decrease', 'concentration', 'Lowers the concentration of a substance in the product.', 'water dilutes acid', 'concentrates'),
  V('concentrates', 5, 'increase', 'concentration', 'Raises the concentration of a substance in the product.', 'evaporator concentrates syrup', 'dilutes'),
  V('purifies', 5, 'decrease', 'contaminant content', 'Removes foreign substances from the product.', 'filter medium purifies water', 'contaminates'),
  V('contaminates', 5, 'increase', 'contaminant content', 'Introduces foreign substances into the product.', 'muzzle contaminates water with bacteria', 'purifies'),
  V('deposits', 5, 'increase', 'surface substance', 'Lays substance onto the product\'s surface.', 'plating bath deposits nickel', 'strips'),
  V('coats', 5, 'create', 'surface layer', 'Forms a continuous covering layer on the product.', 'sprayer coats panel'),
  V('strips', 5, 'decrease', 'surface substance', 'Removes substance from the product\'s surface.', 'solvent strips paint', 'deposits'),
  V('absorbs', 5, 'decrease', 'free (unabsorbed) amount', 'Draws the product into the tool\'s bulk, removing it from where it was.', 'sponge absorbs water (the water is the product)'),
  V('extracts', 5, 'decrease', 'contained substance', 'Draws a substance out of the product\'s bulk.', 'press extracts oil from seeds', 'infuses'),
  V('infuses', 5, 'increase', 'infused substance', 'Introduces a substance into the product\'s bulk.', 'autoclave infuses resin into fibers', 'extracts'),
  V('doses', 5, 'control', 'delivered quantity', 'Delivers a set quantity of substance to the product.', 'dispenser doses reagent'),

  // ── 6 · Material state & integrity ────────────────────────────────────────
  V('melts', 6, 'increase', 'liquid fraction', 'Changes the product from solid to liquid.', 'torch melts solder', 'solidifies'),
  V('solidifies', 6, 'decrease', 'liquid fraction', 'Changes the product from liquid to solid.', 'mold solidifies casting', 'melts'),
  V('evaporates', 6, 'increase', 'vapor fraction', 'Changes the product from liquid to vapor.', 'heater evaporates moisture', 'condenses'),
  V('condenses', 6, 'decrease', 'vapor fraction', 'Changes the product from vapor to liquid.', 'cold plate condenses steam', 'evaporates'),
  V('hardens', 6, 'increase', 'hardness', 'Raises the product\'s resistance to indentation.', 'quench hardens steel', 'softens'),
  V('softens', 6, 'decrease', 'hardness', 'Lowers the product\'s resistance to deformation.', 'heat softens plastic', 'hardens'),
  V('cures', 6, 'increase', 'cross-link density', 'Advances the product\'s chemical setting reaction.', 'UV lamp cures adhesive'),
  V('corrodes', 6, 'decrease', 'material integrity', 'Removes/converts the product\'s material by chemical attack.', 'acid corrodes pan'),
  V('oxidizes', 6, 'increase', 'oxide content', 'Converts the product\'s material to its oxide.', 'oxygen oxidizes iron'),
  V('wears', 6, 'decrease', 'material thickness', 'Removes the product\'s material by rubbing contact.', 'grit wears liner'),
  V('degrades', 6, 'decrease', 'material properties', 'Deteriorates the product\'s material (UV, age, fatigue).', 'sunlight degrades polymer', 'stabilizes'),
  V('stabilizes', 6, 'control', 'material properties', 'Holds the product\'s material properties against deterioration.', 'antioxidant stabilizes rubber', 'degrades'),

  // ── 7 · Thermal ───────────────────────────────────────────────────────────
  V('heats', 7, 'increase', 'temperature', 'Raises the product\'s temperature.', 'flame heats pan', 'cools'),
  V('cools', 7, 'decrease', 'temperature', 'Lowers the product\'s temperature.', 'fan cools processor', 'heats'),
  V('tempers', 7, 'control', 'temperature', 'Maintains the product\'s temperature at a set value.', 'thermostatic bath tempers sample'),

  // ── 8 · Fields & charge ───────────────────────────────────────────────────
  V('charges', 8, 'increase', 'electric charge', 'Adds electric charge to the product.', 'roller charges drum', 'discharges'),
  V('discharges', 8, 'decrease', 'electric charge', 'Removes electric charge from the product.', 'ground strap discharges chassis', 'charges'),
  V('magnetizes', 8, 'increase', 'magnetization', 'Aligns the product\'s magnetic domains.', 'coil magnetizes core', 'demagnetizes'),
  V('demagnetizes', 8, 'decrease', 'magnetization', 'Randomizes the product\'s magnetic domains.', 'degausser demagnetizes tape', 'magnetizes'),
  V('polarizes', 8, 'increase', 'polarization', 'Aligns the product\'s dipoles or transmitted field.', 'filter polarizes light'),
  V('illuminates', 8, 'increase', 'incident light', 'Delivers light onto the product.', 'lamp illuminates stage', 'shades'),
  V('shades', 8, 'decrease', 'incident light', 'Reduces light reaching the product.', 'awning shades window', 'illuminates'),
  V('energizes', 8, 'increase', 'stored energy', 'Adds usable energy into the product.', 'charger energizes battery', 'de-energizes'),
  V('de-energizes', 8, 'decrease', 'stored energy', 'Removes stored energy from the product.', 'bleed resistor de-energizes capacitor', 'energizes'),
  V('irradiates', 8, 'increase', 'radiation dose', 'Delivers ionizing/EM radiation into the product.', 'source irradiates specimen'),

  // ── 9 · Flow & transmission ───────────────────────────────────────────────
  V('conducts', 9, 'control', 'flow path', 'Provides the path along which the product (substance/energy) flows.', 'pipe conducts liquid; wire conducts electrons', 'blocks'),
  V('blocks', 9, 'destroy', 'flow', 'Stops the product from passing.', 'valve blocks gas', 'conducts'),
  V('throttles', 9, 'decrease', 'flow rate', 'Restricts, without stopping, the product\'s flow.', 'orifice throttles fuel'),
  V('pumps', 9, 'increase', 'flow rate', 'Drives the product\'s flow.', 'impeller pumps coolant'),
  V('channels', 9, 'control', 'flow direction', 'Directs where the flowing product goes.', 'gutter channels rainwater'),
  V('filters', 9, 'decrease', 'entrained particles', 'Removes particles from the flowing product.', 'element filters oil'),
  V('meters', 9, 'control', 'flow quantity', 'Delivers the flowing product at a set rate/quantity.', 'injector meters fuel'),
  V('pressurizes', 9, 'increase', 'pressure', 'Raises the product\'s pressure.', 'compressor pressurizes tank', 'depressurizes'),
  V('depressurizes', 9, 'decrease', 'pressure', 'Lowers the product\'s pressure.', 'relief valve depressurizes vessel', 'pressurizes'),

  // ── 10 · Information (informing functions) ────────────────────────────────
  V('informs', 10, 'increase', 'observer knowledge', 'Changes what the observer knows (subject → observer).', 'cubes inform operator (via mass reading)', undefined, true),
  V('indicates', 10, 'increase', 'displayed state', 'Presents a state visibly to the observer.', 'gauge indicates pressure to operator', undefined, true),
  V('signals', 10, 'create', 'alert state', 'Raises a discrete alert in the observer.', 'alarm signals overheat to crew', undefined, true),
  V('records', 10, 'increase', 'stored record', 'Writes the observed state into a persistent record.', 'logger records temperature history', undefined, true),
]

// ---------------------------------------------------------------------------
// Synonyms — silent redirects to the canonical verb
// ---------------------------------------------------------------------------

export const SYNONYMS: Record<string, string> = {
  warms: 'heats', chills: 'cools', refrigerates: 'cools', freezes: 'solidifies',
  grips: 'holds', clamps: 'holds', retains: 'holds', secures: 'fastens',
  pushes: 'moves', pulls: 'moves', shifts: 'moves', displaces: 'moves', carries: 'transports', conveys: 'transports',
  raises: 'lifts', elevates: 'lifts', drops: 'lowers',
  steers: 'guides', directs: 'channels', aims: 'orients', turns: 'rotates',
  speeds: 'accelerates', slows: 'decelerates', halts: 'stops', arrests: 'stops',
  brakes: 'decelerates', shakes: 'vibrates', oscillates: 'vibrates', dampens: 'steadies', damps: 'steadies',
  crushes: 'compresses', squeezes: 'compresses', inflates: 'expands', elongates: 'stretches',
  polishes: 'smooths', grinds: 'wears', abrades: 'wears', erodes: 'wears', etches: 'corrodes',
  bonds: 'joins', welds: 'joins', glues: 'joins', attaches: 'fastens', releases: 'detaches', unfastens: 'detaches',
  slices: 'cuts', severs: 'cuts', shears: 'cuts', fractures: 'breaks', shatters: 'breaks', cracks: 'breaks',
  drills: 'pierces', punctures: 'pierces', perforates: 'pierces',
  stirs: 'mixes', blends: 'mixes', agitates: 'mixes', dopes: 'infuses', impregnates: 'infuses',
  cleans: 'purifies', decontaminates: 'purifies', washes: 'purifies', pollutes: 'contaminates', fouls: 'contaminates',
  plates: 'deposits', paints: 'coats', covers: 'coats', soaks: 'absorbs', wicks: 'absorbs',
  dries: 'evaporates', dehydrates: 'evaporates', vaporizes: 'evaporates', boils: 'evaporates',
  anneals: 'softens', quenches: 'hardens', sets: 'cures', rusts: 'oxidizes', tarnishes: 'oxidizes',
  rots: 'degrades', ages: 'degrades', fatigues: 'degrades', preserves: 'stabilizes',
  electrifies: 'charges', grounds: 'discharges', earths: 'discharges', lights: 'illuminates', darkens: 'shades',
  powers: 'energizes', drains: 'de-energizes',
  transmits: 'conducts', passes: 'conducts', seals_flow: 'blocks', obstructs: 'blocks', plugs: 'blocks',
  restricts: 'throttles', regulates: 'meters', dispenses: 'doses', strains: 'filters', sieves: 'filters',
  drives: 'pumps', circulates: 'pumps', vents: 'depressurizes', inflates_pressure: 'pressurizes',
  notifies: 'informs', tells: 'informs', alerts: 'signals', warns: 'signals', shows: 'indicates',
  displays: 'indicates', logs: 'records', stores_data: 'records', stabilises: 'stabilizes',
  positions_at: 'positions', locates: 'positions', centers: 'positions', aligns: 'orients',
}

// ---------------------------------------------------------------------------
// Traps — "confusing function" verbs that don't name a physical modification
// ---------------------------------------------------------------------------

export interface TrapDef {
  verb: string
  hint: string
  /** Canonical verbs to consider instead. */
  suggest: string[]
}

export const TRAPS: TrapDef[] = [
  { verb: 'protects', hint: 'Protection is not a modification of the protected object — name what is deflected, blocked or shielded away from it.', suggest: ['deflects', 'blocks', 'shades'] },
  { verb: 'prevents', hint: 'Prevention acts on the threatening object, not the protected one — name what is deflected/blocked/held.', suggest: ['deflects', 'blocks', 'holds'] },
  { verb: 'seals', hint: 'A seal does not change the sealed object — it constrains the CONTENTS or blocks outside substances. Make the flowing substance the product.', suggest: ['blocks', 'holds'] },
  { verb: 'seal', hint: 'A seal does not change the sealed object — it constrains the CONTENTS or blocks outside substances. Make the flowing substance the product.', suggest: ['blocks', 'holds'] },
  { verb: 'measures', hint: 'Measurement runs the other way: the measured object CHANGES the instrument, which informs the observer. Model it as an informing function.', suggest: ['informs', 'indicates'] },
  { verb: 'measure', hint: 'Measurement runs the other way: the measured object CHANGES the instrument, which informs the observer. Model it as an informing function.', suggest: ['informs', 'indicates'] },
  { verb: 'senses', hint: 'A sensor is CHANGED BY the subject and then informs the observer — invert the direction and use an informing function.', suggest: ['informs', 'indicates'] },
  { verb: 'lubricates', hint: 'If the oil does its job the parts never touch — the oil GUIDES the moving part (and may drag it, a harm). Describe the real physics.', suggest: ['guides'] },
  { verb: 'brushes', hint: 'A brush acts on the plaque/particles, not the surface they sit on — make the removed substance the product.', suggest: ['moves', 'strips'] },
  { verb: 'improves', hint: '"Improves" changes nothing physical. Name the attribute changed and the substance acting.', suggest: [] },
  { verb: 'improve', hint: '"Improves" changes nothing physical. Name the attribute changed and the substance acting.', suggest: [] },
  { verb: 'supports', hint: 'Say what is physically controlled: "controls position of…" is usually the honest form.', suggest: ['holds'] },
  { verb: 'helps', hint: '"Helps" is not a physical modification — name the attribute changed.', suggest: [] },
  { verb: 'enables', hint: '"Enables" is not a physical modification — name the attribute changed.', suggest: [] },
  { verb: 'manages', hint: '"Manages" is not a physical modification — name the attribute controlled.', suggest: ['meters', 'tempers', 'paces'] },
  { verb: 'ensures', hint: '"Ensures" is not a physical modification — name the attribute controlled.', suggest: ['holds', 'stabilizes'] },
  { verb: 'protect', hint: 'Protection is not a modification of the protected object — name what is deflected, blocked or shielded away from it.', suggest: ['deflects', 'blocks', 'shades'] },
  { verb: 'prevent', hint: 'Prevention acts on the threatening object, not the protected one — name what is deflected/blocked/held.', suggest: ['deflects', 'blocks', 'holds'] },
  { verb: 'brush', hint: 'A brush acts on the plaque/particles, not the surface they sit on — make the removed substance the product.', suggest: ['moves', 'strips'] },
  { verb: 'lubricate', hint: 'If the oil does its job the parts never touch — the oil GUIDES the moving part. Describe the real physics.', suggest: ['guides'] },
]

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const VERB_MAP = new Map(VERBS.map(v => [v.verb.toLowerCase(), v]))
const TRAP_MAP = new Map(TRAPS.map(t => [t.verb.toLowerCase(), t]))

export type Resolved =
  | { kind: 'canonical'; def: VerbDef }
  | { kind: 'synonym'; def: VerbDef; from: string }
  | { kind: 'trap'; trap: TrapDef }
  | { kind: 'unknown' }

export function resolveVerb(text: string): Resolved {
  const t = text.trim().toLowerCase()
  if (!t) return { kind: 'unknown' }
  const direct = VERB_MAP.get(t)
  if (direct) return { kind: 'canonical', def: direct }
  const syn = SYNONYMS[t]
  if (syn) {
    const def = VERB_MAP.get(syn.toLowerCase())
    if (def) return { kind: 'synonym', def, from: t }
  }
  const trap = TRAP_MAP.get(t)
  if (trap) return { kind: 'trap', trap }
  return { kind: 'unknown' }
}

/** Search verbs (and synonyms) for the picker: matches verb, synonym, attribute
 *  or definition text. Returns canonical defs, deduped, category-ordered. */
export function searchVerbs(query: string, informing: boolean): VerbDef[] {
  const q = query.trim().toLowerCase()
  const pool = VERBS.filter(v => informing ? v.category === 10 : !v.informingOnly)
  if (!q) return pool
  const hits = new Set<VerbDef>()
  for (const v of pool) {
    if (v.verb.includes(q) || v.attribute.toLowerCase().includes(q) || v.definition.toLowerCase().includes(q)) hits.add(v)
  }
  for (const [syn, canonical] of Object.entries(SYNONYMS)) {
    if (syn.includes(q)) {
      const def = VERB_MAP.get(canonical.toLowerCase())
      if (def && (informing ? def.category === 10 : !def.informingOnly)) hits.add(def)
    }
  }
  return pool.filter(v => hits.has(v))
}
