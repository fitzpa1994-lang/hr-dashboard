import { describe, test, expect } from '@jest/globals';
import {
  canonicalizeOnboardingDepartment,
  canonicalizeOnboardingPosition,
  canonicalizeOnboardingMatch,
} from '../onboardingCanonicalization.js';

describe('canonicalizeOnboardingDepartment', () => {
  test('collapses live onboarding mail paths to formal requisition org paths', () => {
    expect(canonicalizeOnboardingDepartment('國際標準認證事業五部 RF工程一部', { emailSubject: '錄取通知事宜-楊麗琴' })).toBe('WBU / RF工程一部');
    expect(canonicalizeOnboardingDepartment('全球檢測股份有限公司 技術支援部', { emailSubject: '錄取通知事宜-翁如慧' })).toBe('ICC / 技術支援部');
    expect(canonicalizeOnboardingDepartment('新華營運處 工程 / 文件部 文件組', { emailSubject: '錄取通知事宜-蔡雅婷' })).toBe('新華 / 工程 / 文件部 / 文件組');
    expect(canonicalizeOnboardingDepartment('財務部', { emailSubject: '錄取通知事宜-陳天怡' })).toBe('行政 / 財務部');
  });
});

describe('canonicalizeOnboardingPosition', () => {
  test('maps keyword aliases to the requisition titles that keep the original headcounts', () => {
    expect(canonicalizeOnboardingPosition('實習工程師', {
      department: '國際標準認證事業五部 RF工程一部',
      rawDepartment: '國際標準認證事業五部 RF工程一部',
      emailSubject: '【耕興股份有限公司】錄取通知事宜-楊麗琴',
    })).toBe('測試工程師');

    expect(canonicalizeOnboardingPosition('案件專員', {
      department: '全球檢測股份有限公司 技術支援部',
      rawDepartment: '全球檢測股份有限公司 技術支援部',
      emailSubject: '【耕興子公司-全球檢測】錄取通知事宜-翁如慧',
    })).toBe('案件專員');

    expect(canonicalizeOnboardingPosition('客服業務', {
      department: '新華營運處 業務三部',
      rawDepartment: '新華營運處 業務三部',
      emailSubject: '【耕興股份有限公司】錄取通知事宜-馬偉豪',
    })).toBe('客服業務');

    expect(canonicalizeOnboardingPosition('財務主任', {
      department: '財務部',
      rawDepartment: '財務部',
      emailSubject: '【耕興股份有限公司】錄取通知事宜-陳天怡',
    })).toBe('主任');

    expect(canonicalizeOnboardingPosition('出納專員(職務代理)', {
      department: '總公司 財務部',
      rawDepartment: '總公司 財務部',
      emailSubject: '【耕興股份有限公司】錄取通知事宜-邱美玲',
    })).toBe('出納短期職代');

    expect(canonicalizeOnboardingPosition('電池工程師', {
      department: '安規營運處',
      rawDepartment: '安規營運處',
      emailSubject: '安規 電池 工程師 錄取通知',
    })).toBe('電池案件工程師');
  });
});

describe('canonicalizeOnboardingMatch', () => {
  test('returns canonical fields without discarding the raw inputs', () => {
    const result = canonicalizeOnboardingMatch({
      department: '全球檢測股份有限公司 技術支援部',
      position: '案件專員',
      emailSubject: '【耕興子公司-全球檢測】錄取通知事宜-翁如慧',
    });

    expect(result.department).toBe('全球檢測股份有限公司 技術支援部');
    expect(result.position).toBe('案件專員');
    expect(result.canonicalDepartment).toBe('ICC / 技術支援部');
    expect(result.canonicalPosition).toBe('案件專員');
  });
});
