import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const n8nBaseUrl = String(process.env.N8N_API_BASE_URL || process.env.N8N_API_URL || '').trim().replace(/\/+$/, '');
const n8nApiKey = String(process.env.N8N_API_KEY || '').trim();
const dashboardPassword = String(process.env.HR_DASHBOARD_PASSWORD || '').trim();

if (!n8nBaseUrl) throw new Error('Missing N8N_API_BASE_URL');
if (!n8nApiKey) throw new Error('Missing N8N_API_KEY');
if (!dashboardPassword) throw new Error('Missing HR_DASHBOARD_PASSWORD');

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
    throw new Error(`${options.method || 'GET'} ${url} failed: status=${response.status}; body=${parsed.text.slice(0, 300)}`);
  }
  return parsed.json;
}

async function activateWorkflow(id) {
  try {
    await apiRequest(`${n8nBaseUrl}/workflows/${id}/activate`, {
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

async function waitForExecution(workflowId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const json = await apiRequest(`${n8nBaseUrl}/executions?limit=10&workflowId=${workflowId}`, {
      headers: headers(),
    });
    const execution = Array.isArray(json?.data) ? json.data[0] : null;
    if (execution?.id && execution.finished) {
      return execution;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out waiting for execution ${workflowId}`);
}

async function loginDashboard() {
  const response = await fetch('https://sp-hr.zeabur.app/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: dashboardPassword }),
  });
  const cookie = (response.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) {
    throw new Error('Dashboard login failed');
  }
  return cookie;
}

async function fetchDashboard(cookie) {
  const response = await fetch('https://sp-hr.zeabur.app/api/hr-dashboard', {
    headers: { Cookie: cookie },
  });
  const { json } = await parseJsonResponse(response);
  return json;
}

function loadWorkflow(prefix) {
  const dir = path.join(root, 'n8n');
  const file = fs.readdirSync(dir).find((name) => name.startsWith(prefix));
  if (!file) throw new Error(`Cannot find ${prefix}`);
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

function cloneNode(workflow, id) {
  const node = workflow.nodes.find((entry) => entry.id === id);
  if (!node) throw new Error(`Missing node ${id}`);
  return JSON.parse(JSON.stringify(node));
}

const candidateDataset = [
  {
    candidate_name: '阮黎玉挴',
    applied_position: 'RF測試工程師',
    department: 'WBU',
    status: 'pending_review',
    interview_status: 'scheduled',
    intent: 'request_invite',
    round: 1,
    interview_date: 'null',
    interview_time: 'null',
    location: 'null',
    hr_owner: 'Peggy Lee',
    email_subject: '履歷推薦【RF測試工程師】– 阮黎玉挴',
    email_msg_id: 'manual-fix-20260603-ruan-li-yu-mei',
    email_web_link: '',
    sender: 'Peggylee@sporton.com.tw',
    received_at: '2026-06-03T02:19:15Z',
  },
  {
    candidate_name: '藍右霖',
    applied_position: 'SAR測試工程師',
    department: 'WBU',
    status: 'in_progress',
    interview_status: 'scheduled',
    intent: 'schedule',
    round: 1,
    interview_date: '2026-06-05',
    interview_time: '10:00',
    location: 'null',
    hr_owner: 'Peggy Lee',
    email_subject: '面試時間【SAR測試工程師】- 藍右霖',
    email_msg_id: 'manual-fix-20260603-lan-you-lin',
    email_web_link: '',
    sender: 'Peggylee@sporton.com.tw',
    received_at: '2026-06-03T01:14:43Z',
  },
  {
    candidate_name: '劉謩瑜',
    applied_position: 'RF PM',
    department: 'WBU',
    status: 'in_progress',
    interview_status: 'scheduled',
    intent: 'schedule',
    round: 1,
    interview_date: '2026-06-04',
    interview_time: '14:00',
    location: 'null',
    hr_owner: 'Evan Huang',
    email_subject: '面試時間【RF PM】-劉謩瑜',
    email_msg_id: 'manual-fix-20260603-liu-mo-yu',
    email_web_link: '',
    sender: 'EvanHuang@sporton.com.tw',
    received_at: '2026-06-03T02:17:00Z',
  },
];

const onboardingDataset = [
  {
    email_msg_id: 'manual-fix-20260603-hu-cai-ying',
    email_subject: '【新進人員通知】五部  業務本部：胡采穎，預計於2026/7/6(一) 報到',
    email_web_link: '',
    sender: 'Yen@sporton.com.tw',
    received_at: '2026-06-03T03:39:40Z',
    source_type: 'onboarding',
    name: '胡采穎',
    scheduled_onboard_date: '2026-07-06',
    department: 'WBU / 業務本部',
    position: '業務專員',
    hr_owner: 'Yen Chen',
    intent: 'new_onboard',
  },
  {
    email_msg_id: 'manual-fix-20260603-chen-ze-ying',
    email_subject: '【新進人員通知】五部  SAR工程部：陳則穎，預計於2026/6/15(一) 報到',
    email_web_link: '',
    sender: 'Yen@sporton.com.tw',
    received_at: '2026-06-03T02:48:30Z',
    source_type: 'onboarding',
    name: '陳則穎',
    scheduled_onboard_date: '2026-06-15',
    department: 'WBU / SAR工程部',
    position: '工程師',
    hr_owner: 'Yen Chen',
    intent: 'new_onboard',
  },
];

async function runTempWorkflow(name, dataset, nodeChain) {
  const webhookPath = `tmp-${name}-${crypto.randomBytes(4).toString('hex')}`;
  const webhookName = `Webhook:${name}`;
  const codeName = `Code:${name}`;

  const webhook = {
    id: `tmp-webhook-${name}`,
    name: webhookName,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [240, 240],
    webhookId: `tmp-${name}-${crypto.randomBytes(8).toString('hex')}`,
    parameters: {
      httpMethod: 'POST',
      path: webhookPath,
      responseMode: 'onReceived',
    },
  };

  const code = {
    id: `tmp-code-${name}`,
    name: codeName,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [480, 240],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `return ${JSON.stringify(dataset, null, 2)}.map((json) => ({ json }));`,
    },
  };

  nodeChain.forEach((node, index) => {
    node.position = [760 + index * 260, 240];
  });

  const connections = {
    [webhookName]: {
      main: [[{ node: codeName, type: 'main', index: 0 }]],
    },
    [codeName]: {
      main: [[{ node: nodeChain[0].name, type: 'main', index: 0 }]],
    },
  };

  for (let i = 0; i < nodeChain.length - 1; i += 1) {
    connections[nodeChain[i].name] = {
      main: [[{ node: nodeChain[i + 1].name, type: 'main', index: 0 }]],
    };
  }

  const create = await apiRequest(`${n8nBaseUrl}/workflows`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      name: `tmp-${name}`,
      nodes: [webhook, code, ...nodeChain],
      connections,
      settings: { executionOrder: 'v1' },
    }),
  });

  try {
    await activateWorkflow(create.id);
    const webhookUrl = `${new URL(n8nBaseUrl).origin}/webhook/${webhookPath}`;
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: name }),
    });
    return await waitForExecution(create.id);
  } finally {
    await deleteWorkflow(create.id);
  }
}

const workflow1 = loadWorkflow('live_Workflow1_');
const workflow3 = loadWorkflow('live_Workflow3_');

const candidateExecution = await runTempWorkflow('candidate-backfill-20260603', candidateDataset, [
  cloneNode(workflow1, 'cba3f36b-e5f5-44fb-afc5-044fb48f95fb'),
  cloneNode(workflow1, '5c73b5bf-0b4b-47bc-95b1-a51cbbd1c70d'),
  cloneNode(workflow1, 'b6402442-fddf-4724-abd5-59e7044c691d'),
]);

const onboardingExecution = await runTempWorkflow('onboarding-backfill-20260603', onboardingDataset, [
  cloneNode(workflow3, '177e2c15-35cf-4cd3-8976-f1911ddf98c1'),
  cloneNode(workflow3, '8a85255a-4e76-4306-9f6a-4af77c64c66f'),
]);

const cookie = await loginDashboard();
const dashboard = await fetchDashboard(cookie);
const candidateNames = new Set((dashboard.candidatesData || []).map((item) => item.name));
const scheduleNames = new Set((dashboard.schedEvents || []).map((item) => item.name));
const onboardNames = new Set((dashboard.onboardData || []).map((item) => item.name));

console.log(
  JSON.stringify(
    {
      candidateExecution: { id: candidateExecution.id, status: candidateExecution.status },
      onboardingExecution: { id: onboardingExecution.id, status: onboardingExecution.status },
      verification: {
        candidates: candidateDataset.map((item) => ({
          name: item.candidate_name,
          inCandidates: candidateNames.has(item.candidate_name),
          inSchedule: scheduleNames.has(item.candidate_name),
        })),
        onboardings: onboardingDataset.map((item) => ({
          name: item.name,
          inOnboard: onboardNames.has(item.name),
          inSchedule: scheduleNames.has(item.name),
        })),
      },
    },
    null,
    2,
  ),
);
