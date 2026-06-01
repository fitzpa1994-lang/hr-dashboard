import { describe, test, expect } from '@jest/globals';
import { analyzeOnboardingRequisitionMatches } from '../dataUtils.js';

describe('analyzeOnboardingRequisitionMatches', () => {
  test('counts exact matches and unmatched pending onboardings', () => {
    const result = analyzeOnboardingRequisitionMatches(
      [
        { name: 'A', dept: '五部', pos: 'RF SAR 測試工程師', status: 'pending' },
        { name: 'B', dept: '新竹 工程部', pos: '工程師(EMC)', status: 'pending' },
        { name: 'C', dept: '五部', pos: 'RF SAR 測試工程師', status: 'cancelled' },
      ],
      [
        { id: 1, dept: '五部', pos: 'RF SAR 測試工程師', headcount: 999, status: 'open' },
        { id: 2, dept: '新竹測試工程師', pos: 'ignored', headcount: 4, status: 'open' },
      ]
    );

    expect(result.pendingOnboardCount).toBe(2);
    expect(result.matchedCount).toBe(1);
    expect(result.unmatchedCount).toBe(1);
    expect(result.decrementableMatchCount).toBe(1);
    expect(result.matched[0].onboarding.name).toBe('A');
    expect(result.unmatched[0].name).toBe('B');
  });

  test('does not mark closed requisitions as decrementable', () => {
    const result = analyzeOnboardingRequisitionMatches(
      [{ name: 'A', dept: '五部', pos: 'SAR工程助理', status: 'pending' }],
      [{ id: 3, dept: '五部', pos: 'SAR工程助理', headcount: 0, status: 'cancelled' }]
    );

    expect(result.matchedCount).toBe(1);
    expect(result.decrementableMatchCount).toBe(0);
    expect(result.matched[0].canDecrement).toBe(false);
  });
});
