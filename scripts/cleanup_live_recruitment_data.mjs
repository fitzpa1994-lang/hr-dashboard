import crypto from 'node:crypto';
import process from 'node:process';

const n8nBaseUrl = String(process.env.N8N_API_BASE_URL || process.env.N8N_API_URL || '')
  .trim()
  .replace(/\/+$/, '');
const n8nApiKey = String(process.env.N8N_API_KEY || '').trim();

if (!n8nBaseUrl) throw new Error('Missing N8N_API_BASE_URL');
if (!n8nApiKey) throw new Error('Missing N8N_API_KEY');

const postgresCredential = {
  id: 'NGdDfE2F1YFXGcmn',
  name: 'Postgres account',
};

const cleanupQuery = `
WITH bad_candidate_ids AS (
  SELECT id
  FROM candidates
  WHERE name IN ('請您前來', '邀約', '通知', '現場', '前往', '前往公司')
     OR name ~ '^[?？]+$'
     OR applied_position = 'undefined'
     OR department = 'undefined'
),
deleted_email_logs_candidates AS (
  DELETE FROM email_logs
  WHERE candidate_id IN (SELECT id FROM bad_candidate_ids)
  RETURNING id
),
deleted_interviews AS (
  DELETE FROM interviews
  WHERE candidate_id IN (SELECT id FROM bad_candidate_ids)
  RETURNING id
),
deleted_offers AS (
  DELETE FROM offers
  WHERE candidate_id IN (SELECT id FROM bad_candidate_ids)
  RETURNING id
),
deleted_candidates AS (
  DELETE FROM candidates
  WHERE id IN (SELECT id FROM bad_candidate_ids)
  RETURNING id
),
bad_onboard_msgs AS (
  SELECT email_msg_id
  FROM onboardings
  WHERE name ~ '^[?？]+$'
     OR position ~ '^[?？]+$'
     OR department LIKE '%???%'
     OR position LIKE '%???%'
),
deleted_email_logs_onboard AS (
  DELETE FROM email_logs
  WHERE email_msg_id IN (
    SELECT email_msg_id
    FROM bad_onboard_msgs
    WHERE email_msg_id IS NOT NULL
  )
  RETURNING id
),
deleted_onboardings AS (
  DELETE FROM onboardings
  WHERE email_msg_id IN (
    SELECT email_msg_id
    FROM bad_onboard_msgs
    WHERE email_msg_id IS NOT NULL
  )
     OR (
       (name ~ '^[?？]+$' OR position ~ '^[?？]+$')
       AND department LIKE 'WBU / %'
     )
  RETURNING id
),
bad_resign_msgs AS (
  SELECT email_msg_id
  FROM resignations
  WHERE name LIKE '%職 稱：%'
     OR department LIKE '%姓 名：%'
     OR position LIKE '%離 職 生 效 日：%'
     OR (
       name = '未知姓名'
       AND department = '未分類'
       AND position = '未知職位'
     )
),
deleted_email_logs_resign AS (
  DELETE FROM email_logs
  WHERE email_msg_id IN (
    SELECT email_msg_id
    FROM bad_resign_msgs
    WHERE email_msg_id IS NOT NULL
  )
  RETURNING id
),
deleted_resignations AS (
  DELETE FROM resignations
  WHERE email_msg_id IN (
    SELECT email_msg_id
    FROM bad_resign_msgs
    WHERE email_msg_id IS NOT NULL
  )
     OR name LIKE '%職 稱：%'
     OR department LIKE '%姓 名：%'
     OR position LIKE '%離 職 生 效 日：%'
     OR (
       name = '未知姓名'
       AND department = '未分類'
       AND position = '未知職位'
     )
  RETURNING id
)
SELECT
  (SELECT COUNT(*) FROM deleted_candidates) AS deleted_candidates,
  (SELECT COUNT(*) FROM deleted_interviews) AS deleted_interviews,
  (SELECT COUNT(*) FROM deleted_offers) AS deleted_offers,
  (SELECT COUNT(*) FROM deleted_email_logs_candidates) AS deleted_candidate_logs,
  (SELECT COUNT(*) FROM deleted_onboardings) AS deleted_onboardings,
  (SELECT COUNT(*) FROM deleted_email_logs_onboard) AS deleted_onboarding_logs,
  (SELECT COUNT(*) FROM deleted_resignations) AS deleted_resignations,
  (SELECT COUNT(*) FROM deleted_email_logs_resign) AS deleted_resignation_logs;
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
    throw new Error(
      `${options.method || 'GET'} ${url} failed: status=${response.status}; body=${parsed.text.slice(0, 400)}`,
    );
  }
  return parsed.json;
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

function buildWorkflowPayload(webhookPath) {
  return {
    name: `tmp-cleanup-live-recruitment-${crypto.randomBytes(4).toString('hex')}`,
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
          postgres: postgresCredential,
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

const webhookPath = `tmp-cleanup-live-recruitment-${crypto.randomBytes(8).toString('hex')}`;
const created = await apiRequest(`${n8nBaseUrl}/workflows`, {
  method: 'POST',
  headers: buildHeaders(),
  body: JSON.stringify(buildWorkflowPayload(webhookPath)),
});

const workflowId = created.id;
if (!workflowId) throw new Error('Workflow creation returned no id');

try {
  await activateWorkflow(workflowId);

  const webhookUrl = `${new URL(n8nBaseUrl).origin}/webhook/${webhookPath}`;
  const executeResponse = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'codex-cleanup-live-recruitment' }),
  });
  const executeParsed = await parseJsonResponse(executeResponse);
  if (!executeResponse.ok) {
    throw new Error(
      `POST ${webhookUrl} failed: status=${executeResponse.status}; body=${executeParsed.text.slice(0, 400)}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        workflowId,
        webhookPath,
        result: executeParsed.json ?? executeParsed.text,
      },
      null,
      2,
    ),
  );
} finally {
  await deleteWorkflow(workflowId);
}
