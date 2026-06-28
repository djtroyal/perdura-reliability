// Slim custom Plotly bundle: plotly.js core + only the trace types this app
// actually uses, instead of the full plotly.js-dist-min (~4.7 MB raw). Drops the
// large unused families (geo/mapbox, finance, sankey/treemap/sunburst,
// parcoords, polar/ternary, mesh3d/surface/volume, image, indicator, …).
//
// Trace types in use across the app: scatter, bar, pie, box, violin, histogram,
// heatmap, contour, scatter3d (DOE design-space + ALT multi-stress).
import Plotly from 'plotly.js/lib/core'
import scatter from 'plotly.js/lib/scatter'
import bar from 'plotly.js/lib/bar'
import pie from 'plotly.js/lib/pie'
import box from 'plotly.js/lib/box'
import violin from 'plotly.js/lib/violin'
import histogram from 'plotly.js/lib/histogram'
import heatmap from 'plotly.js/lib/heatmap'
import contour from 'plotly.js/lib/contour'
import scatter3d from 'plotly.js/lib/scatter3d'

Plotly.register([scatter, bar, pie, box, violin, histogram, heatmap, contour, scatter3d])

export default Plotly
