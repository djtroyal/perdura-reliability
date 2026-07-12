// Categories that have no environment/VITA factor (shared by the parts table
// and the index editor/palette). In its own module so both can import it
// without a circular dependency.
export const NO_ENV_CATEGORIES = new Set(['motor', 'custom', 'generic'])

export const VITA_CATEGORIES = new Set([
  'microcircuit', 'vhsic_microcircuit', 'gaas_microcircuit',
  'hybrid_microcircuit', 'detailed_cmos',
  'diode', 'hf_diode', 'bjt', 'fet', 'gaas_fet', 'unijunction',
  'hf_low_noise_bjt', 'hf_power_bjt', 'hf_silicon_fet', 'thyristor',
  'optoelectronic', 'resistor', 'capacitor', 'ferrite_bead',
  'relay', 'ss_relay', 'switch', 'connector', 'pth_assembly',
  'surface_mount_assembly', 'meter', 'crystal', 'oscillator',
  'filter', 'mems_oscillator', 'parts_count',
])

export const VITA_ONLY_CATEGORIES = new Set([
  'ferrite_bead', 'oscillator', 'mems_oscillator',
])
