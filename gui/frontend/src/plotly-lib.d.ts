// The plotly.js partial-bundle entry points (lib/core, lib/scatter, …) ship no
// TS declarations. We build a slim custom Plotly bundle in shared/plotly.ts; the
// global `Plotly.*` types still come from @types/plotly.js.
declare module 'plotly.js/lib/core' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Plotly: any
  export default Plotly
}
declare module 'plotly.js/lib/*' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any
  export default mod
}
