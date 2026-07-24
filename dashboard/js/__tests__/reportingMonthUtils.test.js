import { describe, expect, test } from '@jest/globals';
import '../reportingMonthUtils.js';

const {
  aggregateDepartmentFunnelTrend,
  alignRowsToReportingWindow,
  buildReportingMonthWindow,
  filterRowsToReportingWindow,
  getReportingMonth,
} = globalThis.hrReportingMonthUtils;

describe('reporting month utilities', () => {
  test('builds a continuous six-month window ending at API today', () => {
    expect(buildReportingMonthWindow('2026-07-24', 6)).toEqual([
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
  });

  test('aligns trends to current month, fills missing months and excludes future rows', () => {
    const aligned = alignRowsToReportingWindow([
      { month: '2026-05', interviews: 12, onboarded: 3 },
      { month: '2026-07', interviews: 18, onboarded: 5 },
      { month: '2026-08', interviews: 0, onboarded: 6 },
      { month: '2026-09', interviews: 0, onboarded: 2 },
    ], '2026-07-24', 6);

    expect(aligned.map(row => row.month)).toEqual([
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    expect(aligned.at(-2)).toEqual({ month: '2026-06' });
    expect(aligned.at(-1)).toMatchObject({ month: '2026-07', interviews: 18, onboarded: 5 });
  });

  test('filters department results to the same reporting window', () => {
    const filtered = filterRowsToReportingWindow([
      { department: 'ICC', month: '2026-01', onboard: 2 },
      { department: 'ICC', month: '2026-06', onboard: 3 },
      { department: 'WBU', month: '2026-07', onboard: 1 },
      { department: 'WBU', month: '2026-08', onboard: 7 },
    ], '2026-07', 6);

    expect(filtered).toEqual([
      { department: 'ICC', month: '2026-06', onboard: 3 },
      { department: 'WBU', month: '2026-07', onboard: 1 },
    ]);
  });

  test('aggregates authoritative department metrics without future or duplicate counting', () => {
    const iccJuly = {
      department: 'ICC',
      month: '2026-07',
      interview: 30,
      onboard: 6,
    };
    const trend = aggregateDepartmentFunnelTrend([
      { department: 'ICC', month: '2026-06', interview: 20, onboard: 4 },
      iccJuly,
      { ...iccJuly },
      { department: 'WBU', month: '2026-07', interview: 28, onboard: 5 },
      { department: 'WBU', month: '2026-08', interview: 40, onboard: 10 },
    ], '2026-07-24', 6);

    expect(trend.map(row => row.month)).toEqual([
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    expect(trend.at(-3)).toEqual({ month: '2026-05', interview: 0, onboard: 0 });
    expect(trend.at(-2)).toEqual({ month: '2026-06', interview: 20, onboard: 4 });
    expect(trend.at(-1)).toEqual({ month: '2026-07', interview: 58, onboard: 11 });
  });

  test.each([
    ['2026-07-24', '2026-07'],
    ['2026-07', '2026-07'],
    ['2026-13-01', ''],
    ['', ''],
  ])('normalizes reporting date %s', (value, expected) => {
    expect(getReportingMonth(value)).toBe(expected);
  });
});
