import crypto from 'node:crypto';
import process from 'node:process';

const [
  name,
  department,
  position,
  expectedDate,
  emailSubject,
  emailMessageId,
  emailWebLink = '',
] = process.argv.slice(2);

const n8nBaseUrl = String(process.env.N8N_API_BASE_URL || process.env.N8N_API_URL || '').trim().replace(/\/+$/, '');
const n8nApiKey = String(process.env.N8N_API_KEY || '').trim();

if (!n8nBaseUrl || !n8nApiKey) {
  console.error('Missing N8N_API_BASE_URL or N8N_API_KEY');
  process.exit(1);
}

for (const [label, value] of [
  ['name', name],
  ['department', department],
  ['position', position],
  ['expectedDate', expectedDate],
  ['emailSubject', emailSubject],
  ['emailMessageId', emailMessageId],
]) {
  if (!value) {
    console.error(`Missing required argument: ${label}`);
    process.exit(1);
  }
}

const pgCredential = {
  id: 'NGdDfE2F1YFXGcmn',
  name: 'Postgres account',
};

const webhookPath = `tmp-onboarding-backfill-${crypto.randomBytes(8).toString('hex')}`;

const escapeSql = (value) => String(value).replace(/'/g, "''");

const query = `
INSERT INTO onboardings (
  name,
  department,
  position,
  expected_date,
  status,
  email_subject,
  email_msg_id,
  email_web_link
)
VALUES (
  '${escapeSql(name)}',
  '${escapeSql(department)}',
  '${escapeSql(position)}',
  DATE '${escapeSql(expectedDate)}',
  'pending',
  '${escapeSql(emailSubject)}',
  '${escapeSql(emailMessageId)}',
  ${emailWebLink ? `'${escapeSql(emailWebLink)}'` : 'NULL'}
)
ON CONFLICT (email_msg_id) DO UPDATE SET
  name = EXCLUDED.name,
  department = EXCLUDED.department,
  position = EXCLUDED.position,
  expected_date = EXCLUDED.expected_date,
  status = 'pending',
  email_subject = EXCLUDED.email_subject,
  email_web_link = EXCLUDED.email_web_link,
  updated_at = NOW();

SELECT
  '${escapeSql(name)}' AS name,
  '${escapeSql(department)}' AS department,
  '${escapeSql(position)}' AS position,
  DATE '${escapeSql(expectedDate)}' AS expected_date,
  '${escapeSql(emailMessageId)}' AS email_msg_id;
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
    name: `tmp-onboarding-backfill-${name}`,
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
        id: 'pg-upsert',
        name: 'PG Upsert',
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
        main: [[{ node: 'PG Upsert', type: 'main', index: 0 }]],
      },
    },
    settings: {
      executionOrder: 'v1',
    },
  };
}

async function activateWorkflow(id) {
  try {
    await apiRequest(`${n8nBaseUrl}/workflows/${id}/activate`, {
      method: 'POST',
      headers: buildHeaders(),
    });
  } catch {
    await apiRequest(`${n8nBaseUrl}/workflows/${id}`, {
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
      body: JSON.stringify({ source: 'codex-onboarding-backfill' }),
    });
    const executeParsed = await parseJsonResponse(executeResponse);
    if (!executeResponse.ok) {
      throw new Error(`POST ${webhookUrl} failed: status=${executeResponse.status}; body=${executeParsed.text.slice(0, 400)}`);
    }

    console.log(JSON.stringify({ workflowId, webhookPath, result: executeParsed.json ?? executeParsed.text }, null, 2));
  } finally {
    await deleteWorkflow(workflowId);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
