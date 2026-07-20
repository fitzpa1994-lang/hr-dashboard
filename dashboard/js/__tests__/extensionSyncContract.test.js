import { describe, expect, test } from '@jest/globals';
import {
  SYNC_CONTRACT_VERSION,
  buildComplete104Snapshot,
  classify104PublicationStatus,
  parse104JobTablePage,
} from '../../../chrome-extension/104-job-sync/sync_contract.js';

function rawPage(overrides = {}) {
  return {
    pathname: '/job/allJobList',
    search: '',
    activeScopeLabels: ['所有職務'],
    pageText: '共 1 筆',
    pageButtonText: '第 1 頁',
    headerRows: [['職務名稱', '更新日期', '刊登狀態']],
    rows: [{
      externalId: '123456',
      title: 'Software Engineer',
      href: '/job/jobmaster?jobno=123456',
      cells: ['Software Engineer', '2026/07/20', '刊登中'],
    }],
    ...overrides,
  };
}

describe('104 extension page parser', () => {
  test('accepts an authoritative zero-total page without pagination, headers, or rows', () => {
    const page = parse104JobTablePage(rawPage({
      pageText: '共 0 筆',
      pageButtonText: '',
      headerRows: [],
      rows: [],
    }));

    expect(page).toMatchObject({
      ok: true,
      jobs: [],
      totalCount: 0,
      currentPage: 1,
      pageSize: 30,
      headerSignature: 'empty',
    });
    expect(buildComplete104Snapshot([page], '2026-07-20T08:30:00.000Z')).toEqual({
      ok: true,
      contractVersion: SYNC_CONTRACT_VERSION,
      complete: true,
      jobs: [],
      sourceTotalCount: 0,
      publishedCount: 0,
      scannedCount: 0,
      syncedAt: '2026-07-20T08:30:00.000Z',
    });
  });

  test('still fails closed when a nonzero total has no verifiable rows', () => {
    expect(parse104JobTablePage(rawPage({ rows: [] }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('沒有可驗證的資料列'),
    });
    expect(parse104JobTablePage(rawPage({ pageText: '共 0 筆' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('仍有資料列'),
    });
  });

  test('parses comma-separated totals and follows the uniquely aligned header row', () => {
    const result = parse104JobTablePage(rawPage({
      pageText: '1 - 30，共 1,234 筆',
      headerRows: [
        ['職務資料', '刊登資訊'],
        ['職務名稱', '刊登狀態', '更新日期'],
      ],
      rows: [{
        externalId: '123456',
        title: 'Software Engineer',
        href: '/job/jobmaster?jobno=123456',
        cells: ['Software Engineer', '刊登中', '2026/07/20'],
      }],
    }));

    expect(result).toMatchObject({
      ok: true,
      totalCount: 1234,
      currentPage: 1,
      jobs: [{ externalId: '123456', status: 'open', updatedDate: '2026/07/20' }],
    });
  });

  test('accepts 104 pagination parameters only when filters stay empty and page state agrees', () => {
    expect(parse104JobTablePage(rawPage({
      search: '?page=2&kws=&department=',
      pageButtonText: '第 2 頁',
    }))).toMatchObject({
      ok: true,
      currentPage: 2,
      scopeKey: '/job/allJobList',
    });

    expect(parse104JobTablePage(rawPage({
      search: '?page=2&kws=&department=',
      pageButtonText: '第 1 頁',
    }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('頁碼與目前頁面不一致'),
    });
    expect(parse104JobTablePage(rawPage({
      search: '',
      pageButtonText: '第 2 頁',
    }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('頁碼與目前頁面不一致'),
    });
  });

  test('fails closed without explicit all-jobs evidence or with non-pagination filters', () => {
    expect(parse104JobTablePage(rawPage({ activeScopeLabels: [] }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('所有職務'),
    });
    expect(parse104JobTablePage(rawPage({ search: '?status=closed' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('篩選條件'),
    });
    expect(parse104JobTablePage(rawPage({ search: '?page=2&kws=engineer&department=' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('篩選條件'),
    });
    expect(parse104JobTablePage(rawPage({ search: '?page=2&page=3&kws=&department=' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('篩選條件'),
    });
    for (const search of [
      '?page=2&kws=',
      '?page=2&department=',
      '?page=2&kws=&department=&status=open',
      '?page=0&kws=&department=',
      '?page=01&kws=&department=',
      '?page=1.5&kws=&department=',
      '?page=99999999999999999999&kws=&department=',
    ]) {
      expect(parse104JobTablePage(rawPage({ search }))).toMatchObject({
        ok: false,
        error: expect.stringContaining('篩選條件'),
      });
    }
  });

  test('fails closed when all jobs and a publication-status scope are both active', () => {
    expect(parse104JobTablePage(rawPage({ activeScopeLabels: ['所有職務', '刊登中'] }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('只選取'),
      activeScopeLabels: ['所有職務', '刊登中'],
    });
  });

  test('fails closed for ambiguous headers, unknown statuses, or mismatched job URLs', () => {
    expect(parse104JobTablePage(rawPage({
      headerRows: [
        ['職務名稱', '更新日期', '刊登狀態'],
        ['職務名稱', '處理狀態', '更新日期'],
      ],
    })).error).toContain('唯一對齊');

    expect(parse104JobTablePage(rawPage({
      rows: [{
        externalId: '123456',
        title: 'Software Engineer',
        href: '/job/jobmaster?jobno=123456',
        cells: ['Software Engineer', '2026/07/20', '新狀態'],
      }],
    })).error).toContain('可識別的刊登狀態');

    expect(parse104JobTablePage(rawPage({
      rows: [{
        externalId: '123456',
        title: 'Software Engineer',
        href: '/job/jobmaster?jobno=999999',
        cells: ['Software Engineer', '2026/07/20', '刊登中'],
      }],
    })).error).toContain('網址與編號不一致');
  });
});

describe('104 extension complete snapshot contract', () => {
  test('builds one complete snapshot from canonical base and live paginated URLs', () => {
    const makeRow = index => ({
      externalId: String(200000 + index),
      title: `Job ${index}`,
      href: `/job/jobmaster?jobno=${200000 + index}`,
      cells: [`Job ${index}`, '2026/07/20', '刊登中'],
    });
    const firstPage = parse104JobTablePage(rawPage({
      pageText: '共 31 筆',
      pageButtonText: '第 1 頁',
      rows: Array.from({ length: 30 }, (_, index) => makeRow(index)),
    }));
    const secondPage = parse104JobTablePage(rawPage({
      search: '?department=&page=2&kws=',
      pageText: '共 31 筆',
      pageButtonText: '第 2 頁',
      rows: [makeRow(30)],
    }));

    expect(firstPage).toMatchObject({ ok: true, scopeKey: '/job/allJobList' });
    expect(secondPage).toMatchObject({ ok: true, scopeKey: '/job/allJobList', currentPage: 2 });
    expect(buildComplete104Snapshot([firstPage, secondPage], '2026-07-20T08:30:00.000Z')).toMatchObject({
      ok: true,
      complete: true,
      sourceTotalCount: 31,
      publishedCount: 31,
      scannedCount: 31,
    });
  });

  test('only emits v2 complete metadata after every expected row is present', () => {
    const firstJobs = Array.from({ length: 30 }, (_, index) => ({
      externalId: String(100000 + index),
      status: index === 0 ? 'closed' : 'open',
    }));
    const secondJob = { externalId: '100030', status: 'open' };
    const snapshot = buildComplete104Snapshot([
      {
        ok: true,
        jobs: firstJobs,
        totalCount: 31,
        pageSize: 30,
        currentPage: 1,
        scopeKey: '/job/allJobList',
        headerSignature: '職務名稱|更新日期|刊登狀態',
      },
      {
        ok: true,
        jobs: [secondJob],
        totalCount: 31,
        pageSize: 30,
        currentPage: 2,
        scopeKey: '/job/allJobList',
        headerSignature: '職務名稱|更新日期|刊登狀態',
      },
    ], '2026-07-20T08:30:00.000Z');

    expect(snapshot).toMatchObject({
      ok: true,
      contractVersion: SYNC_CONTRACT_VERSION,
      complete: true,
      sourceTotalCount: 31,
      publishedCount: 30,
      scannedCount: 31,
      syncedAt: '2026-07-20T08:30:00.000Z',
    });
    expect(snapshot.jobs).toHaveLength(30);
  });

  test('rejects duplicate, missing, or inconsistent pages instead of declaring completeness', () => {
    const page = {
      ok: true,
      jobs: [{ externalId: '1', status: 'open' }],
      totalCount: 2,
      pageSize: 30,
      currentPage: 1,
      scopeKey: '/job/allJobList',
      headerSignature: '職務名稱|更新日期|刊登狀態',
    };
    expect(buildComplete104Snapshot([page])).toMatchObject({ ok: false });

    expect(buildComplete104Snapshot([{
      ...page,
      totalCount: 2,
      jobs: [{ externalId: '1', status: 'open' }, { externalId: '1', status: 'open' }],
    }])).toMatchObject({ ok: false, error: expect.stringContaining('重複') });

    expect(buildComplete104Snapshot([{
      ...page,
      totalCount: 1,
      jobs: [{ externalId: '1', status: 'new-status' }],
    }])).toMatchObject({ ok: false, error: expect.stringContaining('未驗證') });
    expect(buildComplete104Snapshot([
      { ...page, totalCount: 31, jobs: Array.from({ length: 30 }, (_, i) => ({ externalId: String(i + 1), status: 'open' })) },
      { ...page, totalCount: 30, currentPage: 2, jobs: [{ externalId: '31', status: 'open' }] },
    ])).toMatchObject({ ok: false, error: expect.stringContaining('不一致') });
  });
});

describe('104 publication status allow-list', () => {
  test('accepts documented labels and rejects unknown non-empty values', () => {
    expect(classify104PublicationStatus('刊登中')).toBe('open');
    expect(classify104PublicationStatus('已關閉')).toBe('closed');
    expect(classify104PublicationStatus('暫停刊登')).toBe('closed');
    expect(classify104PublicationStatus('審核中')).toBeNull();
    expect(classify104PublicationStatus('')).toBeNull();
  });
});
