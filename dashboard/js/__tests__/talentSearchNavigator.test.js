import { describe, expect, jest, test } from '@jest/globals';
import {
  copyProfileToJobs,
  merge104JobSnapshot,
  normalize104SearchConditions,
  reconcileOrder,
  reorderVisible,
  request104ExtensionReady,
  validate104SyncWriteResponse,
} from '../talentSearchNavigator.js';

describe('104 extension ready handshake', () => {
  test('actively requests readiness after the dashboard listener is available', () => {
    const targetWindow = { postMessage: jest.fn() };

    request104ExtensionReady(targetWindow, 'https://sp-hr.zeabur.app');

    expect(targetWindow.postMessage).toHaveBeenCalledWith(
      { type: 'SPORTON_104_EXTENSION_READY_REQUEST' },
      'https://sp-hr.zeabur.app'
    );
  });
});

describe('validate104SyncWriteResponse', () => {
  const expectedPayload = {
    contractVersion: 2,
    complete: true,
    sourceTotalCount: 1,
    publishedCount: 1,
    scannedCount: 1,
    jobs: [{ externalId: '123', status: 'open' }],
  };

  function successResult(overrides = {}) {
    return {
      ok: true,
      data: {
        ok: true,
        sync104Jobs: {
          applied: true,
          complete: true,
          contractVersion: 2,
          sourceTotalCount: 1,
          publishedCount: 1,
          scannedCount: 1,
          received: 1,
          accepted: 1,
          upserted: 1,
          pendingConfirmation: 0,
          syncedAt: '2026-07-20T08:30:00Z',
          ...overrides,
        },
      },
    };
  }

  test('accepts an explicitly applied response with matching counts', () => {
    expect(validate104SyncWriteResponse(successResult(), expectedPayload)).toMatchObject({
      ok: true,
      value: { metadata: { hasSnapshot: true, sourceTotalCount: 1, publishedCount: 1 } },
    });
  });

  test('accepts an authoritative zero-published response', () => {
    const emptyPayload = {
      ...expectedPayload,
      sourceTotalCount: 0,
      publishedCount: 0,
      scannedCount: 0,
      jobs: [],
    };
    expect(validate104SyncWriteResponse(successResult({
      sourceTotalCount: 0,
      publishedCount: 0,
      scannedCount: 0,
      received: 0,
      accepted: 0,
      upserted: 0,
    }), emptyPayload)).toMatchObject({ ok: true });
  });

  test('rejects ambiguous 2xx responses, unapplied snapshots, and count mismatches', () => {
    expect(validate104SyncWriteResponse({ ok: true, data: {} }, expectedPayload)).toMatchObject({ ok: false });
    expect(validate104SyncWriteResponse(successResult({ applied: false }), expectedPayload)).toMatchObject({ ok: false });
    expect(validate104SyncWriteResponse(successResult({ scannedCount: 2 }), expectedPayload)).toMatchObject({ ok: false });
  });
});

describe('copyProfileToJobs', () => {
  test('copies one profile and its 104 conditions to multiple jobs without changing the source', () => {
    const profiles = {
      source: [{ id: 'profile-a', name: '精準搜尋', note: 'MIS 經驗', conditions: { url: 'https://vip.104.com.tw/search/searchResult?kws=MIS' } }],
      targetA: [],
      targetB: [{ id: 'existing', name: '其他方案' }]
    };
    let id = 0;
    const result = copyProfileToJobs(profiles, 'source', 'profile-a', ['targetA', 'targetB'], {
      idFactory: () => `copy-${++id}`,
      copiedAt: '2026-07-20T08:00:00.000Z'
    });

    expect(result.copiedJobIds).toEqual(['targetA', 'targetB']);
    expect(result.profilesByJob.source).toBe(profiles.source);
    expect(result.profilesByJob.targetA[0]).toMatchObject({
      id: 'copy-1', name: '精準搜尋', note: 'MIS 經驗',
      copiedFrom: { jobId: 'source', profileId: 'profile-a' },
      createdAt: '2026-07-20T08:00:00.000Z'
    });
    expect(result.profilesByJob.targetB[1].id).toBe('copy-2');
    expect(result.profilesByJob.targetA[0].conditions).toEqual(profiles.source[0].conditions);
    expect(result.profilesByJob.targetA[0].conditions).not.toBe(profiles.source[0].conditions);
  });

  test('creates a distinct name when the destination already has the same scheme', () => {
    const profiles = {
      source: [{ id: 'profile-a', name: '精準搜尋' }],
      target: [{ id: 'one', name: '精準搜尋' }, { id: 'two', name: '精準搜尋（複製）' }]
    };
    const result = copyProfileToJobs(profiles, 'source', 'profile-a', ['target'], { idFactory: () => 'copy' });
    expect(result.profilesByJob.target[2].name).toBe('精準搜尋（複製 2）');
  });

  test('ignores duplicate targets, the source job, and missing profiles', () => {
    const profiles = { source: [{ id: 'profile-a', name: '精準搜尋' }] };
    const result = copyProfileToJobs(profiles, 'source', 'profile-a', ['source', 'target', 'target'], { idFactory: () => 'copy' });
    expect(result.copiedJobIds).toEqual(['target']);
    expect(result.profilesByJob.target).toHaveLength(1);
    expect(copyProfileToJobs(profiles, 'source', 'missing', ['target']).copiedJobIds).toEqual([]);
  });
});

describe('normalize104SearchConditions', () => {
  test('accepts a 104 search result URL and removes the temporary load time', () => {
    const conditions = normalize104SearchConditions({
      url: 'https://vip.104.com.tw/search/searchResult?loadTime=temporary&kws=MIS&edu%5B%5D=4&edu%5B%5D=8',
      resultCount: 147,
      capturedAt: '2026-07-17T09:00:00.000Z'
    });
    expect(conditions).toMatchObject({ keyword: 'MIS', resultCount: 147, capturedAt: '2026-07-17T09:00:00.000Z' });
    expect(conditions.url).not.toContain('loadTime');
    expect(new URL(conditions.url).searchParams.getAll('edu[]')).toEqual(['4', '8']);
  });

  test('rejects non-104 and non-result URLs', () => {
    expect(normalize104SearchConditions({ url: 'https://example.com/search/searchResult?kws=MIS' })).toBeNull();
    expect(normalize104SearchConditions({ url: 'https://vip.104.com.tw/search/listSearch?kws=MIS' })).toBeNull();
  });
});

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
