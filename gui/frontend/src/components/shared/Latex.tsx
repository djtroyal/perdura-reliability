import katex from 'katex'
import 'katex/dist/katex.min.css'

/** Render a trusted LaTeX expression with accessible MathML and visual HTML. */
export default function Latex({ children, block = false, className = '' }: {
  children: string
  block?: boolean
  className?: string
}) {
  const html = katex.renderToString(children, {
    displayMode: block,
    throwOnError: false,
    strict: false,
    output: 'htmlAndMathml',
  })
  const Tag = block ? 'div' : 'span'
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
