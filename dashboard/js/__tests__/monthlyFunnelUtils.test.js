import { describe, expect, test } from '@jest/globals';
import {
  aggregateMonthlyFunnel,
  buildMonthWindow,
  calculateMonthDelta,
  deltaTone,
  formatConversionRate,
  formatDeltaPeople,
  formatDeltaPercentage,
  listFunnelFilters,
} from '../monthlyFunnelUtils.js';

describe('calculateMonthDelta', () => {
  test('handles flat zero without NaN or Infinity', () => {
    const delta = calculateMonthDelta(0, 0);
    expect(delta).toMatchObject({ kind: 'flat', difference: 0, percentage: 0 });
    expect(formatDeltaPeople(delta)).toBe('持平');
    expect(formatDeltaPercentage(delta)).toBe('0%');
  });

  test('describes a positive value after zero as newly added', () => {
    const delta = calculateMonthDelta(7, 0);
    expect(delta).toMatchObject({ kind: 'new', difference: 7, percentage: null });
    expect(formatDeltaPeople(delta)).toBe('新增 7 人');
    expect(formatDeltaPercentage(delta)).toBe('—');
  });

  test('formats a drop to zero as minus one hundred percent', () => {
    const delta = calculateMonthDelta(0, 5);
    expect(delta).toMatchObject({ kind: 'decrease', difference: -5, percentage: -100 });
    expect(formatDeltaPeople(delta)).toBe('減少 5 人');
    expect(formatDeltaPercentage(delta)).toBe('-100%');
  });

  test('keeps resignation increases negative and decreases positive', () => {
    expect(deltaTone('resign', calculateMonthDelta(3, 1))).toBe('negative');
    expect(deltaTone('resign', calculateMonthDelta(1, 3))).toBe('positive');
    expect(deltaTone('onboard', calculateMonthDelta(3, 1))).toBe('positive');
  });
});

describe('formatConversionRate', () => {
  test('returns a dash when denominator is zero or data is unavailable', () => {
    expect(formatConversionRate(3, 0)).toBe('—');
    expect(formatConversionRate(null, 3)).toBe('—');
  });

  test('rounds valid conversion rates', () => {
    expect(formatConversionRate(2, 3)).toBe('67%');
  });
});

describe('aggregateMonthlyFunnel', () => {
  const rows = [
    { department: 'ICC', month: '2026-05', recommend: 5, interview: 2, onboard: 1, resign: 0 },
    { department: 'ICC', month: '2026-07', recommend: 7, interview: 3, onboard: 2, resign: 1 },
    { department: 'WBU', month: '2026-07', recommend: 4, interview: 2, onboard: 0, resign: 2 },
  ];

  test('builds a continuous month window and aggregates all departments', () => {
    const model = aggregateMonthlyFunnel(rows, { range: 6 });
    expect(model.latestMonth).toBe('2026-07');
    expect(model.series.map(row => row.month)).toEqual([
      '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
    ]);
    expect(model.series.at(-1)).toMatchObject({
      recommend: 11,
      interview: 5,
      onboard: 2,
      resign: 3,
    });
    expect(model.series.at(-2)).toMatchObject({
      recommend: 0,
      interview: 0,
      onboard: 0,
      resign: 0,
    });
  });

  test('filters by department and preserves unavailable job metrics as null', () => {
    const departmentModel = aggregateMonthlyFunnel(rows, {
      selectedKey: 'department:ICC',
      range: 6,
    });
    expect(departmentModel.series.at(-1).recommend).toBe(7);

    const jobModel = aggregateMonthlyFunnel([
      {
        job_requisition_id: 9,
        department: 'ICC',
        position_title: '工程師',
        month: '2026-07',
        recommend: 4,
        interview: 2,
      },
    ], { granularity: 'job', selectedKey: 'job:9', range: 6 });
    expect(jobModel.availability).toMatchObject({ recommend: true, interview: true, onboard: false, resign: false });
    expect(jobModel.series.at(-1)).toMatchObject({ recommend: 4, interview: 2, onboard: null, resign: null });
  });

  test('lists stable filter options', () => {
    expect(listFunnelFilters(rows, 'department')).toEqual([
      { value: 'department:ICC', label: 'ICC' },
      { value: 'department:WBU', label: 'WBU' },
    ]);
  });
});

test('buildMonthWindow supports twelve months across years', () => {
  expect(buildMonthWindow('2026-02', 12)).toEqual([
    '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08',
    '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
  ]);
});
