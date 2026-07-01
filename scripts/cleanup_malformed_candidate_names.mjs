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

const webhookPath = `tmp-candidate-cleanup-${crypto.randomBytes(8).toString('hex')}`;

const cleanupQuery = `
WITH targets AS (
  SELECT
    c.id,
    c.name AS old_name,
    CASE
      WHEN c.name = '-楊人潔' THEN REGEXP_REPLACE(c.name, '^[\\-－—–]+', '')
      WHEN c.name = 'mis工程師-張宇豐' THEN '張宇豐'
      WHEN c.name LIKE '新華文件專員--%' THEN REGEXP_REPLACE(c.name, '^新華文件專員--', '')
      ELSE c.name
    END AS new_name
  FROM candidates c
  WHERE c.name = '-楊人潔'
     OR c.name = 'mis工程師-張宇豐'
     OR c.name LIKE '新華文件專員--%'
),
updated AS (
  UPDATE candidates c
  SET name = t.new_name,
      updated_at = NOW()
  FROM targets t
  WHERE c.id = t.id
    AND t.new_name IS NOT NULL
    AND t.new_name <> t.old_name
  RETURNING c.id, t.old_name, t.new_name
)
SELECT
  COUNT(*) AS updated_count,
  COALESCE(
    json_agg(
      json_build_object(
        'id', id,
        'old_name', old_name,
        'new_name', new_name
      )
      ORDER BY id
    ),
    '[]'::json
  ) AS updated_rows
FROM updated;
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
    name: 'tmp-cleanup-malformed-candidate-names',
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
      body: JSON.stringify({ source: 'codex-cleanup-malformed-candidate-names' }),
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
