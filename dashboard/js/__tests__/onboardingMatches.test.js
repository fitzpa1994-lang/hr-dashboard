import { describe, test, expect } from '@jest/globals';
import { analyzeOnboardingRequisitionMatches } from '../dataUtils.js';

describe('analyzeOnboardingRequisitionMatches', () => {
  test('counts exact matches and unmatched pending onboardings', () => {
    const result = analyzeOnboardingRequisitionMatches(
      [
        { name: 'A', dept: '全球檢測股份有限公司 技術支援部', pos: '案件專員', status: 'pending' },
        { name: 'B', dept: '安規營運處', pos: '電池工程師', status: 'pending' },
        { name: 'C', dept: '全球檢測股份有限公司 技術支援部', pos: '案件專員', status: 'cancelled' },
      ],
      [
        { id: 1, dept: 'ICC / 技術支援部', pos: '案件專員', headcount: 2, status: 'open' },
        { id: 2, dept: '安規', pos: '電池案件工程師', headcount: 1, status: 'open' },
      ]
    );

    expect(result.pendingOnboardCount).toBe(2);
    expect(result.matchedCount).toBe(2);
    expect(result.unmatchedCount).toBe(0);
    expect(result.decrementableMatchCount).toBe(2);
    expect(result.matched[0].onboarding.name).toBe('A');
  });

  test('does not mark closed requisitions as decrementable', () => {
    const result = analyzeOnboardingRequisitionMatches(
      [{ name: 'A', dept: '新華營運處 PM', pos: '案件專員', status: 'pending' }],
      [{ id: 3, dept: '新華 / PM', pos: 'PM', headcount: 0, status: 'cancelled' }]
    );

    expect(result.matchedCount).toBe(1);
    expect(result.decrementableMatchCount).toBe(0);
    expect(result.matched[0].canDecrement).toBe(false);
  });
});
