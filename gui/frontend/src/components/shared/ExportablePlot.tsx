import { useRef, useState, useCallback } from 'react'
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-expect-error -- plotly.js-dist-min ships no TS declarations
import Plotly from 'plotly.js-dist-min'
import { Download, Image, FileCode } from 'lucide-react'

const InternalPlot = createPlotlyComponent(Plotly)
type PlotProps = React.ComponentProps<typeof InternalPlot>

interface ExportablePlotProps extends PlotProps {
  exportName?: string
}

export default function ExportablePlot({ exportName, style, ...plotProps }: ExportablePlotProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const getName = useCallback(() => {
    if (exportName) return exportName
    const title = (plotProps.layout as Record<string, unknown> | undefined)?.title
    const text = typeof title === 'string' ? title : (title as { text?: string } | undefined)?.text
    if (text) return text.replace(/[^\w .-]+/g, '').replace(/\s+/g, '_').replace(/^_+|_+$/g, '') || 'plot'
    return 'plot'
  }, [exportName, plotProps.layout])

  const getGd = () =>
    containerRef.current?.querySelector('.js-plotly-plot') as HTMLElement | null

  const handleImage = (format: 'png' | 'svg') => {
    const gd = getGd()
    if (!gd) return
    const rect = gd.getBoundingClientRect()
    const scale = format === 'png' ? 2 : 1
    ;(Plotly as { downloadImage: Function }).downloadImage(gd, {
      format,
      filename: getName(),
      width: Math.round(rect.width * scale),
      height: Math.round(rect.height * scale),
    })
    setOpen(false)
  }

  const handleHTML = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gd = getGd() as any
    if (!gd?.data) return
    const name = getName()
    const html = [
      '<!DOCTYPE html><html><head><meta charset="utf-8">',
      `<title>${name}</title>`,
      '<script src="https://cdn.plot.ly/plotly-2.35.0.min.js"></' + 'script>',
      '<style>body{margin:0}#p{width:100vw;height:100vh}</style>',
      '</head><body><div id="p"></div><script>',
      `Plotly.newPlot("p",${JSON.stringify(gd.data)},${JSON.stringify(gd.layout)},{responsive:true})`,
      '</' + 'script></body></html>',
    ].join('\n')
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${name}.html`; a.click()
    URL.revokeObjectURL(url)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="group/plot" style={{ position: 'relative', ...style }}>
      <InternalPlot {...plotProps} style={{ width: '100%', height: '100%' }} />
      <button
        onClick={() => setOpen(o => !o)}
        className={`absolute top-2 left-2 z-20 p-1.5 rounded bg-white/80 hover:bg-white border border-gray-200/60 hover:border-gray-300 text-gray-400 hover:text-gray-700 shadow-sm transition-all ${
          open ? 'opacity-100' : 'opacity-0 group-hover/plot:opacity-70'
        }`}
        title="Export plot"
      >
        <Download size={13} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-10 left-2 z-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[150px]">
            <button onClick={() => handleImage('png')}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
              <Image size={12} /> PNG image
            </button>
            <button onClick={() => handleImage('svg')}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
              <Image size={12} /> SVG vector
            </button>
            <div className="border-t border-gray-100 my-0.5" />
            <button onClick={handleHTML}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
              <FileCode size={12} /> HTML (interactive)
            </button>
          </div>
        </>
      )}
    </div>
  )
}
