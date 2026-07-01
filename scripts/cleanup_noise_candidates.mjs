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

const webhookPath = `tmp-noise-candidate-cleanup-${crypto.randomBytes(8).toString('hex')}`;

const cleanupQuery = `
WITH targets AS (
  SELECT id, name
  FROM candidates
  WHERE name IN (
    '—這期三個方案都有解',
    '測試李小明',
    '測試王小明',
    '測試陳小明',
    '測試張小明'
  )
),
email_logs_cleared AS (
  UPDATE email_logs e
  SET candidate_id = NULL,
      action = CASE WHEN COALESCE(e.action, '') = 'inserted' THEN 'skipped' ELSE e.action END,
      error_msg = COALESCE(NULLIF(e.error_msg, ''), 'system noise cleanup'),
      processed_at = NOW()
  FROM targets t
  WHERE e.candidate_id = t.id
  RETURNING e.id
),
interviews_deleted AS (
  DELETE FROM interviews i
  USING targets t
  WHERE i.candidate_id = t.id
  RETURNING i.id
),
offers_deleted AS (
  DELETE FROM offers o
  USING targets t
  WHERE o.candidate_id = t.id
  RETURNING o.id
),
onboardings_cleared AS (
  UPDATE onboardings o
  SET candidate_id = NULL,
      updated_at = NOW()
  FROM targets t
  WHERE o.candidate_id = t.id
  RETURNING o.id
),
deleted_candidates AS (
  DELETE FROM candidates c
  USING targets t
  WHERE c.id = t.id
  RETURNING c.id, c.name
)
SELECT json_build_object(
  'target_count', (SELECT COUNT(*) FROM targets),
  'email_logs_cleared', (SELECT COUNT(*) FROM email_logs_cleared),
  'interviews_deleted', (SELECT COUNT(*) FROM interviews_deleted),
  'offers_deleted', (SELECT COUNT(*) FROM offers_deleted),
  'onboardings_cleared', (SELECT COUNT(*) FROM onboardings_cleared),
  'deleted_candidates', COALESCE((
    SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY id)
    FROM deleted_candidates
  ), '[]'::json)
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
    name: 'tmp-cleanup-noise-candidates',
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
        id: 'pg-cleanup',
        name: 'PG Cleanup',
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5,
        position: [520, 240],
        parameters: {
          operation: 'executeQuery',
          query: cleanupQuery,
          options: {},
        },
        credentials: {
          postgres: pgCredential,
        },
      },
    ],
    connections: {
      Webhook: {
        main: [[{ node: 'PG Cleanup', type: 'main', index: 0 }]],
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
  if (!workflowId) {
    throw new Error('Workflow creation returned no id');
  }

  try {
    await activateWorkflow(workflowId);
    const webhookUrl = `${new URL(n8nBaseUrl).origin}/webhook/${webhookPath}`;
    const executeResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'codex-cleanup-noise-candidates' }),
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
