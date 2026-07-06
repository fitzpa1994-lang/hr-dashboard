// 重播器：把 2026-05-01 起信箱中「新進人員通知／錄取通知事宜」相關信件，
// 依時間順序餵進「與線上 Workflow3 完全相同」的到職處理鏈（節點逐一複製），
// 藉此回補缺漏並實測修復後流程。email_msg_id UNIQUE 保證已存在記錄不重複。
// 唯一刻意差異：INSERT 不做職缺 headcount 遞減（改由 audit:onboarding-matches 對帳），
// 避免與人工調整過的職缺數重複扣。
// 預設 dry-run；--apply 才建立臨時 workflow 並重播。
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

const CHAIN = [
  'IF：過濾新進人員通知',
  'Code：萃取 name_from_subject',
  'Code：組裝 Onboarding AI Body',
  'Claude：解析 Onboarding 意圖',
  'Code：整合 Onboarding 輸出',
  'IF：intent=new_onboard?',
  'IF：intent=update_date?',
  'IF：intent=cancel?',
  'PG：寫入 onboardings',
  'PG：UPDATE onboarding date',
  'PG：UPDATE onboarding cancel',
  'PG：到職 email_logs',
  'PG：到職 email_logs skip',
  'PG：到職 email_logs_update',
  'PG：到職 email_logs_cancel',
];

const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'n8n', 'live_Workflow3_到職離職.json'), 'utf8'));
const nodesByName = new Map(snapshot.nodes.map((n) => [n.name, n]));
for (const name of CHAIN) if (!nodesByName.has(name)) throw new Error(`快照缺少節點：${name}`);

const nodes = CHAIN.map((name, i) => {
  const src = nodesByName.get(name);
  return {
    id: src.id, name: src.name, type: src.type, typeVersion: src.typeVersion,
    position: [240 + (i % 5) * 260, 240 + Math.floor(i / 5) * 180],
    parameters: JSON.parse(JSON.stringify(src.parameters ?? {})),
    ...(src.credentials ? { credentials: src.credentials } : {}),
  };
});

// 拿掉 INSERT 後的職缺遞減（保留 CTE 與最終 SELECT 的回傳形狀）
{
  const pg = nodes.find((n) => n.name === 'PG：寫入 onboardings');
  const q = pg.parameters.query;
  const m = q.match(/UPDATE job_requisitions[\s\S]*?;/);
  if (!m) throw new Error('找不到職缺遞減段落，中止');
  pg.parameters.query = q.replace(m[0], 'SELECT count(*) FROM inserted;');
  if (/UPDATE job_requisitions/.test(pg.parameters.query)) throw new Error('遞減段落移除失敗');
}

// 接線：照抄快照中鏈內的邊，webhook 為新入口
const chainSet = new Set(CHAIN);
const connections = {};
for (const [src, outputs] of Object.entries(snapshot.connections || {})) {
  if (!chainSet.has(src)) continue;
  const kept = {};
  for (const [type, groups] of Object.entries(outputs)) {
    kept[type] = groups.map((g) => (g || []).filter((c) => chainSet.has(c.node)));
  }
  connections[src] = kept;
}
const webhookPath = `tmp-replay-onboard-${crypto.randomBytes(6).toString('hex')}`;
nodes.unshift(
  {
    id: 'replay-webhook', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2,
    position: [0, 240],
    parameters: { httpMethod: 'POST', path: webhookPath, responseMode: 'lastNode' },
  },
  {
    // webhook 會把 POST payload 包在 body 欄位；生產鏈期望信件欄位在頂層（Outlook trigger 格式）
    id: 'replay-unwrap', name: 'Unwrap', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [120, 240],
    parameters: { mode: 'runOnceForEachItem', jsCode: 'return $input.item.json.body;' },
  },
);
connections['Webhook'] = { main: [[{ node: 'Unwrap', type: 'main', index: 0 }]] };
connections['Unwrap'] = { main: [[{ node: 'IF：過濾新進人員通知', type: 'main', index: 0 }]] };

const payload = {
  name: 'tmp-replay-onboarding',
  nodes, connections,
  settings: { executionOrder: 'v1' },
};
if (/�/.test(JSON.stringify(payload))) throw new Error('payload 含亂碼，中止');

async function api(pathname, options = {}) {
  const res = await fetch(`${base}${pathname}`, { headers, ...options });
  const text = await res.text();
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${pathname} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// 抓取要重播的信（含完整內文），時間正序
async function fetchMessages() {
  const filter = encodeURIComponent(
    "receivedDateTime ge 2026-05-01T00:00:00Z and (contains(subject,'新進人員通知') or contains(subject,'錄取通知事宜'))"
  );
  const url = `https://graph.microsoft.com/v1.0/me/messages?$filter=${filter}&$select=id,subject,receivedDateTime,webLink,bodyPreview,body,from&$top=150`;
  const hookPath = `tmp-fetch-${crypto.randomBytes(6).toString('hex')}`;
  const wf = await api('/workflows', {
    method: 'POST',
    body: JSON.stringify({
      name: 'tmp-fetch-messages',
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
console.log(`待重播信件：${messages.length} 封（2026-05-01 起，時間正序）`);
if (!APPLY) {
  for (const m of messages) console.log(`  ${m.receivedDateTime.slice(0, 16)}  ${m.subject.trim().slice(0, 70)}`);
  console.log('\n[dry-run] 加 --apply 開始重播。');
  process.exit(0);
}

const wf = await api('/workflows', { method: 'POST', body: JSON.stringify(payload) });
console.log(`重播 workflow 已建立：${wf.id}`);
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
      if (!res.ok && text.includes('No item to return was found')) {
        ok += 1;
        console.log(`  ○ ${label}  → 被 IF 過濾（無輸出，正常）`);
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 120)}`);
      let action = '';
      try { const j = JSON.parse(text); action = j.action || j.message || ''; } catch { action = text.slice(0, 40); }
      ok += 1;
      console.log(`  ✔ ${label}  → ${action}`);
    } catch (err) {
      fail += 1;
      console.log(`  ✖ ${label}  → ${err.message}`);
    }
  }
} finally {
  await fetch(`${base}/workflows/${wf.id}`, { method: 'DELETE', headers });
}
console.log(`\n重播完成：成功 ${ok}、失敗 ${fail}。臨時 workflow 已刪除。`);
