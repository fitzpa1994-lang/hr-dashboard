import process from 'node:process';
import crypto from 'node:crypto';

const n8nBaseUrl = String(process.env.N8N_API_BASE_URL || process.env.N8N_API_URL || '').trim().replace(/\/+$/, '');
const n8nApiKey = String(process.env.N8N_API_KEY || '').trim();

if (!n8nBaseUrl) {
  console.error('Missing N8N_API_BASE_URL');
  process.exit(1);
}
if (!n8nApiKey) {
  console.error('Missing N8N_API_KEY');
  process.exit(1);
}

const pgCredential = {
  id: 'NGdDfE2F1YFXGcmn',
  name: 'Postgres account',
};

const webhookPath = `tmp-fix-interview-record-${crypto.randomBytes(8).toString('hex')}`;
const emailMsgId = 'AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQBGAAAAAAATwHe72s8cTYU6NTzQdTNsBwCddaHEqpeLSJK4gY8M9T9SAAAA-bMBAABZ5GNOx7QRRZIXo071wWwMAABbKjzGAAA=';

const query = `
UPDATE interviews
SET
  interview_date = DATE '2026-07-06',
  interview_time = '11:00',
  updated_at = NOW()
WHERE email_msg_id = '${emailMsgId.replace(/'/g, "''")}'
RETURNING
  id,
  candidate_id,
  interview_date,
  interview_time,
  email_subject,
  email_msg_id,
  updated_at;
`.trim();

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-N8N-API-KEY': n8nApiKey,
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, options);
  const parsed = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${url} failed: status=${response.status}; body=${parsed.text.slice(0, 400)}`);
  }
  return parsed.json;
}

function buildWorkflowPayload() {
  return {
    name: 'tmp-fix-live-interview-record',
    nodes: [
      {
        id: 'webhook-trigger',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [240, 240],
        parameters: {
          httpMethod: 'POST',
          path: webhookPath,
          responseMode: 'lastNode',
        },
      },
      {
        id: 'pg-query',
        name: 'PG Query',
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5,
        position: [520, 240],
        parameters: {
          operation: 'executeQuery',
          query,
          options: {},
        },
        credentials: {
          postgres: pgCredential,
        },
      },
    ],
    connections: {
      Webhook: {
        main: [[{ node: 'PG Query', type: 'main', index: 0 }]],
      },
    },
    settings: {
      executionOrder: 'v1',
    },
  };
}

async function activateWorkflow(id) {
  const activateUrl = `${n8nBaseUrl}/workflows/${id}/activate`;
  try {
    await apiRequest(activateUrl, {
      method: 'POST',
      headers: buildHeaders(),
    });
    return;
  } catch {
    const patchUrl = `${n8nBaseUrl}/workflows/${id}`;
    await apiRequest(patchUrl, {
      method: 'PATCH',
      headers: buildHeaders(),
      body: JSON.stringify({ active: true }),
    });
  }
}

async function deleteWorkflow(id) {
  const response = await fetch(`${n8nBaseUrl}/workflows/${id}`, {
    method: 'DELETE',
    headers: buildHeaders(),
  });
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`DELETE workflow ${id} failed: status=${response.status}; body=${text.slice(0, 300)}`);
  }
}

async function main() {
  const workflow = await apiRequest(`${n8nBaseUrl}/workflows`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(buildWorkflowPayload()),
  });

  const workflowId = workflow.id;
  if (!workflowId) throw new Error('Workflow creation returned no id');

  try {
    await activateWorkflow(workflowId);
    const webhookUrl = `${new URL(n8nBaseUrl).origin}/webhook/${webhookPath}`;
    const executeResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'codex-fix-live-interview-record' }),
    });
    const executeParsed = await parseJsonResponse(executeResponse);
    if (!executeResponse.ok) {
      throw new Error(`POST ${webhookUrl} failed: status=${executeResponse.status}; body=${executeParsed.text.slice(0, 400)}`);
    }
    console.log(JSON.stringify({
      workflowId,
      webhookPath,
      result: executeParsed.json ?? executeParsed.text,
    }, null, 2));
  } finally {
    await deleteWorkflow(workflowId);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
