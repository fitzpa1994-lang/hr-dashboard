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
    } catch (_) {
      keepTab = true;
      await chrome.tabs.update(tab.id, { active: true });
      throw new Error('讀不到 104 職缺。請在剛開啟的頁面登入 104，再回招募作業台重試。');
    }
    if (!firstPage.jobs.length) {
      keepTab = true;
      await chrome.tabs.update(tab.id, { active: true });
      throw new Error('讀不到 104 職缺。請在剛開啟的頁面登入 104，再回招募作業台重試。');
    }

    const totalPages = Math.max(1, Math.ceil(firstPage.totalCount / firstPage.pageSize));
    const allJobs = [...firstPage.jobs];

    let previousPageIds = firstPage.jobs.map(job => job.externalId);
    for (let page = 2; page <= totalPages; page += 1) {
      await selectPage(tab.id, page);
      const pageData = await waitForPage(tab.id, page, 20_000, previousPageIds);
      if (!pageData.jobs.length) throw new Error(`104 第 ${page} 頁沒有讀到職缺，已保留原本同步資料。`);
      allJobs.push(...pageData.jobs);
      previousPageIds = pageData.jobs.map(job => job.externalId);
    }

    const uniqueJobs = [...new Map(allJobs.map(job => [job.externalId, job])).values()];
    if (uniqueJobs.length !== firstPage.totalCount) {
      throw new Error(`104 顯示 ${firstPage.totalCount} 筆，但只讀到 ${uniqueJobs.length} 筆，已取消更新。`);
    }

    const publishedJobs = uniqueJobs.filter(job => job.status === 'open');
    return {
      ok: true,
      jobs: publishedJobs,
      totalCount: publishedJobs.length,
      scannedCount: uniqueJobs.length,
      syncedAt: new Date().toISOString()
    };
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
    func: extractPublishedJobs
  });
  return result?.result || { jobs: [], totalCount: 0, pageSize: 30, currentPage: 0 };
}

function extractPublishedJobs() {
  const rows = Array.from(document.querySelectorAll("tr[data-qa-id^='listJobno']"));
  const pageText = document.querySelector('.pagination-container .page')?.textContent || '';
  const pageButtonText = document.querySelector('.pagination-container .dropdown-toggle')?.textContent || '';
  const totalCount = Number(pageText.match(/共\s*(\d+)\s*筆/)?.[1] || 0);
  const currentPage = Number(pageButtonText.match(/第\s*(\d+)\s*頁/)?.[1] || 0);

  const jobs = rows.map(row => {
    const externalId = (row.getAttribute('data-qa-id') || '').replace('listJobno', '');
    const titleLink = row.querySelector(`a[href^='/job/jobmaster?jobno=']`);
    const cells = Array.from(row.querySelectorAll('td')).map(cell => (cell.innerText || '').trim().replace(/\s+/g, ' '));
    const statusText = cells[7] || '';
    return {
      externalId,
      title: (titleLink?.textContent || '').trim().replace(/\s+/g, ' '),
      url: titleLink ? new URL(titleLink.getAttribute('href'), location.origin).href : '',
      updatedDate: cells[3] || '',
      status: statusText.includes('刊登中') ? 'open' : 'closed'
    };
  }).filter(job => /^\d+$/.test(job.externalId) && job.title);

  return { jobs, totalCount, pageSize: Math.max(rows.length, 30), currentPage };
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
  while (Date.now() - startedAt < timeoutMs) {
    await delay(400);
    const page = await readPage(tabId);
    const currentSignature = page.jobs.map(job => job.externalId).join(',');
    const rowsChanged = !previousSignature || currentSignature !== previousSignature;
    if (page.currentPage === expectedPage && page.jobs.length && rowsChanged) return page;
  }
  throw new Error(`104 第 ${expectedPage} 頁載入逾時，已取消更新。`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
