/**
 * Physics-of-Failure component / material property library (#PoF library).
 *
 * Typical, literature-sourced parameter values for common failure mechanisms
 * and materials, so users can "Load from library" instead of typing values by
 * hand. Every entry remains editable after loading -- these are starting points,
 * not fixed constants.
 *
 * Sources (general references; exact values vary by process/supplier):
 *  - JEDEC JEP122 (Failure Mechanisms and Models for Semiconductor Devices)
 *  - JESD91 (Activation Energy method), JESD33 (TDDB)
 *  - Norris & Landzberg, IBM J. Res. Dev. (1969); IPC-9701 (solder fatigue)
 *  - Hallberg & Peck, Quality and Reliability Eng. Int. (1991)
 */

// --- Activation energies (eV) for common failure mechanisms ---
// Used by: Arrhenius, Eyring, Black (electromigration), Peck, Hallberg-Peck, TDDB.
export interface EaEntry {
  label: string
  Ea: number
  note?: string
}

export const ACTIVATION_ENERGIES: EaEntry[] = [
  { label: 'Electromigration (Al)', Ea: 0.7, note: 'Aluminium interconnect, JEP122' },
  { label: 'Electromigration (Cu)', Ea: 0.9, note: 'Copper interconnect' },
  { label: 'Oxide TDDB (low)', Ea: 0.3, note: 'Thin gate oxide breakdown' },
  { label: 'Oxide TDDB (high)', Ea: 0.6, note: 'Thicker oxide / field oxide' },
  { label: 'Corrosion (humidity)', Ea: 0.45, note: 'Metallization corrosion' },
  { label: 'Hot carrier injection', Ea: -0.06, note: 'Slightly negative (worse cold)' },
  { label: 'NBTI', Ea: 0.4, note: 'Negative-bias temperature instability' },
  { label: 'Si-Al interdiffusion', Ea: 1.4, note: 'Contact/junction spiking' },
  { label: 'Solder thermal fatigue', Ea: 0.122, note: 'Norris-Landzberg (SnPb)' },
  { label: 'Ionic contamination', Ea: 1.0, note: 'Mobile-ion / surface charge' },
  { label: 'Generic semiconductor', Ea: 0.7, note: 'Common default for ALT' },
]

// --- Coffin-Manson / strain-life fatigue exponents for common solders ---
// c is the fatigue ductility (Coffin-Manson) exponent. The Coffin-Manson
// fatigue exponent commonly quoted (~1.9-2.5) is roughly -1/c.
export interface SolderEntry {
  label: string
  E: number            // Young's modulus (MPa)
  sigma_f: number      // fatigue strength coefficient (MPa)
  b: number            // fatigue strength exponent
  epsilon_f: number    // fatigue ductility coefficient
  c: number            // fatigue ductility (Coffin-Manson) exponent
  note?: string
}

export const SOLDER_FATIGUE: SolderEntry[] = [
  {
    label: 'SnPb eutectic (63/37)',
    E: 30000, sigma_f: 80, b: -0.12, epsilon_f: 0.32, c: -0.52,
    note: 'CM exponent ~1.9-2.0',
  },
  {
    label: 'SAC305 (Sn-3.0Ag-0.5Cu)',
    E: 50000, sigma_f: 100, b: -0.11, epsilon_f: 0.30, c: -0.45,
    note: 'CM exponent ~2.0-2.3',
  },
  {
    label: 'SAC387/405 (high-Ag)',
    E: 51000, sigma_f: 110, b: -0.10, epsilon_f: 0.28, c: -0.40,
    note: 'CM exponent ~2.3-2.5',
  },
  {
    label: 'Structural steel (1045)',
    E: 200000, sigma_f: 900, b: -0.09, epsilon_f: 0.5, c: -0.6,
    note: 'Generic ductile metal',
  },
]

// --- Norris-Landzberg constants for common solders ---
// AF = (dT_test/dT_use)^n * (f_use/f_test)^m * exp(Ea/k*(1/Tmax_use - 1/Tmax_test))
export interface NorrisLandzbergEntry {
  label: string
  n: number    // thermal-range exponent
  m: number    // frequency exponent
  Ea: number   // activation energy (eV)
  note?: string
}

export const NORRIS_LANDZBERG: NorrisLandzbergEntry[] = [
  { label: 'SnPb eutectic (classic NL)', n: 1.9, m: 0.333, Ea: 0.122, note: 'Norris-Landzberg 1969' },
  { label: 'SAC305 (Pan et al.)', n: 2.65, m: 0.136, Ea: 0.0867, note: 'Lead-free SAC fit' },
  { label: 'SAC387', n: 2.3, m: 0.19, Ea: 0.122, note: 'Typical lead-free' },
]

// --- TDDB field acceleration parameter (gamma) presets ---
export interface TDDBEntry {
  label: string
  model: 'E' | '1/E'
  gamma: number
  Ea: number
  note?: string
}

export const TDDB_PRESETS: TDDBEntry[] = [
  { label: 'Thermochemical E-model (thin oxide)', model: 'E', gamma: 4.0, Ea: 0.6, note: 'gamma in cm/MV' },
  { label: '1/E anode-hole-injection model', model: '1/E', gamma: 350, Ea: 0.3, note: 'gamma in MV/cm' },
  { label: 'High-k / advanced node (E-model)', model: 'E', gamma: 2.0, Ea: 0.5 },
]
