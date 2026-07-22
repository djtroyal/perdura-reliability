import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { strToU8, zipSync } from 'fflate'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const spreadsheet = await vite.ssrLoadModule('/src/components/Prediction/bomSpreadsheet.ts')

  const csv = new File([
    'Assembly BOM Export\nReference Designators,Qty,Manufacturer Part Number,Description\nR1-R3,3,RN55D1001F,Precision resistor\n',
  ], 'assembly.csv', { type: 'text/csv' })
  const csvWorkbook = await spreadsheet.readBomWorkbook(csv)
  assert.equal(csvWorkbook.sheets.length, 1)
  assert.equal(spreadsheet.detectBomHeaderRow(csvWorkbook.sheets[0].rows), 1)
  const csvTable = spreadsheet.bomTableFromSheet(csvWorkbook, 0, 1)
  assert.equal(csvTable.rows[0]['Manufacturer Part Number'], 'RN55D1001F')
  assert.equal(csvTable.headerRow, 2)

  const xml = value => strToU8(value)
  const xlsxBytes = zipSync({
    '[Content_Types].xml': xml('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': xml('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': xml('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Main BOM" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': xml('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'xl/styles.xml': xml('<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>'),
    'xl/worksheets/sheet1.xml': xml('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>RefDes</t></is></c><c r="B1" t="inlineStr"><is><t>Qty</t></is></c><c r="C1" t="inlineStr"><is><t>Description</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>C1</t></is></c><c r="B2"><v>1</v></c><c r="C2" t="inlineStr"><is><t>Ceramic capacitor</t></is></c></row></sheetData></worksheet>'),
  })
  const xlsx = new File([xlsxBytes], 'assembly.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const xlsxWorkbook = await spreadsheet.readBomWorkbook(xlsx)
  assert.equal(xlsxWorkbook.sheets[0].name, 'Main BOM')
  const xlsxTable = spreadsheet.bomTableFromSheet(xlsxWorkbook, 0, 0)
  assert.deepEqual(xlsxTable.headers, ['RefDes', 'Qty', 'Description'])
  assert.equal(xlsxTable.rows[0].Description, 'Ceramic capacitor')

  console.log('BOM spreadsheet parsing contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
