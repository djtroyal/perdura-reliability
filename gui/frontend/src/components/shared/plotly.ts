// Plotly.js is loaded via CDN script in index.html because both plotly.js
// (CJS-only) and plotly.js-dist-min (UMD-only) lack proper ESM exports for
// Vite 8 / Rolldown. The CDN script sets window.Plotly before the app loads.
declare const window: Window & { Plotly: any }
export default window.Plotly
