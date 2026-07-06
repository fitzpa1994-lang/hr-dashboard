// 離職側重播：把離職資料夾 2026-05-01 起信件依時間順序餵進與線上相同的離職處理鏈
// （Code：萃取離職資訊 → PG：寫入 resignations → PG：離職 email_logs）。
// email_msg_id UNIQUE 去重；預設 dry-run，--apply 執行。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const ROOT = process.cwd();
const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
  .filter(Boolean).map((m) => [m[1], m[2].trim()]));
const base = env.N8N_API_BASE_URL.replace(/\/+$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };

const CHAIN = ['Code：萃取離職資訊', 'PG：寫入 resignations', 'PG：離職 email_logs'];
const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'n8n', 'live_Workflow3_到職離職.json'), 'utf8'));
const nodesByName = new Map(snapshot.nodes.map((n) => [n.name, n]));
for (const name of CHAIN) if (!nodesByName.has(name)) throw new Error(`快照缺少節點：${name}`);

const webhookPath = `tmp-replay-resign-${crypto.randomBytes(6).toString('hex')}`;
const nodes = [
  { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0],
    parameters: { httpMethod: 'POST', path: webhookPath, responseMode: 'lastNode' } },
  { id: 'unwrap', name: 'Unwrap', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0],
    parameters: { mode: 'runOnceForEachItem', jsCode: 'return $input.item.json.body;' } },
  ...CHAIN.map((name, i) => {
    const src = nodesByName.get(name);
    return {
      id: src.id, name: src.name, type: src.type, typeVersion: src.typeVersion,
      position: [420 + i * 240, 0],
      parameters: JSON.parse(JSON.stringify(src.parameters ?? {})),
      ...(src.credentials ? { credentials: src.credentials } : {}),
    };
  }),
];
const connections = {
  Webhook: { main: [[{ node: 'Unwrap', type: 'main', index: 0 }]] },
  Unwrap: { main: [[{ node: CHAIN[0], type: 'main', index: 0 }]] },
  [CHAIN[0]]: { main: [[{ node: CHAIN[1], type: 'main', index: 0 }]] },
  [CHAIN[1]]: { main: [[{ node: CHAIN[2], type: 'main', index: 0 }]] },
};
const payload = { name: 'tmp-replay-resign', nodes, connections, settings: { executionOrder: 'v1' } };
if (/�/.test(JSON.stringify(payload))) throw new Error('payload 含亂碼，中止');

async function api(pathname, options = {}) {
  const res = await fetch(`${base}${pathname}`, { headers, ...options });
  const text = await res.text();
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${pathname} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function fetchMessages() {
  const FOLDER = 'AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQAuAAAAAAATwHe72s8cTYU6NTzQdTNsAQDrOyTdalCqR4oTn0wwCObdAEg2qZyLAAA=';
  const filter = encodeURIComponent('receivedDateTime ge 2026-05-01T00:00:00Z');
  const url = `https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(FOLDER)}/messages?$filter=${filter}&$select=id,subject,receivedDateTime,webLink,bodyPreview,body,from&$top=100`;
  const hookPath = `tmp-fetch-r-${crypto.randomBytes(6).toString('hex')}`;
  const wf = await api('/workflows', {
    method: 'POST',
    body: JSON.stringify({
      name: 'tmp-fetch-resign',
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
    if (!res.ok) throw new Error(`fetch messages -> ${res.status}: ${text.slice(0, 300)}`);
    return (JSON.parse(text).value || []).sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime));
  } finally {
    await fetch(`${base}/workflows/${wf.id}`, { method: 'DELETE', headers });
  }
}

const messages = await fetchMessages();
console.log(`離職資料夾待重播：${messages.length} 封`);
if (!APPLY) { console.log('[dry-run] 加 --apply 開始重播。'); process.exit(0); }

const wf = await api('/workflows', { method: 'POST', body: JSON.stringify(payload) });
let ok = 0, fail = 0;
try {
  await api(`/workflows/${wf.id}/activate`, { method: 'POST' });
  const hook = `${new URL(base).origin}/webhook/${webhookPath}`;
  for (const m of messages) {
    const label = `${m.receivedDateTime.slice(5, 16)} ${m.subject.trim().slice(0, 50)}`;
    try {
      const res = await fetch(hook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m),
      });
      const text = await res.text();
      if (!res.ok && text.includes('No item to return was found')) { ok += 1; console.log(`  ○ ${label} → 無輸出`); continue; }
      if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 100)}`);
      ok += 1;
      console.log(`  ✔ ${label}`);
    } catch (err) {
      fail += 1;
      console.log(`  ✖ ${label} → ${err.message}`);
    }
  }
} finally {
  await fetch(`${base}/workflows/${wf.id}`, { method: 'DELETE', headers });
}
console.log(`\n離職重播完成：成功 ${ok}、失敗 ${fail}`);
