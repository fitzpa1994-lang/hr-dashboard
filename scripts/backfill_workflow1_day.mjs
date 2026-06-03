import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

const root = process.cwd();
const n8nBaseUrl = String(process.env.N8N_API_BASE_URL || process.env.N8N_API_URL || '').trim().replace(/\/+$/, '');
const n8nApiKey = String(process.env.N8N_API_KEY || '').trim();
const dashboardBaseUrl = String(process.env.HR_DASHBOARD_URL || 'https://sp-hr.zeabur.app').trim().replace(/\/+$/, '');
const dashboardPassword = String(process.env.HR_DASHBOARD_PASSWORD || '').trim();
const targetDate = String(process.env.BACKFILL_DATE || process.argv[2] || '2026-06-02').trim();
const targetTimezone = String(process.env.BACKFILL_TIMEZONE || 'Asia/Taipei').trim();
const verifyNames = String(
  process.env.BACKFILL_VERIFY_NAMES || '張哲瑞,夏子瀚,王業暹,許宏恩'
)
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

const workflow1File = fs.readdirSync(path.join(root, 'n8n')).find((name) => name.startsWith('live_Workflow1_'));
if (!workflow1File) {
  console.error('Cannot find live_Workflow1 export file under n8n/');
  process.exit(1);
}

const workflow1Path = path.join(root, 'n8n', workflow1File);
const workflow1 = JSON.parse(fs.readFileSync(workflow1Path, 'utf8'));

if (!n8nBaseUrl) {
  console.error('Missing N8N_API_BASE_URL');
  process.exit(1);
}
if (!n8nApiKey) {
  console.error('Missing N8N_API_KEY');
  process.exit(1);
}

const WORKFLOW1_NODE_NAMES = {
  filter: 'IF：主旨過濾',
  extract: 'Code：萃取基本資訊',
  skip: 'Code：非面試信件略過',
  skipLog: 'PG：記錄略過信件',
  buildClaude: 'Code：組裝 Claude Request Body',
  anthropic: 'Claude：AI 解析意圖',
  merge: 'Code：整合輸出',
  split: 'Code：拆分多人推薦',
  upsertCandidates: 'PG：寫入 candidates',
  upsertInterviews: 'PG：寫入 interviews',
  upsertLogs: 'PG：寫入 email_logs',
};

const TEMP_NODE_NAMES = {
  webhook: 'Webhook：Workflow1 Day Backfill',
  getAll: 'Microsoft Outlook：Backfill getAll',
  filterDay: 'Code：Filter target day',
};

const DAY_FILTER_CODE = String.raw`const targetDate = ${JSON.stringify(targetDate)};
const targetTimezone = ${JSON.stringify(targetTimezone)};
const subjectPattern = /(面試|面談|初試|複試|面試通知|面談通知|interview|履歷推薦)/i;

function toLocalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: targetTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

return $input
  .all()
  .filter((item) => {
    const json = item.json || {};
    const subject = String(json.subject || '');
    const receivedAt = json.receivedDateTime;
    return toLocalDate(receivedAt) === targetDate && subjectPattern.test(subject);
  });`;

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

function buildWorkflowPayload() {
  const trigger = getNode('Outlook 收信觸發');
  const filter = getNode(WORKFLOW1_NODE_NAMES.filter);
  const extract = getNode(WORKFLOW1_NODE_NAMES.extract);
  const skip = getNode(WORKFLOW1_NODE_NAMES.skip);
  const skipLog = getNode(WORKFLOW1_NODE_NAMES.skipLog);
  const buildClaude = getNode(WORKFLOW1_NODE_NAMES.buildClaude);
  const anthropic = getNode(WORKFLOW1_NODE_NAMES.anthropic);
  const merge = getNode(WORKFLOW1_NODE_NAMES.merge);
  const split = getNode(WORKFLOW1_NODE_NAMES.split);
  const upsertCandidates = getNode(WORKFLOW1_NODE_NAMES.upsertCandidates);
  const upsertInterviews = getNode(WORKFLOW1_NODE_NAMES.upsertInterviews);
  const upsertLogs = getNode(WORKFLOW1_NODE_NAMES.upsertLogs);

  const webhookPath = `tmp-workflow1-backfill-${targetDate}-${crypto.randomBytes(4).toString('hex')}`;

  const webhook = {
    id: 'tmp-webhook-trigger',
    name: TEMP_NODE_NAMES.webhook,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [240, 320],
    webhookId: `tmp-workflow1-backfill-${crypto.randomBytes(8).toString('hex')}`,
    parameters: {
      httpMethod: 'POST',
      path: webhookPath,
      responseMode: 'onReceived',
    },
  };

  const getAll = {
    id: 'tmp-outlook-getall',
    name: TEMP_NODE_NAMES.getAll,
    type: 'n8n-nodes-base.microsoftOutlook',
    typeVersion: 2,
    position: [520, 320],
    parameters: {
      operation: 'getAll',
      limit: 500,
      options: {},
    },
    credentials: trigger.credentials,
  };

  const filterDay = {
    id: 'tmp-filter-target-day',
    name: TEMP_NODE_NAMES.filterDay,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [760, 320],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: DAY_FILTER_CODE,
    },
  };

  filter.position = [1040, 320];
  extract.position = [1280, 192];
  skip.position = [1280, 448];
  skipLog.position = [1520, 448];
  buildClaude.position = [1520, 192];
  anthropic.position = [1760, 192];
  merge.position = [2000, 192];
  split.position = [2240, 192];
  upsertCandidates.position = [2480, 192];
  upsertInterviews.position = [2720, 192];
  upsertLogs.position = [2960, 192];

  return {
    webhookPath,
    payload: {
      name: `tmp-workflow1-backfill-${targetDate}`,
      nodes: [
        webhook,
        getAll,
        filterDay,
        filter,
        extract,
        skip,
        skipLog,
        buildClaude,
        anthropic,
        merge,
        split,
        upsertCandidates,
        upsertInterviews,
        upsertLogs,
      ],
      connections: {
        [TEMP_NODE_NAMES.webhook]: {
          main: [[{ node: TEMP_NODE_NAMES.getAll, type: 'main', index: 0 }]],
        },
        [TEMP_NODE_NAMES.getAll]: {
          main: [[{ node: TEMP_NODE_NAMES.filterDay, type: 'main', index: 0 }]],
        },
        [TEMP_NODE_NAMES.filterDay]: {
          main: [[{ node: WORKFLOW1_NODE_NAMES.filter, type: 'main', index: 0 }]],
        },
        [WORKFLOW1_NODE_NAMES.filter]: {
          main: [
            [{ node: WORKFLOW1_NODE_NAMES.extract, type: 'main', index: 0 }],
            [{ node: WORKFLOW1_NODE_NAMES.skip, type: 'main', index: 0 }],
          ],
        },
        [WORKFLOW1_NODE_NAMES.extract]: {
          main: [[{ node: WORKFLOW1_NODE_NAMES.buildClaude, type: 'main', index: 0 }]],
        },
        [WORKFLOW1_NODE_NAMES.skip]: {
          main: [[{ node: WORKFLOW1_NODE_NAMES.skipLog, type: 'main', index: 0 }]],
        },
        [WORKFLOW1_NODE_NAMES.buildClaude]: {
          main: [[{ node: WORKFLOW1_NODE_NAMES.anthropic, type: 'main', index: 0 }]],
        },
        [WORKFLOW1_NODE_NAMES.anthropic]: {
          main: [[{ node: WORKFLOW1_NODE_NAMES.merge, type: 'main', index: 0 }]],
        },
        [WORKFLOW1_NODE_NAMES.merge]: {
          main: [[{ node: WORKFLOW1_NODE_NAMES.split, type: 'main', index: 0 }]],
        },
        [WORKFLOW1_NODE_NAMES.split]: {
          main: [[{ node: WORKFLOW1_NODE_NAMES.upsertCandidates, type: 'main', index: 0 }]],
        },
        [WORKFLOW1_NODE_NAMES.upsertCandidates]: {
          main: [[{ node: WORKFLOW1_NODE_NAMES.upsertInterviews, type: 'main', index: 0 }]],
        },
        [WORKFLOW1_NODE_NAMES.upsertInterviews]: {
          main: [[{ node: WORKFLOW1_NODE_NAMES.upsertLogs, type: 'main', index: 0 }]],
        },
      },
      settings: {
        executionOrder: 'v1',
      },
    },
  };
}

async function main() {
  const { payload, webhookPath } = buildWorkflowPayload();
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
      body: JSON.stringify({ source: 'codex-backfill-workflow1-day', targetDate }),
    });
    const runParsed = await parseJsonResponse(runResponse);
    if (!runResponse.ok) {
      throw new Error(`POST ${webhookUrl} failed: status=${runResponse.status}; body=${runParsed.text.slice(0, 400)}`);
    }

    const execution = await waitForExecution(workflowId);

    let verification = null;
    if (dashboardPassword) {
      const cookie = await loginDashboard();
      const dashboard = await fetchDashboard(cookie);
      const candidateNames = new Set((dashboard.candidatesData || []).map((item) => item.name));
      const scheduleNames = new Set((dashboard.schedEvents || []).map((item) => item.name));
      verification = verifyNames.map((name) => ({
        name,
        inCandidates: candidateNames.has(name),
        inSchedule: scheduleNames.has(name),
      }));
    }

    console.log(JSON.stringify({
      workflowId,
      executionId: execution.id,
      executionStatus: execution.status,
      webhookPath,
      targetDate,
      runStatus: runResponse.status,
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
