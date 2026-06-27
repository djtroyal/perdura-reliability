// Categories that have no environment/VITA factor (shared by the parts table
// and the index editor/palette). In its own module so both can import it
// without a circular dependency.
export const NO_ENV_CATEGORIES = new Set(['custom', 'generic'])
