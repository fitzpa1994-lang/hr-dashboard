const STORAGE_KEY = 'sporton.talentSearchNavigator.v1';
const SEARCH_URL = 'https://vip.104.com.tw/search/listSearch';
const SYNC_REQUEST_TYPE = 'SPORTON_104_SYNC_REQUEST';
const SYNC_RESPONSE_TYPE = 'SPORTON_104_SYNC_RESPONSE';
const EXTENSION_READY_TYPE = 'SPORTON_104_EXTENSION_READY';

export function reconcileOrder(currentIds, savedOrder = []) {
  const current = currentIds.map(String);
  const seen = new Set();
  const preserved = [];

  for (const rawId of savedOrder) {
    const id = String(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    preserved.push(id);
  }
  for (const id of current) {
    if (seen.has(id)) continue;
    seen.add(id);
    preserved.push(id);
  }
  return preserved;
}

export function reorderVisible(fullOrder, visibleIds, movedId, targetId, placeAfter = false) {
  const moved = String(movedId);
  const target = String(targetId);
  const visibleSet = new Set(visibleIds.map(String));
  if (!visibleSet.has(moved) || !visibleSet.has(target) || moved === target) return [...fullOrder];

  const visibleOrder = fullOrder.map(String).filter(id => visibleSet.has(id) && id !== moved);
  const targetIndex = visibleOrder.indexOf(target);
  if (targetIndex < 0) return [...fullOrder];
  visibleOrder.splice(targetIndex + (placeAfter ? 1 : 0), 0, moved);

  let cursor = 0;
  return fullOrder.map(rawId => {
    const id = String(rawId);
    return visibleSet.has(id) ? visibleOrder[cursor++] : id;
  });
}

export function merge104JobSnapshot(previousJobs = [], incomingJobs = [], syncedAt = new Date().toISOString()) {
  const previous = new Map(previousJobs.map(job => [String(job.externalId || ''), job]));
  const incomingIds = new Set();
  const merged = [];

  for (const rawJob of incomingJobs) {
    const externalId = String(rawJob.externalId || '').trim();
    const title = String(rawJob.title || rawJob.pos || '').trim();
    if (!/^\d+$/.test(externalId) || !title || incomingIds.has(externalId)) continue;
    incomingIds.add(externalId);
    merged.push({
      ...previous.get(externalId),
      id: `104:${externalId}`,
      externalId,
      pos: title,
      title,
      dept: '104 刊登中',
      status: 'open',
      source: '104',
      url: String(rawJob.url || `https://vip.104.com.tw/job/jobmaster?jobno=${externalId}`),
      updatedDate: String(rawJob.updatedDate || ''),
      lastSeenAt: syncedAt
    });
  }

  for (const oldJob of previousJobs) {
    const externalId = String(oldJob.externalId || '');
    if (!externalId || incomingIds.has(externalId)) continue;
    merged.push({ ...oldJob, status: 'pending_confirmation' });
  }
  return merged;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function jobId(job) {
  return String(job?.id ?? `${job?.dept || 'unknown'}::${job?.pos || 'untitled'}`);
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadStoredState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      order: Array.isArray(parsed.order) ? parsed.order.map(String) : [],
      profilesByJob: parsed.profilesByJob && typeof parsed.profilesByJob === 'object' ? parsed.profilesByJob : {},
      selectedJobId: parsed.selectedJobId ? String(parsed.selectedJobId) : '',
      statusFilter: parsed.statusFilter === 'all' ? 'all' : 'open',
      syncedJobs: Array.isArray(parsed.syncedJobs) ? parsed.syncedJobs : [],
      lastSyncAt: parsed.lastSyncAt ? String(parsed.lastSyncAt) : '',
    };
  } catch (error) {
    console.warn('104 搜尋導覽設定讀取失敗，已使用預設值。', error);
    return { order: [], profilesByJob: {}, selectedJobId: '', statusFilter: 'open', syncedJobs: [], lastSyncAt: '' };
  }
}

const stored = typeof localStorage === 'undefined'
  ? { order: [], profilesByJob: {}, selectedJobId: '', statusFilter: 'open', syncedJobs: [], lastSyncAt: '' }
  : loadStoredState();

const state = {
  jobs: [],
  order: stored.order,
  profilesByJob: stored.profilesByJob,
  selectedJobId: stored.selectedJobId,
  statusFilter: stored.statusFilter,
  query: '',
  editingProfileId: '',
  draggedJobId: '',
  draggedProfileId: '',
  syncedJobs: stored.syncedJobs,
  lastSyncAt: stored.lastSyncAt,
  extensionReady: false,
  extensionVersion: '',
  syncInProgress: false,
  syncError: '',
  pendingSyncRequestId: '',
  syncTimer: null,
};

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      order: state.order,
      profilesByJob: state.profilesByJob,
      selectedJobId: state.selectedJobId,
      statusFilter: state.statusFilter,
      syncedJobs: state.syncedJobs,
      lastSyncAt: state.lastSyncAt,
    }));
  } catch (error) {
    console.warn('104 搜尋導覽設定儲存失敗。', error);
  }
}

function getProfiles(id) {
  const profiles = state.profilesByJob[String(id)];
  return Array.isArray(profiles) ? profiles : [];
}

function syncJobs() {
  state.jobs = Array.isArray(state.syncedJobs) ? state.syncedJobs : [];
  state.order = reconcileOrder(state.jobs.map(jobId), state.order);
}

function isOpenJob(job) {
  return String(job?.status || '').toLowerCase() === 'open';
}

function orderedJobs() {
  const byId = new Map(state.jobs.map(job => [jobId(job), job]));
  return state.order.map(id => byId.get(String(id))).filter(Boolean);
}

function visibleJobs() {
  const query = state.query.trim().toLowerCase();
  return orderedJobs().filter(job => {
    if (state.statusFilter === 'open' && !isOpenJob(job)) return false;
    if (!query) return true;
    return [job.pos, job.externalId, job.note].some(value => String(value || '').toLowerCase().includes(query));
  });
}

function ensureSelection(jobs) {
  const ids = new Set(jobs.map(jobId));
  if (!ids.has(state.selectedJobId)) state.selectedJobId = jobs[0] ? jobId(jobs[0]) : '';
}

function renderJobList(jobs) {
  const list = document.getElementById('talent-nav-job-list');
  const count = document.getElementById('talent-nav-job-count');
  if (!list || !count) return;
  count.textContent = `${jobs.length} / ${state.jobs.length} 筆`;

  if (!jobs.length) {
    list.innerHTML = `<div class="talent-nav-list-empty">${state.jobs.length ? '沒有符合目前篩選的職缺。' : '職缺資料載入後會顯示在這裡。'}</div>`;
    return;
  }

  const visibleOrder = jobs.map(jobId);
  list.innerHTML = jobs.map((job, index) => {
    const id = jobId(job);
    const profileCount = getProfiles(id).length;
    return `
      <article class="talent-nav-job-row${id === state.selectedJobId ? ' is-selected' : ''}" draggable="true" data-job-id="${escapeHtml(id)}" tabindex="0" aria-label="${escapeHtml(job.pos || '未命名職缺')}，排序第 ${index + 1}">
        <button type="button" class="talent-drag-handle" tabindex="-1" aria-label="拖曳調整職缺順序"><i data-lucide="grip-vertical"></i></button>
        <span class="talent-nav-order">${String(index + 1).padStart(2, '0')}</span>
        <div class="talent-nav-job-copy">
          <div class="talent-nav-job-title">${escapeHtml(job.pos || '未命名職缺')}</div>
          <div class="talent-nav-job-meta">104 #${escapeHtml(job.externalId || '--')}${job.updatedDate ? ` · 更新 ${escapeHtml(job.updatedDate)}` : ''}${isOpenJob(job) ? '' : ' · 待確認是否關閉'}</div>
        </div>
        <span class="talent-nav-profile-count" title="搜尋方案數">${profileCount}</span>
      </article>`;
  }).join('');
  list.dataset.visibleIds = JSON.stringify(visibleOrder);
}

function profileCard(profile, index) {
  return `
    <article class="talent-profile-card" draggable="true" data-profile-id="${escapeHtml(profile.id)}">
      <button type="button" class="talent-drag-handle" tabindex="-1" aria-label="拖曳調整搜尋方案順序"><i data-lucide="grip-vertical"></i></button>
      <div class="talent-profile-copy">
        <div class="talent-profile-topline">
          <span class="talent-profile-step">STEP ${String(index + 1).padStart(2, '0')}</span>
          <span class="talent-profile-name">${escapeHtml(profile.name || '未命名方案')}</span>
        </div>
        <div class="talent-profile-note${profile.note ? '' : ' is-empty'}">${escapeHtml(profile.note || '尚未填寫備註')}</div>
        <span class="talent-profile-state"><i data-lucide="unlink"></i> 104 條件待擷取</span>
      </div>
      <div class="talent-profile-actions">
        <button type="button" class="talent-profile-action is-open" data-action="open-104" data-profile-id="${escapeHtml(profile.id)}"><i data-lucide="external-link"></i>開啟 104</button>
        <button type="button" class="talent-profile-action" data-action="edit-profile" data-profile-id="${escapeHtml(profile.id)}"><i data-lucide="pencil"></i>編輯</button>
        <button type="button" class="talent-profile-action" data-action="delete-profile" data-profile-id="${escapeHtml(profile.id)}" aria-label="刪除 ${escapeHtml(profile.name)}"><i data-lucide="trash-2"></i></button>
      </div>
    </article>`;
}

function renderDetail() {
  const detail = document.getElementById('talent-nav-detail');
  if (!detail) return;
  const job = state.jobs.find(item => jobId(item) === state.selectedJobId);
  if (!job) {
    detail.innerHTML = `
      <div class="talent-nav-empty">
        <i data-lucide="mouse-pointer-2"></i>
        <h3>選擇一個職缺</h3>
        <p>從左側挑選職缺，開始安排精準搜尋與放大條件。</p>
      </div>`;
    return;
  }

  const profiles = getProfiles(state.selectedJobId);
  detail.innerHTML = `
    <div class="talent-nav-detail-head">
      <div class="talent-nav-detail-title">
        <div class="talent-nav-eyebrow">SELECTED POSITION</div>
        <h3>${escapeHtml(job.pos || '未命名職缺')}</h3>
        <p>104 職缺 #${escapeHtml(job.externalId || '--')} · ${profiles.length} 組搜尋方案</p>
      </div>
      <button type="button" class="talent-primary-button" data-action="add-profile"><i data-lucide="plus"></i>新增搜尋方案</button>
    </div>
    <div class="talent-nav-route-label">
      <span>搜尋順序</span>
      <span>從條件最精準排到最寬鬆</span>
    </div>
    ${profiles.length ? `<div id="talent-profile-list" class="talent-profile-list">${profiles.map(profileCard).join('')}</div>` : `
      <div class="talent-nav-profile-empty">
        <i data-lucide="route"></i>
        <h4>尚未建立搜尋方案</h4>
        <p>先建立「精準搜尋」，之後找不到適合人選時，再新增一組放大條件。</p>
        <button type="button" class="talent-primary-button" data-action="add-profile"><i data-lucide="plus"></i>建立第一組方案</button>
      </div>`}
  `;
}

function render() {
  if (!document.getElementById('tab-talent-search')) return;
  syncJobs();
  const jobs = visibleJobs();
  ensureSelection(jobs);
  renderJobList(jobs);
  renderDetail();

  const search = document.getElementById('talent-nav-job-search');
  const filter = document.getElementById('talent-nav-status-filter');
  if (search && search.value !== state.query) search.value = state.query;
  if (filter && filter.value !== state.statusFilter) filter.value = state.statusFilter;
  renderSyncStatus();
  window.lucide?.createIcons?.();
  saveState();
}

function formatSyncTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function renderSyncStatus() {
  const status = document.getElementById('talent-nav-sync-status');
  const button = document.getElementById('talent-nav-sync-button');
  if (!status || !button) return;

  button.disabled = state.syncInProgress;
  button.classList.toggle('is-syncing', state.syncInProgress);
  if (state.syncInProgress) {
    status.textContent = '正在讀取 104 所有職務並逐頁檢查，請稍候…';
    return;
  }
  if (state.syncError) {
    status.textContent = state.syncError;
    return;
  }
  if (state.lastSyncAt) {
    const openCount = state.syncedJobs.filter(isOpenJob).length;
    status.textContent = `上次更新 ${formatSyncTime(state.lastSyncAt)} · ${openCount} 筆刊登中職缺`;
    return;
  }
  status.textContent = state.extensionReady
    ? `同步掛件已連線${state.extensionVersion ? `（v${state.extensionVersion}）` : ''}，可開始更新。`
    : '尚未偵測到同步掛件。請先安裝目前專案內的 104-job-sync。';
}

function startManualSync() {
  if (state.syncInProgress) return;
  state.syncError = '';
  state.syncInProgress = true;
  state.pendingSyncRequestId = createId();
  renderSyncStatus();
  window.postMessage({ type: SYNC_REQUEST_TYPE, requestId: state.pendingSyncRequestId }, location.origin);
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(() => {
    if (!state.syncInProgress) return;
    state.syncInProgress = false;
    state.syncError = state.extensionReady
      ? '104 同步逾時，舊職缺清單已保留，請確認 104 登入狀態後重試。'
      : '找不到 104 同步掛件。請先安裝或重新載入掛件，再重新整理本頁。';
    renderSyncStatus();
  }, 90_000);
}

function handleExtensionMessage(event) {
  if (event.source !== window || event.origin !== location.origin) return;
  if (event.data?.type === EXTENSION_READY_TYPE) {
    state.extensionReady = true;
    state.extensionVersion = String(event.data.version || '');
    state.syncError = '';
    renderSyncStatus();
    return;
  }
  if (event.data?.type !== SYNC_RESPONSE_TYPE || event.data.requestId !== state.pendingSyncRequestId) return;

  clearTimeout(state.syncTimer);
  state.syncInProgress = false;
  state.pendingSyncRequestId = '';
  if (!event.data.ok || !Array.isArray(event.data.jobs)) {
    state.syncError = event.data.error || '104 同步失敗，舊職缺清單已保留。';
    renderSyncStatus();
    return;
  }

  const syncedAt = event.data.syncedAt || new Date().toISOString();
  state.syncedJobs = merge104JobSnapshot(state.syncedJobs, event.data.jobs, syncedAt);
  state.lastSyncAt = syncedAt;
  state.statusFilter = 'open';
  state.syncError = '';
  saveState();
  render();
}

function openProfileModal(profileId = '') {
  const modal = document.getElementById('talent-profile-modal');
  const title = document.getElementById('talent-profile-modal-title');
  const idInput = document.getElementById('talent-profile-id');
  const nameInput = document.getElementById('talent-profile-name');
  const noteInput = document.getElementById('talent-profile-note');
  if (!modal || !title || !idInput || !nameInput || !noteInput || !state.selectedJobId) return;

  const profile = getProfiles(state.selectedJobId).find(item => item.id === profileId);
  state.editingProfileId = profile?.id || '';
  idInput.value = state.editingProfileId;
  nameInput.value = profile?.name || (getProfiles(state.selectedJobId).length ? `放大條件 ${getProfiles(state.selectedJobId).length + 1}` : '精準搜尋');
  noteInput.value = profile?.note || '';
  title.textContent = profile ? '編輯搜尋方案' : '新增搜尋方案';
  modal.classList.remove('hidden');
  window.lucide?.createIcons?.();
  requestAnimationFrame(() => nameInput.focus());
}

function closeProfileModal() {
  document.getElementById('talent-profile-modal')?.classList.add('hidden');
  state.editingProfileId = '';
}

function saveProfileFromForm(event) {
  event.preventDefault();
  if (!state.selectedJobId) return;
  const name = document.getElementById('talent-profile-name')?.value.trim();
  const note = document.getElementById('talent-profile-note')?.value.trim() || '';
  if (!name) return;

  const profiles = [...getProfiles(state.selectedJobId)];
  const existingIndex = profiles.findIndex(item => item.id === state.editingProfileId);
  if (existingIndex >= 0) {
    profiles[existingIndex] = { ...profiles[existingIndex], name, note, updatedAt: new Date().toISOString() };
  } else {
    profiles.push({ id: createId(), name, note, conditions: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  state.profilesByJob[state.selectedJobId] = profiles;
  closeProfileModal();
  render();
}

function deleteProfile(profileId) {
  const profiles = getProfiles(state.selectedJobId);
  const profile = profiles.find(item => item.id === profileId);
  if (!profile || !window.confirm(`確定刪除「${profile.name}」搜尋方案？`)) return;
  state.profilesByJob[state.selectedJobId] = profiles.filter(item => item.id !== profileId);
  render();
}

function open104() {
  const opened = window.open(SEARCH_URL, '_blank', 'noopener,noreferrer');
  if (opened) opened.opener = null;
}

function bindEvents() {
  document.getElementById('talent-nav-job-search')?.addEventListener('input', event => {
    state.query = event.target.value || '';
    render();
  });
  document.getElementById('talent-nav-status-filter')?.addEventListener('change', event => {
    state.statusFilter = event.target.value === 'all' ? 'all' : 'open';
    render();
  });
  document.getElementById('talent-profile-form')?.addEventListener('submit', saveProfileFromForm);

  document.getElementById('tab-talent-search')?.addEventListener('click', event => {
    const close = event.target.closest('[data-action="close-profile-modal"]');
    if (close) return closeProfileModal();

    const row = event.target.closest('[data-job-id]');
    if (row && !event.target.closest('button')) {
      state.selectedJobId = row.dataset.jobId;
      return render();
    }

    const action = event.target.closest('[data-action]');
    if (!action) return;
    const profileId = action.dataset.profileId || '';
    if (action.dataset.action === 'add-profile') openProfileModal();
    if (action.dataset.action === 'edit-profile') openProfileModal(profileId);
    if (action.dataset.action === 'delete-profile') deleteProfile(profileId);
    if (action.dataset.action === 'open-104') open104();
    if (action.dataset.action === 'sync-104-jobs') startManualSync();
  });

  document.getElementById('talent-nav-job-list')?.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key)) return;
    const row = event.target.closest('[data-job-id]');
    if (!row) return;
    event.preventDefault();
    state.selectedJobId = row.dataset.jobId;
    render();
  });

  const jobList = document.getElementById('talent-nav-job-list');
  jobList?.addEventListener('dragstart', event => {
    const row = event.target.closest('[data-job-id]');
    if (!row) return;
    state.draggedJobId = row.dataset.jobId;
    row.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
  });
  jobList?.addEventListener('dragover', event => {
    const row = event.target.closest('[data-job-id]');
    if (!row || row.dataset.jobId === state.draggedJobId) return;
    event.preventDefault();
    jobList.querySelectorAll('.is-drop-target').forEach(item => item.classList.remove('is-drop-target'));
    row.classList.add('is-drop-target');
  });
  jobList?.addEventListener('drop', event => {
    const row = event.target.closest('[data-job-id]');
    if (!row || !state.draggedJobId) return;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const placeAfter = event.clientY > rect.top + rect.height / 2;
    const ids = visibleJobs().map(jobId);
    state.order = reorderVisible(state.order, ids, state.draggedJobId, row.dataset.jobId, placeAfter);
    state.draggedJobId = '';
    render();
  });
  jobList?.addEventListener('dragend', () => {
    state.draggedJobId = '';
    jobList.querySelectorAll('.is-dragging,.is-drop-target').forEach(item => item.classList.remove('is-dragging', 'is-drop-target'));
  });

  const detail = document.getElementById('talent-nav-detail');
  detail?.addEventListener('dragstart', event => {
    const card = event.target.closest('[data-profile-id]');
    if (!card) return;
    state.draggedProfileId = card.dataset.profileId;
    card.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
  });
  detail?.addEventListener('dragover', event => {
    const card = event.target.closest('.talent-profile-card');
    if (!card || card.dataset.profileId === state.draggedProfileId) return;
    event.preventDefault();
    detail.querySelectorAll('.is-drop-target').forEach(item => item.classList.remove('is-drop-target'));
    card.classList.add('is-drop-target');
  });
  detail?.addEventListener('drop', event => {
    const card = event.target.closest('.talent-profile-card');
    if (!card || !state.draggedProfileId) return;
    event.preventDefault();
    const profiles = [...getProfiles(state.selectedJobId)];
    const from = profiles.findIndex(item => item.id === state.draggedProfileId);
    let to = profiles.findIndex(item => item.id === card.dataset.profileId);
    if (from < 0 || to < 0) return;
    const rect = card.getBoundingClientRect();
    const placeAfter = event.clientY > rect.top + rect.height / 2;
    const [moved] = profiles.splice(from, 1);
    to = profiles.findIndex(item => item.id === card.dataset.profileId);
    profiles.splice(to + (placeAfter ? 1 : 0), 0, moved);
    state.profilesByJob[state.selectedJobId] = profiles;
    state.draggedProfileId = '';
    render();
  });
  detail?.addEventListener('dragend', () => {
    state.draggedProfileId = '';
    detail.querySelectorAll('.is-dragging,.is-drop-target').forEach(item => item.classList.remove('is-dragging', 'is-drop-target'));
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.getElementById('talent-profile-modal')?.classList.contains('hidden')) closeProfileModal();
  });
}

function init() {
  if (!document.getElementById('tab-talent-search')) return;
  bindEvents();
  window.addEventListener('message', handleExtensionMessage);
  render();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.talentSearchNavigator = { render };
  init();
}
