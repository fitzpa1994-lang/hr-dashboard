// 一次性修復：WF1「Code：萃取基本資訊」舊版硬編碼 preferredRequisitionId 規則
// （hasXinhuaFile -> 2）把所有「新華文件專員」推薦信誤導向 job_requisitions id=2
// （實際是 WBU / SAR工程部 的職缺，seed 於 2026-05-29）。根因已於 2026-07-20
// 隨 WF1 部署修復（改用 dashboard/js/onboardingCanonicalization.js 正規化比對），
// 本腳本補救修復前已寫入的既有候選人資料。
//
// 範圍：id=2 目前掛的候選人中，主旨明確提到「新華」的 7 位（不動 張曦文/白永晴 —
// 他們的主旨是 RF文件專員／SAR文件專員，本來就正確屬於 WBU/SAR；也不動「未知姓名」
// withdrawn 那筆 — 那是不相關的姓名擷取失敗舊資料，非本次誤判範圍）。
//
// 用法：node scripts/maintenance/fix_xinhua_wenjian_zhuanyuan_misroute_20260717.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  canonicalizeOnboardingDepartment,
  canonicalizeOnboardingPosition,
} from '../../dashboard/js/onboardingCanonicalization.js';

const APPLY = process.argv.includes('--apply');
const ROOT = process.cwd();
const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
  .filter(Boolean).map((m) => [m[1], m[2].trim()]));
const base = env.N8N_API_BASE_URL.replace(/\/+$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };

// {candidate_id, name, subject} — subject is each candidate's latest 履歷推薦/RE 主旨
// that literally mentions 新華, pulled from email_logs (2026-07-20 查核).
const AFFECTED = [
  { id: 101, name: '林宜亭', subject: 'RE: 履歷推薦【新華文件專員】– 林宜亭' },
  { id: 124, name: '林芳竹', subject: 'RE: 履歷推薦-(新華文件專員)--林芳竹' },
  { id: 126, name: '潘怡雯', subject: 'RE: 履歷推薦-(新華文件專員)--潘怡雯' },
  { id: 128, name: '李芷彤', subject: 'RE: 履歷推薦-(新華文件專員)--李芷彤' },
  { id: 142, name: '牛詩婷', subject: '履歷推薦-(新華文件專員)--牛詩婷' },
  { id: 205, name: '楊家萓', subject: 'RE: 履歷推薦-(新華文件專員)--楊家萓' },
  { id: 234, name: '徐子涵', subject: 'RE: 履歷推薦-(新華文件專員)--徐子涵' },
];
// Explicit exclude list — never touch these even if a future edit widens AFFECTED.
const EXCLUDE_NAMES = new Set(['張曦文', '白永晴']);

const canonicalDept = canonicalizeOnboardingDepartment(null, { emailSubject: AFFECTED[0].subject });
const canonicalPos = canonicalizeOnboardingPosition(null, { emailSubject: AFFECTED[0].subject, department: canonicalDept });
if (canonicalDept !== '新華 / 工程 / 文件部 / 文件組' || canonicalPos !== '文件專員') {
  throw new Error(`預期外的正規化結果：department=${canonicalDept} position=${canonicalPos}`);
}

console.log('目標職缺：', canonicalDept, '/', canonicalPos);
console.log('\n即將修正：');
for (const c of AFFECTED) {
  if (EXCLUDE_NAMES.has(c.name)) throw new Error(`${c.name} 在排除名單中，不應出現於 AFFECTED`);
  const dept = canonicalizeOnboardingDepartment(null, { emailSubject: c.subject });
  const pos = canonicalizeOnboardingPosition(null, { emailSubject: c.subject, department: dept });
  console.log(`  id=${c.id} ${c.name}  "${c.subject}"  -> ${dept} / ${pos}`);
  if (dept !== canonicalDept || pos !== canonicalPos) {
    throw new Error(`${c.name} 正規化結果與預期不一致，中止`);
  }
}

if (!APPLY) {
  console.log('\n[dry-run] 加 --apply 執行修復。');
  process.exit(0);
}

const sql = `
DO $$
DECLARE
  v_req_id INTEGER;
BEGIN
  SELECT id INTO v_req_id FROM job_requisitions
  WHERE department = '${canonicalDept}' AND position_title = '${canonicalPos}'
  LIMIT 1;

  IF v_req_id IS NULL THEN
    INSERT INTO job_requisitions (position_title, department, headcount, filled_count, status, urgency, notes)
    VALUES ('${canonicalPos}', '${canonicalDept}', 1, 0, 'open', 3, 'auto-created (misroute repair 2026-07-20)')
    RETURNING id INTO v_req_id;
  END IF;

  UPDATE candidates
  SET job_requisition_id = v_req_id,
      department = '${canonicalDept}',
      applied_position = '${canonicalPos}'
  WHERE id IN (${AFFECTED.map((c) => c.id).join(', ')});
END $$;

SELECT json_agg(t) AS rows FROM (
  SELECT id, name, department, applied_position, job_requisition_id
  FROM candidates
  WHERE id IN (${AFFECTED.map((c) => c.id).join(', ')})
  ORDER BY id
) t;
`;

async function api(pathname, options = {}) {
  const res = await fetch(`${base}${pathname}`, { headers, ...options });
  const text = await res.text();
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${pathname} -> ${res.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : null;
}

const hookPath = `tmp-fix-xinhua-${crypto.randomBytes(6).toString('hex')}`;
const wf = await api('/workflows', {
  method: 'POST',
  body: JSON.stringify({
    name: 'tmp-fix-xinhua-wenjian-misroute',
    nodes: [
      { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0],
        parameters: { httpMethod: 'POST', path: hookPath, responseMode: 'lastNode' } },
      { id: 'pg', name: 'PG', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: [260, 0],
        parameters: { operation: 'executeQuery', query: sql, options: {} },
        credentials: { postgres: { id: 'NGdDfE2F1YFXGcmn', name: 'Postgres account' } } },
    ],
    connections: { Webhook: { main: [[{ node: 'PG', type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1' },
  }),
});
try {
  await api(`/workflows/${wf.id}/activate`, { method: 'POST' });
  const res = await fetch(`${new URL(base).origin}/webhook/${hookPath}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`webhook -> ${res.status}: ${text.slice(0, 1500)}`);
  console.log('\n修復完成：\n', text);
} finally {
  await fetch(`${base}/workflows/${wf.id}`, { method: 'DELETE', headers });
}
