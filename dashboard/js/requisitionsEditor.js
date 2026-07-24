import { reconcileJobRequisitions } from './jobReconciliation.js';

const bridge = typeof window !== 'undefined' ? window.hrDashboardBridge : null;

if (!bridge || typeof window.hrRequestJson !== 'function') {
  if (typeof window !== 'undefined') console.warn('Requisitions editor bridge is not available.');
} else {
  const state = {
    saving: false,
    error: '',
    message: '',
    formMode: null, // null | 'create' | 'edit'
    formId: null,
    form: { department: '', positionTitle: '', headcount: 1, status: 'open', urgency: 3, notes: '' },
    linkSelection: {},
    showCancelled: false,
  };

  const STATUS_META = {
    open: { label: '刊登中', cls: 'badge-green' },
    filled: { label: '已補滿', cls: 'badge-blue' },
    on_hold: { label: '暫緩', cls: 'badge-amber' },
    cancelled: { label: '已取消', cls: 'badge-gray' },
  };

  const RECONCILIATION_META = {
    in_sync: { label: '已同步', cls: 'badge-green' },
    external_open_internal_closed: { label: '104仍刊登，內部已關閉', cls: 'badge-orange' },
    external_missing_internal_open: { label: '104已下架，內部仍開', cls: 'badge-amber' },
    external_missing_internal_closed: { label: '雙邊皆已結束', cls: 'badge-gray' },
    internal_unlinked: { label: '尚未連結104', cls: 'badge-gray' },
    external_unlinked: { label: '未連結內部職缺', cls: 'badge-gray' },
    not_synced: { label: '尚未同步104', cls: 'badge-gray' },
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

  function statusBadge(status) {
    const meta = STATUS_META[status] || STATUS_META.cancelled;
    return `<span class="badge ${meta.cls}">${meta.label}</span>`;
  }

  function reconciliationBadge(state104) {
    const meta = RECONCILIATION_META[state104] || RECONCILIATION_META.not_synced;
    return `<span class="badge ${meta.cls}">${meta.label}</span>`;
  }

  function getReconciliation() {
    const sync = bridge.getExternal104Sync?.() || {};
    return reconcileJobRequisitions({
      internalRequisitions: bridge.getJobs?.() || [],
      external104Jobs: bridge.getExternal104Jobs?.() || [],
      hasSuccessfulSync: Boolean(sync.hasSnapshot),
    });
  }

  function resetForm() {
    state.formMode = null;
    state.formId = null;
    state.form = { department: '', positionTitle: '', headcount: 1, status: 'open', urgency: 3, notes: '' };
  }

  function openCreateForm() {
    resetForm();
    state.formMode = 'create';
    state.error = '';
    render();
  }

  function openEditForm(id) {
    const job = (bridge.getJobs?.() || []).find(j => String(j.id) === String(id));
    if (!job) return;
    state.formMode = 'edit';
    state.formId = job.id;
    state.form = {
      department: job.dept || '',
      positionTitle: job.pos || '',
      headcount: Number(job.headcount ?? 0),
      status: job.status || 'open',
      urgency: Number(job.urgency ?? 3),
      notes: job.note || '',
    };
    state.error = '';
    render();
  }

  function readFormFromDom(container) {
    const get = name => container.querySelector(`[name="${name}"]`);
    state.form = {
      department: String(get('department')?.value || '').trim(),
      positionTitle: String(get('positionTitle')?.value || '').trim(),
      headcount: Number(get('headcount')?.value ?? 0),
      status: String(get('status')?.value || 'open'),
      urgency: Number(get('urgency')?.value ?? 3),
      notes: String(get('notes')?.value || ''),
    };
  }

  async function submitForm() {
    if (state.saving) return;
    const { department, positionTitle, headcount, status, urgency, notes } = state.form;
    if (!department) { state.error = '部門為必填'; render(); return; }
    if (!positionTitle) { state.error = '職稱為必填'; render(); return; }
    if (!Number.isInteger(headcount) || headcount < 0) { state.error = '名額須為 0 以上整數'; render(); return; }

    state.saving = true;
    state.error = '';
    render();

    const isEdit = state.formMode === 'edit';
    const url = isEdit ? `/api/job-requisitions/${state.formId}` : '/api/job-requisitions';
    const method = isEdit ? 'PATCH' : 'POST';
    const result = await window.hrRequestJson(url, {
      method,
      timeoutMs: 12000,
      body: JSON.stringify({ department, positionTitle, headcount, status, urgency, notes }),
    });

    if (!result.ok || result.data?.ok !== true) {
      state.saving = false;
      state.error = String(result.data?.error || '職缺儲存失敗');
      render();
      return;
    }

    state.message = isEdit ? '職缺已更新。' : '職缺已新增。';
    resetForm();
    await bridge.reloadData?.();
    state.saving = false;
    render();
  }

  async function linkExternalJob(externalId, jobRequisitionId) {
    if (state.saving || !externalId) return;
    state.saving = true;
    state.error = '';
    render();

    const result = await window.hrRequestJson(`/api/job-requisition-sources/104/${encodeURIComponent(externalId)}`, {
      method: 'PATCH',
      timeoutMs: 12000,
      body: JSON.stringify({ jobRequisitionId }),
    });

    if (!result.ok || result.data?.ok !== true) {
      state.saving = false;
      state.error = String(result.data?.error || '104 職缺連結失敗');
      render();
      return;
    }

    state.message = jobRequisitionId ? '已連結 104 職缺。' : '已解除連結。';
    await bridge.reloadData?.();
    state.saving = false;
    render();
  }

  function renderForm() {
    if (!state.formMode) return '';
    const f = state.form;
    const title = state.formMode === 'create' ? '新增職缺' : '編輯職缺';
    return `
      <form data-requisition-form class="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-4 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-[13px] font-semibold text-gray-800">${title}</h3>
          <button type="button" data-action="cancel-form" class="text-[11px] text-gray-400 hover:text-gray-600">取消</button>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <label class="text-[11px] text-gray-500">部門
            <input name="department" value="${escapeHtml(f.department)}" placeholder="例如：行政 / 總務" class="mt-1 w-full text-xs border border-gray-300 rounded px-2 py-1.5">
          </label>
          <label class="text-[11px] text-gray-500">職稱
            <input name="positionTitle" value="${escapeHtml(f.positionTitle)}" placeholder="例如：總務專員" class="mt-1 w-full text-xs border border-gray-300 rounded px-2 py-1.5">
          </label>
          <label class="text-[11px] text-gray-500">名額
            <input name="headcount" type="number" min="0" value="${f.headcount}" class="mt-1 w-full text-xs border border-gray-300 rounded px-2 py-1.5">
          </label>
          <label class="text-[11px] text-gray-500">狀態
            <select name="status" class="mt-1 w-full text-xs border border-gray-300 rounded px-2 py-1.5">
              ${Object.entries(STATUS_META).map(([value, meta]) => `<option value="${value}"${f.status === value ? ' selected' : ''}>${meta.label}</option>`).join('')}
            </select>
          </label>
          <label class="text-[11px] text-gray-500">急迫度 (1-5)
            <input name="urgency" type="number" min="1" max="5" value="${f.urgency}" class="mt-1 w-full text-xs border border-gray-300 rounded px-2 py-1.5">
          </label>
        </div>
        <label class="text-[11px] text-gray-500 block">備註
          <textarea name="notes" rows="2" class="mt-1 w-full text-xs border border-gray-300 rounded px-2 py-1.5">${escapeHtml(f.notes)}</textarea>
        </label>
        <div class="flex justify-end gap-2">
          <button type="submit" data-action="submit-form" class="px-3 py-1.5 text-xs font-medium rounded border border-brand bg-brand text-white"${state.saving ? ' disabled' : ''}>${state.saving ? '儲存中…' : '儲存'}</button>
        </div>
      </form>`;
  }

  function renderLinkedBadges(links) {
    if (!links.length) return '<span class="text-gray-300">—</span>';
    return links.map(job => {
      const url = safe104Url(job.url);
      const label = url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="text-brand hover:underline">${escapeHtml(job.title)}</a>`
        : escapeHtml(job.title);
      return `<div class="flex items-center gap-1.5">${label}<button type="button" data-action="unlink" data-external-id="${escapeHtml(job.externalId)}" class="text-[10px] text-gray-400 hover:text-red-500" title="解除連結">✕</button></div>`;
    }).join('');
  }

  function renderSuggestion(row) {
    const suggestion = row.suggestedLinks?.[0];
    if (!suggestion) return '<span class="text-gray-300">—</span>';
    return `
      <div class="flex items-center gap-1.5">
        <span class="text-[11px] text-gray-500">${escapeHtml(suggestion.title)}</span>
        <button type="button" data-action="accept-suggestion" data-requisition-id="${escapeHtml(row.id)}" data-external-id="${escapeHtml(suggestion.externalId)}" class="text-[10px] text-brand hover:underline">採用</button>
      </div>`;
  }

  function renderInternalRow(row) {
    return `
      <tr>
        <td class="text-gray-700">${escapeHtml(row.dept || '--')}</td>
        <td class="font-medium text-gray-900">${escapeHtml(row.pos || '--')}</td>
        <td class="text-gray-500 whitespace-nowrap">${Number(row.hired ?? 0)}/${Number(row.headcount ?? 0)}</td>
        <td>${statusBadge(row.status)}</td>
        <td>${reconciliationBadge(row.reconciliationState)}</td>
        <td>${renderLinkedBadges(row.links)}</td>
        <td>${renderSuggestion(row)}</td>
        <td class="text-right"><button type="button" data-action="edit" data-requisition-id="${escapeHtml(row.id)}" class="text-[11px] text-brand hover:underline">✎ 編輯</button></td>
      </tr>`;
  }

  function renderUnmatchedExternalRow(job, requisitionOptions) {
    const url = safe104Url(job.url);
    const titleHtml = url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="text-brand hover:underline">${escapeHtml(job.title)}</a>`
      : escapeHtml(job.title);
    const selected = state.linkSelection[job.externalId] || job.suggestedJobRequisitionId || '';
    const options = ['<option value="">選擇要連結的職缺…</option>']
      .concat(requisitionOptions.map(opt => `<option value="${escapeHtml(opt.id)}"${String(opt.id) === String(selected) ? ' selected' : ''}>${escapeHtml(opt.dept)} / ${escapeHtml(opt.pos)}</option>`));
    return `
      <div class="flex items-center gap-2 py-2 border-b border-gray-100 last:border-0">
        <div class="flex-1 text-xs">${titleHtml}<span class="text-gray-400 ml-2">104 #${escapeHtml(job.externalId)}</span></div>
        <select data-action="select-link-target" data-external-id="${escapeHtml(job.externalId)}" class="text-xs border border-gray-300 rounded px-2 py-1">${options.join('')}</select>
        <button type="button" data-action="link" data-external-id="${escapeHtml(job.externalId)}" class="px-2 py-1 text-[11px] font-medium rounded border border-brand bg-brand text-white"${state.saving ? ' disabled' : ''}>連結</button>
      </div>`;
  }

  function render() {
    const container = document.getElementById('requisitions-board');
    if (!container) return;

    const reconciliation = getReconciliation();
    const cancelledRows = reconciliation.internalRows.filter(row => row.status === 'cancelled');
    const visibleRows = state.showCancelled ? reconciliation.internalRows : reconciliation.internalRows.filter(row => row.status !== 'cancelled');
    // Never suggest linking a live 104 posting to a cancelled/retired internal requisition.
    const requisitionOptions = reconciliation.internalRows
      .filter(row => row.status !== 'cancelled')
      .map(row => ({ id: row.id, dept: row.dept || '--', pos: row.pos || '--' }));
    const openExternal = reconciliation.unmatchedExternal.filter(job => job.status === 'open');

    container.innerHTML = `
      <div class="surface-panel-strong p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-[14px] font-semibold text-gray-800">職缺總覽</h2>
            <p class="text-[11px] text-gray-400 mt-1">共 ${reconciliation.summary.internalTotal} 筆職缺 · 已連結 104 ${reconciliation.summary.linkedInternalTotal} 筆 · 104 未連結 ${reconciliation.summary.unmatchedExternalTotal} 筆</p>
          </div>
          <button type="button" data-action="open-create" class="px-3 py-1.5 text-xs font-medium rounded border border-brand bg-brand text-white">＋ 新增職缺</button>
        </div>
        ${state.error ? `<div class="mb-4 rounded border border-red-200 bg-red-50 text-red-600 text-xs px-3 py-2">${escapeHtml(state.error)}</div>` : ''}
        ${state.message && !state.error ? `<div class="mb-4 rounded border border-green-200 bg-green-50 text-green-700 text-xs px-3 py-2">${escapeHtml(state.message)}</div>` : ''}
        ${renderForm()}
        <label class="flex items-center gap-1.5 text-[11px] text-gray-500 mb-2 cursor-pointer w-fit">
          <input type="checkbox" data-action="toggle-cancelled"${state.showCancelled ? ' checked' : ''}> 顯示已取消的職缺（${cancelledRows.length} 筆）
        </label>
        <div class="overflow-x-auto">
          <table class="w-full tbl-compact">
            <thead><tr><th>部門</th><th>職稱</th><th>錄取/名額</th><th>狀態</th><th>對帳狀態</th><th>已連結104職缺</th><th>建議連結</th><th></th></tr></thead>
            <tbody>${visibleRows.length ? visibleRows.map(renderInternalRow).join('') : '<tr><td colspan="8" class="text-center py-6 text-gray-400">尚無職缺，點右上角新增</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div class="surface-panel-strong p-6 mt-5">
        <h2 class="text-[14px] font-semibold text-gray-800 mb-1">未連結的 104 刊登中職缺</h2>
        <p class="text-[11px] text-gray-400 mb-3">這些職缺目前 104 上還刊登著，但沒有連到任何內部職缺——選一筆內部職缺連結，之後應徵這個104職缺的候選人就能自動歸類。</p>
        ${openExternal.length ? openExternal.map(job => renderUnmatchedExternalRow(job, requisitionOptions)).join('') : '<div class="text-xs text-gray-400 py-2">目前沒有未連結的刊登中職缺。</div>'}
      </div>`;

    window.lucide?.createIcons?.();
  }

  const requisitionsTab = document.getElementById('tab-requisitions');
  requisitionsTab?.addEventListener('click', event => {
    if (event.target.closest('[data-action="open-create"]')) { openCreateForm(); return; }
    if (event.target.closest('[data-action="cancel-form"]')) { resetForm(); state.error = ''; render(); return; }

    const editButton = event.target.closest('[data-action="edit"]');
    if (editButton) { openEditForm(editButton.getAttribute('data-requisition-id')); return; }

    const unlinkButton = event.target.closest('[data-action="unlink"]');
    if (unlinkButton) { linkExternalJob(unlinkButton.getAttribute('data-external-id'), null); return; }

    const acceptButton = event.target.closest('[data-action="accept-suggestion"]');
    if (acceptButton) {
      linkExternalJob(acceptButton.getAttribute('data-external-id'), Number(acceptButton.getAttribute('data-requisition-id')));
      return;
    }

    const linkButton = event.target.closest('[data-action="link"]');
    if (linkButton) {
      const externalId = linkButton.getAttribute('data-external-id');
      const select = requisitionsTab.querySelector(`select[data-action="select-link-target"][data-external-id="${CSS.escape(externalId)}"]`);
      const jobRequisitionId = Number(select?.value || 0);
      if (!jobRequisitionId) { state.error = '請先選擇要連結的職缺'; render(); return; }
      linkExternalJob(externalId, jobRequisitionId);
    }
  });

  requisitionsTab?.addEventListener('change', event => {
    const select = event.target.closest('[data-action="select-link-target"]');
    if (select) { state.linkSelection[select.getAttribute('data-external-id')] = select.value; return; }
    const toggle = event.target.closest('[data-action="toggle-cancelled"]');
    if (toggle) { state.showCancelled = toggle.checked; render(); }
  });

  requisitionsTab?.addEventListener('submit', event => {
    const form = event.target.closest('[data-requisition-form]');
    if (!form) return;
    event.preventDefault();
    readFormFromDom(form);
    submitForm();
  });

  window.addEventListener('hr-dashboard-data-loaded', () => render());

  window.hrRequisitionsEditor = { render };
}
