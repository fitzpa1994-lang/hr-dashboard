import process from 'node:process';

const baseUrl = String(process.env.N8N_API_BASE_URL || process.env.N8N_API_URL || '').trim().replace(/\/+$/, '');
const apiKey = String(process.env.N8N_API_KEY || '').trim();
const workflowId = String(process.argv[2] || '').trim();
const startNode = String(process.argv[3] || 'manual-trigger').trim();
const timeoutMs = Number(process.argv[4] || 600000);

if (!baseUrl) throw new Error('Missing N8N_API_BASE_URL');
if (!apiKey) throw new Error('Missing N8N_API_KEY');
if (!workflowId) throw new Error('Missing workflowId argv[2]');

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-N8N-API-KEY': apiKey,
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

async function triggerRun() {
  return apiRequest(`${baseUrl}/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      startNodes: [startNode],
    }),
  });
}

async function waitForExecution(runId) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const json = await apiRequest(`${baseUrl}/executions/${runId}`, {
      headers: headers(),
    });
    if (json?.finished) return json;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Timed out waiting for workflow ${workflowId} execution ${runId}`);
}

const run = await triggerRun();
const runId = String(run?.data?.executionId || run?.executionId || run?.id || '').trim();
if (!runId) {
  throw new Error(`Workflow ${workflowId} run endpoint did not return an execution id: ${JSON.stringify(run)}`);
}

const execution = await waitForExecution(runId);

console.log(JSON.stringify({
  workflowId,
  executionId: runId,
  finished: execution.finished ?? null,
  mode: execution.mode ?? null,
  status: execution.status ?? null,
  startedAt: execution.startedAt ?? null,
  stoppedAt: execution.stoppedAt ?? null,
  success: execution.success ?? null,
}, null, 2));
