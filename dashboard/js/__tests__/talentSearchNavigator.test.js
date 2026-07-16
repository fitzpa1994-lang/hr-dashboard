import { describe, expect, test } from '@jest/globals';
import { reconcileOrder, reorderVisible } from '../talentSearchNavigator.js';

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
