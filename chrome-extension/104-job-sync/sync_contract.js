export const SYNC_CONTRACT_VERSION = 2;

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function invalidPage(error, details = {}) {
  return {
    ok: false,
    error,
    jobs: [],
    totalCount: 0,
    pageSize: 30,
    currentPage: 0,
    ...details,
  };
}

export function classify104PublicationStatus(value) {
  const statusText = normalizeText(value);
  if (!statusText) return null;
  if (
    statusText === '刊登中'
    || statusText.startsWith('刊登中 ')
    || statusText.startsWith('刊登中（')
    || statusText.startsWith('刊登中(')
  ) return 'open';

  // These are the only non-published labels evidenced by the existing product
  // language and 104 documentation. New labels must be reviewed before syncing.
  const nonPublishedLabels = ['未刊登', '已關閉', '暫停刊登', '待刊登'];
  const matched = nonPublishedLabels.some(label => (
    statusText === label
    || statusText.startsWith(`${label} `)
    || statusText.startsWith(`${label}（`)
    || statusText.startsWith(`${label}(`)
  ));
  return matched ? 'closed' : null;
}

export function parse104JobTablePage(raw = {}) {
  const pathname = String(raw.pathname || '');
  const search = String(raw.search || '');
  const rawScopeKey = `${pathname}${search}`;
  const scopeKey = pathname;
  if (pathname !== '/job/allJobList') {
    return invalidPage('104 職缺頁不是「所有職務」網址。', { scopeKey: rawScopeKey });
  }

  let requestedPage = 1;
  if (search) {
    const params = new URLSearchParams(search);
    const keys = [...params.keys()];
    const pageValues = params.getAll('page');
    const keywordValues = params.getAll('kws');
    const departmentValues = params.getAll('department');
    const exactKeys = keys.length === 3
      && new Set(keys).size === 3
      && ['page', 'kws', 'department'].every(key => params.getAll(key).length === 1);
    const pageNumber = Number(pageValues[0]);
    const hasInvalidPage = !/^[1-9]\d*$/.test(pageValues[0] || '')
      || !Number.isSafeInteger(pageNumber);
    const hasNonEmptyFilter = keywordValues[0] !== '' || departmentValues[0] !== '';
    if (!exactKeys || hasNonEmptyFilter || hasInvalidPage) {
      return invalidPage('104 職缺頁網址包含非分頁的篩選條件。', { scopeKey: rawScopeKey });
    }
    requestedPage = pageNumber;
  }
  const activeScopeLabels = [...new Set(
    (Array.isArray(raw.activeScopeLabels) ? raw.activeScopeLabels : []).map(normalizeText).filter(Boolean)
  )];
  if (activeScopeLabels.length !== 1 || activeScopeLabels[0] !== '所有職務') {
    return invalidPage('無法唯一確認 104 目前只選取「所有職務」；請清除其他篩選後重試。', {
      scopeKey,
      activeScopeLabels,
    });
  }

  const pageText = normalizeText(raw.pageText);
  const totalMatch = pageText.match(/共\s*([\d,]+)\s*筆/);
  if (!totalMatch) {
    return invalidPage('104 職缺總筆數無法確認。', { scopeKey });
  }
  const totalCount = Number(totalMatch[1].replaceAll(',', ''));
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
    return invalidPage('104 職缺總筆數格式不正確。', { scopeKey });
  }

  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  if (totalCount === 0) {
    if (rows.length) {
      return invalidPage('104 職缺總筆數為 0，但頁面仍有資料列。', { scopeKey, totalCount });
    }
    if (requestedPage !== 1) {
      return invalidPage('104 網址頁碼與目前頁面不一致。', { scopeKey, totalCount });
    }
    return {
      ok: true,
      jobs: [],
      totalCount: 0,
      pageSize: 30,
      currentPage: 1,
      scopeKey,
      headerSignature: 'empty',
    };
  }

  const currentPageMatch = normalizeText(raw.pageButtonText).match(/第\s*(\d+)\s*頁/);
  const currentPage = Number(currentPageMatch?.[1] || 0);
  if (!Number.isSafeInteger(currentPage) || currentPage < 1) {
    return invalidPage('104 目前頁碼無法確認。', { scopeKey, totalCount });
  }
  if (requestedPage !== currentPage) {
    return invalidPage('104 網址頁碼與目前頁面不一致。', {
      scopeKey,
      totalCount,
      currentPage,
      requestedPage,
    });
  }

  if (!rows.length) {
    return invalidPage('104 職缺表格沒有可驗證的資料列。', {
      scopeKey,
      totalCount,
      currentPage,
    });
  }

  const firstCellCount = Array.isArray(rows[0]?.cells) ? rows[0].cells.length : 0;
  const rawHeaderRows = Array.isArray(raw.headerRows)
    ? raw.headerRows
    : (Array.isArray(raw.headers) ? [raw.headers] : []);
  const alignedHeaderRows = rawHeaderRows
    .filter(Array.isArray)
    .map(row => row.map(normalizeText))
    .filter(row => row.length === firstCellCount && row.filter(label => label.includes('狀態')).length === 1);
  if (alignedHeaderRows.length !== 1) {
    return invalidPage('104 表頭無法與資料欄位唯一對齊。', { scopeKey, totalCount, currentPage });
  }
  const headers = alignedHeaderRows[0];
  const statusIndexes = headers
    .map((label, index) => (label.includes('狀態') ? index : -1))
    .filter(index => index >= 0);
  if (statusIndexes.length !== 1) {
    return invalidPage('104 職缺狀態欄無法唯一確認。', { scopeKey, totalCount, currentPage });
  }
  const statusIndex = statusIndexes[0];
  const updatedIndexes = headers
    .map((label, index) => (label.includes('更新') ? index : -1))
    .filter(index => index >= 0);
  const updatedIndex = updatedIndexes.length === 1 ? updatedIndexes[0] : -1;
  const headerSignature = headers.join('|');

  const jobs = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const externalId = String(row.externalId || '').trim();
    const title = normalizeText(row.title);
    const cells = Array.isArray(row.cells) ? row.cells.map(normalizeText) : [];
    if (!/^\d+$/.test(externalId) || !title) {
      return invalidPage(`104 第 ${index + 1} 列缺少可驗證的職缺編號或名稱。`, {
        scopeKey, totalCount, currentPage, headerSignature,
      });
    }
    if (statusIndex >= cells.length) {
      return invalidPage(`104 第 ${index + 1} 列與狀態表頭無法對齊。`, {
        scopeKey, totalCount, currentPage, headerSignature,
      });
    }
    const statusText = cells[statusIndex];
    const status = classify104PublicationStatus(statusText);
    if (!status) {
      return invalidPage(`104 第 ${index + 1} 列沒有可識別的刊登狀態。`, {
        scopeKey, totalCount, currentPage, headerSignature,
      });
    }

    let jobUrl;
    try {
      jobUrl = new URL(String(row.href || ''), 'https://vip.104.com.tw');
    } catch (_) {
      return invalidPage(`104 第 ${index + 1} 列的職缺網址無法確認。`, {
        scopeKey, totalCount, currentPage, headerSignature,
      });
    }
    if (
      jobUrl.origin !== 'https://vip.104.com.tw'
      || jobUrl.pathname !== '/job/jobmaster'
      || jobUrl.searchParams.get('jobno') !== externalId
    ) {
      return invalidPage(`104 第 ${index + 1} 列的職缺網址與編號不一致。`, {
        scopeKey, totalCount, currentPage, headerSignature,
      });
    }

    jobs.push({
      externalId,
      title,
      url: jobUrl.href,
      updatedDate: updatedIndex >= 0 && updatedIndex < cells.length ? cells[updatedIndex] : '',
      status,
    });
  }

  return {
    ok: true,
    jobs,
    totalCount,
    pageSize: Math.max(rows.length, 30),
    currentPage,
    scopeKey,
    headerSignature,
  };
}

export function buildComplete104Snapshot(pages = [], syncedAt = new Date().toISOString()) {
  if (!Array.isArray(pages) || !pages.length || pages.some(page => !page?.ok)) {
    return { ok: false, error: '104 職缺頁面資料不完整。' };
  }

  const firstPage = pages[0];
  const expectedPages = Math.max(1, Math.ceil(firstPage.totalCount / firstPage.pageSize));
  if (pages.length !== expectedPages) {
    return { ok: false, error: `104 應有 ${expectedPages} 頁，但只完成 ${pages.length} 頁。` };
  }

  const jobs = [];
  const seenExternalIds = new Set();
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (
      page.currentPage !== index + 1
      || page.totalCount !== firstPage.totalCount
      || page.scopeKey !== firstPage.scopeKey
      || page.headerSignature !== firstPage.headerSignature
    ) {
      return { ok: false, error: `104 第 ${index + 1} 頁的頁碼、範圍、表頭或總筆數不一致。` };
    }
    for (const job of page.jobs) {
      if (!job || !/^\d+$/.test(String(job.externalId || '')) || !['open', 'closed'].includes(job.status)) {
        return { ok: false, error: `104 第 ${index + 1} 頁含有未驗證的職缺資料。` };
      }
      if (seenExternalIds.has(job.externalId)) {
        return { ok: false, error: `104 職缺編號 ${job.externalId} 在分頁間重複。` };
      }
      seenExternalIds.add(job.externalId);
      jobs.push(job);
    }
  }

  if (jobs.length !== firstPage.totalCount) {
    return {
      ok: false,
      error: `104 顯示 ${firstPage.totalCount} 筆，但只讀到 ${jobs.length} 筆。`,
    };
  }

  const publishedJobs = jobs.filter(job => job.status === 'open');
  return {
    ok: true,
    contractVersion: SYNC_CONTRACT_VERSION,
    complete: true,
    jobs: publishedJobs,
    sourceTotalCount: jobs.length,
    publishedCount: publishedJobs.length,
    scannedCount: jobs.length,
    syncedAt,
  };
}
