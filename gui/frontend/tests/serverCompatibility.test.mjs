import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

try {
  const compatibility = await vite.ssrLoadModule('/src/api/serverCompatibility.ts')
  const version = await vite.ssrLoadModule('/src/version.ts')
  const identity = {
    version: version.APP_VERSION,
    commit: version.APP_COMMIT,
    api_contract: compatibility.FRONTEND_API_CONTRACT,
    minimum_client_api_contract: 1,
    maximum_client_api_contract: 1,
  }

  assert.equal(compatibility.assessServerCompatibility(identity).kind, 'compatible')
  assert.equal(compatibility.assessServerCompatibility(identity, 0).kind, 'incompatible',
    'older frontend contracts must fail closed')
  assert.equal(compatibility.assessServerCompatibility(identity, 2).kind, 'incompatible',
    'a newer frontend must not assume an older server response contract')
  assert.equal(compatibility.assessServerCompatibility({ ...identity, version: '0.0.1' }).kind, 'refresh',
    'different application releases may continue only when the API range is compatible')
  assert.equal(compatibility.assessServerCompatibility({ version: '0.0.1' }).kind, 'incompatible',
    'servers without compatibility metadata must not be interpreted approximately')

  const headers = compatibility.apiClientHeaders()
  assert.equal(headers['X-Perdura-Client-API-Contract'], String(compatibility.FRONTEND_API_CONTRACT))
  assert.equal(headers['X-Perdura-Client-Version'], version.APP_VERSION)
  const backendContract = readFileSync(new URL('../../backend/api_contract.py', import.meta.url), 'utf8')
    .match(/^API_CONTRACT_VERSION = (\d+)$/m)?.[1]
  assert.equal(String(compatibility.FRONTEND_API_CONTRACT), backendContract,
    'frontend and backend API-contract constants must advance together')
  console.log('server compatibility contracts passed')
} finally {
  await vite.close()
  hmrServer.close()
}
