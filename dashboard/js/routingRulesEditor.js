const bridge = typeof window !== 'undefined' ? window.hrDashboardBridge : null;

if (!bridge || typeof window.hrRequestJson !== 'function') {
  if (typeof window !== 'undefined') console.warn('Routing rules editor bridge is not available.');
} else {
  const state = {
    saving: false,
    error: '',
    message: '',
    formMode: null, // null | 'create' | 'edit'
    formId: null,
    form: { matchType: 'department_keyword', pattern: '', targetMode: 'requisition', jobRequisitionId: '', departmentHint: '', priority: 10, isActive: true, notes: '' },
  };

  const MATCH_TYPE_META = {
    recipient_email: { label: '收件人信箱', placeholder: '例如：viclee@sporton.com.tw（比對完整信箱字尾）' },
    position_keyword: { label: '職稱關鍵字', placeholder: '例如：總務專員（比對候選人解析出的職稱文字）' },
    department_keyword: { label: '部門關鍵字', placeholder: '例如：SAR（比對信件解析出的部門文字，RF/SAR這類同職稱不同部門要用這個）' },
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function requisitionLabel(id) {
    const job = (bridge.getJobs?.() || []).find(j => String(j.id) === String(id));
    if (!job) return `#${id}（找不到，可能已刪除）`;
    return `${job.dept || '--'} / ${job.pos || '--'}`;
  }

  function resetForm() {
    state.formMode = null;
    state.formId = null;
    state.form = { matchType: 'department_keyword', pattern: '', targetMode: 'requisition', jobRequisitionId: '', departmentHint: '', priority: 10, isActive: true, notes: '' };
  }

  function openCreateForm() {
    resetForm();
    state.formMode = 'create';
    state.error = '';
    render();
  }

  function openEditForm(id) {
    const rule = (bridge.getRoutingRules?.() || []).find(r => String(r.id) === String(id));
    if (!rule) return;
    state.formMode = 'edit';
    state.formId = rule.id;
    state.form = {
      matchType: rule.matchType,
      pattern: rule.pattern,
      targetMode: rule.jobRequisitionId ? 'requisition' : 'department',
      jobRequisitionId: rule.jobRequisitionId || '',
      departmentHint: rule.departmentHint || '',
      priority: Number(rule.priority ?? 10),
      isActive: rule.isActive !== false,
      notes: rule.notes || '',
    };
    state.error = '';
    render();
  }

  function readFormFromDom(container) {
    const get = name => container.querySelector(`[name="${name}"]`);
    const targetMode = container.querySelector('input[name="targetMode"]:checked')?.value || 'requisition';
    state.form = {
      matchType: get('matchType')?.value || 'department_keyword',
      pattern: String(get('pattern')?.value || '').trim(),
      targetMode,
      jobRequisitionId: targetMode === 'requisition' ? String(get('jobRequisitionId')?.value || '') : '',
      departmentHint: targetMode === 'department' ? String(get('departmentHint')?.value || '').trim() : '',
      priority: Number(get('priority')?.value ?? 10),
      isActive: Boolean(get('isActive')?.checked),
      notes: String(get('notes')?.value || ''),
    };
  }

  async function submitForm() {
    if (state.saving) return;
    const f = state.form;
    if (!f.pattern) { state.error = '比對內容為必填'; render(); return; }
    if (f.targetMode === 'requisition' && !f.jobRequisitionId) { state.error = '請選擇要歸類到哪個職缺'; render(); return; }
    if (f.targetMode === 'department' && !f.departmentHint) { state.error = '請填要歸類到哪個部門'; render(); return; }

    state.saving = true;
    state.error = '';
    render();

    const isEdit = state.formMode === 'edit';
    const url = isEdit ? `/api/routing-rules/${state.formId}` : '/api/routing-rules';
    const method = isEdit ? 'PATCH' : 'POST';
    const result = await window.hrRequestJson(url, {
      method,
      timeoutMs: 12000,
      body: JSON.stringify({
        matchType: f.matchType,
        pattern: f.pattern,
        jobRequisitionId: f.targetMode === 'requisition' ? Number(f.jobRequisitionId) : null,
        departmentHint: f.targetMode === 'department' ? f.departmentHint : null,
        priority: f.priority,
        isActive: f.isActive,
        notes: f.notes,
      }),
    });

    if (!result.ok || result.data?.ok !== true) {
      state.saving = false;
      state.error = String(result.data?.error || '規則儲存失敗');
      render();
      return;
    }

    state.message = isEdit ? '規則已更新。' : '規則已新增。';
    resetForm();
    await bridge.reloadData?.();
    state.saving = false;
    render();
  }

  function renderTargetFields(f) {
    // Never let a rule target a cancelled/retired requisition (same class of
    // mistake as linking a live 104 posting to an already-cancelled one).
    const requisitions = [...(bridge.getJobs?.() || [])]
      .filter(j => j.status !== 'cancelled')
      .sort((a, b) => String(a.dept).localeCompare(String(b.dept), 'zh-Hant'));
    const options = ['<option value="">選擇職缺…</option>']
      .concat(requisitions.map(j => `<option value="${escapeHtml(j.id)}"${String(j.id) === String(f.jobRequisitionId) ? ' selected' : ''}>${escapeHtml(j.dept || '--')} / ${escapeHtml(j.pos || '--')}</option>`));
    return `
      <div class="flex items-center gap-3 text-[11px] text-gray-500 mb-1">
        <label class="flex items-center gap-1"><input type="radio" name="targetMode" value="requisition"${f.targetMode === 'requisition' ? ' checked' : ''}> 歸類到指定職缺</label>
        <label class="flex items-center gap-1"><input type="radio" name="targetMode" value="department"${f.targetMode === 'department' ? ' checked' : ''}> 只給部門提示（沒有明確職缺時用）</label>
      </div>
      ${f.targetMode === 'requisition'
        ? `<select name="jobRequisitionId" class="w-full text-xs border border-gray-300 rounded px-2 py-1.5">${options.join('')}</select>`
        : `<input name="departmentHint" value="${escapeHtml(f.departmentHint)}" placeholder="例如：WBU" class="w-full text-xs border border-gray-300 rounded px-2 py-1.5">`}
    `;
  }

  function renderForm() {
    if (!state.formMode) return '';
    const f = state.form;
    const title = state.formMode === 'create' ? '新增分類規則' : '編輯分類規則';
    return `
      <form data-rule-form class="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-4 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-[13px] font-semibold text-gray-800">${title}</h3>
          <button type="button" data-action="cancel-form" class="text-[11px] text-gray-400 hover:text-gray-600">取消</button>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <label class="text-[11px] text-gray-500">比對類型
            <select name="matchType" data-action="match-type-select" class="mt-1 w-full text-xs border border-gray-300 rounded px-2 py-1.5">
              ${Object.entries(MATCH_TYPE_META).map(([value, meta]) => `<option value="${value}"${f.matchType === value ? ' selected' : ''}>${meta.label}</option>`).join('')}
            </select>
          </label>
          <label class="text-[11px] text-gray-500">優先序（數字越小越優先）
            <input name="priority" type="number" value="${f.priority}" class="mt-1 w-full text-xs border border-gray-300 rounded px-2 py-1.5">
          </label>
        </div>
        <label class="text-[11px] text-gray-500 block">比對內容
          <input name="pattern" value="${escapeHtml(f.pattern)}" placeholder="${escapeHtml(MATCH_TYPE_META[f.matchType]?.placeholder || '')}" class="mt-1 w-full text-xs border border-gray-300 rounded px-2 py-1.5">
        </label>
        <div>${renderTargetFields(f)}</div>
        <label class="text-[11px] text-gray-500 block">備註
          <textarea name="notes" rows="2" class="mt-1 w-full text-xs border border-gray-300 rounded px-2 py-1.5">${escapeHtml(f.notes)}</textarea>
        </label>
        <label class="flex items-center gap-1.5 text-[11px] text-gray-500">
          <input type="checkbox" name="isActive"${f.isActive ? ' checked' : ''}> 啟用
        </label>
        <div class="flex justify-end gap-2">
          <button type="submit" data-action="submit-form" class="px-3 py-1.5 text-xs font-medium rounded border border-brand bg-brand text-white"${state.saving ? ' disabled' : ''}>${state.saving ? '儲存中…' : '儲存'}</button>
        </div>
      </form>`;
  }

  function renderRuleRow(rule) {
    const target = rule.jobRequisitionId ? requisitionLabel(rule.jobRequisitionId) : `部門：${escapeHtml(rule.departmentHint || '--')}`;
    return `
      <tr class="${rule.isActive === false ? 'opacity-40' : ''}">
        <td>${escapeHtml(MATCH_TYPE_META[rule.matchType]?.label || rule.matchType)}</td>
        <td class="font-medium text-gray-900">${escapeHtml(rule.pattern)}</td>
        <td>${target}</td>
        <td class="text-center">${rule.priority}</td>
        <td>${rule.isActive === false ? '<span class="badge badge-gray">已停用</span>' : '<span class="badge badge-green">啟用中</span>'}</td>
        <td class="text-gray-400" title="${escapeHtml(rule.notes || '')}">${escapeHtml((rule.notes || '').slice(0, 20))}</td>
        <td class="text-right"><button type="button" data-action="edit" data-rule-id="${escapeHtml(rule.id)}" class="text-[11px] text-brand hover:underline">✎ 編輯</button></td>
      </tr>`;
  }

  function render() {
    const container = document.getElementById('routing-rules-board');
    if (!container) return;

    const rules = [...(bridge.getRoutingRules?.() || [])].sort((a, b) => (a.priority - b.priority) || (a.id - b.id));

    container.innerHTML = `
      <div class="surface-panel-strong p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-[14px] font-semibold text-gray-800">候選人分類規則</h2>
            <p class="text-[11px] text-gray-400 mt-1">共 ${rules.length} 條規則 · 決定信件解析後，候選人自動歸類到哪個部門/職缺</p>
          </div>
          <button type="button" data-action="open-create" class="px-3 py-1.5 text-xs font-medium rounded border border-brand bg-brand text-white">＋ 新增規則</button>
        </div>
        ${state.error ? `<div class="mb-4 rounded border border-red-200 bg-red-50 text-red-600 text-xs px-3 py-2">${escapeHtml(state.error)}</div>` : ''}
        ${state.message && !state.error ? `<div class="mb-4 rounded border border-green-200 bg-green-50 text-green-700 text-xs px-3 py-2">${escapeHtml(state.message)}</div>` : ''}
        ${renderForm()}
        <div class="overflow-x-auto">
          <table class="w-full tbl-compact">
            <thead><tr><th>比對類型</th><th>比對內容</th><th>歸類到</th><th>優先序</th><th>狀態</th><th>備註</th><th></th></tr></thead>
            <tbody>${rules.length ? rules.map(renderRuleRow).join('') : '<tr><td colspan="7" class="text-center py-6 text-gray-400">尚無規則，點右上角新增</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;

    window.lucide?.createIcons?.();
  }

  const settingsTab = document.getElementById('tab-settings');
  settingsTab?.addEventListener('click', event => {
    if (event.target.closest('[data-action="open-create"]')) { openCreateForm(); return; }
    if (event.target.closest('[data-action="cancel-form"]')) { resetForm(); state.error = ''; render(); return; }

    const editButton = event.target.closest('[data-action="edit"]');
    if (editButton) { openEditForm(editButton.getAttribute('data-rule-id')); return; }

    const targetModeRadio = event.target.closest('input[name="targetMode"]');
    if (targetModeRadio) {
      const form = targetModeRadio.closest('form');
      readFormFromDom(form);
      state.form.targetMode = targetModeRadio.value;
      render();
    }
  });

  settingsTab?.addEventListener('change', event => {
    if (event.target.name === 'matchType') {
      const form = event.target.closest('form');
      readFormFromDom(form);
      render();
    }
  });

  settingsTab?.addEventListener('submit', event => {
    const form = event.target.closest('[data-rule-form]');
    if (!form) return;
    event.preventDefault();
    readFormFromDom(form);
    submitForm();
  });

  window.addEventListener('hr-dashboard-data-loaded', () => render());

  window.hrRoutingRulesEditor = { render };
}
