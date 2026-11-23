import assert from 'node:assert/strict'
import { parseRepairTimes } from '../src/components/Maintenance/repairTimeInput.ts'
assert.deepEqual(parseRepairTimes('2 3\n'), { samples: [2,3] })
assert.deepEqual(parseRepairTimes(' 2, 3\t4e-1 '), { samples: [2,3,.4] })
for (const input of ['2 bad 3','2 Infinity','2 -3','2 0','']) assert.throws(() => parseRepairTimes(input))
assert.deepEqual(parseRepairTimes('2, 4\n3 2\n', true), { samples: [2,3], frequencies: [4,2] })
assert.throws(() => parseRepairTimes('2, 1.5',true), /integer/)
assert.throws(() => parseRepairTimes('2, 3, 4',true), /Row 1/)
console.log('Repair input validation preserves every observation and frequency.')
