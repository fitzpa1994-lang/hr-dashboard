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

const webhookPath = `tmp-inspect-candidate-history-${crypto.randomBytes(8).toString('hex')}`;

const names = [
  '張家豪',
  '劉彥廷',
  '黃鳴華',
  '洪邵維',
];

const quotedNames = names.map((name) => `'${name.replace(/'/g, "''")}'`).join(', ');

const inspectQuery = `
WITH target_candidates AS (
  SELECT *
  FROM candidates
  WHERE name IN (${quotedNames})
),
candidate_rows AS (
  SELECT json_agg(json_build_object(
    'id', c.id,
    'name', c.name,
    'applied_position', c.applied_position,
    'department', c.department,
    'status', c.status,
    'source', c.source,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'notes', c.notes
  ) ORDER BY c.id) AS data
  FROM target_candidates c
),
interview_rows AS (
  SELECT json_agg(json_build_object(
    'id', i.id,
    'candidate_id', i.candidate_id,
    'candidate_name', c.name,
    'interview_date', i.interview_date,
    'interview_time', i.interview_time,
    'round', i.round,
    'status', i.status,
    'result', i.result,
    'hr_owner', i.hr_owner,
    'notes', i.notes,
    'email_subject', i.email_subject,
    'email_msg_id', i.email_msg_id,
    'created_at', i.created_at,
    'updated_at', i.updated_at
  ) ORDER BY c.name, i.interview_date NULLS LAST, i.id) AS data
  FROM interviews i
  JOIN target_candidates c ON c.id = i.candidate_id
),
email_rows AS (
  SELECT json_agg(json_build_object(
    'id', e.id,
    'candidate_id', e.candidate_id,
    'candidate_name', c.name,
    'received_at', e.received_at,
    'sender', e.sender,
    'action', e.action,
    'email_subject', e.email_subject,
    'error_msg', e.error_msg,
    'processed_at', e.processed_at
  ) ORDER BY c.name, e.received_at DESC NULLS LAST, e.id DESC) AS data
  FROM email_logs e
  JOIN target_candidates c ON c.id = e.candidate_id
)
SELECT json_build_object(
  'candidates', COALESCE((SELECT data FROM candidate_rows), '[]'::json),
  'interviews', COALESCE((SELECT data FROM interview_rows), '[]'::json),
  'email_logs', COALESCE((SELECT data FROM email_rows), '[]'::json)
) AS result;
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
    name: 'tmp-inspect-candidate-history',
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
          query: inspectQuery,
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
      body: JSON.stringify({ source: 'codex-inspect-candidate-history' }),
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
