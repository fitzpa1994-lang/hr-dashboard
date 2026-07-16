import { describe, expect, test } from '@jest/globals';
import { merge104JobSnapshot, reconcileOrder, reorderVisible } from '../talentSearchNavigator.js';

describe('reconcileOrder', () => {
  test('keeps the saved job order and appends newly synced jobs', () => {
    expect(reconcileOrder(['a', 'b', 'c'], ['b', 'a'])).toEqual(['b', 'a', 'c']);
  });

  test('preserves temporarily missing jobs so reopening restores their position', () => {
    expect(reconcileOrder(['a', 'c'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  test('removes duplicate saved identifiers', () => {
    expect(reconcileOrder(['a', 'b'], ['a', 'a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('reorderVisible', () => {
  test('moves a job without disturbing filtered-out positions', () => {
    const full = ['a', 'hidden-1', 'b', 'hidden-2', 'c'];
    const visible = ['a', 'b', 'c'];
    expect(reorderVisible(full, visible, 'c', 'a')).toEqual(['c', 'hidden-1', 'a', 'hidden-2', 'b']);
  });

  test('supports dropping after the target row', () => {
    expect(reorderVisible(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 'b', true)).toEqual(['b', 'a', 'c']);
  });

  test('leaves order unchanged for invalid drag targets', () => {
    expect(reorderVisible(['a', 'b'], ['a'], 'a', 'b')).toEqual(['a', 'b']);
  });
});

describe('merge104JobSnapshot', () => {
  test('uses the stable 104 job number and preserves existing local data', () => {
    const result = merge104JobSnapshot(
      [{ id: '104:123', externalId: '123', pos: '舊名稱', note: '保留備註', status: 'open' }],
      [{ externalId: '123', title: '新名稱', updatedDate: '07/16' }],
      '2026-07-16T08:00:00.000Z'
    );
    expect(result[0]).toMatchObject({
      id: '104:123', externalId: '123', pos: '新名稱', note: '保留備註', status: 'open', updatedDate: '07/16'
    });
  });

  test('marks missing jobs for confirmation instead of deleting them', () => {
    const result = merge104JobSnapshot(
      [{ id: '104:123', externalId: '123', pos: 'A', status: 'open' }],
      [],
      '2026-07-16T08:00:00.000Z'
    );
    expect(result).toEqual([{ id: '104:123', externalId: '123', pos: 'A', status: 'pending_confirmation' }]);
  });

  test('ignores malformed and duplicate jobs', () => {
    const result = merge104JobSnapshot([], [
      { externalId: '123', title: 'A' },
      { externalId: '123', title: 'A duplicate' },
      { externalId: 'bad', title: 'B' }
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].pos).toBe('A');
  });
});
