import process from 'node:process';
import crypto from 'node:crypto';

const n8nBaseUrl = String(process.env.N8N_API_BASE_URL || '').trim().replace(/\/+$/, '');
const n8nApiKey = String(process.env.N8N_API_KEY || '').trim();

if (!n8nBaseUrl || !n8nApiKey) {
  console.error('Missing N8N_API_BASE_URL or N8N_API_KEY');
  process.exit(1);
}

const pgCredential = { id: 'NGdDfE2F1YFXGcmn', name: 'Postgres account' };
const webhookPath = `tmp-fix-xu-ruifang-${crypto.randomBytes(8).toString('hex')}`;

// 單一 CTE：先記錄修正前狀態，UPDATE，再回傳修正後結果（含 before/after 對比）
const query = `
WITH before AS (
  SELECT c.name, c.department AS old_dept, c.job_requisition_id AS old_jrid
  FROM candidates c
  WHERE c.name = '許瑞芳'
),
updated AS (
  UPDATE candidates c
  SET department        = j.department,
      applied_position  = j.position_title,
      job_requisition_id = j.id
  FROM job_requisitions j, before b
  WHERE j.id = 25
    AND c.name = '許瑞芳'
    AND c.job_requisition_id = 23
  RETURNING c.name, c.department AS new_dept, c.job_requisition_id AS new_jrid
)
SELECT
  b.old_dept,
  b.old_jrid,
  COALESCE(u.new_dept, (SELECT department FROM candidates WHERE name = '許瑞芳')) AS new_dept,
  COALESCE(u.new_jrid, (SELECT job_requisition_id FROM candidates WHERE name = '許瑞芳')) AS new_jrid,
  CASE WHEN u.name IS NOT NULL THEN 'updated' ELSE 'no_change_needed' END AS action
FROM before b
LEFT JOIN updated u ON u.name = b.name;
`.trim();

function buildHeaders() {
  return { 'Content-Type': 'application/json', 'X-N8N-API-KEY': n8nApiKey };
}

async function parseJson(res) {
  const text = await res.text();
  try { return { text, json: text ? JSON.parse(text) : null }; }
  catch { return { text, json: null }; }
}

async function apiRequest(url, options = {}) {
  const res = await fetch(url, options);
  const parsed = await parseJson(res);
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} => ${res.status}: ${parsed.text.slice(0, 400)}`);
  return parsed.json;
}

async function activateWorkflow(id) {
  try {
    await apiRequest(`${n8nBaseUrl}/workflows/${id}/activate`, { method: 'POST', headers: buildHeaders() });
  } catch {
    await apiRequest(`${n8nBaseUrl}/workflows/${id}`, {
      method: 'PATCH', headers: buildHeaders(), body: JSON.stringify({ active: true }),
    });
  }
}

async function deleteWorkflow(id) {
  const res = await fetch(`${n8nBaseUrl}/workflows/${id}`, { method: 'DELETE', headers: buildHeaders() });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`DELETE workflow ${id} => ${res.status}: ${text.slice(0, 300)}`);
  }
}

async function main() {
  const workflow = await apiRequest(`${n8nBaseUrl}/workflows`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      name: 'tmp-fix-xu-ruifang-dept',
      nodes: [
        {
          id: 'webhook-trigger',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [240, 240],
          parameters: { httpMethod: 'POST', path: webhookPath, responseMode: 'lastNode' },
        },
        {
          id: 'pg-fix',
          name: 'PG Fix',
          type: 'n8n-nodes-base.postgres',
          typeVersion: 2.5,
          position: [520, 240],
          parameters: { operation: 'executeQuery', query, options: {} },
          credentials: { postgres: pgCredential },
        },
      ],
      connections: { Webhook: { main: [[{ node: 'PG Fix', type: 'main', index: 0 }]] } },
      settings: { executionOrder: 'v1' },
    }),
  });

  const workflowId = workflow.id;
  if (!workflowId) throw new Error('Workflow creation returned no id');

  try {
    await activateWorkflow(workflowId);
    const webhookUrl = `${new URL(n8nBaseUrl).origin}/webhook/${webhookPath}`;
    const execRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'fix-xu-ruifang-dept-20260715' }),
    });
    const execParsed = await parseJson(execRes);
    if (!execRes.ok) throw new Error(`POST ${webhookUrl} => ${execRes.status}: ${execParsed.text.slice(0, 400)}`);

    console.log(JSON.stringify({ workflowId, result: execParsed.json ?? execParsed.text }, null, 2));
  } finally {
    await deleteWorkflow(workflowId);
    console.log('Temporary workflow cleaned up.');
  }
}

main().catch((e) => { console.error(e.message || String(e)); process.exit(1); });
