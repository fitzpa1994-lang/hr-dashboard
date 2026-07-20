import { describe, expect, test } from '@jest/globals';
import {
  normalizeExternal104SyncMetadata,
  POSTGRES_INTEGER_MAX,
  validateComplete104SyncPayload,
} from '../sync104Contract.js';

function completePayload(overrides = {}) {
  return {
    contractVersion: 2,
    complete: true,
    sourceTotalCount: 2,
    publishedCount: 1,
    scannedCount: 2,
    syncedAt: '2026-07-20T08:30:00.000Z',
    jobs: [{
      externalId: '123456',
      title: 'Software Engineer',
      url: 'https://vip.104.com.tw/job/jobmaster?jobno=123456',
      updatedDate: '2026-07-20',
      status: 'open',
    }],
    ...overrides,
  };
}

describe('validateComplete104SyncPayload', () => {
  test('accepts v2 metadata without inferring closed rows into jobs', () => {
    expect(validateComplete104SyncPayload(completePayload())).toMatchObject({
      ok: true,
      value: {
        contractVersion: 2,
        complete: true,
        sourceTotalCount: 2,
        publishedCount: 1,
        scannedCount: 2,
      },
    });
  });

  test('accepts a successful zero-published snapshot', () => {
    expect(validateComplete104SyncPayload(completePayload({
      sourceTotalCount: 3,
      publishedCount: 0,
      scannedCount: 3,
      jobs: [],
    })).ok).toBe(true);
  });

  test.each([
    ['old contract', { contractVersion: 1 }],
    ['missing contract', { contractVersion: undefined }],
    ['incomplete', { complete: false }],
    ['missing source count', { sourceTotalCount: undefined }],
    ['missing published count', { publishedCount: undefined }],
    ['missing scanned count', { scannedCount: undefined }],
    ['scan mismatch', { scannedCount: 1 }],
    ['published mismatch', { publishedCount: 0 }],
    ['PostgreSQL overflow', { sourceTotalCount: POSTGRES_INTEGER_MAX + 1, scannedCount: POSTGRES_INTEGER_MAX + 1 }],
    ['non-open job', { jobs: [{ ...completePayload().jobs[0], status: 'closed' }] }],
    ['duplicate job', {
      sourceTotalCount: 2,
      publishedCount: 2,
      scannedCount: 2,
      jobs: [completePayload().jobs[0], { ...completePayload().jobs[0] }],
    }],
  ])('rejects %s instead of falling back', (_label, overrides) => {
    expect(validateComplete104SyncPayload(completePayload(overrides)).ok).toBe(false);
  });
});

describe('normalizeExternal104SyncMetadata', () => {
  test('keeps hasSnapshot true when the authoritative published count is zero', () => {
    expect(normalizeExternal104SyncMetadata({
      hasSnapshot: true,
      source: '104',
      contractVersion: 2,
      sourceTotalCount: 4,
      publishedCount: 0,
      lastSyncAt: '2026-07-20T08:30:00.000Z',
    })).toEqual({
      hasSnapshot: true,
      source: '104',
      contractVersion: 2,
      sourceTotalCount: 4,
      publishedCount: 0,
      lastSyncAt: '2026-07-20T08:30:00.000Z',
    });
  });

  test('does not manufacture a snapshot from jobs or invalid metadata', () => {
    expect(normalizeExternal104SyncMetadata({ hasSnapshot: false, publishedCount: 9 }).hasSnapshot).toBe(false);
    expect(normalizeExternal104SyncMetadata({
      hasSnapshot: true,
      contractVersion: 1,
      sourceTotalCount: 1,
      publishedCount: 1,
      lastSyncAt: '2026-07-20T08:30:00.000Z',
    }).hasSnapshot).toBe(false);
  });
});
