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

const latestEmailMessageId = 'AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQBGAAAAAAATwHe72s8cTYU6NTzQdTNsBwDrOyTdalCqR4oTn0wwCObdAEg2qZyMAABZ5GNOx7QRRZIXo071wWwMAAAbv2eUAAA=';
const latestEmailSubject = 'RE: 【耕興股份有限公司】錄取通知事宜-陳天怡';
const latestEmailWebLink = 'https://outlook.office365.com/owa/?ItemID=AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQBGAAAAAAATwHe72s8cTYU6NTzQdTNsBwDrOyTdalCqR4oTn0wwCObdAEg2qZyMAABZ5GNOx7QRRZIXo071wWwMAAAbv2eUAAA%3D&exvsurl=1&viewmodel=ReadMessageItem';

const webhookPath = `tmp-onboarding-fix-${crypto.randomBytes(8).toString('hex')}`;

const cleanupQuery = `
WITH cancelled AS (
  UPDATE onboardings
  SET status = 'cancelled',
      updated_at = NOW()
  WHERE name = '未知姓名'
    AND department = '未分類'
    AND position = '未知職位'
    AND status = 'pending'
    AND expected_date IN (DATE '2026-05-20', DATE '2026-05-26')
  RETURNING id
),
upserted AS (
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
    '陳天怡',
    '行政 / 財務部',
    '主任',
    DATE '2026-06-01',
    'pending',
    '${latestEmailSubject.replace(/'/g, "''")}',
    '${latestEmailMessageId.replace(/'/g, "''")}',
    '${latestEmailWebLink.replace(/'/g, "''")}'
  )
  ON CONFLICT (email_msg_id) DO UPDATE SET
    name = EXCLUDED.name,
    department = EXCLUDED.department,
    position = EXCLUDED.position,
    expected_date = EXCLUDED.expected_date,
    status = 'pending',
    email_subject = EXCLUDED.email_subject,
    email_web_link = EXCLUDED.email_web_link,
    updated_at = NOW()
  RETURNING id
)
SELECT
  (SELECT COUNT(*) FROM cancelled) AS cancelled_count,
  (SELECT COUNT(*) FROM upserted) AS upserted_count;
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
    name: `tmp-fix-陳天怡-onboarding-history`,
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
        main: [
          [
            {
              node: 'PG Cleanup',
              type: 'main',
              index: 0,
            },
          ],
        ],
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
  } catch (error) {
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
  const createUrl = `${n8nBaseUrl}/workflows`;
  const workflow = await apiRequest(createUrl, {
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
      body: JSON.stringify({ source: 'codex-fix-chentianyi-history' }),
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
