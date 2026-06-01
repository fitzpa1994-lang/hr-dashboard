import process from 'node:process';

const baseUrl = String(process.env.HR_DASHBOARD_URL || 'https://sp-hr.zeabur.app').trim().replace(/\/+$/, '');
const password = String(process.env.HR_DASHBOARD_PASSWORD || '').trim();

if (!password) {
  console.error('Missing HR_DASHBOARD_PASSWORD');
  process.exit(1);
}

const updates = [
  { id: 1, department: 'ICC / 工程部', positionTitle: '測試工程師', headcount: 999, status: 'open' },
  { id: 17, department: '行政 / 資訊部', positionTitle: 'MIS工程師', headcount: 1, status: 'open' },
  { id: 23, department: 'WBU / SAR工程部', positionTitle: '測試工程師', headcount: 999, status: 'open' },
  { id: 12, department: '新華 / RF工程組', positionTitle: '測試工程師', headcount: 999, status: 'open' },
  { id: 22, department: '安規 / 安規業務部', positionTitle: '助理業務/業務', headcount: 2, status: 'open' },
  { id: 5, department: 'ICC / 技術支援部', positionTitle: '案件專員', headcount: 2, status: 'open' },
  { id: 19, department: 'ICC / 業務部', positionTitle: '客服業務', headcount: 3, status: 'open' },
  { id: 13, department: 'WBU / PM', positionTitle: 'PM', headcount: 2, status: 'open', notes: 'PM 與 五部RF PM 視為同一職缺' },
  { id: 24, department: '新華 / PM', positionTitle: 'PM', headcount: 0, status: 'cancelled', notes: '郵件中的新華案件專員視為 PM' },
  { id: 3, department: 'WBU / SAR工程部', positionTitle: '工程助理', headcount: 0, status: 'cancelled' },
  { id: 2, department: 'WBU / SAR工程部', positionTitle: '文件專員', headcount: 1, status: 'open' },
  { id: 25, department: 'WBU / RF工程一部', positionTitle: '測試工程師', headcount: 2, status: 'open' },
  { id: 7, department: 'WBU / RF工程一部', positionTitle: '工程助理', headcount: 1, status: 'open' },
  { id: 15, department: '行政 / 財務部', positionTitle: '主任', headcount: 1, status: 'open' },
  { id: 14, department: 'WBU / 業務部', positionTitle: '業務助理', headcount: 0, status: 'cancelled' },
  { id: 16, department: 'WBU / 國際認證一部', positionTitle: '認證專員', headcount: 1, status: 'open' },
  { id: 6, department: '行政 / 品管部', positionTitle: '品管人員', headcount: 1, status: 'open' },
  { id: 21, department: 'WBU / 業務部', positionTitle: '客服業務', headcount: 1, status: 'open' },
  { id: 4, department: '新竹 / 工程部', positionTitle: '測試工程師(RF/EMC)', headcount: 4, status: 'open' },
  { id: 8, department: '安規 / 安規業務部', positionTitle: '業務助理(David)', headcount: 1, status: 'open' },
  { id: 9, department: 'WBU / 業務部', positionTitle: '業務專員', headcount: 2, status: 'open' },
  { id: 20, department: '行政 / 董事長室', positionTitle: '行政專員', headcount: 1, status: 'open' },
  { id: 10, department: '行政 / 財務部', positionTitle: '副理', headcount: 1, status: 'open' },
  { id: 11, department: '行政 / 資訊部', positionTitle: '軟體工程師(ERP開發維運)', headcount: 1, status: 'open' },
  { id: 18, department: '安規', positionTitle: '電池案件工程師', headcount: 1, status: 'open' },
];

const creates = [
  { department: '行政 / 資訊部', positionTitle: '軟體工程師(AI開發)', headcount: 1, status: 'open' },
  { department: '行政 / 品管部', positionTitle: '驗證人員', headcount: 1, status: 'open' },
  { department: '新華 / 業務三部', positionTitle: '客服業務', headcount: 2, status: 'open' },
  { department: '行政 / 財務部', positionTitle: '出納短期職代', headcount: 0, status: 'cancelled' },
];

async function login() {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const cookie = response.headers.get('set-cookie');
  if (!response.ok || !cookie) {
    const text = await response.text();
    throw new Error(`login failed: status=${response.status}; body=${text.slice(0, 200)}`);
  }
  return cookie.split(';')[0];
}

async function fetchDashboard(cookie) {
  const response = await fetch(`${baseUrl}/api/hr-dashboard`, {
    headers: { Cookie: cookie },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`dashboard fetch failed: status=${response.status}; body=${text.slice(0, 200)}`);
  }
  return response.json();
}

async function writeRequisition(cookie, action, requisition, id = null) {
  const url = id == null
    ? `${baseUrl}/api/job-requisitions`
    : `${baseUrl}/api/job-requisitions/${id}`;
  const response = await fetch(url, {
    method: id == null ? 'POST' : 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(requisition),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(`${action} failed for ${requisition.department} / ${requisition.positionTitle}: status=${response.status}; body=${text.slice(0, 200)}`);
  }
  return json;
}

function buildPayload(base = {}) {
  return {
    department: base.department,
    positionTitle: base.positionTitle,
    headcount: base.headcount,
    status: base.status,
    urgency: Number(base.urgency ?? 3),
    notes: String(base.notes || ''),
    openDate: base.openDate || null,
    targetDate: base.targetDate || null,
  };
}

async function main() {
  const cookie = await login();
  const dashboard = await fetchDashboard(cookie);
  const jobs = dashboard.jobsData || [];

  const byId = new Map(jobs.map((job) => [Number(job.id), job]));
  const byKey = new Map(jobs.map((job) => [`${String(job.dept).trim()}||${String(job.pos).trim()}`, job]));

  const results = [];

  for (const update of updates) {
    const existing = byId.get(update.id);
    if (!existing) {
      throw new Error(`live requisition id ${update.id} not found`);
    }
    const payload = buildPayload({
      ...existing,
      ...update,
      urgency: existing.urgency ?? 3,
      openDate: existing.open ?? null,
      targetDate: existing.target ?? null,
      notes: update.notes ?? existing.note ?? '',
    });
    const result = await writeRequisition(cookie, 'update', payload, update.id);
    results.push({ type: 'update', id: update.id, department: payload.department, positionTitle: payload.positionTitle, ok: result?.ok === true });
  }

  const refreshed = await fetchDashboard(cookie);
  const refreshedJobs = refreshed.jobsData || [];
  const refreshedKeys = new Set(refreshedJobs.map((job) => `${String(job.dept).trim()}||${String(job.pos).trim()}`));

  for (const create of creates) {
    const key = `${create.department}||${create.positionTitle}`;
    if (refreshedKeys.has(key)) {
      results.push({ type: 'create-skip', department: create.department, positionTitle: create.positionTitle, ok: true });
      continue;
    }
    const payload = buildPayload(create);
    const result = await writeRequisition(cookie, 'create', payload);
    results.push({ type: 'create', department: payload.department, positionTitle: payload.positionTitle, ok: result?.ok === true });
  }

  console.log(JSON.stringify({
    baseUrl,
    updatedCount: results.filter((item) => item.type === 'update').length,
    createdCount: results.filter((item) => item.type === 'create').length,
    skippedCreateCount: results.filter((item) => item.type === 'create-skip').length,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
