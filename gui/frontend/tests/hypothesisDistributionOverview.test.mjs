import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

const hmrServer = createHttpServer()
const vite = await createServer({
  root: new URL('..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true, hmr: { server: hmrServer } },
})

const base = {
  dataText: '',
  groupAText: '',
  groupBText: '',
  kGroupsText: '',
  factorialTableText: '',
  factorialResponse: '',
  factorialFactors: '',
  rmTableText: '',
  mixedTableText: '',
  mixedBetween: 'between',
  mixedWithin: 'within',
  mixedValue: 'value',
}

try {
  const { buildDistributionOverview } = await vite.ssrLoadModule(
    '/src/components/Hypothesis/distributionOverview.ts',
  )

  assert.deepEqual(buildDistributionOverview('one_group', {
    ...base, dataText: '1, 2\n3 4',
  }), [{ label: 'Sample', values: [1, 2, 3, 4] }])

  assert.deepEqual(buildDistributionOverview('two_groups', {
    ...base, groupAText: '', groupBText: '5 6 7',
  }), [{ label: 'Group B', values: [5, 6, 7] }])

  assert.deepEqual(buildDistributionOverview('k_groups', {
    ...base, kGroupsText: '1 2 3\n4 5 6\n7 8 9',
  }), [
    { label: 'Group 1', values: [1, 2, 3] },
    { label: 'Group 2', values: [4, 5, 6] },
    { label: 'Group 3', values: [7, 8, 9] },
  ])

  assert.deepEqual(buildDistributionOverview('factorial_anova', {
    ...base,
    factorialTableText: 'response,A,B\n5,a1,b1\n6,a1,b2\n7,a2,b1\n8,a2,b2',
    factorialResponse: 'response',
    factorialFactors: 'A,B',
  }), [
    { label: 'A=a1 · B=b1', values: [5] },
    { label: 'A=a1 · B=b2', values: [6] },
    { label: 'A=a2 · B=b1', values: [7] },
    { label: 'A=a2 · B=b2', values: [8] },
  ])

  assert.deepEqual(buildDistributionOverview('rm_anova', {
    ...base, rmTableText: '1 10 100\n2 20 200\n3 30 300',
  }), [
    { label: 'Condition 1', values: [1, 2, 3] },
    { label: 'Condition 2', values: [10, 20, 30] },
    { label: 'Condition 3', values: [100, 200, 300] },
  ])

  assert.deepEqual(buildDistributionOverview('mixed_anova', {
    ...base,
    mixedTableText: [
      'value,subject,between,within',
      '5,s1,control,pre',
      '6,s1,control,post',
      '7,s2,treatment,pre',
      '9,s2,treatment,post',
    ].join('\n'),
  }), [
    { label: 'between=control · within=pre', values: [5] },
    { label: 'between=control · within=post', values: [6] },
    { label: 'between=treatment · within=pre', values: [7] },
    { label: 'between=treatment · within=post', values: [9] },
  ])

  assert.deepEqual(buildDistributionOverview('binomial', base), [])
  console.log('Hypothesis distribution overview contracts passed')
} finally {
  await vite.close()
}
