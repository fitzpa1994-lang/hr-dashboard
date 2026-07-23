const PRIORITY_LEVELS = [1, 2, 3];
const POSTGRES_INTEGER_MAX = 2_147_483_647;

export function normalizePriorityLevel(value) {
  const level = Number(value);
  return Number.isInteger(level) && PRIORITY_LEVELS.includes(level) ? level : 2;
}

function normalizeDisplayOrder(value) {
  const order = Number(value);
  return Number.isInteger(order) && order >= 0 && order <= POSTGRES_INTEGER_MAX ? order : 0;
}

export function normalizeOpen104PriorityJobs(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(job => {
      const externalId = String(job?.externalId ?? '').trim();
      const title = String(job?.title ?? job?.pos ?? '').trim();
      return /^\d{1,32}$/.test(externalId)
        && Boolean(title)
        && String(job?.status || '').toLowerCase() === 'open';
    })
    .map(job => ({
      ...job,
      externalId: String(job.externalId).trim(),
      title: String(job.title ?? job.pos).trim(),
      status: 'open',
      priorityLevel: normalizePriorityLevel(job.priorityLevel ?? job.priority_level),
      displayOrder: normalizeDisplayOrder(job.displayOrder ?? job.display_order),
    }));
}

export function sortPriorityJobs(rows = []) {
  return [...rows].sort((left, right) => (
    normalizePriorityLevel(left.priorityLevel) - normalizePriorityLevel(right.priorityLevel)
    || normalizeDisplayOrder(left.displayOrder) - normalizeDisplayOrder(right.displayOrder)
    || String(left.title || '').localeCompare(String(right.title || ''), 'zh-TW')
    || String(left.externalId || '').localeCompare(String(right.externalId || ''))
  ));
}

export function reindexPriorityJobs(rows = []) {
  const counters = new Map(PRIORITY_LEVELS.map(level => [level, 0]));
  return rows.map(job => {
    const priorityLevel = normalizePriorityLevel(job.priorityLevel);
    const displayOrder = counters.get(priorityLevel);
    counters.set(priorityLevel, displayOrder + 1);
    return { ...job, priorityLevel, displayOrder };
  });
}

export function movePriorityJob(rows, movedExternalId, targetPriority, targetExternalId = '', placeAfter = false) {
  const movedId = String(movedExternalId || '');
  const targetId = String(targetExternalId || '');
  const normalized = sortPriorityJobs(normalizeOpen104PriorityJobs(rows));
  const moved = normalized.find(job => job.externalId === movedId);
  if (!moved) return reindexPriorityJobs(normalized);
  if (targetId === movedId) return reindexPriorityJobs(normalized);

  const groups = new Map(PRIORITY_LEVELS.map(level => [level, []]));
  for (const job of normalized) {
    if (job.externalId !== movedId) groups.get(normalizePriorityLevel(job.priorityLevel)).push(job);
  }

  const nextPriority = normalizePriorityLevel(targetPriority);
  const targetGroup = groups.get(nextPriority);
  const targetIndex = targetId ? targetGroup.findIndex(job => job.externalId === targetId) : -1;
  targetGroup.splice(targetIndex < 0 ? targetGroup.length : targetIndex + (placeAfter ? 1 : 0), 0, {
    ...moved,
    priorityLevel: nextPriority,
  });

  return reindexPriorityJobs(PRIORITY_LEVELS.flatMap(level => groups.get(level)));
}

export function movePriorityJobByStep(rows, movedExternalId, direction) {
  const movedId = String(movedExternalId || '');
  const step = Number(direction) < 0 ? -1 : 1;
  const normalized = sortPriorityJobs(normalizeOpen104PriorityJobs(rows));
  const moved = normalized.find(job => job.externalId === movedId);
  if (!moved) return reindexPriorityJobs(normalized);

  const group = normalized.filter(job => job.priorityLevel === moved.priorityLevel);
  const currentIndex = group.findIndex(job => job.externalId === movedId);
  const target = group[currentIndex + step];
  if (!target) return reindexPriorityJobs(normalized);
  return movePriorityJob(normalized, movedId, moved.priorityLevel, target.externalId, step > 0);
}

export function buildPriorityPayload(rows = []) {
  return reindexPriorityJobs(sortPriorityJobs(normalizeOpen104PriorityJobs(rows))).map(job => ({
    externalId: job.externalId,
    priorityLevel: job.priorityLevel,
    displayOrder: job.displayOrder,
  }));
}

export function validatePriorityWriteResponse(result, expectedCount) {
  const error = fallback => ({ ok: false, error: String(result?.data?.error || fallback) });
  if (result?.ok !== true) return error('104 職缺排序無法寫入');
  if (result.data?.ok !== true) return error('104 職缺排序未明確儲存成功');
  const updated = result.data?.priorityUpdate?.updated;
  if (!Number.isInteger(updated) || updated !== Number(expectedCount)) {
    return error('104 職缺排序更新筆數不一致');
  }
  return { ok: true, value: { updated } };
}

const bridge = typeof window !== 'undefined' ? window.hrDashboardBridge : null;

if (!bridge || typeof window.hrRequestJson !== 'function') {
  if (typeof window !== 'undefined') console.warn('104 priority board bridge is not available.');
} else {
  const originalRenderJobs = bridge.getRenderJobs();
  const state = {
    jobs: [],
    saving: false,
    syncing: false,
    draggedExternalId: '',
    message: '',
    error: '',
  };

  const PRIORITY_META = {
    1: { label: 'P1', title: '急找', description: '目前最需要投入找人的職缺' },
    2: { label: 'P2', title: '正常', description: '依日常節奏持續招募；104 新職缺會先放這裡' },
    3: { label: 'P3', title: '暫緩', description: '保留刊登，暫不優先投入' },
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function safe104Url(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && url.hostname === 'vip.104.com.tw' ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function formatSyncTime(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '尚未同步';
    return date.toLocaleString('zh-TW', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }

  function loadJobsFromBridge() {
    state.jobs = sortPriorityJobs(normalizeOpen104PriorityJobs(bridge.getExternal104Jobs?.()));
  }

  function priorityButtons(job) {
    const locked = state.saving || state.syncing;
    return PRIORITY_LEVELS.map(level => {
      const selected = level === job.priorityLevel;
      return `<button type="button" class="job-priority-choice${selected ? ' is-selected' : ''}" data-set-priority="${level}" data-external-id="${escapeHtml(job.externalId)}" aria-pressed="${selected}"${locked ? ' disabled' : ''}>${PRIORITY_META[level].label}</button>`;
    }).join('');
  }

  function renderJobRow(job, index, groupSize) {
    const url = safe104Url(job.url);
    const title = escapeHtml(job.title);
    const locked = state.saving || state.syncing;
    return `
      <article class="job-priority-row" draggable="${locked ? 'false' : 'true'}" data-priority-job="${escapeHtml(job.externalId)}">
        <button type="button" class="job-priority-drag" tabindex="-1" aria-label="拖曳調整 ${title} 的優先順序"${locked ? ' disabled' : ''}>
          <i data-lucide="grip-vertical" aria-hidden="true"></i>
        </button>
        <span class="job-priority-index">${String(index + 1).padStart(2, '0')}</span>
        <div class="job-priority-copy">
          <div class="job-priority-title-row">
            ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : `<strong>${title}</strong>`}
            <span class="job-priority-live"><i data-lucide="radio" aria-hidden="true"></i>104 刊登中</span>
          </div>
          <div class="job-priority-meta">104 #${escapeHtml(job.externalId)}${job.updatedDate ? ` · 更新 ${escapeHtml(job.updatedDate)}` : ''}</div>
        </div>
        <div class="job-priority-step-controls" role="group" aria-label="${title} 同級排序">
          <button type="button" data-move-step="-1" data-external-id="${escapeHtml(job.externalId)}" aria-label="將 ${title} 往上移"${locked || index === 0 ? ' disabled' : ''}><i data-lucide="chevron-up" aria-hidden="true"></i></button>
          <button type="button" data-move-step="1" data-external-id="${escapeHtml(job.externalId)}" aria-label="將 ${title} 往下移"${locked || index === groupSize - 1 ? ' disabled' : ''}><i data-lucide="chevron-down" aria-hidden="true"></i></button>
        </div>
        <div class="job-priority-controls" role="group" aria-label="${title} 優先級">
          ${priorityButtons(job)}
        </div>
        <button type="button" class="job-priority-strategy" data-open-strategy="${escapeHtml(job.externalId)}">
          <i data-lucide="route" aria-hidden="true"></i><span>搜尋策略</span>
        </button>
      </article>`;
  }

  function renderGroup(level, jobs) {
    const meta = PRIORITY_META[level];
    return `
      <section class="job-priority-group priority-${level}" data-priority-group="${level}" aria-labelledby="job-priority-heading-${level}">
        <header class="job-priority-group-head">
          <div class="job-priority-group-title">
            <span class="job-priority-code">${meta.label}</span>
            <div><h3 id="job-priority-heading-${level}">${meta.title}</h3><p>${meta.description}</p></div>
          </div>
          <span class="job-priority-count">${jobs.length} 個職缺</span>
        </header>
        <div class="job-priority-list">
          ${jobs.length ? jobs.map((job, index) => renderJobRow(job, index, jobs.length)).join('') : '<div class="job-priority-empty">將職缺拖到這裡，或直接點選 P1／P2／P3。</div>'}
        </div>
      </section>`;
  }

  function renderPriorityBoard({ refresh = true } = {}) {
    const container = document.getElementById('job-priority-board');
    if (!container) return;
    if (refresh && !state.saving) loadJobsFromBridge();

    const sync = bridge.getExternal104Sync?.() || {};
    const grouped = new Map(PRIORITY_LEVELS.map(level => [level, []]));
    for (const job of sortPriorityJobs(state.jobs)) grouped.get(job.priorityLevel).push(job);

    container.innerHTML = `
      <header class="job-priority-board-head">
        <div>
          <div class="job-priority-eyebrow">104 RECRUITING PRIORITY</div>
          <h2>今天先找哪個職缺</h2>
          <p>職缺名稱與刊登狀態跟著 104 更新；新職缺先進 P2，再用拖曳、上下鍵或 P1／P2／P3 安排順序。</p>
        </div>
        <div class="job-priority-board-actions">
          <span>${state.jobs.length} 個刊登中 · ${escapeHtml(formatSyncTime(sync.lastSyncAt))}</span>
          <button type="button" data-sync-104${state.syncing || state.saving ? ' disabled' : ''}>
            <i data-lucide="refresh-cw" aria-hidden="true"></i>${state.syncing ? '更新中…' : '從 104 更新'}
          </button>
        </div>
      </header>
      ${state.error ? `<div class="job-priority-feedback is-error" role="alert">${escapeHtml(state.error)}</div>` : ''}
      ${state.message ? `<div class="job-priority-feedback is-success" role="status">${escapeHtml(state.message)}</div>` : ''}
      ${!sync.hasSnapshot ? '<div class="job-priority-feedback is-note">尚未取得 104 職缺。請先按「從 104 更新」。</div>' : ''}
      <div class="job-priority-groups${state.saving || state.syncing ? ' is-saving' : ''}">
        ${PRIORITY_LEVELS.map(level => renderGroup(level, grouped.get(level))).join('')}
      </div>`;
    window.lucide?.createIcons?.();
  }

  function applySavedJobsToBridge(jobs) {
    const saved = new Map(jobs.map(job => [job.externalId, job]));
    for (const row of bridge.getExternal104Jobs?.() || []) {
      const job = saved.get(String(row?.externalId || ''));
      if (!job) continue;
      row.priorityLevel = job.priorityLevel;
      row.displayOrder = job.displayOrder;
    }
  }

  async function persistJobs(nextJobs) {
    if (state.saving || state.syncing) return;
    const previousJobs = state.jobs.map(job => ({ ...job }));
    const payload = buildPriorityPayload(nextJobs);
    const payloadById = new Map(payload.map(job => [job.externalId, job]));
    state.jobs = sortPriorityJobs(normalizeOpen104PriorityJobs(nextJobs)).map(job => ({
      ...job,
      ...payloadById.get(job.externalId),
    }));
    state.saving = true;
    state.error = '';
    state.message = '';
    renderPriorityBoard({ refresh: false });

    try {
      const result = await window.hrRequestJson('/api/job-requisition-sources/104/priorities', {
        method: 'PATCH',
        timeoutMs: 12000,
        body: JSON.stringify({ jobs: payload }),
      });
      const response = validatePriorityWriteResponse(result, payload.length);
      if (!response.ok) throw new Error(response.error);
      applySavedJobsToBridge(state.jobs);
      state.message = '104 職缺優先順序已儲存。';
    } catch (error) {
      state.jobs = previousJobs;
      state.error = error?.message || '104 職缺排序儲存失敗';
    } finally {
      state.saving = false;
      renderPriorityBoard({ refresh: false });
    }
  }

  function clearDropState(container) {
    container.querySelectorAll('.is-dragging,.is-drop-target')
      .forEach(node => node.classList.remove('is-dragging', 'is-drop-target'));
  }

  const jobsTab = document.getElementById('tab-jobs');
  jobsTab?.addEventListener('click', event => {
    const syncButton = event.target.closest('[data-sync-104]');
    if (syncButton) {
      if (state.saving) return;
      state.error = '';
      if (window.talentSearchNavigator?.startManualSync) window.talentSearchNavigator.startManualSync();
      else {
        state.error = '104 同步模組尚未載入，請重新整理頁面後再試。';
        renderPriorityBoard({ refresh: false });
      }
      return;
    }

    const stepButton = event.target.closest('[data-move-step]');
    if (stepButton && !state.saving && !state.syncing) {
      const next = movePriorityJobByStep(
        state.jobs,
        stepButton.getAttribute('data-external-id'),
        Number(stepButton.getAttribute('data-move-step'))
      );
      persistJobs(next);
      return;
    }

    const strategyButton = event.target.closest('[data-open-strategy]');
    if (strategyButton) {
      const opened = window.talentSearchNavigator?.selectJob?.(strategyButton.getAttribute('data-open-strategy'));
      if (opened === false) {
        state.error = '找不到這筆 104 職缺的搜尋策略資料，請先重新同步。';
        renderPriorityBoard({ refresh: false });
      }
      return;
    }

    const priorityButton = event.target.closest('[data-set-priority]');
    if (priorityButton && !state.saving && !state.syncing) {
      const externalId = priorityButton.getAttribute('data-external-id');
      const priorityLevel = Number(priorityButton.getAttribute('data-set-priority'));
      const current = state.jobs.find(job => job.externalId === externalId);
      if (current?.priorityLevel === priorityLevel) return;
      const next = movePriorityJob(
        state.jobs,
        externalId,
        priorityLevel
      );
      persistJobs(next);
    }
  });

  jobsTab?.addEventListener('dragstart', event => {
    const row = event.target.closest('[data-priority-job]');
    if (!row || state.saving || state.syncing) return;
    state.draggedExternalId = row.getAttribute('data-priority-job');
    row.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', state.draggedExternalId);
    }
  });

  jobsTab?.addEventListener('dragover', event => {
    const group = event.target.closest('[data-priority-group]');
    if (!group || !state.draggedExternalId || state.saving || state.syncing) return;
    event.preventDefault();
    jobsTab.querySelectorAll('.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
    (event.target.closest('[data-priority-job]') || group).classList.add('is-drop-target');
  });

  jobsTab?.addEventListener('drop', event => {
    const group = event.target.closest('[data-priority-group]');
    if (!group || !state.draggedExternalId || state.saving || state.syncing) return;
    event.preventDefault();
    const targetRow = event.target.closest('[data-priority-job]');
    let placeAfter = false;
    if (targetRow) {
      const rect = targetRow.getBoundingClientRect();
      placeAfter = event.clientY > rect.top + rect.height / 2;
    }
    const next = movePriorityJob(
      state.jobs,
      state.draggedExternalId,
      Number(group.getAttribute('data-priority-group')),
      targetRow?.getAttribute('data-priority-job') || '',
      placeAfter
    );
    state.draggedExternalId = '';
    clearDropState(jobsTab);
    persistJobs(next);
  });

  jobsTab?.addEventListener('dragend', () => {
    state.draggedExternalId = '';
    clearDropState(jobsTab);
  });

  bridge.setRenderJobs(renderPriorityBoard);
  window.addEventListener('hr-dashboard-data-loaded', () => renderPriorityBoard());
  window.addEventListener('talent-search-sync-state', event => {
    state.syncing = Boolean(event.detail?.inProgress);
    if (event.detail && Object.prototype.hasOwnProperty.call(event.detail, 'error')) {
      state.error = String(event.detail.error || '');
    }
    renderPriorityBoard({ refresh: !state.syncing });
  });
  renderPriorityBoard();

  function focusJob(externalId) {
    const id = String(externalId || '');
    if (!state.jobs.some(job => job.externalId === id)) loadJobsFromBridge();
    if (!state.jobs.some(job => job.externalId === id)) return false;
    window.showJobWorkspace?.('jobs');
    renderPriorityBoard({ refresh: false });
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-priority-job="${id}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('is-focused');
      setTimeout(() => row.classList.remove('is-focused'), 1800);
    });
    return true;
  }

  window.hrJobsEditor = {
    renderPriorityBoard,
    focusJob,
    isSaving: () => state.saving,
    restoreOriginalRenderJobs: () => bridge.setRenderJobs(originalRenderJobs),
  };
}
