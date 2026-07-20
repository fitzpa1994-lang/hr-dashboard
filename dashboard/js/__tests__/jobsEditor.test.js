import { describe, expect, test } from '@jest/globals';
import {
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
