import http from 'k6/http'
import { check, group } from 'k6'

const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:8000'
const profile = __ENV.PROFILE || 'smoke'
const p95Milliseconds = Number(__ENV.P95_MS || 1500)

const profiles = {
  smoke: { executor: 'shared-iterations', vus: 1, iterations: 5, maxDuration: '1m' },
  average: { executor: 'constant-vus', vus: 8, duration: '2m' },
  stress: { executor: 'ramping-vus', stages: [{ duration: '30s', target: 10 }, { duration: '1m', target: 30 }, { duration: '30s', target: 0 }] },
  spike: { executor: 'ramping-vus', stages: [{ duration: '10s', target: 40 }, { duration: '20s', target: 40 }, { duration: '10s', target: 0 }] },
  soak: { executor: 'constant-vus', vus: 8, duration: '30m' },
}

export const options = {
  scenarios: { [profile]: profiles[profile] || profiles.smoke },
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate==0'],
    http_req_duration: [`p(95)<${p95Milliseconds}`],
  },
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

const values = Array.from({ length: 1000 }, (_, index) => 50 + index / 20 + Math.sin(index / 13))
const params = {
  headers: {
    'Content-Type': 'application/json',
    'X-Perdura-Client-API-Contract': '1',
    'X-Perdura-Client-Version': 'assurance-k6',
  },
}

export default function () {
  group('identity', () => {
    const response = http.get(`${baseUrl}/api/v1/health`)
    check(response, {
      'health status is 200': value => value.status === 200,
      'health body identifies Perdura': value => value.json('status') === 'ok',
      'contract response header is present': value => value.headers['X-Perdura-Api-Contract'] === '1',
    })
  })
  group('representative calculation', () => {
    const response = http.post(
      `${baseUrl}/api/v1/descriptive/summary`,
      JSON.stringify({ columns: { measurement: values } }),
      params,
    )
    check(response, {
      'summary status is 200': value => value.status === 200,
      'summary contains all observations': value => value.json('measurement.n') === 1000,
      'response content hash is present': value => Boolean(value.headers['X-Perdura-Content-Sha256']),
    })
  })
}
