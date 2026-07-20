import { afterAll, afterEach, beforeAll, describe, expect, test } from '@jest/globals';
import { parse104JobTablePage } from '../../../chrome-extension/104-job-sync/sync_contract.js';

let extractRawJobTablePage;

beforeAll(async () => {
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener() {} },
    },
  };
  ({ extractRawJobTablePage } = await import('../../../chrome-extension/104-job-sync/service_worker.js'));
});

afterEach(() => {
  delete globalThis.document;
  delete globalThis.location;
});

afterAll(() => {
  delete globalThis.chrome;
});

function makeCell(text, tagName = 'TH') {
  return { tagName, innerText: text, textContent: text };
}

function makeHeaderRow(labels) {
  const cells = labels.map(label => makeCell(label));
  return {
    querySelectorAll(selector) {
      return selector === 'th' ? cells : [];
    },
  };
}

function installJobTableDom({ standardHeaderRows = [], directHeaderChildren = [] } = {}) {
  const labels = [
    '',
    '職務名稱',
    '招募進度',
    '更新日',
    '60天內 被瀏覽數',
    '60天內 應徵',
    '推薦 人才',
    '職務狀態',
    '修改',
    '更多',
  ];
  const thead = {
    children: directHeaderChildren.length
      ? directHeaderChildren
      : labels.map(label => makeCell(label)),
  };
  const table = {
    querySelectorAll(selector) {
      return selector === 'thead tr' ? standardHeaderRows : [];
    },
    querySelector(selector) {
      return selector === 'thead' ? thead : null;
    },
  };
  const rowCells = [
    '',
    'Software Engineer',
    '3',
    '2026/07/20',
    '120',
    '8',
    '2',
    '刊登中 (關閉)',
    '修改',
    '更多',
  ].map(value => makeCell(value, 'TD'));
  const titleLink = {
    textContent: 'Software Engineer',
    getAttribute(name) {
      return name === 'href' ? '/job/jobmaster?jobno=123456' : null;
    },
  };
  const row = {
    closest(selector) {
      return selector === 'table' ? table : null;
    },
    getAttribute(name) {
      return name === 'data-qa-id' ? 'listJobno123456' : null;
    },
    querySelector(selector) {
      return selector === "a[href^='/job/jobmaster?jobno=']" ? titleLink : null;
    },
    querySelectorAll(selector) {
      return selector === 'td' ? rowCells : [];
    },
  };
  const allJobsFilter = {
    tagName: 'BUTTON',
    innerText: '所有職務',
    textContent: '所有職務',
    closest() {
      return {};
    },
  };

  globalThis.location = { pathname: '/job/allJobList', search: '' };
  globalThis.document = {
    querySelector(selector) {
      if (selector === '.pagination-container .page') return { textContent: '共 1 筆' };
      if (selector === '.pagination-container .dropdown-toggle') return { textContent: '第 1 頁' };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "tr[data-qa-id^='listJobno']") return [row];
      if (selector.startsWith('button, a,')) return [allJobsFilter];
      return [];
    },
  };

  return labels;
}

describe('104 service worker allJobList DOM extraction', () => {
  test('accepts ten TH elements directly under THEAD as one header row', () => {
    const labels = installJobTableDom();

    const raw = extractRawJobTablePage();

    expect(raw.headerRows).toEqual([labels]);
    expect(parse104JobTablePage(raw)).toMatchObject({
      ok: true,
      jobs: [{
        externalId: '123456',
        status: 'open',
        updatedDate: '2026/07/20',
      }],
    });
  });

  test('keeps standard THEAD TR parsing ahead of direct TH fallback', () => {
    const standardLabels = ['職務名稱', '更新日', '職務狀態'];
    installJobTableDom({
      standardHeaderRows: [makeHeaderRow(standardLabels)],
      directHeaderChildren: [makeCell('不應採用')],
    });

    expect(extractRawJobTablePage().headerRows).toEqual([standardLabels]);
  });

  test('does not treat nested TH elements as the direct-header fallback', () => {
    const nestedWrapper = {
      tagName: 'DIV',
      querySelectorAll() {
        return [makeCell('職務狀態')];
      },
    };
    installJobTableDom({ directHeaderChildren: [nestedWrapper] });

    const raw = extractRawJobTablePage();

    expect(raw.headerRows).toEqual([]);
    expect(parse104JobTablePage(raw)).toMatchObject({
      ok: false,
      error: expect.stringContaining('表頭無法與資料欄位唯一對齊'),
    });
  });
});
