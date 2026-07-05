// plotly.js-dist-min has no TS declarations. Re-export the global Plotly namespace
// from @types/plotly.js so it's available under the new package name.
/// <reference types="plotly.js" />

declare module 'plotly.js-dist-min' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Plotly: any
  export default Plotly
}
