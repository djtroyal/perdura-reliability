// Use plotly.js-dist-min which has proper ESM support (the slim plotly.js/lib/core
// imports are CJS-only and break under Vite 8/Rolldown).
import Plotly from 'plotly.js-dist-min'

export default Plotly
