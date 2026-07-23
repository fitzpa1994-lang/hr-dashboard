import { describe, expect, test } from '@jest/globals';
import {
  buildPriorityPayload,
  movePriorityJob,
  movePriorityJobByStep,
  normalizeOpen104PriorityJobs,
  normalizePriorityLevel,
  reindexPriorityJobs,
  sortPriorityJobs,
  validatePriorityWriteResponse,
} from '../jobsEditor.js';

function job(externalId, title, priorityLevel, displayOrder, overrides = {}) {
  return {
    externalId: String(externalId),
    title,
    status: 'open',
    priorityLevel,
    displayOrder,
    ...overrides,
  };
}

describe('104 priority normalization', () => {
  test('keeps only valid open 104 postings and accepts API snake_case fields', () => {
    const result = normalizeOpen104PriorityJobs([
      { externalId: 12, title: ' B 職缺 ', status: 'OPEN', priority_level: '1', display_order: '4' },
      { externalId: '13', pos: 'A 職缺', status: 'open', priorityLevel: 9, displayOrder: -1 },
      { externalId: 'bad-id', title: '無效 ID', status: 'open' },
      { externalId: '14', title: '已關閉', status: 'closed' },
      { externalId: '15', title: '   ', status: 'open' },
    ]);

    expect(result).toEqual([
      expect.objectContaining({ externalId: '12', title: 'B 職缺', priorityLevel: 1, displayOrder: 4 }),
      expect.objectContaining({ externalId: '13', title: 'A 職缺', priorityLevel: 2, displayOrder: 0 }),
    ]);
    expect(normalizePriorityLevel('3')).toBe(3);
    expect(normalizePriorityLevel('urgent')).toBe(2);
  });

  test('sorts by priority, saved order, title, then 104 id', () => {
    const sorted = sortPriorityJobs([
      job('30', '最後', 2, 0),
      job('22', 'B', 1, 1),
      job('21', 'A', 1, 1),
      job('20', '最前', 1, 0),
    ]);

    expect(sorted.map(item => item.externalId)).toEqual(['20', '21', '22', '30']);
  });
});

describe('104 priority ordering', () => {
  const rows = [
    job('1', 'A', 1, 0),
    job('2', 'B', 1, 1),
    job('3', 'C', 1, 2),
    job('4', 'D', 2, 0),
  ];

  test('moves a posting before or after another row in the same priority', () => {
    const before = movePriorityJob(rows, '3', 1, '2');
    expect(before.map(item => item.externalId)).toEqual(['1', '3', '2', '4']);
    expect(before.filter(item => item.priorityLevel === 1).map(item => item.displayOrder)).toEqual([0, 1, 2]);

    const after = movePriorityJob(rows, '1', 1, '2', true);
    expect(after.map(item => item.externalId)).toEqual(['2', '1', '3', '4']);
  });

  test('moves a posting across priorities and does not move when dropped on itself', () => {
    const crossGroup = movePriorityJob(rows, '4', 1, '2', true);
    expect(crossGroup.map(item => [item.externalId, item.priorityLevel, item.displayOrder])).toEqual([
      ['1', 1, 0],
      ['2', 1, 1],
      ['4', 1, 2],
      ['3', 1, 3],
    ]);

    expect(movePriorityJob(rows, '2', 1, '2').map(item => item.externalId)).toEqual(['1', '2', '3', '4']);
  });

  test('moves one step for keyboard and touch controls without crossing priority groups', () => {
    expect(movePriorityJobByStep(rows, '2', -1).map(item => item.externalId)).toEqual(['2', '1', '3', '4']);
    expect(movePriorityJobByStep(rows, '2', 1).map(item => item.externalId)).toEqual(['1', '3', '2', '4']);
    expect(movePriorityJobByStep(rows, '1', -1).map(item => item.externalId)).toEqual(['1', '2', '3', '4']);
    expect(movePriorityJobByStep(rows, '4', -1).map(item => item.externalId)).toEqual(['1', '2', '3', '4']);
  });

  test('reindexes each priority independently and builds only the API contract fields', () => {
    const reindexed = reindexPriorityJobs([
      job('1', 'A', 1, 8),
      job('4', 'D', 2, 9),
      job('2', 'B', 1, 12),
    ]);
    expect(reindexed.map(item => item.displayOrder)).toEqual([0, 0, 1]);

    expect(buildPriorityPayload([
      job('4', 'D', 2, 7, { extra: 'ignored' }),
      job('2', 'B', 1, 4),
      job('1', 'A', 1, 1),
    ])).toEqual([
      { externalId: '1', priorityLevel: 1, displayOrder: 0 },
      { externalId: '2', priorityLevel: 1, displayOrder: 1 },
      { externalId: '4', priorityLevel: 2, displayOrder: 0 },
    ]);
  });
});

describe('validatePriorityWriteResponse', () => {
  test('requires explicit success and the exact updated count', () => {
    const result = {
      ok: true,
      data: { ok: true, priorityUpdate: { updated: 3 } },
    };
    expect(validatePriorityWriteResponse(result, 3)).toEqual({ ok: true, value: { updated: 3 } });

    expect(validatePriorityWriteResponse({ ok: true, data: {} }, 3)).toMatchObject({ ok: false });
    expect(validatePriorityWriteResponse({ ok: false, data: { error: '上游失敗' } }, 3)).toEqual({ ok: false, error: '上游失敗' });
    expect(validatePriorityWriteResponse({ ok: true, data: { ok: true, priorityUpdate: { updated: 2 } } }, 3)).toMatchObject({ ok: false });
    expect(validatePriorityWriteResponse({ ok: true, data: { ok: true, priorityUpdate: { updated: '3' } } }, 3)).toMatchObject({ ok: false });
  });
});
