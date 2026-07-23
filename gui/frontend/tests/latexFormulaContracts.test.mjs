import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'
import katex from 'katex'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const { formulaToLatex } = await vite.ssrLoadModule(
    '/src/components/shared/Latex.tsx',
  )

  const resistor = formulaToLatex(
    'Vallowed = min(0.8 Vspec,max, sqrt(Pallowed Ractive))',
  )
  assert.match(resistor, /V_\{\\mathrm\{allowed\}\}/)
  assert.match(resistor, /\\min\\left\(/)
  assert.match(resistor, /\\sqrt\{/)
  assert.match(resistor, /P_\{\\mathrm\{allowed\}\}/)
  assert.match(resistor, /R_\{\\mathrm\{active\}\}/)

  const thermal = formulaToLatex(
    'Tinsert,rated > Tambient + DeltaTohmic + 50°C',
  )
  assert.match(thermal, /T_\{\\mathrm\{insert,rated\}\}/)
  assert.match(thermal, /T_\{\\mathrm\{ambient\}\}/)
  assert.match(thermal, /\\Delta T_\{\\mathrm\{ohmic\}\}/)
  assert.match(thermal, /\^\{\\circ\}\\mathrm\{C\}/)

  const capacitor = formulaToLatex(
    'Vstress = VDC + VAC,peak <= f(T) Vrated',
  )
  assert.match(capacitor, /V_\{\\mathrm\{stress\}\}/)
  assert.match(capacitor, /V_\{\\mathrm\{DC\}\}/)
  assert.match(capacitor, /V_\{\\mathrm\{AC,peak\}\}/)
  assert.match(capacitor, /\\le/)

  const ratio = formulaToLatex('actual/rated <= table factor')
  assert.match(ratio, /\\mathrm\{actual\}\/\\mathrm\{rated\}/)
  assert.match(ratio, /\\text\{table factor\}/)

  const writeCycles = formulaToLatex('1.26e8/B^0.660')
  assert.match(writeCycles, /1\.26\\times10\^\{8\}/)
  assert.match(writeCycles, /B\^\{0\.660\}/)

  const fuse = formulaToLatex(
    'Iapplication <= (f25 - 0.005 max(T-25,0)) Irated',
  )
  assert.match(fuse, /I_\{\\mathrm\{application\}\}/)
  assert.match(fuse, /f_\{25\}/)
  assert.match(fuse, /I_\{\\mathrm\{rated\}\}/)

  const wire = formulaToLatex('Iallowed = Isw Fbundle Finsulation')
  assert.match(wire, /I_\{\\mathrm\{allowed\}\}/)
  assert.match(wire, /I_\{\\mathrm\{sw\}\}/)
  assert.match(wire, /F_\{\\mathrm\{bundle\}\}/)
  assert.match(wire, /F_\{\\mathrm\{insulation\}\}/)

  const dwv = formulaToLatex('VDWV,sea-level > 4 Vapplication')
  assert.match(dwv, /V_\{\\mathrm\{DWV,sea-level\}\}/)
  assert.match(dwv, /V_\{\\mathrm\{application\}\}/)

  const zener = formulaToLatex('Iz = manufacturer-specified IzT')
  assert.match(zener, /I_\{z\}/)
  assert.match(zener, /\\text\{manufacturer-specified\}/)
  assert.match(zener, /I_\{\\mathrm\{zT\}\}/)

  const outputRatio = formulaToLatex('output/rated <= 0.80')
  assert.match(outputRatio, /\\mathrm\{output\}\/\\mathrm\{rated\}/)
  assert.match(outputRatio, /\\le/)

  const obligation = formulaToLatex(
    'all operating points lie within the manufacturer SOA envelope',
  )
  assert.equal(
    obligation,
    String.raw`\text{all operating points lie within the manufacturer SOA envelope}`,
  )

  const combinedCapacitorVoltage = formulaToLatex(
    'VAC,peak + VDC <= Vderated,max',
  )
  assert.match(combinedCapacitorVoltage, /V_\{\\mathrm\{AC,peak\}\}/)
  assert.match(combinedCapacitorVoltage, /V_\{\\mathrm\{DC\}\}/)
  assert.match(combinedCapacitorVoltage, /V_\{\\mathrm\{derated,max\}\}/)

  const peakIncludingTransients = formulaToLatex(
    'Vpeak,total <= Vrated',
  )
  assert.match(peakIncludingTransients, /V_\{\\mathrm\{peak,total\}\}/)
  assert.match(peakIncludingTransients, /V_\{\\mathrm\{rated\}\}/)
  assert.match(peakIncludingTransients, /\\le/)

  const formulaSources = [
    '../../../src/reliability/MIL_STD_975M.py',
    '../../../src/reliability/RL_TR_92_11.py',
  ]
  let sourceFormulaCount = 0
  for (const relativePath of formulaSources) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    for (const line of source.split('\n')) {
      const match = line.match(/\bformula\s*=\s*f?(["'])(.*)\1,?\s*$/)
      if (!match || match[2].includes('{')) continue
      sourceFormulaCount += 1
      const converted = formulaToLatex(match[2])
      assert.doesNotThrow(
        () => katex.renderToString(converted, { throwOnError: true, strict: false }),
        `${relativePath}: ${match[2]} -> ${converted}`,
      )
    }
  }
  assert.ok(sourceFormulaCount >= 15, 'expected broad source-formula smoke coverage')

  console.log('LaTeX formula contracts passed')
} finally {
  await vite.close()
}
