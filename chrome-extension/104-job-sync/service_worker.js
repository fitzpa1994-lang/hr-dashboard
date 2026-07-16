const ALL_JOBS_URL = 'https://vip.104.com.tw/job/allJobList';
let syncInProgress = false;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

    for (let page = 2; page <= totalPages; page += 1) {
      await selectPage(tab.id, page);
      const pageData = await waitForPage(tab.id, page, 20_000);
      if (!pageData.jobs.length) throw new Error(`104 第 ${page} 頁沒有讀到職缺，已保留原本同步資料。`);
      allJobs.push(...pageData.jobs);
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

async function waitForPage(tabId, expectedPage, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await delay(400);
    const page = await readPage(tabId);
    if (page.currentPage === expectedPage && page.jobs.length) return page;
  }
  throw new Error(`104 第 ${expectedPage} 頁載入逾時，已取消更新。`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
