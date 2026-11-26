// Run with: npm test   (plain Node, no test framework)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rmbUpper } from './rmb.ts';

test('rmbUpper', () => {
  const cases: [number, string][] = [
    [650, '陆佰伍拾元正'],
    [0, '零元正'],
    [10, '壹拾元正'],
    [1005, '壹仟零伍元正'],
    [1050, '壹仟零伍拾元正'],
    [10005, '壹万零伍元正'],
    [10500, '壹万零伍佰元正'],
    [100000, '壹拾万元正'],
    [100000000, '壹亿元正'],
    [100010001, '壹亿零壹万零壹元正'],
    [650.5, '陆佰伍拾元伍角'],
    [650.05, '陆佰伍拾元零伍分'],
    [0.5, '伍角'],
    [0.05, '伍分'],
    [1.1 + 2.2, '叁元叁角'], // 3.3000000000000003
    [-1, ''],
    [NaN, ''],
  ];
  for (const [n, want] of cases) assert.equal(rmbUpper(n), want, String(n));
});
