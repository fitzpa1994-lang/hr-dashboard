import { describe, expect, test } from '@jest/globals';
import {
  RECONCILIATION_STATES,
  normalizeExternal104Job,
  normalizeReconciliationTitle,
  readTalentNavigatorStorageSnapshot,
  reconcileJobRequisitions,
} from '../jobReconciliation.js';

const openInternal = (id, pos, dept = '研發') => ({
  id,
  pos,
  dept,
  headcount: 1,
  status: 'open',
});

const closedInternal = (id, pos, dept = '研發') => ({
  id,
  pos,
  dept,
  headcount: 0,
  status: 'cancelled',
});

describe('normalizeExternal104Job', () => {
  test('normalizes 104 aliases and persisted mapping without mutating the source', () => {
    const source = {
      id: '104:12345',
      pos: '  RF   Engineer  ',
      department: '工程處',
      status: 'pending_confirmation',
      job_requisition_id: ' 9 ',
    };
    const before = structuredClone(source);

    expect(normalizeExternal104Job(source)).toMatchObject({
      id: '104:12345',
      externalId: '12345',
      pos: 'RF Engineer',
      title: 'RF Engineer',
      dept: '工程處',
      status: 'pending_confirmation',
      jobRequisitionId: '9',
      isExternalOpen: false,
    });
    expect(source).toEqual(before);
  });

  test('normalizes only Unicode, whitespace, and case for exact title suggestions', () => {
    expect(normalizeReconciliationTitle('  ＲＦ   Engineer ')).toBe('rf engineer');
    expect(normalizeReconciliationTitle('RF-Engineer')).not.toBe(normalizeReconciliationTitle('RF Engineer'));
  });
});

describe('readTalentNavigatorStorageSnapshot', () => {
  test('reads the existing navigator localStorage record and sync marker', () => {
    const storage = {
      getItem: () => JSON.stringify({
        lastSyncAt: '2026-07-20T01:00:00.000Z',
        syncedJobs: [{ externalId: '88', pos: 'MIS 工程師', status: 'open', jobRequisitionId: 4 }],
      }),
    };

    expect(readTalentNavigatorStorageSnapshot(storage)).toEqual({
      lastSyncAt: '2026-07-20T01:00:00.000Z',
      hasSuccessfulSync: true,
      external104Jobs: [expect.objectContaining({
        id: '104:88',
        externalId: '88',
        title: 'MIS 工程師',
        jobRequisitionId: 4,
      })],
    });
  });

  test('fails closed for invalid or unavailable storage', () => {
    expect(readTalentNavigatorStorageSnapshot('{invalid')).toEqual({
      external104Jobs: [],
      lastSyncAt: '',
      hasSuccessfulSync: false,
    });
    expect(readTalentNavigatorStorageSnapshot(null)).toEqual({
      external104Jobs: [],
      lastSyncAt: '',
      hasSuccessfulSync: false,
    });
  });
});

describe('reconcileJobRequisitions', () => {
  test('covers the synced status matrix while retaining legacy displayStatus logic', () => {
    const result = reconcileJobRequisitions({
      internalRequisitions: [
        openInternal(1, 'A'),
        closedInternal(2, 'B'),
        openInternal(3, 'C'),
        closedInternal(4, 'D'),
        openInternal(5, 'E'),
      ],
      external104Jobs: [
        { externalId: '101', title: 'A', status: 'open', jobRequisitionId: 1 },
        { externalId: '102', title: 'B', status: 'open', jobRequisitionId: 2 },
        { externalId: '103', title: 'C', status: 'pending_confirmation', jobRequisitionId: 3 },
        { externalId: '104', title: 'D', status: 'pending_confirmation', jobRequisitionId: 4 },
        { externalId: '105', title: '外部未連結', status: 'open' },
      ],
      hasSuccessfulSync: true,
    });

    expect(result.internalRows.map(row => row.displayStatus)).toEqual([
      'open', 'closed', 'open', 'closed', 'open',
    ]);
    expect(result.internalRows.map(row => row.reconciliationState)).toEqual([
      RECONCILIATION_STATES.IN_SYNC,
      RECONCILIATION_STATES.EXTERNAL_OPEN_INTERNAL_CLOSED,
      RECONCILIATION_STATES.EXTERNAL_MISSING_INTERNAL_OPEN,
      RECONCILIATION_STATES.EXTERNAL_MISSING_INTERNAL_CLOSED,
      RECONCILIATION_STATES.INTERNAL_UNLINKED,
    ]);
    expect(result.unmatchedExternal).toHaveLength(1);
    expect(result.unmatchedExternal[0].reconciliationState).toBe(RECONCILIATION_STATES.EXTERNAL_UNLINKED);
    expect(result.summary).toMatchObject({
      internalTotal: 5,
      externalTotal: 5,
      linkedInternalTotal: 4,
      linkedExternalTotal: 4,
      unmatchedExternalTotal: 1,
    });
  });

  test('supports multiple 104 postings for one internal requisition', () => {
    const result = reconcileJobRequisitions({
      internalRequisitions: [openInternal(7, '韌體工程師')],
      external104Jobs: [
        { externalId: '201', title: '韌體工程師（台北）', status: 'open', jobRequisitionId: 7 },
        { externalId: '202', title: '韌體工程師（高雄）', status: 'open', jobRequisitionId: '7' },
      ],
      hasSuccessfulSync: true,
    });

    expect(result.internalRows[0].links.map(job => job.externalId)).toEqual(['201', '202']);
    expect(result.internalRows[0].reconciliationState).toBe(RECONCILIATION_STATES.IN_SYNC);
    expect(result.summary.linkedExternalTotal).toBe(2);
  });

  test('keeps a confirmed ID link after the 104 posting is renamed', () => {
    const result = reconcileJobRequisitions({
      internalRequisitions: [openInternal(12, '舊職缺名稱')],
      external104Jobs: [{
        externalId: '301',
        title: '104 上的新職缺名稱',
        status: 'open',
        jobRequisitionId: '12',
      }],
      hasSuccessfulSync: true,
    });

    expect(result.internalRows[0].links).toHaveLength(1);
    expect(result.internalRows[0].links[0].title).toBe('104 上的新職缺名稱');
    expect(result.internalRows[0].suggestedLinks).toEqual([]);
    expect(result.internalRows[0].reconciliationState).toBe(RECONCILIATION_STATES.IN_SYNC);
  });

  test('returns a unique normalized-title suggestion but never treats it as a link', () => {
    const result = reconcileJobRequisitions({
      internalRequisitions: [openInternal(20, 'ＲＦ   Engineer')],
      external104Jobs: [{ externalId: '401', title: 'rf engineer', status: 'open' }],
      hasSuccessfulSync: true,
    });

    expect(result.internalRows[0].links).toEqual([]);
    expect(result.internalRows[0].suggestedLinks.map(job => job.externalId)).toEqual(['401']);
    expect(result.internalRows[0].reconciliationState).toBe(RECONCILIATION_STATES.INTERNAL_UNLINKED);
    expect(result.unmatchedExternal[0].suggestedJobRequisitionId).toBe(20);
    expect(result.unmatchedExternal[0].reconciliationState).toBe(RECONCILIATION_STATES.EXTERNAL_UNLINKED);
  });

  test('does not suggest a same-title posting when internal departments are ambiguous', () => {
    const result = reconcileJobRequisitions({
      internalRequisitions: [
        openInternal(30, '測試工程師', '台北研發'),
        openInternal(31, '測試工程師', '高雄研發'),
      ],
      external104Jobs: [{ externalId: '501', title: '測試工程師', status: 'open' }],
      hasSuccessfulSync: true,
    });

    expect(result.internalRows.every(row => row.links.length === 0)).toBe(true);
    expect(result.internalRows.every(row => row.suggestedLinks.length === 0)).toBe(true);
    expect(result.unmatchedExternal[0].suggestedJobRequisitionId).toBeNull();
  });

  test('does not suggest when multiple external postings have the same title, including a pending one', () => {
    const result = reconcileJobRequisitions({
      internalRequisitions: [openInternal(40, '業務專員')],
      external104Jobs: [
        { externalId: '601', title: '業務專員', status: 'open' },
        { externalId: '602', title: '業務專員', status: 'pending_confirmation' },
      ],
      hasSuccessfulSync: true,
    });

    expect(result.internalRows[0].suggestedLinks).toEqual([]);
    expect(result.unmatchedExternal.map(job => job.suggestedJobRequisitionId)).toEqual([null, null]);
  });

  test('reports not_synced instead of missing or mismatch diagnoses for stale data', () => {
    const inputs = {
      internalRequisitions: [openInternal(50, '資料工程師')],
      external104Jobs: [
        { externalId: '701', title: '資料工程師', status: 'pending_confirmation', jobRequisitionId: 50 },
        { externalId: '702', title: '資料工程師', status: 'open' },
      ],
      hasSuccessfulSync: false,
    };
    const before = structuredClone(inputs);
    const result = reconcileJobRequisitions(inputs);

    expect(result.internalRows[0].links).toHaveLength(1);
    expect(result.internalRows[0].suggestedLinks).toEqual([]);
    expect(result.internalRows[0].reconciliationState).toBe(RECONCILIATION_STATES.NOT_SYNCED);
    expect(result.unmatchedExternal[0].reconciliationState).toBe(RECONCILIATION_STATES.NOT_SYNCED);
    expect(result.unmatchedExternal[0].suggestedJobRequisitionId).toBeNull();
    expect(result.summary.hasSuccessfulSync).toBe(false);
    expect(result.summary.byState.not_synced).toBe(2);
    expect(inputs).toEqual(before);
  });

  test('leaves a dangling persisted mapping unmatched and never rewrites it by title', () => {
    const result = reconcileJobRequisitions({
      internalRequisitions: [openInternal(60, '採購專員')],
      external104Jobs: [{
        externalId: '801',
        title: '採購專員',
        status: 'open',
        jobRequisitionId: 999,
      }],
      hasSuccessfulSync: true,
    });

    expect(result.internalRows[0].links).toEqual([]);
    expect(result.internalRows[0].suggestedLinks).toEqual([]);
    expect(result.unmatchedExternal[0].jobRequisitionId).toBe(999);
    expect(result.unmatchedExternal[0].suggestedJobRequisitionId).toBeNull();
  });
});
