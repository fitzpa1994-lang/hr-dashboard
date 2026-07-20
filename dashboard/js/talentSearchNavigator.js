import { normalizeJobRequisition } from './dataUtils.js';
import {
  normalizeExternal104SyncMetadata,
  SYNC_104_CONTRACT_VERSION,
  validateComplete104SyncPayload,
} from './sync104Contract.js';

const STORAGE_KEY = 'sporton.talentSearchNavigator.v1';
const SEARCH_URL = 'https://vip.104.com.tw/search/listSearch';
const SYNC_REQUEST_TYPE = 'SPORTON_104_SYNC_REQUEST';
const SYNC_RESPONSE_TYPE = 'SPORTON_104_SYNC_RESPONSE';
const EXTENSION_READY_TYPE = 'SPORTON_104_EXTENSION_READY';
const CAPTURE_REQUEST_TYPE = 'SPORTON_104_CAPTURE_REQUEST';
const CAPTURE_RESPONSE_TYPE = 'SPORTON_104_CAPTURE_RESPONSE';

export function validate104SyncWriteResponse(result, expectedPayload) {
  const fail = fallback => ({
    ok: false,
    error: String(result?.data?.error || fallback),
  });
  if (result?.ok !== true) return fail('104 職缺無法寫入招募作業台');
  if (result.data?.ok !== true) return fail('104 職缺寫入結果未明確成功');
  if (!expectedPayload || typeof expectedPayload !== 'object' || !Array.isArray(expectedPayload.jobs)) {
    return fail('104 同步預期資料不完整');
  }

  const sync = result.data.sync104Jobs;
  if (!sync || typeof sync !== 'object' || Array.isArray(sync)) {
    return fail('104 職缺寫入回應缺少同步結果');
  }
  if (sync.applied !== true || sync.complete !== true) {
    return fail('104 完整快照未套用');
  }

  const expectedCounts = {
    sourceTotalCount: expectedPayload.sourceTotalCount,
    publishedCount: expectedPayload.publishedCount,
    scannedCount: expectedPayload.scannedCount,
  };
  if (sync.contractVersion !== expectedPayload.contractVersion) {
    return fail('104 同步合約版本回應不一致');
  }
  for (const [field, expected] of Object.entries(expectedCounts)) {
    const actual = Number(sync[field]);
    if (!Number.isInteger(actual) || actual !== expected) {
      return fail(`104 同步 ${field} 回應不一致`);
    }
  }

  const expectedPublishedCount = expectedPayload.jobs.length;
  for (const field of ['received', 'accepted', 'upserted']) {
    const actual = Number(sync[field]);
    if (!Number.isInteger(actual) || actual !== expectedPublishedCount) {
      return fail(`104 同步 ${field} 回應不一致`);
    }
  }
  const pendingConfirmation = Number(sync.pendingConfirmation);
  if (!Number.isInteger(pendingConfirmation) || pendingConfirmation < 0) {
    return fail('104 同步 pendingConfirmation 回應不正確');
  }

  const metadata = normalizeExternal104SyncMetadata({
    hasSnapshot: true,
    source: '104',
    contractVersion: Number(sync.contractVersion),
    sourceTotalCount: Number(sync.sourceTotalCount),
    publishedCount: Number(sync.publishedCount),
    lastSyncAt: sync.syncedAt,
  });
  if (!metadata.hasSnapshot) return fail('104 同步時間回應不正確');

  return { ok: true, value: { sync104Jobs: sync, metadata } };
}

export function normalize104SearchConditions(rawConditions) {
  if (!rawConditions || typeof rawConditions !== 'object') return null;
  try {
    const url = new URL(String(rawConditions.url || ''));
    if (url.origin !== 'https://vip.104.com.tw' || url.pathname !== '/search/searchResult') return null;
    url.searchParams.delete('loadTime');
    if (![...url.searchParams.keys()].length) return null;
    const rawResultCount = rawConditions.resultCount;
    return {
      url: url.href,
      capturedAt: String(rawConditions.capturedAt || new Date().toISOString()),
      criteriaCount: Number(rawConditions.criteriaCount || new Set(url.searchParams.keys()).size),
      resultCount: rawResultCount !== null && rawResultCount !== undefined && rawResultCount !== '' && Number.isFinite(Number(rawResultCount))
        ? Number(rawResultCount)
        : null,
      keyword: String(rawConditions.keyword || url.searchParams.get('kws') || ''),
    };
  } catch (_) {
    return null;
  }
}

function nextCopiedProfileName(sourceName, targetProfiles) {
  const baseName = String(sourceName || '未命名方案');
  const existingNames = new Set(targetProfiles.map(profile => String(profile?.name || '')));
  if (!existingNames.has(baseName)) return baseName;
  if (!existingNames.has(`${baseName}（複製）`)) return `${baseName}（複製）`;
  let copyNumber = 2;
  while (existingNames.has(`${baseName}（複製 ${copyNumber}）`)) copyNumber += 1;
  return `${baseName}（複製 ${copyNumber}）`;
}

export function copyProfileToJobs(
  profilesByJob,
  sourceJobId,
  profileId,
  targetJobIds,
  { idFactory = createId, copiedAt = new Date().toISOString() } = {}
) {
  const sourceProfiles = Array.isArray(profilesByJob?.[String(sourceJobId)])
    ? profilesByJob[String(sourceJobId)]
    : [];
  const sourceProfile = sourceProfiles.find(profile => String(profile?.id) === String(profileId));
  const nextProfilesByJob = { ...(profilesByJob || {}) };
  if (!sourceProfile) return { profilesByJob: nextProfilesByJob, copiedJobIds: [] };

  const copiedJobIds = [];
  const uniqueTargets = [...new Set((targetJobIds || []).map(String))]
    .filter(targetJobId => targetJobId && targetJobId !== String(sourceJobId));

  for (const targetJobId of uniqueTargets) {
    const targetProfiles = Array.isArray(nextProfilesByJob[targetJobId])
      ? [...nextProfilesByJob[targetJobId]]
      : [];
    targetProfiles.push({
      ...sourceProfile,
      id: idFactory(),
      name: nextCopiedProfileName(sourceProfile.name, targetProfiles),
      conditions: sourceProfile.conditions && typeof sourceProfile.conditions === 'object'
        ? { ...sourceProfile.conditions }
        : sourceProfile.conditions ?? null,
      copiedFrom: { jobId: String(sourceJobId), profileId: String(profileId) },
      createdAt: copiedAt,
      updatedAt: copiedAt,
    });
    nextProfilesByJob[targetJobId] = targetProfiles;
    copiedJobIds.push(targetJobId);
  }
  return { profilesByJob: nextProfilesByJob, copiedJobIds };
}

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

function normalizeServer104Job(rawJob) {
  const externalId = String(rawJob?.externalId || rawJob?.external_id || '').trim();
  const title = String(rawJob?.title || rawJob?.externalTitle || rawJob?.external_title || '').trim();
  if (!/^\d+$/.test(externalId) || !title) return null;
  const status = String(rawJob?.status || rawJob?.publicationStatus || rawJob?.publication_status || '').toLowerCase();
  return {
    id: `104:${externalId}`,
    externalId,
    pos: title,
    title,
    status: status === 'open' ? 'open' : 'pending_confirmation',
    source: '104',
    url: String(rawJob?.url || rawJob?.externalUrl || `https://vip.104.com.tw/job/jobmaster?jobno=${externalId}`),
    updatedDate: String(rawJob?.updatedDate || rawJob?.sourceUpdatedText || ''),
    lastSeenAt: String(rawJob?.lastSeenAt || ''),
    lastSyncedAt: String(rawJob?.lastSyncedAt || ''),
    jobRequisitionId: rawJob?.jobRequisitionId === null || rawJob?.jobRequisitionId === undefined
      ? null
      : Number(rawJob.jobRequisitionId),
  };
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
      external104Sync: normalizeExternal104SyncMetadata(parsed.external104Sync),
    };
  } catch (error) {
    console.warn('104 搜尋導覽設定讀取失敗，已使用預設值。', error);
    return { order: [], profilesByJob: {}, selectedJobId: '', statusFilter: 'open', syncedJobs: [], lastSyncAt: '', external104Sync: normalizeExternal104SyncMetadata(null) };
  }
}

const stored = typeof localStorage === 'undefined'
  ? { order: [], profilesByJob: {}, selectedJobId: '', statusFilter: 'open', syncedJobs: [], lastSyncAt: '', external104Sync: normalizeExternal104SyncMetadata(null) }
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
  extensionDetected: false,
  extensionVersion: '',
  extensionContractVersion: null,
  external104Sync: stored.external104Sync,
  syncInProgress: false,
  syncError: '',
  pendingSyncRequestId: '',
  syncTimer: null,
  captureInProgressProfileId: '',
  captureJobId: '',
  pendingCaptureRequestId: '',
  captureTimer: null,
  captureErrors: {},
  copyingProfileId: '',
  copySourceJobId: '',
  copyQuery: '',
  copyTargetIds: new Set(),
  copyToastTimer: null,
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
      external104Sync: state.external104Sync,
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
  const metadata = normalizeExternal104SyncMetadata(window.hrDashboardBridge?.getExternal104Sync?.());
  const serverJobs = window.hrDashboardBridge?.getExternal104Jobs?.();
  if (metadata.hasSnapshot) {
    state.external104Sync = metadata;
    const previous = new Map(state.syncedJobs.map(job => [String(job?.externalId || ''), job]));
    state.syncedJobs = (Array.isArray(serverJobs) ? serverJobs : [])
      .map(normalizeServer104Job)
      .filter(Boolean)
      .map(job => ({ ...previous.get(job.externalId), ...job }));
    state.lastSyncAt = metadata.lastSyncAt;
  }

  const internalJobs = window.hrDashboardBridge?.getJobs?.() || [];
  const internalById = new Map(internalJobs.map(job => [Number(job?.id), job]));
  state.jobs = (Array.isArray(state.syncedJobs) ? state.syncedJobs : []).map(job => {
    const internalJob = job.jobRequisitionId ? internalById.get(Number(job.jobRequisitionId)) : null;
    const internal = internalJob ? normalizeJobRequisition(internalJob) : null;
    return {
      ...job,
      dept: internal?.dept || '尚未連結',
      internalJob: internal,
      internalState: internal?.displayStatus || 'unlinked',
    };
  });
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
    return [job.pos, job.externalId, job.dept, job.note].some(value => String(value || '').toLowerCase().includes(query));
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
    const internal = job.internalJob;
    const internalMeta = internal
      ? `${internal.dept || '--'} · 缺額 ${internal.displayOpenSlots} · 候選人 ${internal.candidateCount}`
      : '尚未連結內部職缺，缺額與候選人數暫無法判斷';
    const isConflict = isOpenJob(job) && internal && internal.displayStatus !== 'open';
    return `
      <article class="talent-nav-job-row${id === state.selectedJobId ? ' is-selected' : ''}" draggable="true" data-job-id="${escapeHtml(id)}" tabindex="0" aria-label="${escapeHtml(job.pos || '未命名職缺')}，排序第 ${index + 1}">
        <button type="button" class="talent-drag-handle" tabindex="-1" aria-label="拖曳調整職缺順序"><i data-lucide="grip-vertical"></i></button>
        <span class="talent-nav-order">${String(index + 1).padStart(2, '0')}</span>
        <div class="talent-nav-job-copy">
          <div class="talent-nav-job-title">${escapeHtml(job.pos || '未命名職缺')}</div>
          <div class="talent-nav-job-meta">104 #${escapeHtml(job.externalId || '--')}${job.updatedDate ? ` · 更新 ${escapeHtml(job.updatedDate)}` : ''}${isOpenJob(job) ? '' : ' · 待確認是否關閉'}</div>
          <div class="talent-nav-job-meta${isConflict ? ' is-conflict' : ''}">${escapeHtml(internalMeta)}${isConflict ? ' · 內外狀態不一致' : ''}</div>
        </div>
        <span class="talent-nav-profile-count" title="搜尋方案數">${profileCount}</span>
      </article>`;
  }).join('');
  list.dataset.visibleIds = JSON.stringify(visibleOrder);
}

function profileCard(profile, index) {
  const conditions = normalize104SearchConditions(profile.conditions);
  const isCapturing = state.captureInProgressProfileId === profile.id;
  const captureError = state.captureErrors[profile.id] || '';
  const conditionLabel = conditions
    ? `104 條件已儲存${conditions.resultCount !== null ? ` · ${conditions.resultCount} 人` : ''}`
    : '104 條件待擷取';
  return `
    <article class="talent-profile-card" draggable="true" data-profile-id="${escapeHtml(profile.id)}">
      <button type="button" class="talent-drag-handle" tabindex="-1" aria-label="拖曳調整搜尋方案順序"><i data-lucide="grip-vertical"></i></button>
      <div class="talent-profile-copy">
        <div class="talent-profile-topline">
          <span class="talent-profile-step">STEP ${String(index + 1).padStart(2, '0')}</span>
          <span class="talent-profile-name">${escapeHtml(profile.name || '未命名方案')}</span>
        </div>
        <div class="talent-profile-note${profile.note ? '' : ' is-empty'}">${escapeHtml(profile.note || '尚未填寫備註')}</div>
        <span class="talent-profile-state${conditions ? ' is-captured' : ''}${captureError ? ' is-error' : ''}"><i data-lucide="${captureError ? 'circle-alert' : conditions ? 'link-2' : 'unlink'}"></i> ${escapeHtml(captureError || conditionLabel)}</span>
      </div>
      <div class="talent-profile-actions">
        <button type="button" class="talent-profile-action is-open" data-action="open-104" data-profile-id="${escapeHtml(profile.id)}"><i data-lucide="external-link"></i>${conditions ? '開啟 104' : '設定條件'}</button>
        <button type="button" class="talent-profile-action is-capture" data-action="capture-104" data-profile-id="${escapeHtml(profile.id)}"${isCapturing ? ' disabled' : ''}><i data-lucide="${isCapturing ? 'loader-circle' : 'scan-search'}"></i>${isCapturing ? '擷取中' : conditions ? '重新擷取' : '擷取條件'}</button>
        <button type="button" class="talent-profile-action" data-action="copy-profile" data-profile-id="${escapeHtml(profile.id)}"><i data-lucide="copy-plus"></i>複製</button>
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
  const internal = job.internalJob;
  const internalSummary = internal
    ? `${internal.dept || '--'} · 內部缺額 ${internal.displayOpenSlots} · 候選人 ${internal.candidateCount}`
    : '尚未連結職缺管理；請先回職缺總覽完成配對';
  detail.innerHTML = `
    <div class="talent-nav-detail-head">
      <div class="talent-nav-detail-title">
        <div class="talent-nav-eyebrow">SELECTED POSITION</div>
        <h3>${escapeHtml(job.pos || '未命名職缺')}</h3>
        <p>104 職缺 #${escapeHtml(job.externalId || '--')} · ${profiles.length} 組搜尋方案<br>${escapeHtml(internalSummary)}</p>
      </div>
      <div class="talent-nav-detail-actions">
        <button type="button" class="talent-secondary-button" data-action="open-job-overview"><i data-lucide="table-properties"></i>職缺總覽</button>
        <button type="button" class="talent-primary-button" data-action="add-profile"><i data-lucide="plus"></i>新增搜尋方案</button>
      </div>
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
  window.dispatchEvent(new CustomEvent('talent-search-sync-state', {
    detail: {
      inProgress: state.syncInProgress,
      error: state.syncError,
      lastSyncAt: state.lastSyncAt,
      extensionReady: state.extensionReady,
      openCount: state.external104Sync.hasSnapshot ? state.external104Sync.publishedCount : 0,
    }
  }));
  if (state.syncInProgress) {
    status.textContent = '正在讀取 104 所有職務並逐頁檢查，請稍候…';
    return;
  }
  if (state.syncError) {
    status.textContent = state.syncError;
    return;
  }
  if (state.external104Sync.hasSnapshot) {
    status.textContent = `上次更新 ${formatSyncTime(state.external104Sync.lastSyncAt)} · ${state.external104Sync.publishedCount} 筆刊登中職缺（104 共 ${state.external104Sync.sourceTotalCount} 筆）`;
    return;
  }
  if (state.lastSyncAt) {
    status.textContent = `此瀏覽器舊快照 ${formatSyncTime(state.lastSyncAt)} · ${state.syncedJobs.filter(isOpenJob).length} 筆刊登中職缺；請重新同步以保存到系統。`;
    return;
  }
  status.textContent = state.extensionReady
    ? `同步掛件已連線${state.extensionVersion ? `（v${state.extensionVersion}）` : ''}，可開始更新。`
    : '尚未偵測到同步掛件。請先安裝目前專案內的 104-job-sync。';
}

function startManualSync() {
  if (state.syncInProgress) return;
  if (state.extensionDetected && !state.extensionReady) {
    state.syncError = `104 同步掛件不支援契約 v${SYNC_104_CONTRACT_VERSION}，請重新載入目前專案內的掛件。`;
    renderSyncStatus();
    return;
  }
  state.syncError = '';
  state.syncInProgress = true;
  state.pendingSyncRequestId = createId();
  renderSyncStatus();
  window.postMessage({
    type: SYNC_REQUEST_TYPE,
    requestId: state.pendingSyncRequestId,
    contractVersion: SYNC_104_CONTRACT_VERSION,
  }, location.origin);
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(() => {
    if (!state.syncInProgress) return;
    state.syncInProgress = false;
    state.pendingSyncRequestId = '';
    state.syncError = state.extensionReady
      ? '104 同步逾時，舊職缺清單已保留，請確認 104 登入狀態後重試。'
      : '找不到 104 同步掛件。請先安裝或重新載入掛件，再重新整理本頁。';
    renderSyncStatus();
  }, 90_000);
}

async function handleExtensionMessage(event) {
  if (event.source !== window || event.origin !== location.origin) return;
  if (event.data?.type === EXTENSION_READY_TYPE) {
    state.extensionDetected = true;
    state.extensionVersion = String(event.data.version || '');
    state.extensionContractVersion = event.data.contractVersion;
    state.extensionReady = event.data.contractVersion === SYNC_104_CONTRACT_VERSION;
    state.syncError = state.extensionReady
      ? ''
      : `104 同步掛件版本過舊，需支援契約 v${SYNC_104_CONTRACT_VERSION}。`;
    renderSyncStatus();
    return;
  }
  if (event.data?.type === CAPTURE_RESPONSE_TYPE && event.data.requestId === state.pendingCaptureRequestId) {
    clearTimeout(state.captureTimer);
    const profileId = state.captureInProgressProfileId;
    const captureJobId = state.captureJobId;
    state.captureInProgressProfileId = '';
    state.captureJobId = '';
    state.pendingCaptureRequestId = '';
    const conditions = event.data.ok ? normalize104SearchConditions(event.data.conditions) : null;
    if (!conditions) {
      state.captureErrors[profileId] = event.data.error || '無法讀取 104 搜尋條件，原條件仍保留。';
      render();
      return;
    }
    const profiles = [...getProfiles(captureJobId)];
    const profileIndex = profiles.findIndex(item => item.id === profileId);
    if (profileIndex >= 0) {
      profiles[profileIndex] = { ...profiles[profileIndex], conditions, updatedAt: new Date().toISOString() };
      state.profilesByJob[captureJobId] = profiles;
      delete state.captureErrors[profileId];
    }
    render();
    return;
  }
  if (event.data?.type !== SYNC_RESPONSE_TYPE || event.data.requestId !== state.pendingSyncRequestId) return;

  clearTimeout(state.syncTimer);
  if (!event.data.ok) {
    state.syncInProgress = false;
    state.pendingSyncRequestId = '';
    state.syncError = event.data.error || '104 同步失敗，舊職缺清單已保留。';
    renderSyncStatus();
    return;
  }

  const validated = validateComplete104SyncPayload(event.data);
  if (!validated.ok) {
    state.syncInProgress = false;
    state.pendingSyncRequestId = '';
    state.syncError = `${validated.error}；已拒絕不完整的掛件回應，原資料保持不變。`;
    renderSyncStatus();
    return;
  }

  const payload = validated.value;
  try {
    const result = await window.hrRequestJson('/api/job-requisitions/sync-104', {
      method: 'POST',
      timeoutMs: 30000,
      body: JSON.stringify(payload),
    });
    const writeResponse = validate104SyncWriteResponse(result, payload);
    if (!writeResponse.ok) throw new Error(writeResponse.error);

    const appliedAt = writeResponse.value.metadata.lastSyncAt;
    state.syncedJobs = merge104JobSnapshot(state.syncedJobs, payload.jobs, appliedAt);
    state.lastSyncAt = appliedAt;
    state.external104Sync = writeResponse.value.metadata;
    state.statusFilter = 'open';
    state.syncError = '';
    saveState();
    await window.hrDashboardBridge?.reloadData?.();
  } catch (error) {
    state.syncError = `${error?.message || '104 同步失敗'}，舊職缺清單已保留。`;
  } finally {
    state.syncInProgress = false;
    state.pendingSyncRequestId = '';
    render();
  }
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

function copyTargetJobs() {
  const query = state.copyQuery.trim().toLowerCase();
  return orderedJobs().filter(job => {
    if (!isOpenJob(job) || jobId(job) === state.copySourceJobId) return false;
    if (!query) return true;
    return [job.pos, job.externalId].some(value => String(value || '').toLowerCase().includes(query));
  });
}

function renderCopyModal() {
  const modal = document.getElementById('talent-profile-copy-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  const sourceJob = state.jobs.find(job => jobId(job) === state.copySourceJobId);
  const sourceProfile = getProfiles(state.copySourceJobId).find(profile => profile.id === state.copyingProfileId);
  const source = document.getElementById('talent-copy-source');
  const list = document.getElementById('talent-copy-target-list');
  const count = document.getElementById('talent-copy-selected-count');
  const resultCount = document.getElementById('talent-copy-result-count');
  const submit = document.getElementById('talent-copy-submit');
  const selectVisible = document.querySelector('[data-action="toggle-visible-copy-targets"]');
  if (!source || !list || !count || !resultCount || !submit || !selectVisible || !sourceJob || !sourceProfile) return;

  const conditions = normalize104SearchConditions(sourceProfile.conditions);
  source.innerHTML = `
    <span class="talent-copy-source-route">${escapeHtml(sourceJob.pos || '未命名職缺')}</span>
    <i data-lucide="arrow-right"></i>
    <strong>${escapeHtml(sourceProfile.name || '未命名方案')}</strong>
    <span class="talent-copy-source-state">${conditions ? '含已儲存的 104 條件' : '尚未儲存 104 條件'}</span>`;

  const jobs = copyTargetJobs();
  const positions = new Map(orderedJobs().map((job, index) => [jobId(job), index + 1]));
  list.innerHTML = jobs.length ? jobs.map(job => {
    const id = jobId(job);
    const selected = state.copyTargetIds.has(id);
    return `
      <label class="talent-copy-target${selected ? ' is-selected' : ''}">
        <input type="checkbox" data-copy-target-id="${escapeHtml(id)}"${selected ? ' checked' : ''}>
        <span class="talent-copy-target-order">${String(positions.get(id) || 0).padStart(2, '0')}</span>
        <span class="talent-copy-target-copy">
          <strong>${escapeHtml(job.pos || '未命名職缺')}</strong>
          <small>104 #${escapeHtml(job.externalId || '--')} · 目前 ${getProfiles(id).length} 組方案</small>
        </span>
        <i data-lucide="check"></i>
      </label>`;
  }).join('') : `
    <div class="talent-copy-target-empty">
      <i data-lucide="search-x"></i>
      <span>${state.copyQuery ? '沒有符合搜尋的刊登中職缺' : '目前沒有其他刊登中職缺'}</span>
    </div>`;

  const visibleIds = jobs.map(jobId);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => state.copyTargetIds.has(id));
  selectVisible.textContent = allVisibleSelected ? '取消目前顯示' : '選取目前顯示';
  count.textContent = `${state.copyTargetIds.size} 個已選取`;
  resultCount.textContent = `${jobs.length} 個職缺`;
  submit.disabled = state.copyTargetIds.size === 0;
  submit.textContent = state.copyTargetIds.size ? `複製到 ${state.copyTargetIds.size} 個職缺` : '選擇目的職缺';
  window.lucide?.createIcons?.();
}

function openCopyModal(profileId) {
  const modal = document.getElementById('talent-profile-copy-modal');
  const search = document.getElementById('talent-copy-search');
  const profile = getProfiles(state.selectedJobId).find(item => item.id === profileId);
  if (!modal || !search || !profile) return;
  state.copyingProfileId = profileId;
  state.copySourceJobId = state.selectedJobId;
  state.copyQuery = '';
  state.copyTargetIds = new Set();
  search.value = '';
  modal.classList.remove('hidden');
  renderCopyModal();
  requestAnimationFrame(() => search.focus());
}

function closeCopyModal() {
  document.getElementById('talent-profile-copy-modal')?.classList.add('hidden');
  state.copyingProfileId = '';
  state.copySourceJobId = '';
  state.copyQuery = '';
  state.copyTargetIds = new Set();
}

function toggleVisibleCopyTargets() {
  const visibleIds = copyTargetJobs().map(jobId);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => state.copyTargetIds.has(id));
  for (const id of visibleIds) {
    if (allVisibleSelected) state.copyTargetIds.delete(id);
    else state.copyTargetIds.add(id);
  }
  renderCopyModal();
}

function showCopyToast(message) {
  const toast = document.getElementById('talent-copy-toast');
  if (!toast) return;
  clearTimeout(state.copyToastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  state.copyToastTimer = setTimeout(() => toast.classList.remove('is-visible'), 4200);
}

function copyProfileFromForm(event) {
  event.preventDefault();
  if (!state.copyingProfileId || !state.copySourceJobId || !state.copyTargetIds.size) return;
  const result = copyProfileToJobs(
    state.profilesByJob,
    state.copySourceJobId,
    state.copyingProfileId,
    [...state.copyTargetIds]
  );
  const copiedJobs = result.copiedJobIds
    .map(id => state.jobs.find(job => jobId(job) === id))
    .filter(Boolean);
  state.profilesByJob = result.profilesByJob;
  closeCopyModal();
  render();
  if (copiedJobs.length === 1) showCopyToast(`方案已複製到「${copiedJobs[0].pos}」`);
  else showCopyToast(`方案已複製到 ${copiedJobs.length} 個職缺`);
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

function capture104Conditions(profileId) {
  if (!profileId || state.captureInProgressProfileId) return;
  state.captureInProgressProfileId = profileId;
  state.captureJobId = state.selectedJobId;
  state.pendingCaptureRequestId = createId();
  delete state.captureErrors[profileId];
  render();
  window.postMessage({
    type: CAPTURE_REQUEST_TYPE,
    requestId: state.pendingCaptureRequestId,
  }, location.origin);
  clearTimeout(state.captureTimer);
  state.captureTimer = setTimeout(() => {
    if (state.captureInProgressProfileId !== profileId) return;
    state.captureInProgressProfileId = '';
    state.captureJobId = '';
    state.pendingCaptureRequestId = '';
    state.captureErrors[profileId] = state.extensionReady
      ? '條件擷取逾時，請確認 104 搜尋頁仍開著。'
      : '找不到 104 同步掛件，請重新載入掛件與本頁。';
    render();
  }, 35_000);
}

function open104(profileId) {
  const profile = getProfiles(state.selectedJobId).find(item => item.id === profileId);
  const conditions = normalize104SearchConditions(profile?.conditions);
  const opened = window.open(conditions?.url || SEARCH_URL, '_blank', 'noopener,noreferrer');
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
  document.getElementById('talent-profile-copy-form')?.addEventListener('submit', copyProfileFromForm);
  document.getElementById('talent-copy-search')?.addEventListener('input', event => {
    state.copyQuery = event.target.value || '';
    renderCopyModal();
  });
  document.getElementById('talent-copy-target-list')?.addEventListener('change', event => {
    const checkbox = event.target.closest('[data-copy-target-id]');
    if (!checkbox) return;
    if (checkbox.checked) state.copyTargetIds.add(checkbox.dataset.copyTargetId);
    else state.copyTargetIds.delete(checkbox.dataset.copyTargetId);
    renderCopyModal();
  });

  document.getElementById('tab-talent-search')?.addEventListener('click', event => {
    const close = event.target.closest('[data-action="close-profile-modal"]');
    if (close) return closeProfileModal();
    const closeCopy = event.target.closest('[data-action="close-copy-modal"]');
    if (closeCopy) return closeCopyModal();

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
    if (action.dataset.action === 'copy-profile') openCopyModal(profileId);
    if (action.dataset.action === 'toggle-visible-copy-targets') toggleVisibleCopyTargets();
    if (action.dataset.action === 'delete-profile') deleteProfile(profileId);
    if (action.dataset.action === 'open-104') open104(profileId);
    if (action.dataset.action === 'capture-104') capture104Conditions(profileId);
    if (action.dataset.action === 'sync-104-jobs') startManualSync();
    if (action.dataset.action === 'open-job-overview') window.showJobWorkspace?.('jobs');
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
    if (event.key === 'Escape' && !document.getElementById('talent-profile-copy-modal')?.classList.contains('hidden')) closeCopyModal();
  });
}

function init() {
  if (!document.getElementById('tab-talent-search')) return;
  bindEvents();
  window.addEventListener('message', handleExtensionMessage);
  window.addEventListener('hr-dashboard-data-loaded', render);
  render();
}

function selectJob(externalId) {
  const raw = String(externalId || '');
  const id = raw.startsWith('104:') ? raw : `104:${raw}`;
  syncJobs();
  if (!state.jobs.some(job => jobId(job) === id)) return false;
  state.selectedJobId = id;
  state.statusFilter = 'all';
  saveState();
  window.showJobWorkspace?.('talent-search');
  render();
  return true;
}

function getSnapshot() {
  syncJobs();
  return {
    jobs: state.jobs.map(job => ({ ...job, internalJob: job.internalJob ? { ...job.internalJob } : null })),
    profilesByJob: Object.fromEntries(Object.entries(state.profilesByJob).map(([id, profiles]) => [id, Array.isArray(profiles) ? [...profiles] : []])),
    lastSyncAt: state.lastSyncAt,
    external104Sync: { ...state.external104Sync },
    syncInProgress: state.syncInProgress,
    extensionReady: state.extensionReady,
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.talentSearchNavigator = { render, startManualSync, selectJob, getSnapshot };
  init();
}
