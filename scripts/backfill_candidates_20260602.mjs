import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

const n8nBaseUrl = String(process.env.N8N_API_BASE_URL || process.env.N8N_API_URL || '').trim().replace(/\/+$/, '');
const n8nApiKey = String(process.env.N8N_API_KEY || '').trim();
const dashboardBaseUrl = String(process.env.HR_DASHBOARD_URL || 'https://sp-hr.zeabur.app').trim().replace(/\/+$/, '');
const dashboardPassword = String(process.env.HR_DASHBOARD_PASSWORD || '').trim();
const root = process.cwd();

if (!n8nBaseUrl) {
  console.error('Missing N8N_API_BASE_URL');
  process.exit(1);
}
if (!n8nApiKey) {
  console.error('Missing N8N_API_KEY');
  process.exit(1);
}

const workflow1File = fs.readdirSync(path.join(root, 'n8n')).find((name) => name.startsWith('live_Workflow1_'));
if (!workflow1File) {
  console.error('Cannot find live_Workflow1 export file under n8n/');
  process.exit(1);
}
const workflow1 = JSON.parse(fs.readFileSync(path.join(root, 'n8n', workflow1File), 'utf8'));

const DATASET = [
  {
    candidate_name: '張哲瑞',
    applied_position: 'ICC客服業務/業務專員',
    department: 'ICC',
    status: 'pending_review',
    interview_status: 'scheduled',
    intent: 'request_invite',
    round: 1,
    interview_date: 'null',
    interview_time: 'null',
    location: 'null',
    hr_owner: 'Peggy Lee (李沛晴)',
    email_subject: '履歷推薦【ICC客服業務/業務專員】–張哲瑞',
    email_msg_id: 'AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQBGAAAAAAATwHe72s8cTYU6NTzQdTNsBwCddaHEqpeLSJK4gY8M9T9SAAAA-bMBAABZ5GNOx7QRRZIXo071wWwMAABGTCXgAAA=',
    email_web_link: 'https://outlook.office365.com/owa/?ItemID=AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQBGAAAAAAATwHe72s8cTYU6NTzQdTNsBwCddaHEqpeLSJK4gY8M9T9SAAAA%2FbMBAABZ5GNOx7QRRZIXo071wWwMAABGTCXgAAA%3D&exvsurl=1&viewmodel=ReadMessageItem',
    sender: 'Peggylee@sporton.com.tw',
    received_at: '2026-06-02T06:20:57Z',
  },
  {
    candidate_name: '王業暹',
    applied_position: 'icc測試工程師',
    department: 'ICC',
    status: 'in_progress',
    interview_status: 'scheduled',
    intent: 'schedule',
    round: 1,
    interview_date: '2026-06-08',
    interview_time: '11:00',
    location: 'null',
    hr_owner: 'Peggy Lee (李沛晴)',
    email_subject: 'RE: 履歷推薦【icc測試工程師】- 王業暹',
    email_msg_id: 'AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQBGAAAAAAATwHe72s8cTYU6NTzQdTNsBwCddaHEqpeLSJK4gY8M9T9SAAAA-bMBAABZ5GNOx7QRRZIXo071wWwMAABGTCXSAAA=',
    email_web_link: 'https://outlook.office365.com/owa/?ItemID=AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQBGAAAAAAATwHe72s8cTYU6NTzQdTNsBwCddaHEqpeLSJK4gY8M9T9SAAAA%2FbMBAABZ5GNOx7QRRZIXo071wWwMAABGTCXSAAA%3D&exvsurl=1&viewmodel=ReadMessageItem',
    sender: 'Cody@icertifi.com.tw',
    received_at: '2026-06-02T03:30:59Z',
  },
  {
    candidate_name: '夏子瀚',
    applied_position: 'icc測試工程師',
    department: 'ICC',
    status: 'in_progress',
    interview_status: 'scheduled',
    intent: 'schedule',
    round: 1,
    interview_date: '2026-06-05',
    interview_time: '13:30',
    location: 'null',
    hr_owner: 'Peggy Lee (李沛晴)',
    email_subject: '面試時間【icc測試工程師】- 夏子瀚',
    email_msg_id: 'AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQBGAAAAAAATwHe72s8cTYU6NTzQdTNsBwCddaHEqpeLSJK4gY8M9T9SAAAA-bMBAABZ5GNOx7QRRZIXo071wWwMAABGTCXWAAA=',
    email_web_link: 'https://outlook.office365.com/owa/?ItemID=AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQBGAAAAAAATwHe72s8cTYU6NTzQdTNsBwCddaHEqpeLSJK4gY8M9T9SAAAA%2FbMBAABZ5GNOx7QRRZIXo071wWwMAABGTCXWAAA%3D&exvsurl=1&viewmodel=ReadMessageItem',
    sender: 'Peggylee@sporton.com.tw',
    received_at: '2026-06-02T03:44:24Z',
  },
  {
    candidate_name: '許宏恩',
    applied_position: 'icc測試工程師',
    department: 'ICC',
    status: 'in_progress',
    interview_status: 'scheduled',
    intent: 'schedule',
    round: 1,
    interview_date: '2026-06-05',
    interview_time: '10:00',
    location: 'null',
    hr_owner: 'Peggy Lee (李沛晴)',
    email_subject: '面試時間【icc測試工程師】- 許宏恩',
    email_msg_id: 'AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQBGAAAAAAATwHe72s8cTYU6NTzQdTNsBwCddaHEqpeLSJK4gY8M9T9SAAAA-bMBAABZ5GNOx7QRRZIXo071wWwMAABGTCXLAAA=',
    email_web_link: 'https://outlook.office365.com/owa/?ItemID=AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQBGAAAAAAATwHe72s8cTYU6NTzQdTNsBwCddaHEqpeLSJK4gY8M9T9SAAAA%2FbMBAABZ5GNOx7QRRZIXo071wWwMAABGTCXLAAA%3D&exvsurl=1&viewmodel=ReadMessageItem',
    sender: 'Peggylee@sporton.com.tw',
    received_at: '2026-06-02T02:23:11Z',
  },
];

function getNode(name) {
  const node = workflow1.nodes.find((item) => item.name === name);
  if (!node) {
    throw new Error(`Workflow1 export is missing node: ${name}`);
  }
  return JSON.parse(JSON.stringify(node));
}

function headers() {
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
    throw new Error(`${options.method || 'GET'} ${url} failed: status=${response.status}; body=${parsed.text.slice(0, 500)}`);
  }
  return parsed.json;
}

async function activateWorkflow(id) {
  const activateUrl = `${n8nBaseUrl}/workflows/${id}/activate`;
  try {
    await apiRequest(activateUrl, {
      method: 'POST',
      headers: headers(),
    });
  } catch {
    await apiRequest(`${n8nBaseUrl}/workflows/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ active: true }),
    });
  }
}

async function deleteWorkflow(id) {
  const response = await fetch(`${n8nBaseUrl}/workflows/${id}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`DELETE workflow ${id} failed: status=${response.status}; body=${text.slice(0, 300)}`);
  }
}

async function loginDashboard() {
  if (!dashboardPassword) {
    return null;
  }
  const response = await fetch(`${dashboardBaseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: dashboardPassword }),
  });
  const cookie = response.headers.get('set-cookie') || '';
  if (!response.ok || !cookie.includes('hr_sid=')) {
    const body = await response.text();
    throw new Error(`Dashboard login failed: status=${response.status}; body=${body.slice(0, 200)}`);
  }
  return cookie.split(';')[0];
}

async function fetchDashboard(cookie) {
  const response = await fetch(`${dashboardBaseUrl}/api/hr-dashboard`, {
    headers: { Cookie: cookie },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`/api/hr-dashboard failed: status=${response.status}; body=${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

function buildPayload() {
  const codeEmitItems = {
    id: 'tmp-emit-items',
    name: 'Code：Emit candidate backfill items',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [480, 240],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `return ${JSON.stringify(DATASET, null, 2)}.map((json) => ({ json }));`,
    },
  };

  const webhook = {
    id: 'tmp-webhook-trigger',
    name: 'Webhook：Candidate backfill',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [240, 240],
    webhookId: `tmp-candidate-backfill-${crypto.randomBytes(8).toString('hex')}`,
    parameters: {
      httpMethod: 'POST',
      path: `tmp-candidate-backfill-${crypto.randomBytes(4).toString('hex')}`,
      responseMode: 'onReceived',
    },
  };

  const upsertCandidates = getNode('PG：寫入 candidates');
  const upsertInterviews = getNode('PG：寫入 interviews');
  const upsertLogs = getNode('PG：寫入 email_logs');

  upsertCandidates.position = [760, 240];
  upsertInterviews.position = [1020, 240];
  upsertLogs.position = [1280, 240];

  return {
    webhookPath: webhook.parameters.path,
    payload: {
      name: `tmp-candidate-backfill-20260602`,
      nodes: [webhook, codeEmitItems, upsertCandidates, upsertInterviews, upsertLogs],
      connections: {
        'Webhook：Candidate backfill': {
          main: [[{ node: 'Code：Emit candidate backfill items', type: 'main', index: 0 }]],
        },
        'Code：Emit candidate backfill items': {
          main: [[{ node: 'PG：寫入 candidates', type: 'main', index: 0 }]],
        },
        'PG：寫入 candidates': {
          main: [[{ node: 'PG：寫入 interviews', type: 'main', index: 0 }]],
        },
        'PG：寫入 interviews': {
          main: [[{ node: 'PG：寫入 email_logs', type: 'main', index: 0 }]],
        },
      },
      settings: {
        executionOrder: 'v1',
      },
    },
  };
}

async function waitForExecution(workflowId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = `${n8nBaseUrl}/executions?limit=10&workflowId=${workflowId}`;
    const json = await apiRequest(url, {
      headers: headers(),
    });
    const execution = Array.isArray(json?.data) ? json.data[0] : null;
    if (execution?.id) {
      if (execution.finished) {
        return execution;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for execution of temporary workflow ${workflowId}`);
}

async function main() {
  const { payload, webhookPath } = buildPayload();
  const create = await apiRequest(`${n8nBaseUrl}/workflows`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  });
  const workflowId = create.id;
  if (!workflowId) {
    throw new Error('Workflow creation returned no id');
  }

  try {
    await activateWorkflow(workflowId);
    const webhookUrl = `${new URL(n8nBaseUrl).origin}/webhook/${webhookPath}`;
    const runResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'codex-candidate-backfill-20260602' }),
    });
    if (!runResponse.ok) {
      const body = await runResponse.text();
      throw new Error(`POST ${webhookUrl} failed: status=${runResponse.status}; body=${body.slice(0, 300)}`);
    }

    const execution = await waitForExecution(workflowId);

    const cookie = await loginDashboard();
    const dashboard = await fetchDashboard(cookie);
    const candidateNames = new Set((dashboard.candidatesData || []).map((item) => item.name));
    const scheduleNames = new Set((dashboard.schedEvents || []).map((item) => item.name));

    const verification = DATASET.map((item) => ({
      name: item.candidate_name,
      inCandidates: candidateNames.has(item.candidate_name),
      inSchedule: scheduleNames.has(item.candidate_name),
    }));

    console.log(JSON.stringify({
      workflowId,
      executionId: execution.id,
      executionStatus: execution.status,
      verification,
    }, null, 2));
  } finally {
    await deleteWorkflow(workflowId);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
