import {
  filterJobRequisitions,
  normalizeJobRequisition,
  serializeJobRequisitionPayload,
} from './dataUtils.js';
import {
  readTalentNavigatorStorageSnapshot,
  reconcileJobRequisitions,
} from './jobReconciliation.js';
import {
  normalizeExternal104SyncMetadata,
  POSTGRES_INTEGER_MAX,
} from './sync104Contract.js';

function failedWriteResponse(result, fallback) {
  return { ok: false, error: String(result?.data?.error || fallback) };
}

export function validateExternalLinkWriteResponse(result, externalId, jobRequisitionId) {
  if (result?.ok !== true) return failedWriteResponse(result, '配對儲存失敗');
  if (result.data?.ok !== true) return failedWriteResponse(result, '配對儲存結果未明確成功');

  const external104Job = result.data.external104Job;
  if (!external104Job || typeof external104Job !== 'object' || Array.isArray(external104Job)) {
    return failedWriteResponse(result, '配對儲存回應缺少 104 職缺資料');
  }
  const expectedExternalId = String(externalId ?? '').trim();
  if (!/^\d{1,32}$/.test(expectedExternalId) || external104Job.externalId !== expectedExternalId) {
    return failedWriteResponse(result, '配對儲存回應的 104 職缺編號不一致');
  }

  const expectedJobRequisitionId = jobRequisitionId === null ? null : Number(jobRequisitionId);
  const actualJobRequisitionId = external104Job.jobRequisitionId;
  if (expectedJobRequisitionId === null) {
    if (actualJobRequisitionId !== null) {
      return failedWriteResponse(result, '解除配對回應仍含有內部職缺編號');
    }
  } else if (
    !Number.isInteger(expectedJobRequisitionId)
    || expectedJobRequisitionId < 1
    || expectedJobRequisitionId > POSTGRES_INTEGER_MAX
    || actualJobRequisitionId !== expectedJobRequisitionId
  ) {
    return failedWriteResponse(result, '配對儲存回應的內部職缺編號不一致');
  }
  if (
    typeof external104Job.title !== 'string'
    || !external104Job.title.trim()
    || typeof external104Job.url !== 'string'
    || !['open', 'pending_confirmation'].includes(external104Job.status)
  ) {
    return failedWriteResponse(result, '配對儲存回應的 104 職缺資料不完整');
  }

  return { ok: true, value: external104Job };
}

export function validateJobRequisitionWriteResponse(result, expectedId = null) {
  if (result?.ok !== true) return failedWriteResponse(result, '職缺儲存失敗');
  if (result.data?.ok !== true) return failedWriteResponse(result, '職缺儲存結果未明確成功');

  const requisition = result.data.requisition;
  if (!requisition || typeof requisition !== 'object' || Array.isArray(requisition)) {
    return failedWriteResponse(result, '職缺儲存回應缺少職缺資料');
  }
  const id = requisition.id;
  if (!Number.isInteger(id) || id < 1 || id > POSTGRES_INTEGER_MAX) {
    return failedWriteResponse(result, '職缺儲存回應缺少可用的職缺編號');
  }
  if (expectedId !== null && id !== Number(expectedId)) {
    return failedWriteResponse(result, '職缺儲存回應的職缺編號不一致');
  }
  if (
    typeof requisition.positionTitle !== 'string'
    || !requisition.positionTitle.trim()
    || typeof requisition.department !== 'string'
    || !requisition.department.trim()
    || !Number.isInteger(requisition.headcount)
    || requisition.headcount < 0
    || !Number.isInteger(requisition.urgency)
    || requisition.urgency < 1
    || requisition.urgency > 5
    || !['open', 'cancelled', 'on_hold', 'filled'].includes(requisition.status)
  ) {
    return failedWriteResponse(result, '職缺儲存回應的職缺資料不完整');
  }

  return { ok: true, value: requisition };
}

const bridge = typeof window !== 'undefined' ? window.hrDashboardBridge : null;

if (!bridge || typeof window.hrRequestJson !== 'function') {
  if (typeof window !== 'undefined') console.warn('Jobs editor bridge is not available.');
} else {
  const originalRenderJobs = bridge.getRenderJobs();
  const state = {
    modalReady: false,
    editingJob: null,
    pendingExternalJob: null,
    pendingCreatedJobId: null,
    saving: false,
    linkingExternalId: '',
    actionError: '',
    actionMessage: '',
    syncInProgress: false,
  };

  const statusLabels = {
    open: '開缺中',
    cancelled: '已關閉',
    closed: '已關閉',
    on_hold: '暫停',
    filled: '已補滿',
  };

  const statusBadgeClasses = {
    open: 'badge-blue',
    on_hold: 'badge-orange',
    filled: 'badge-green',
    closed: 'badge-gray',
    cancelled: 'badge-gray',
  };

  const reconciliationLabels = {
    in_sync: { label: '與 104 一致', tone: 'is-good' },
    external_open_internal_closed: { label: '104 仍在刊登', tone: 'is-conflict' },
    external_missing_internal_open: { label: '104 待確認', tone: 'is-review' },
    external_missing_internal_closed: { label: '104 待確認', tone: '' },
    internal_unlinked: { label: '尚未配對 104', tone: 'is-review' },
    not_synced: { label: '104 尚未同步', tone: '' },
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

  function getExternalSnapshot() {
    const serverJobs = bridge.getExternal104Jobs?.();
    const metadata = normalizeExternal104SyncMetadata(bridge.getExternal104Sync?.());
    const localSnapshot = readTalentNavigatorStorageSnapshot();
    return {
      jobs: metadata.hasSnapshot
        ? (Array.isArray(serverJobs) ? serverJobs : [])
        : localSnapshot.external104Jobs,
      lastSyncAt: metadata.hasSnapshot ? metadata.lastSyncAt : localSnapshot.lastSyncAt,
      hasSuccessfulSync: metadata.hasSnapshot || localSnapshot.hasSuccessfulSync,
      isPersisted: metadata.hasSnapshot,
      metadata,
    };
  }

  function getReconciliation() {
    const snapshot = getExternalSnapshot();
    return {
      snapshot,
      result: reconcileJobRequisitions({
        internalRequisitions: bridge.getJobs(),
        external104Jobs: snapshot.jobs,
        hasSuccessfulSync: snapshot.hasSuccessfulSync,
      }),
    };
  }

  function formatSyncTime(value) {
    if (!value) return '尚未同步';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '已同步';
    return date.toLocaleString('zh-TW', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }

  function getProfileCount(externalId) {
    const snapshot = window.talentSearchNavigator?.getSnapshot?.();
    const profiles = snapshot?.profilesByJob?.[`104:${externalId}`];
    if (Array.isArray(profiles)) return profiles.length;
    try {
      const parsed = JSON.parse(localStorage.getItem('sporton.talentSearchNavigator.v1') || '{}');
      return Array.isArray(parsed?.profilesByJob?.[`104:${externalId}`])
        ? parsed.profilesByJob[`104:${externalId}`].length
        : 0;
    } catch (_) {
      return 0;
    }
  }

  function createFilterButton(label, filter) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.jobFilter = filter;
    button.className = 'px-3 py-1.5 text-xs font-medium rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50';
    button.textContent = label;
    button.addEventListener('click', () => {
      if (typeof window.setJobF === 'function') {
        window.setJobF(filter, button);
      }
    });
    return button;
  }

  function ensureToolbar() {
    const jobsTab = document.getElementById('tab-jobs');
    if (!jobsTab) return;
    const toolbar = jobsTab.querySelector('.section-head');
    if (!toolbar) return;

    if (!toolbar.querySelector('[data-job-filter="closed"]')) {
      toolbar.insertBefore(createFilterButton('已關閉', 'closed'), toolbar.querySelector('[data-job-editor-add]') || null);
    }
    if (!toolbar.querySelector('[data-job-filter="on_hold"]')) {
      toolbar.insertBefore(createFilterButton('暫停', 'on_hold'), toolbar.querySelector('[data-job-editor-add]') || null);
    }
    if (toolbar.querySelector('[data-job-editor-add]')) return;

    const spacer = document.createElement('div');
    spacer.className = 'ml-auto';

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.jobEditorAdd = '1';
    button.className = 'px-3 py-1.5 text-xs font-medium rounded border border-brand bg-brand text-white hover:opacity-90';
    button.innerHTML = '<span aria-hidden="true">＋</span> 新增職缺';
    button.addEventListener('click', () => openModal());

    spacer.appendChild(button);
    toolbar.appendChild(spacer);
  }

  function internalOptions(rows, selectedId = null) {
    const options = rows
      .filter(job => job.id !== null && job.id !== undefined && job.id !== '')
      .map(job => {
        const id = String(job.id);
        const selected = selectedId !== null && String(selectedId) === id ? ' selected' : '';
        return `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(job.dept || '--')}｜${escapeHtml(job.pos || '未命名職缺')}</option>`;
      });
    return `<option value="">選擇內部職缺…</option>${options.join('')}`;
  }

  function renderReconciliationPanel(result, snapshot) {
    const panel = document.getElementById('job-reconciliation-panel');
    if (!panel) return;

    const conflictCount = (result.summary.byState.external_open_internal_closed || 0)
      + (result.summary.byState.external_missing_internal_open || 0);
    const queue = result.unmatchedExternal.filter(external => external.status === 'open');
    const persistedMessage = !snapshot.hasSuccessfulSync
      ? '尚未取得 104 快照；同步前不會把任何內部職缺判定為未刊登。'
      : snapshot.isPersisted
        ? `最後同步 ${formatSyncTime(snapshot.lastSyncAt)}；104 共 ${snapshot.metadata.sourceTotalCount} 筆、刊登中 ${snapshot.metadata.publishedCount} 筆。配對會保存到系統，其他使用者也能看到。`
        : '目前顯示此瀏覽器的舊快照；請重新從 104 更新，才能保存配對。';

    const queueRows = queue.slice(0, 10).map(external => {
      const suggestedId = external.suggestedJobRequisitionId ?? null;
      const disabled = snapshot.isPersisted ? '' : ' disabled';
      const title = external.title || external.pos || '未命名職缺';
      return `
        <div class="job-source-queue-row" data-external-row="${escapeHtml(external.externalId)}">
          <div class="job-source-queue-copy">
            <strong>${escapeHtml(title)}</strong>
            <small>104 #${escapeHtml(external.externalId)}${external.updatedDate ? ` · 更新 ${escapeHtml(external.updatedDate)}` : ''}${external.status === 'open' ? ' · 刊登中' : ' · 待確認'}</small>
          </div>
          <select data-external-link-select="${escapeHtml(external.externalId)}" aria-label="選擇要配對的內部職缺"${disabled}>
            ${internalOptions(result.internalRows, suggestedId)}
          </select>
          <div class="job-source-actions">
            <button type="button" class="job-source-action" data-job-create-from-104="${escapeHtml(external.externalId)}"${disabled}>
              <i data-lucide="plus"></i>建立職缺
            </button>
            <button type="button" class="job-source-action is-primary" data-job-save-link="${escapeHtml(external.externalId)}"${disabled || (state.linkingExternalId === external.externalId ? ' disabled' : '')}>
              <i data-lucide="link-2"></i>${state.linkingExternalId === external.externalId ? '儲存中' : suggestedId ? '確認建議' : '儲存配對'}
            </button>
          </div>
        </div>`;
    }).join('');

    panel.innerHTML = `
      <div class="job-source-card">
        <div class="job-source-head">
          <div class="job-source-title">
            <i data-lucide="git-compare-arrows" aria-hidden="true"></i>
            <div>
              <h2>104 最新刊登 × 內部缺額判斷</h2>
              <p>104 只負責刊登名稱與上下架狀態；部門、標準職稱、缺額及到職扣缺仍以內部職缺為準。${escapeHtml(persistedMessage)}</p>
            </div>
          </div>
          <button type="button" class="job-source-sync${state.syncInProgress ? ' is-syncing' : ''}" data-job-sync-104${state.syncInProgress ? ' disabled' : ''}>
            <i data-lucide="refresh-cw" aria-hidden="true"></i>${state.syncInProgress ? '同步中' : '從 104 更新'}
          </button>
        </div>
        <div class="job-source-summary">
          <div class="job-source-metric"><span>104 刊登中</span><strong>${result.summary.openExternalTotal}</strong></div>
          <div class="job-source-metric is-good"><span>已確認配對</span><strong>${result.summary.linkedExternalTotal}</strong></div>
          <div class="job-source-metric is-review"><span>刊登中待配對</span><strong>${queue.length}</strong></div>
          <div class="job-source-metric${conflictCount ? ' is-conflict' : ''}"><span>狀態需檢查</span><strong>${conflictCount}</strong></div>
        </div>
        <div class="job-source-queue">
          <div class="job-source-queue-head">
            <strong>104 待納管職缺</strong>
            <span>同名只作為建議，請確認部門與標準職稱後再配對</span>
          </div>
          ${state.actionError ? `<div class="job-source-empty" style="color:#a33f36">${escapeHtml(state.actionError)}</div>` : ''}
          ${state.actionMessage ? `<div class="job-source-empty" style="color:#277052">${escapeHtml(state.actionMessage)}</div>` : ''}
          <div class="job-source-queue-list">
            ${queueRows || `<div class="job-source-empty">${snapshot.hasSuccessfulSync ? '目前沒有待配對的 104 職缺。' : '完成第一次同步後，待配對職缺會顯示在這裡。'}</div>`}
          </div>
          ${queue.length > 10 ? `<div class="job-source-empty">另有 ${queue.length - 10} 筆，請先處理目前清單。</div>` : ''}
        </div>
      </div>`;
  }

  async function persistExternalLink(externalId, jobRequisitionId) {
    state.actionError = '';
    state.actionMessage = '';
    state.linkingExternalId = String(externalId);
    renderEditableJobs();
    try {
      const result = await window.hrRequestJson(`/api/job-requisition-sources/104/${encodeURIComponent(externalId)}`, {
        method: 'PATCH',
        timeoutMs: 12000,
        body: JSON.stringify({ jobRequisitionId: jobRequisitionId === null ? null : Number(jobRequisitionId) }),
      });
      const writeResponse = validateExternalLinkWriteResponse(result, externalId, jobRequisitionId);
      if (!writeResponse.ok) throw new Error(writeResponse.error);
      state.actionMessage = jobRequisitionId === null ? '已解除 104 配對。' : '104 職缺已連結到內部職缺。';
      await bridge.reloadData();
      return result.data;
    } catch (error) {
      state.actionError = error?.message || '配對儲存失敗';
      throw error;
    } finally {
      state.linkingExternalId = '';
      renderEditableJobs();
    }
  }

  function bindReconciliationEvents(reconciliation) {
    const panel = document.getElementById('job-reconciliation-panel');
    if (!panel) return;

    const syncButton = panel.querySelector('[data-job-sync-104]');
    if (syncButton) {
      syncButton.addEventListener('click', () => {
        state.actionError = '';
        state.actionMessage = '';
        if (window.talentSearchNavigator?.startManualSync) window.talentSearchNavigator.startManualSync();
        else {
          state.actionError = '104 同步模組尚未載入，請重新整理頁面後再試。';
          renderEditableJobs();
        }
      });
    }

    panel.querySelectorAll('[data-job-create-from-104]').forEach(createButton => {
      createButton.addEventListener('click', () => {
        const externalId = createButton.getAttribute('data-job-create-from-104');
        const external = reconciliation.unmatchedExternal.find(job => String(job.externalId) === String(externalId));
        if (external) openModal(null, external);
      });
    });

    panel.querySelectorAll('[data-job-save-link]').forEach(saveButton => {
      saveButton.addEventListener('click', async () => {
        const externalId = saveButton.dataset.jobSaveLink;
        const select = saveButton.closest('[data-external-row]')?.querySelector('[data-external-link-select]');
        if (!select?.value) {
          state.actionError = '請先選擇要配對的內部職缺。';
          renderEditableJobs();
          return;
        }
        try { await persistExternalLink(externalId, Number(select.value)); } catch (_) {}
      });
    });
  }

  function ensureModal() {
    if (state.modalReady) return;

    const overlay = document.createElement('div');
    overlay.id = 'job-editor-overlay';
    overlay.className = 'hidden fixed inset-0 z-[1200] bg-slate-900/45 items-center justify-center p-4';
    overlay.innerHTML = `
      <div class="w-full max-w-2xl rounded-lg border border-border bg-white shadow-2xl">
        <div class="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div class="text-sm font-semibold text-gray-900" id="job-editor-title">新增職缺</div>
            <div class="text-xs text-gray-500 mt-1">部門＋標準職稱是到職自動扣缺的配對鍵，請勿直接照 104 名稱覆寫。</div>
          </div>
          <button type="button" id="job-editor-close" class="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">關閉</button>
        </div>
        <form id="job-editor-form" class="grid grid-cols-2 gap-4 px-5 py-5">
          <label class="flex flex-col gap-1 text-xs text-gray-600">
            <span>正式部門</span>
            <input name="department" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900" required />
          </label>
          <label class="flex flex-col gap-1 text-xs text-gray-600">
            <span>標準職稱</span>
            <input name="positionTitle" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900" required />
          </label>
          <label class="flex flex-col gap-1 text-xs text-gray-600">
            <span>目前缺額</span>
            <input name="headcount" type="number" min="0" step="1" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900" required />
          </label>
          <label class="flex flex-col gap-1 text-xs text-gray-600">
            <span>內部狀態</span>
            <select name="status" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900">
              <option value="open">開缺中</option>
              <option value="cancelled">已關閉</option>
              <option value="on_hold">暫停</option>
              <option value="filled">已補滿</option>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-xs text-gray-600">
            <span>急迫度（1–5）</span>
            <input name="urgency" type="number" min="1" max="5" step="1" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900" value="3" required />
          </label>
          <label class="flex flex-col gap-1 text-xs text-gray-600">
            <span>開缺日期</span>
            <input name="openDate" type="date" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900" />
          </label>
          <label class="col-span-2 flex flex-col gap-1 text-xs text-gray-600">
            <span>目標日期</span>
            <input name="targetDate" type="date" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900" />
          </label>
          <label class="col-span-2 flex flex-col gap-1 text-xs text-gray-600">
            <span>備註</span>
            <textarea name="notes" rows="3" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"></textarea>
          </label>
          <div class="col-span-2 flex items-center justify-between border-t border-border pt-4">
            <div id="job-editor-error" class="text-xs text-rose-600"></div>
            <div class="flex items-center gap-2">
              <button type="button" id="job-editor-cancel" class="rounded border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">取消</button>
              <button type="submit" id="job-editor-save" class="rounded border border-brand bg-brand px-3 py-2 text-xs font-medium text-white hover:opacity-90">儲存</button>
            </div>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    const setFormFieldsDisabled = disabled => {
      overlay.querySelectorAll('#job-editor-form input, #job-editor-form select, #job-editor-form textarea')
        .forEach(field => { field.disabled = disabled; });
    };

    const showPendingLinkRetry = error => {
      const createdId = Number(state.pendingCreatedJobId);
      overlay.querySelector('#job-editor-title').textContent = '職缺已建立，待完成 104 配對';
      overlay.querySelector('#job-editor-error').textContent = `內部職缺 #${createdId} 已建立，但 104 配對失敗：${error?.message || '配對儲存失敗'}。資料不會再次建立，請按「重試配對」。`;
      setFormFieldsDisabled(true);
      state.actionMessage = `內部職缺 #${createdId} 已建立，等待完成 104 配對。`;
      renderEditableJobs();
    };

    const close = () => {
      overlay.classList.add('hidden');
      overlay.classList.remove('flex');
      state.editingJob = null;
      state.pendingExternalJob = null;
      state.pendingCreatedJobId = null;
      state.saving = false;
      overlay.querySelector('#job-editor-error').textContent = '';
      overlay.querySelector('#job-editor-form').reset();
      overlay.querySelector('#job-editor-save').textContent = '儲存';
      setFormFieldsDisabled(false);
    };

    overlay.querySelector('#job-editor-close').addEventListener('click', close);
    overlay.querySelector('#job-editor-cancel').addEventListener('click', close);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });

    overlay.querySelector('#job-editor-form').addEventListener('submit', async event => {
      event.preventDefault();
      if (state.saving) return;

      const form = event.currentTarget;
      const errorNode = overlay.querySelector('#job-editor-error');
      const saveButton = overlay.querySelector('#job-editor-save');
      const pendingExternalJob = state.pendingExternalJob;
      const retryCreatedId = Number(state.pendingCreatedJobId);
      const isRetryingLink = Boolean(
        pendingExternalJob
        && Number.isInteger(retryCreatedId)
        && retryCreatedId > 0
      );
      let createdDuringAttempt = false;
      errorNode.textContent = '';

      state.saving = true;
      saveButton.textContent = isRetryingLink ? '重新配對中…' : '儲存中…';

      try {
        if (isRetryingLink) {
          await persistExternalLink(pendingExternalJob.externalId, retryCreatedId);
          close();
          return;
        }

        const formData = new FormData(form);
        const headcount = Number(formData.get('headcount'));
        const urgency = Number(formData.get('urgency'));
        const payload = {
          department: String(formData.get('department') || '').trim(),
          positionTitle: String(formData.get('positionTitle') || '').trim(),
          headcount,
          status: String(formData.get('status') || '').trim(),
          urgency,
          notes: String(formData.get('notes') || '').trim(),
          openDate: String(formData.get('openDate') || '').trim() || null,
          targetDate: String(formData.get('targetDate') || '').trim() || null,
        };
        const targetId = state.editingJob?.id ? Number(state.editingJob.id) : null;
        const result = await window.hrRequestJson(
          targetId ? `/api/job-requisitions/${targetId}` : '/api/job-requisitions',
          {
            method: targetId ? 'PATCH' : 'POST',
            body: JSON.stringify(targetId ? { ...payload, id: targetId } : payload),
            timeoutMs: 10000,
          }
        );

        const writeResponse = validateJobRequisitionWriteResponse(result, targetId);
        if (!writeResponse.ok) {
          errorNode.textContent = writeResponse.error;
          return;
        }

        if (!targetId && pendingExternalJob) {
          const createdId = writeResponse.value.id;
          state.pendingCreatedJobId = createdId;
          createdDuringAttempt = true;
          await persistExternalLink(pendingExternalJob.externalId, createdId);
        }
        close();
        if (!pendingExternalJob) await bridge.reloadData();
      } catch (error) {
        if (state.pendingCreatedJobId && state.pendingExternalJob) {
          if (createdDuringAttempt) await bridge.reloadData();
          showPendingLinkRetry(error);
        } else {
          errorNode.textContent = error?.message || '職缺儲存失敗';
        }
      } finally {
        state.saving = false;
        saveButton.textContent = state.pendingCreatedJobId && state.pendingExternalJob ? '重試配對' : '儲存';
      }
    });

    state.modalReady = true;
  }

  function openModal(job = null, externalJob = null) {
    ensureModal();
    state.editingJob = job;
    state.pendingExternalJob = externalJob;
    state.pendingCreatedJobId = null;

    const overlay = document.getElementById('job-editor-overlay');
    const form = overlay.querySelector('#job-editor-form');
    const title = overlay.querySelector('#job-editor-title');
    const errorNode = overlay.querySelector('#job-editor-error');

    form.reset();
    form.querySelectorAll('input, select, textarea').forEach(field => { field.disabled = false; });
    errorNode.textContent = '';
    overlay.querySelector('#job-editor-save').textContent = '儲存';

    if (job) {
      title.textContent = '編輯職缺';
      form.elements.department.value = job.dept || job.department || '';
      form.elements.positionTitle.value = job.pos || job.positionTitle || '';
      form.elements.headcount.value = job.headcount ?? 0;
      form.elements.status.value = job.status || 'open';
      form.elements.urgency.value = job.urgency ?? 3;
      form.elements.notes.value = job.note || job.notes || '';
      form.elements.openDate.value = job.open || job.openDate || '';
      form.elements.targetDate.value = job.target || job.targetDate || '';
    } else {
      title.textContent = externalJob ? '將 104 職缺納入管理' : '新增職缺';
      form.elements.status.value = 'open';
      form.elements.urgency.value = '3';
      form.elements.headcount.value = '1';
      if (externalJob) {
        form.elements.positionTitle.value = externalJob.title || externalJob.pos || '';
        form.elements.notes.value = `來源：104 #${externalJob.externalId}。請確認正式部門與標準職稱。`;
      }
    }

    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    setTimeout(() => form.elements.department.focus(), 0);
  }

  const GROUP_ORDER = ['WBU', 'ICC', '新華／新竹', '安規', '行政', '其他'];
  const getGroup = dept => {
    if (!dept) return '其他';
    if (dept.startsWith('WBU')) return 'WBU';
    if (dept.startsWith('ICC')) return 'ICC';
    if (dept.startsWith('新竹') || dept.startsWith('新華')) return '新華／新竹';
    if (dept.startsWith('安規')) return '安規';
    if (dept.startsWith('行政')) return '行政';
    return '其他';
  };
  const getSubDept = dept => String(dept || '').replace(/^[^/／]+[/／]\s*/, '').trim() || dept || '--';

  function renderEditableJobs() {
    ensureToolbar();

    const { result: reconciliation, snapshot } = getReconciliation();
    renderReconciliationPanel(reconciliation, snapshot);
    bindReconciliationEvents(reconciliation);

    const header = document.querySelector('#tab-jobs thead tr');
    if (header) {
      header.innerHTML = [
        '<th style="min-width:120px">部門</th>',
        '<th style="min-width:160px">內部職缺</th>',
        '<th class="text-center" style="min-width:70px">缺額</th>',
        '<th class="text-center" style="min-width:90px">急迫度</th>',
        '<th class="text-center" style="min-width:55px">候選人</th>',
        '<th style="min-width:125px">判斷結果</th>',
        '<th style="min-width:175px">104 刊登</th>',
        '<th style="min-width:90px">搜尋策略</th>',
        '<th class="text-right" style="min-width:115px">操作</th>',
      ].join('');
    }

    const tbody = document.getElementById('job-tbody');
    if (!tbody) return;

    const normalized = filterJobRequisitions(reconciliation.internalRows, bridge.getJobFilter());
    if (!normalized.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-400">目前沒有符合篩選條件的職缺</td></tr>';
      window.lucide?.createIcons?.();
      return;
    }

    const groups = {};
    GROUP_ORDER.forEach(g => { groups[g] = []; });
    normalized.forEach(job => { (groups[getGroup(job.dept)] = groups[getGroup(job.dept)] || []).push(job); });

    let html = '';
    GROUP_ORDER.forEach(groupName => {
      const list = groups[groupName];
      if (!list || !list.length) return;
      html += `<tr style="background:rgba(22,58,99,0.06);border-top:1px solid rgba(22,58,99,0.1)"><td colspan="9" style="padding:8px 24px 6px"><span style="font-size:11px;font-weight:700;color:#163a63;letter-spacing:0.06em;text-transform:uppercase">${escapeHtml(groupName)}</span></td></tr>`;
      list.forEach(job => {
        const item = normalizeJobRequisition(job);
        const notes = item.noteText || '--';
        const urgency = Number(job.urgency ?? 3);
        const candidateCount = Number(job.candidateCount ?? job.cands ?? 0);
        const displayStatus = item.displayStatus === 'closed' ? 'cancelled' : item.displayStatus;
        const urgencyDots = '●'.repeat(Math.min(urgency,5)) + '○'.repeat(Math.max(0,5-urgency));
        const reconciliation = reconciliationLabels[item.reconciliationState] || reconciliationLabels.not_synced;
        const links = Array.isArray(item.links) ? item.links : [];
        const externalLinks = links.map(link => {
          const url = safe104Url(link.url);
          const label = `${link.title || link.pos || '104 職缺'}`;
          return `<div class="job-publication-link">
            ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(label)}">${escapeHtml(label)}</a>` : `<span>${escapeHtml(label)}</span>`}
            <small>#${escapeHtml(link.externalId)}${link.status === 'open' ? '' : ' · 待確認'}</small>
            <button type="button" class="job-unlink-button" data-job-unlink-external="${escapeHtml(link.externalId)}" aria-label="解除 ${escapeHtml(label)} 的配對"><i data-lucide="unlink"></i></button>
          </div>`;
        }).join('');
        const primaryExternal = links.find(link => link.status === 'open') || links[0] || null;
        const profileCount = links.reduce((count, link) => count + getProfileCount(link.externalId), 0);
        html += `<tr>
          <td class="text-gray-500 text-[12px]">${escapeHtml(getSubDept(item.dept))}</td>
          <td><div class="job-title-stack"><strong>${escapeHtml(item.pos)}</strong><small title="${escapeHtml(notes)}">${escapeHtml(notes)}</small></div></td>
          <td class="text-center font-semibold text-brand">${escapeHtml(item.displayOpenSlots)}</td>
          <td class="text-center text-[10px] tracking-tighter text-amber-500">${urgencyDots}</td>
          <td class="text-center">${candidateCount}</td>
          <td><div class="job-status-rail">
            <span class="job-status-line${displayStatus === 'open' ? ' is-good' : ''}">內部：${escapeHtml(statusLabels[item.displayStatus] || statusLabels[job.status] || job.status)}</span>
            <span class="job-status-line ${reconciliation.tone}">${escapeHtml(reconciliation.label)}</span>
          </div></td>
          <td><div class="job-publication-links">${externalLinks || '<span class="job-publication-empty">尚未連結 104 職缺</span>'}</div></td>
          <td>${primaryExternal ? `<button type="button" class="job-table-action is-search" data-job-search-external="${escapeHtml(primaryExternal.externalId)}"><i data-lucide="route"></i>${profileCount} 組</button>` : '<span class="job-publication-empty">—</span>'}</td>
          <td class="text-right">
            <div class="job-row-actions">
              <button type="button" class="job-table-action" data-job-edit="${escapeHtml(job.id ?? '')}"><i data-lucide="pencil"></i>編輯</button>
            </div>
          </td>
        </tr>`;
      });
    });
    tbody.innerHTML = html;

    tbody.querySelectorAll('[data-job-edit]').forEach(button => {
      button.addEventListener('click', () => {
        const id = Number(button.dataset.jobEdit);
        const job = bridge.getJobs().find(item => Number(item.id) === id) || null;
        openModal(job ? serializeJobRequisitionPayload(job, { includeId: true }) : null);
      });
    });
    tbody.querySelectorAll('[data-job-search-external]').forEach(button => {
      button.addEventListener('click', () => window.talentSearchNavigator?.selectJob?.(button.dataset.jobSearchExternal));
    });
    tbody.querySelectorAll('[data-job-unlink-external]').forEach(button => {
      button.addEventListener('click', async () => {
        if (!window.confirm('確定解除這筆 104 刊登與內部職缺的配對？搜尋方案仍會保留。')) return;
        try { await persistExternalLink(button.dataset.jobUnlinkExternal, null); } catch (_) {}
      });
    });
    window.lucide?.createIcons?.();
  }

  bridge.setRenderJobs(renderEditableJobs);
  renderEditableJobs();
  window.addEventListener('hr-dashboard-data-loaded', renderEditableJobs);
  window.addEventListener('talent-search-sync-state', event => {
    state.syncInProgress = Boolean(event.detail?.inProgress);
    if (event.detail && Object.prototype.hasOwnProperty.call(event.detail, 'error')) {
      state.actionError = String(event.detail.error || '');
    }
    renderEditableJobs();
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const overlay = document.getElementById('job-editor-overlay');
      if (overlay && !overlay.classList.contains('hidden')) {
        overlay.querySelector('#job-editor-close')?.click();
      }
    }
  });

  window.hrJobsEditor = {
    openModal,
    renderEditableJobs,
    restoreOriginalRenderJobs: () => bridge.setRenderJobs(originalRenderJobs),
  };
}
