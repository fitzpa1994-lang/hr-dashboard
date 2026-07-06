// 建立 HR Error Logger workflow（Error Trigger → 寫入 email_logs action='error'），
// 並將其設為 Workflow1 / Workflow3 的 errorWorkflow — 讓執行失敗不再靜默。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
  .filter(Boolean).map((m) => [m[1], m[2].trim()]));
const base = env.N8N_API_BASE_URL.replace(/\/+$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };

async function api(pathname, options = {}) {
  const res = await fetch(`${base}${pathname}`, { headers, ...options });
  const text = await res.text();
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${pathname} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// 已存在就沿用（重跑安全）
const existing = (await api('/workflows?limit=100')).data?.find((w) => w.name === 'HR Error Logger');
let loggerId = existing?.id;
if (!loggerId) {
  const created = await api('/workflows', {
    method: 'POST',
    body: JSON.stringify({
      name: 'HR Error Logger',
      nodes: [
        { id: 'err-trigger', name: 'Error Trigger', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1,
          position: [0, 0], parameters: {} },
        { id: 'err-shape', name: 'Code：整理錯誤', type: 'n8n-nodes-base.code', typeVersion: 2,
          position: [240, 0],
          parameters: {
            mode: 'runOnceForEachItem',
            jsCode: `const e = $input.item.json;
return {
  msgid: 'error-' + (e.execution && e.execution.id ? e.execution.id : Date.now()),
  subject: ('[WF ERROR] ' + ((e.workflow && e.workflow.name) || '') + ' @ ' + ((e.execution && e.execution.lastNodeExecuted) || '')).slice(0, 200),
  err: String((e.execution && e.execution.error && (e.execution.error.message || e.execution.error.description)) || 'unknown').slice(0, 500),
};`,
          } },
        { id: 'err-pg', name: 'PG：寫入 error log', type: 'n8n-nodes-base.postgres', typeVersion: 2.5,
          position: [480, 0],
          parameters: {
            operation: 'executeQuery',
            query: `INSERT INTO email_logs (email_msg_id, email_subject, sender, received_at, action, error_msg, processed_at)
VALUES ('{{ $json.msgid }}', '{{ ($json.subject || '').replace(/'/g, "''") }}', NULL, NOW(), 'error', '{{ ($json.err || '').replace(/'/g, "''") }}', NOW())
ON CONFLICT (email_msg_id) DO NOTHING;`,
            options: {},
          },
          credentials: { postgres: { id: 'NGdDfE2F1YFXGcmn', name: 'Postgres account' } } },
      ],
      connections: {
        'Error Trigger': { main: [[{ node: 'Code：整理錯誤', type: 'main', index: 0 }]] },
        'Code：整理錯誤': { main: [[{ node: 'PG：寫入 error log', type: 'main', index: 0 }]] },
      },
      settings: { executionOrder: 'v1' },
    }),
  });
  loggerId = created.id;
  console.log(`HR Error Logger 已建立：${loggerId}`);
} else {
  console.log(`HR Error Logger 已存在：${loggerId}`);
}

// 掛到 Workflow1 與 Workflow3
const SETTINGS_ALLOWED = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
  'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];
for (const [wfId, label] of [['zEIwksk6hz9Ri8NA', 'Workflow3'], ['pqnpr72wTiOE2m8I', 'Workflow1']]) {
  const live = await api(`/workflows/${wfId}`);
  const settings = Object.fromEntries(Object.entries(live.settings || {}).filter(([k]) => SETTINGS_ALLOWED.includes(k)));
  settings.errorWorkflow = loggerId;
  await api(`/workflows/${wfId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: live.name, nodes: live.nodes, connections: live.connections, settings }),
  });
  console.log(`${label} errorWorkflow → ${loggerId} 設定完成`);
}
