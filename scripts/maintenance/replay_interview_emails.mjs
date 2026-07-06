// WF1 面試信重播：把監看資料夾中指定日期起的信件，依時間順序餵進與線上
// Workflow1 完全相同的處理鏈（主旨過濾 → 萃取 → Claude → 整合 → 拆分 → PG 寫入）。
// candidates 有 NOT EXISTS/UPDATE、interviews/email_logs 有唯一鍵 → 重播冪等。
// 用法：node scripts/maintenance/replay_interview_emails.mjs [--apply] [起始日 预設 2026-07-02]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const SINCE = (process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))) || '2026-07-02';
const ROOT = process.cwd();
const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
  .filter(Boolean).map((m) => [m[1], m[2].trim()]));
const base = env.N8N_API_BASE_URL.replace(/\/+$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };

const CHAIN = [
  'IF：主旨過濾',
  'Code：萃取基本資訊',
  'Code：組裝 Claude Request Body',
  'Claude：AI 解析意圖',
  'Code：整合輸出',
  'Code：拆分多人推薦',
  'PG：寫入 candidates',
  'PG：寫入 interviews',
  'PG：寫入 email_logs',
  'Code：非面試信件略過',
  'PG：記錄略過信件',
];
const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'n8n', 'live_Workflow1_面試解析.json'), 'utf8'));
const nodesByName = new Map(snapshot.nodes.map((n) => [n.name, n]));
for (const name of CHAIN) if (!nodesByName.has(name)) throw new Error(`快照缺少節點：${name}`);

const trigger = snapshot.nodes.find((n) => n.type === 'n8n-nodes-base.microsoftOutlookTrigger');
const FOLDERS = trigger?.parameters?.filters?.foldersToInclude || [];
if (!FOLDERS.length) throw new Error('找不到監看資料夾');

const webhookPath = `tmp-replay-interview-${crypto.randomBytes(6).toString('hex')}`;
const nodes = [
  { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 240],
    parameters: { httpMethod: 'POST', path: webhookPath, responseMode: 'lastNode' } },
  { id: 'unwrap', name: 'Unwrap', type: 'n8n-nodes-base.code', typeVersion: 2, position: [140, 240],
    parameters: { mode: 'runOnceForEachItem', jsCode: 'return $input.item.json.body;' } },
  ...CHAIN.map((name, i) => {
    const src = nodesByName.get(name);
    return {
      id: src.id, name: src.name, type: src.type, typeVersion: src.typeVersion,
      position: [300 + (i % 6) * 240, 160 + Math.floor(i / 6) * 200],
      parameters: JSON.parse(JSON.stringify(src.parameters ?? {})),
      ...(src.credentials ? { credentials: src.credentials } : {}),
      ...(src.retryOnFail ? { retryOnFail: src.retryOnFail, maxTries: src.maxTries, waitBetweenTries: src.waitBetweenTries } : {}),
    };
  }),
];
const chainSet = new Set(CHAIN);
const connections = { Webhook: { main: [[{ node: 'Unwrap', type: 'main', index: 0 }]] },
  Unwrap: { main: [[{ node: 'IF：主旨過濾', type: 'main', index: 0 }]] } };
for (const [src, outputs] of Object.entries(snapshot.connections || {})) {
  if (!chainSet.has(src)) continue; // 亂碼幽靈鍵與觸發器一併排除
  const kept = {};
  for (const [type, groups] of Object.entries(outputs)) {
    kept[type] = groups.map((g) => (g || []).filter((c) => chainSet.has(c.node)));
  }
  connections[src] = kept;
}
const payload = { name: 'tmp-replay-interview', nodes, connections, settings: { executionOrder: 'v1' } };
if (/�/.test(JSON.stringify(payload))) throw new Error('payload 含亂碼，中止');

async function api(pathname, options = {}) {
  const res = await fetch(`${base}${pathname}`, { headers, ...options });
  const text = await res.text();
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${pathname} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function fetchFolderPage(folderId, skip) {
  const filter = encodeURIComponent(`receivedDateTime ge ${SINCE}T00:00:00Z`);
  const url = `https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(folderId)}/messages?$filter=${filter}&$orderby=receivedDateTime%20desc&$select=id,subject,receivedDateTime,webLink,bodyPreview,body,from&$top=100&$skip=${skip}`;
  const hookPath = `tmp-fetch-i-${crypto.randomBytes(6).toString('hex')}`;
  const wf = await api('/workflows', {
    method: 'POST',
    body: JSON.stringify({
      name: 'tmp-fetch-interview',
      nodes: [
        { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0],
          parameters: { httpMethod: 'POST', path: hookPath, responseMode: 'lastNode' } },
        { id: 'g', name: 'Graph', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [260, 0],
          parameters: { method: 'GET', url, authentication: 'predefinedCredentialType', nodeCredentialType: 'microsoftOutlookOAuth2Api', options: {} },
          credentials: { microsoftOutlookOAuth2Api: { id: 'gRnSdH5u4gDyDZzB', name: 'Microsoft Outlook account' } } },
      ],
      connections: { Webhook: { main: [[{ node: 'Graph', type: 'main', index: 0 }]] } },
      settings: { executionOrder: 'v1' },
    }),
  });
  try {
    await api(`/workflows/${wf.id}/activate`, { method: 'POST' });
    const res = await fetch(`${new URL(base).origin}/webhook/${hookPath}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`fetch folder -> ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text).value || [];
  } finally {
    await fetch(`${base}/workflows/${wf.id}`, { method: 'DELETE', headers });
  }
}

async function fetchFolderMessages(folderId) {
  // Graph 每頁上限 100，逐頁抓到見底（安全上限 1000 封/資料夾）
  const all = [];
  for (let skip = 0; skip < 1000; skip += 100) {
    const page = await fetchFolderPage(folderId, skip);
    all.push(...page);
    if (page.length < 100) break;
  }
  return all;
}

const all = [];
for (const fid of FOLDERS) {
  const msgs = await fetchFolderMessages(fid);
  all.push(...msgs);
  console.log(`資料夾 ${fid.slice(-12)}：${msgs.length} 封`);
}
const seen = new Set();
const messages = all.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
  .sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime));
console.log(`合計待重播（${SINCE} 起，去重後）：${messages.length} 封`);
if (!APPLY) {
  for (const m of messages) console.log(`  ${m.receivedDateTime.slice(0, 16)}  ${m.subject.trim().slice(0, 70)}`);
  console.log('\n[dry-run] 加 --apply 開始重播。');
  process.exit(0);
}

const wf = await api('/workflows', { method: 'POST', body: JSON.stringify(payload) });
let ok = 0, fail = 0;
try {
  await api(`/workflows/${wf.id}/activate`, { method: 'POST' });
  const hook = `${new URL(base).origin}/webhook/${webhookPath}`;
  for (const m of messages) {
    const label = `${m.receivedDateTime.slice(5, 16)} ${m.subject.trim().slice(0, 52)}`;
    try {
      const res = await fetch(hook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m),
      });
      const text = await res.text();
      if (!res.ok && text.includes('No item to return was found')) { ok += 1; console.log(`  ○ ${label} → 無輸出`); continue; }
      if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 100)}`);
      let action = '';
      try { const j = JSON.parse(text); action = j.action || ''; } catch { /* ignore */ }
      ok += 1;
      console.log(`  ✔ ${label} → ${action}`);
    } catch (err) {
      fail += 1;
      console.log(`  ✖ ${label} → ${err.message}`);
    }
  }
} finally {
  await fetch(`${base}/workflows/${wf.id}`, { method: 'DELETE', headers });
}
console.log(`\n面試信重播完成：成功 ${ok}、失敗 ${fail}`);
