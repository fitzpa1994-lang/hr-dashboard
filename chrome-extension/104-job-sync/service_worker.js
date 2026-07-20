import { buildComplete104Snapshot, parse104JobTablePage } from './sync_contract.js';

const ALL_JOBS_URL = 'https://vip.104.com.tw/job/allJobList';
let syncInProgress = false;
let captureInProgress = false;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'capture104SearchConditions') {
    if (captureInProgress) {
      sendResponse({ ok: false, error: '104 搜尋條件正在擷取，請稍候。' });
      return;
    }
    captureInProgress = true;
    captureSearchConditions()
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }))
      .finally(() => { captureInProgress = false; });
    return true;
  }
  if (message?.type !== 'sync104JobsManual') return;

  if (syncInProgress) {
    sendResponse({ ok: false, error: '104 職缺同步正在執行，請稍候。' });
    return;
  }

  syncInProgress = true;
  syncPublishedJobs()
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }))
    .finally(() => { syncInProgress = false; });
  return true;
});

async function captureSearchConditions() {
  const searchTabs = await chrome.tabs.query({
    url: [
      'https://vip.104.com.tw/search/listSearch*',
      'https://vip.104.com.tw/search/searchResult*'
    ]
  });
  const targetTab = searchTabs
    .filter(tab => tab.id)
    .sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0];
  if (!targetTab) {
    throw new Error('找不到 104 查詢人才頁。請先開啟 104 並設定搜尋條件。');
  }

  let resultCount = null;
  let resultUrl = targetTab.url || '';
  if (new URL(resultUrl).pathname === '/search/listSearch') {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: () => {
        const button = Array.from(document.querySelectorAll('button'))
          .find(item => /^符合人數\s*[\d,]+\s*人$/.test((item.textContent || '').trim().replace(/\s+/g, ' ')));
        if (!button) return { clicked: false, resultCount: null };
        const count = Number((button.textContent || '').replace(/\D/g, ''));
        button.click();
        return { clicked: true, resultCount: Number.isFinite(count) ? count : null };
      }
    });
    if (!result?.result?.clicked) {
      throw new Error('104 條件尚未完成或符合人數仍在計算，請稍後再擷取。');
    }
    resultCount = result.result.resultCount;
    resultUrl = await waitForSearchResultUrl(targetTab.id, 25_000);
  }

  const conditions = normalizeSearchResultUrl(resultUrl, resultCount);
  return { ok: true, conditions };
}

function normalizeSearchResultUrl(rawUrl, resultCount = null) {
  const url = new URL(rawUrl);
  if (url.origin !== 'https://vip.104.com.tw' || url.pathname !== '/search/searchResult') {
    throw new Error('目前 104 分頁不是可儲存的查詢結果，請重新設定條件。');
  }
  url.searchParams.delete('loadTime');
  const keys = [...url.searchParams.keys()];
  if (!keys.length) throw new Error('104 查詢網址沒有條件，請重新設定後再擷取。');
  return {
    url: url.href,
    capturedAt: new Date().toISOString(),
    criteriaCount: new Set(keys).size,
    resultCount,
    keyword: url.searchParams.get('kws') || ''
  };
}

function waitForSearchResultUrl(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
    };
    const accept = url => {
      try { return new URL(url || '').pathname === '/search/searchResult'; } catch (_) { return false; }
    };
    const listener = (updatedId, info, tab) => {
      if (updatedId !== tabId || !accept(info.url || tab.url)) return;
      cleanup();
      resolve(info.url || tab.url);
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('104 搜尋結果載入逾時，請確認登入狀態後重試。'));
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab => {
      if (!accept(tab.url)) return;
      cleanup();
      resolve(tab.url);
    }).catch(() => {});
  });
}

async function syncPublishedJobs() {
  const tab = await chrome.tabs.create({ url: ALL_JOBS_URL, active: false });
  let keepTab = false;

  try {
    await waitForTabComplete(tab.id, 30_000);
    let firstPage;
    try {
      firstPage = await waitForPage(tab.id, 1, 20_000);
    } catch (error) {
      keepTab = true;
      await chrome.tabs.update(tab.id, { active: true });
      throw new Error(error?.message || '讀不到 104 職缺。請在剛開啟的頁面登入 104，再回招募作業台重試。');
    }
    if (!firstPage.jobs.length && firstPage.totalCount !== 0) {
      keepTab = true;
      await chrome.tabs.update(tab.id, { active: true });
      throw new Error('讀不到 104 職缺。請在剛開啟的頁面登入 104，再回招募作業台重試。');
    }

    const totalPages = Math.max(1, Math.ceil(firstPage.totalCount / firstPage.pageSize));
    const pages = [firstPage];

    let previousPageIds = firstPage.jobs.map(job => job.externalId);
    for (let page = 2; page <= totalPages; page += 1) {
      await selectPage(tab.id, page);
      const pageData = await waitForPage(tab.id, page, 20_000, previousPageIds);
      if (!pageData.jobs.length) throw new Error(`104 第 ${page} 頁沒有讀到職缺，已保留原本同步資料。`);
      pages.push(pageData);
      previousPageIds = pageData.jobs.map(job => job.externalId);
    }

    const snapshot = buildComplete104Snapshot(pages);
    if (!snapshot.ok) throw new Error(`${snapshot.error} 已取消更新並保留原本資料。`);
    return snapshot;
  } finally {
    if (!keepTab && tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch (_) {}
    }
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
    };
    const listener = (updatedId, info) => {
      if (updatedId !== tabId || info.status !== 'complete') return;
      cleanup();
      resolve();
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('104 職缺頁載入逾時，請確認網路及登入狀態。'));
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(current => {
      if (current.status === 'complete') {
        cleanup();
        resolve();
      }
    }).catch(() => {});
  });
}

async function readPage(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractRawJobTablePage
  });
  return parse104JobTablePage(result?.result || {});
}

function extractRawJobTablePage() {
  const rows = Array.from(document.querySelectorAll("tr[data-qa-id^='listJobno']"));
  const pageText = document.querySelector('.pagination-container .page')?.textContent || '';
  const pageButtonText = document.querySelector('.pagination-container .dropdown-toggle')?.textContent || '';
  const table = rows[0]?.closest('table');
  const headerRows = Array.from(table?.querySelectorAll('thead tr') || []).map(row => (
    Array.from(row.querySelectorAll('th')).map(cell => cell.innerText || cell.textContent || '')
  ));
  const activeFilterCandidates = Array.from(document.querySelectorAll(
    'button, a, [role="tab"], [aria-current], [aria-selected], [aria-pressed], option'
  ));
  const scopeLabels = new Set(['所有職務', '刊登中', '未刊登', '已關閉', '暫停刊登', '待刊登']);
  const activeScopeLabels = activeFilterCandidates.flatMap(element => {
    const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ');
    if (!scopeLabels.has(text)) return [];
    const isActive = (element.tagName === 'OPTION' && element.selected === true)
      || Boolean(element.closest(
      '[aria-current="page"], [aria-selected="true"], [aria-pressed="true"], .active, .selected, .is-active, .is-selected'
      ));
    return isActive ? [text] : [];
  });

  return {
    pathname: location.pathname,
    search: location.search,
    activeScopeLabels,
    pageText,
    pageButtonText,
    headerRows,
    rows: rows.map(row => {
      const externalId = (row.getAttribute('data-qa-id') || '').replace('listJobno', '');
      const titleLink = row.querySelector(`a[href^='/job/jobmaster?jobno=']`);
      return {
        externalId,
        title: titleLink?.textContent || '',
        href: titleLink?.getAttribute('href') || '',
        cells: Array.from(row.querySelectorAll('td')).map(cell => cell.innerText || cell.textContent || '')
      };
    })
  };
}

async function selectPage(tabId, pageNumber) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: targetPage => {
      const item = document.querySelector(`.pagination-container a.dropdown-item[title="第${targetPage}頁"]`);
      if (!item) return false;
      item.click();
      return true;
    },
    args: [pageNumber]
  });
  if (!result?.result) throw new Error(`找不到 104 第 ${pageNumber} 頁的分頁控制。`);
}

async function waitForPage(tabId, expectedPage, timeoutMs, previousPageIds = []) {
  const startedAt = Date.now();
  const previousSignature = previousPageIds.join(',');
  let lastValidationError = '';
  while (Date.now() - startedAt < timeoutMs) {
    await delay(400);
    const page = await readPage(tabId);
    if (!page.ok) {
      lastValidationError = page.error || '';
      continue;
    }
    const currentSignature = page.jobs.map(job => job.externalId).join(',');
    const rowsChanged = !previousSignature || currentSignature !== previousSignature;
    const hasCompletePage = page.totalCount === 0
      ? expectedPage === 1 && page.jobs.length === 0
      : page.jobs.length > 0;
    if (page.currentPage === expectedPage && hasCompletePage && rowsChanged) return page;
  }
  throw new Error(lastValidationError || `104 第 ${expectedPage} 頁載入逾時，已取消更新。`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
