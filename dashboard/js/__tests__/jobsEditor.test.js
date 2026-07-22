import { describe, expect, test } from '@jest/globals';
import {
  getSelectableOpen104Jobs,
  validateExternalLinkWriteResponse,
  validateJobRequisitionWriteResponse,
} from '../jobsEditor.js';

function linkResult(overrides = {}) {
  return {
    ok: true,
    data: {
      ok: true,
      external104Job: {
        externalId: '123456',
        jobRequisitionId: 42,
        title: '資深軟體工程師',
        url: 'https://vip.104.com.tw/job/jobmaster?jobno=123456',
        status: 'open',
        ...overrides,
      },
    },
  };
}

function requisitionResult(overrides = {}) {
  return {
    ok: true,
    data: {
      ok: true,
      requisition: {
        id: 42,
        positionTitle: '資深軟體工程師',
        department: '資訊處',
        headcount: 2,
        urgency: 4,
        status: 'open',
        ...overrides,
      },
    },
  };
}

describe('validateExternalLinkWriteResponse', () => {
  test('accepts matching link and unlink responses', () => {
    expect(validateExternalLinkWriteResponse(linkResult(), '123456', 42)).toMatchObject({
      ok: true,
      value: { externalId: '123456', jobRequisitionId: 42 },
    });
    expect(validateExternalLinkWriteResponse(
      linkResult({ jobRequisitionId: null, status: 'pending_confirmation' }),
      '123456',
      null
    )).toMatchObject({ ok: true, value: { jobRequisitionId: null } });
  });

  test('rejects ambiguous success and mismatched identifiers', () => {
    expect(validateExternalLinkWriteResponse({ ok: true, data: {} }, '123456', 42)).toMatchObject({ ok: false });
    expect(validateExternalLinkWriteResponse(linkResult({ externalId: '999999' }), '123456', 42)).toMatchObject({ ok: false });
    expect(validateExternalLinkWriteResponse(linkResult({ jobRequisitionId: 7 }), '123456', 42)).toMatchObject({ ok: false });
  });
});

describe('validateJobRequisitionWriteResponse', () => {
  test('accepts a complete requisition response and enforces the update id', () => {
    expect(validateJobRequisitionWriteResponse(requisitionResult(), 42)).toMatchObject({
      ok: true,
      value: { id: 42, positionTitle: '資深軟體工程師' },
    });
  });

  test('rejects missing explicit success, invalid shapes, and mismatched ids', () => {
    expect(validateJobRequisitionWriteResponse({ ok: true, data: { requisition: { id: 42 } } })).toMatchObject({ ok: false });
    expect(validateJobRequisitionWriteResponse(requisitionResult({ headcount: '2' }))).toMatchObject({ ok: false });
    expect(validateJobRequisitionWriteResponse(requisitionResult(), 7)).toMatchObject({ ok: false });
  });
});

describe('getSelectableOpen104Jobs', () => {
  test('returns only open, valid, unlinked 104 postings', () => {
    const result = getSelectableOpen104Jobs([
      { externalId: '20', title: '軟體工程師', status: 'open', jobRequisitionId: null },
      { externalId: '21', title: '已配對職缺', status: 'open', jobRequisitionId: 7 },
      { externalId: '22', title: '待確認職缺', status: 'pending_confirmation', jobRequisitionId: null },
      { externalId: 'bad-id', title: '無效職缺', status: 'open', jobRequisitionId: null },
      { externalId: '23', title: '   ', status: 'open', jobRequisitionId: null },
    ]);

    expect(result).toEqual([
      expect.objectContaining({ externalId: '20', title: '軟體工程師', status: 'open' }),
    ]);
  });

  test('trims values and sorts postings by title then external id', () => {
    const result = getSelectableOpen104Jobs([
      { externalId: 12, title: ' B 職缺 ', status: 'open' },
      { externalId: '11', title: 'A 職缺', status: 'open' },
      { externalId: '10', title: 'A 職缺', status: 'open', jobRequisitionId: '' },
    ]);

    expect(result.map(job => [job.externalId, job.title])).toEqual([
      ['10', 'A 職缺'],
      ['11', 'A 職缺'],
      ['12', 'B 職缺'],
    ]);
  });
});
