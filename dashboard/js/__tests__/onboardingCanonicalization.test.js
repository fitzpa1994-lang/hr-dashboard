import { describe, test, expect } from '@jest/globals';
import {
  canonicalizeOnboardingDepartment,
  canonicalizeOnboardingPosition,
  canonicalizeOnboardingMatch,
} from '../onboardingCanonicalization.js';

describe('canonicalizeOnboardingDepartment', () => {
  test('collapses live SAR department naming to requisition department', () => {
    expect(canonicalizeOnboardingDepartment('五部 SAR工程部', { emailSubject: '6/1 SAR工程師 張洛圖 已報到' })).toBe('五部');
    expect(canonicalizeOnboardingDepartment('新華 RF工程組', { emailSubject: '黃彥彰 已報到' })).toBe('新華');
    expect(canonicalizeOnboardingDepartment('ICC 技術支援部', { emailSubject: '翁如慧 已報到' })).toBe('全球');
    expect(canonicalizeOnboardingDepartment('新竹 工程部', { emailSubject: '陳朝詳 已報到' })).toBe('新竹');
  });
});

describe('canonicalizeOnboardingPosition', () => {
  test('maps safe subject/title aliases to seeded requisition titles', () => {
    expect(canonicalizeOnboardingPosition('工程師', {
      department: '五部 SAR工程部',
      rawDepartment: '五部 SAR工程部',
      emailSubject: '6/1 (一) SAR工程師 張洛圖 已報到',
    })).toBe('RF SAR 測試工程師');

    expect(canonicalizeOnboardingPosition('工程師(EMC)', {
      department: '新竹 工程部',
      rawDepartment: '新竹 工程部',
      emailSubject: '新竹 EMC 工程師 陳朝詳 已報到',
    })).toBe('新竹測試工程師');

    expect(canonicalizeOnboardingPosition('客服業務', {
      department: 'ICC 業務部',
      rawDepartment: 'ICC 業務部',
      emailSubject: 'ICC 客服業務 某某 已報到',
    })).toBe('ICC 客服業務');

    expect(canonicalizeOnboardingPosition('工程師', {
      department: '新華 RF工程組',
      rawDepartment: '新華 RF工程組',
      emailSubject: '黃彥彰 已報到',
    })).toBe('RF SAR 測試工程師');

    expect(canonicalizeOnboardingPosition('工程師', {
      department: '五部 RF工程一部',
      rawDepartment: '五部 RF工程一部',
      emailSubject: '盧政樺 已報到',
    })).toBe('WE1：場測工程師');

    expect(canonicalizeOnboardingPosition('實習工程師', {
      department: '五部 RF工程一部',
      rawDepartment: '五部 RF工程一部',
      emailSubject: '楊麗琴 已報到',
    })).toBe('WE1工程助理(理工相關)');
  });
});

describe('canonicalizeOnboardingMatch', () => {
  test('returns canonical fields without discarding the raw inputs', () => {
    const result = canonicalizeOnboardingMatch({
      department: '五部 SAR工程部',
      position: '工程師',
      emailSubject: '6/1 (一) SAR工程師 張洛圖 已報到',
    });

    expect(result.department).toBe('五部 SAR工程部');
    expect(result.position).toBe('工程師');
    expect(result.canonicalDepartment).toBe('五部');
    expect(result.canonicalPosition).toBe('RF SAR 測試工程師');
  });
});
