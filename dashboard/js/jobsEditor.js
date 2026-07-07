import {
  filterJobRequisitions,
  normalizeJobRequisition,
  serializeJobRequisitionPayload,
} from './dataUtils.js';

const bridge = window.hrDashboardBridge;

if (!bridge || typeof window.hrRequestJson !== 'function') {
  console.warn('Jobs editor bridge is not available.');
} else {
  const originalRenderJobs = bridge.getRenderJobs();
  const state = {
    modalReady: false,
    editingJob: null,
    saving: false,
  };

  const statusLabels = {
    open: 'Open',
    cancelled: 'Closed',
    closed: 'Closed',
    on_hold: 'On hold',
    filled: 'Filled',
  };

  const statusBadgeClasses = {
    open: 'badge-blue',
    on_hold: 'badge-orange',
    filled: 'badge-green',
    closed: 'badge-gray',
    cancelled: 'badge-gray',
  };

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
    const toolbar = jobsTab.querySelector('.px-5.py-4');
    if (!toolbar) return;

    if (!toolbar.querySelector('[data-job-filter="closed"]')) {
      toolbar.insertBefore(createFilterButton('Closed', 'closed'), toolbar.querySelector('[data-job-editor-add]') || null);
    }
    if (!toolbar.querySelector('[data-job-filter="on_hold"]')) {
      toolbar.insertBefore(createFilterButton('On hold', 'on_hold'), toolbar.querySelector('[data-job-editor-add]') || null);
    }
    if (toolbar.querySelector('[data-job-editor-add]')) return;

    const spacer = document.createElement('div');
    spacer.className = 'ml-auto';

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.jobEditorAdd = '1';
    button.className = 'px-3 py-1.5 text-xs font-medium rounded border border-brand bg-brand text-white hover:opacity-90';
    button.textContent = 'Add job';
    button.addEventListener('click', () => openModal());

    spacer.appendChild(button);
    toolbar.appendChild(spacer);
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
            <div class="text-sm font-semibold text-gray-900" id="job-editor-title">Add job requisition</div>
            <div class="text-xs text-gray-500 mt-1">Department + position title is the matching key for auto decrement.</div>
          </div>
          <button type="button" id="job-editor-close" class="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">Close</button>
        </div>
        <form id="job-editor-form" class="grid grid-cols-2 gap-4 px-5 py-5">
          <label class="flex flex-col gap-1 text-xs text-gray-600">
            <span>Department</span>
            <input name="department" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900" required />
          </label>
          <label class="flex flex-col gap-1 text-xs text-gray-600">
            <span>Position title</span>
            <input name="positionTitle" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900" required />
          </label>
          <label class="flex flex-col gap-1 text-xs text-gray-600">
            <span>Open slots</span>
            <input name="headcount" type="number" min="0" step="1" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900" required />
          </label>
          <label class="flex flex-col gap-1 text-xs text-gray-600">
            <span>Status</span>
            <select name="status" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900">
              <option value="open">Open</option>
              <option value="cancelled">Closed</option>
              <option value="on_hold">On hold</option>
              <option value="filled">Filled</option>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-xs text-gray-600">
            <span>Urgency (1-5)</span>
            <input name="urgency" type="number" min="1" max="5" step="1" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900" value="3" required />
          </label>
          <label class="flex flex-col gap-1 text-xs text-gray-600">
            <span>Open date</span>
            <input name="openDate" type="date" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900" />
          </label>
          <label class="col-span-2 flex flex-col gap-1 text-xs text-gray-600">
            <span>Target date</span>
            <input name="targetDate" type="date" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900" />
          </label>
          <label class="col-span-2 flex flex-col gap-1 text-xs text-gray-600">
            <span>Notes</span>
            <textarea name="notes" rows="3" class="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"></textarea>
          </label>
          <div class="col-span-2 flex items-center justify-between border-t border-border pt-4">
            <div id="job-editor-error" class="text-xs text-rose-600"></div>
            <div class="flex items-center gap-2">
              <button type="button" id="job-editor-cancel" class="rounded border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="submit" id="job-editor-save" class="rounded border border-brand bg-brand px-3 py-2 text-xs font-medium text-white hover:opacity-90">Save</button>
            </div>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => {
      overlay.classList.add('hidden');
      overlay.classList.remove('flex');
      state.editingJob = null;
      state.saving = false;
      overlay.querySelector('#job-editor-error').textContent = '';
      overlay.querySelector('#job-editor-form').reset();
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

      const errorNode = overlay.querySelector('#job-editor-error');
      errorNode.textContent = '';

      state.saving = true;
      overlay.querySelector('#job-editor-save').textContent = 'Saving...';

      try {
        const targetId = state.editingJob?.id ? Number(state.editingJob.id) : null;
        const result = await window.hrRequestJson(
          targetId ? `/api/job-requisitions/${targetId}` : '/api/job-requisitions',
          {
            method: targetId ? 'PATCH' : 'POST',
            body: JSON.stringify(targetId ? { ...payload, id: targetId } : payload),
            timeoutMs: 10000,
          }
        );

        if (!result.ok) {
          errorNode.textContent = result.data?.error || 'Save failed';
          return;
        }

        close();
        await bridge.reloadData();
      } finally {
        state.saving = false;
        overlay.querySelector('#job-editor-save').textContent = 'Save';
      }
    });

    state.modalReady = true;
  }

  function openModal(job = null) {
    ensureModal();
    state.editingJob = job;

    const overlay = document.getElementById('job-editor-overlay');
    const form = overlay.querySelector('#job-editor-form');
    const title = overlay.querySelector('#job-editor-title');
    const errorNode = overlay.querySelector('#job-editor-error');

    form.reset();
    errorNode.textContent = '';

    if (job) {
      title.textContent = 'Edit job requisition';
      form.elements.department.value = job.dept || job.department || '';
      form.elements.positionTitle.value = job.pos || job.positionTitle || '';
      form.elements.headcount.value = job.headcount ?? 0;
      form.elements.status.value = job.status || 'open';
      form.elements.urgency.value = job.urgency ?? 3;
      form.elements.notes.value = job.note || job.notes || '';
      form.elements.openDate.value = job.open || job.openDate || '';
      form.elements.targetDate.value = job.target || job.targetDate || '';
    } else {
      title.textContent = 'Add job requisition';
      form.elements.status.value = 'open';
      form.elements.urgency.value = '3';
      form.elements.headcount.value = '1';
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

    const header = document.querySelector('#tab-jobs thead tr');
    if (header) {
      header.innerHTML = [
        '<th style="min-width:120px">部門</th>',
        '<th style="min-width:110px">職缺名稱</th>',
        '<th class="text-center" style="min-width:70px">缺額</th>',
        '<th class="text-center" style="min-width:90px">急迫度</th>',
        '<th class="text-center" style="min-width:55px">候選人</th>',
        '<th style="min-width:80px">狀態</th>',
        '<th style="min-width:120px">備註</th>',
        '<th class="text-right" style="min-width:70px">操作</th>',
      ].join('');
    }

    const tbody = document.getElementById('job-tbody');
    if (!tbody) return;

    const normalized = filterJobRequisitions(bridge.getJobs(), bridge.getJobFilter());
    if (!normalized.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-400">目前沒有職缺資料</td></tr>';
      return;
    }

    const groups = {};
    GROUP_ORDER.forEach(g => { groups[g] = []; });
    normalized.forEach(job => { (groups[getGroup(job.dept)] = groups[getGroup(job.dept)] || []).push(job); });

    let html = '';
    GROUP_ORDER.forEach(groupName => {
      const list = groups[groupName];
      if (!list || !list.length) return;
      html += `<tr style="background:rgba(22,58,99,0.06);border-top:1px solid rgba(22,58,99,0.1)"><td colspan="8" style="padding:8px 24px 6px"><span style="font-size:11px;font-weight:700;color:#163a63;letter-spacing:0.06em;text-transform:uppercase">${groupName}</span></td></tr>`;
      list.forEach(job => {
        const item = normalizeJobRequisition(job);
        const notes = item.noteText || '--';
        const urgency = Number(job.urgency ?? 3);
        const candidateCount = Number(job.candidateCount ?? job.cands ?? 0);
        const displayStatus = item.displayStatus === 'closed' ? 'cancelled' : item.displayStatus;
        const urgencyDots = '●'.repeat(Math.min(urgency,5)) + '○'.repeat(Math.max(0,5-urgency));
        html += `<tr>
          <td class="text-gray-500 text-[12px]">${getSubDept(item.dept)}</td>
          <td class="font-semibold text-gray-900">${item.pos}</td>
          <td class="text-center font-semibold text-brand">${item.displayOpenSlots}</td>
          <td class="text-center text-[10px] tracking-tighter text-amber-500">${urgencyDots}</td>
          <td class="text-center">${candidateCount}</td>
          <td><span class="badge ${statusBadgeClasses[displayStatus] || 'badge-gray'}">${statusLabels[job.status] || statusLabels[item.displayStatus] || job.status}</span></td>
          <td class="max-w-[200px] truncate text-gray-400" title="${notes}">${notes}</td>
          <td class="text-right">
            <button type="button" class="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50" data-job-edit="${job.id ?? ''}">Edit</button>
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
  }

  bridge.setRenderJobs(renderEditableJobs);
  renderEditableJobs();
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const overlay = document.getElementById('job-editor-overlay');
      if (overlay && !overlay.classList.contains('hidden')) {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
      }
    }
  });

  window.hrJobsEditor = {
    openModal,
    renderEditableJobs,
    restoreOriginalRenderJobs: () => bridge.setRenderJobs(originalRenderJobs),
  };
}
