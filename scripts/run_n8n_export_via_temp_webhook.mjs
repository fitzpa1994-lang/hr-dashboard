import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

const root = process.cwd();
const baseUrl = String(process.env.N8N_API_BASE_URL || process.env.N8N_API_URL || '').trim().replace(/\/+$/, '');
const apiKey = String(process.env.N8N_API_KEY || '').trim();
const exportArg = String(process.argv[2] || '').trim();
const timeoutMs = Number(process.argv[3] || 900000);

if (!baseUrl) throw new Error('Missing N8N_API_BASE_URL');
if (!apiKey) throw new Error('Missing N8N_API_KEY');
if (!exportArg) throw new Error('Missing export path argv[2]');

const exportPath = path.isAbsolute(exportArg) ? exportArg : path.join(root, exportArg);
if (!fs.existsSync(exportPath)) throw new Error(`Export file not found: ${exportPath}`);

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

async function activateWorkflow(id) {
  try {
    await apiRequest(`${baseUrl}/workflows/${id}/activate`, {
      method: 'POST',
      headers: headers(),
    });
  } catch {
    await apiRequest(`${baseUrl}/workflows/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ active: true }),
    });
  }
}

async function deleteWorkflow(id) {
  const response = await fetch(`${baseUrl}/workflows/${id}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`DELETE workflow ${id} failed: status=${response.status}; body=${text.slice(0, 300)}`);
  }
}

async function waitForExecution(workflowId) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const json = await apiRequest(`${baseUrl}/executions?limit=10&workflowId=${workflowId}`, {
      headers: headers(),
    });
    const execution = Array.isArray(json?.data) ? json.data[0] : null;
    if (execution?.id && execution.finished) return execution;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Timed out waiting for temp workflow execution ${workflowId}`);
}

function buildTempWorkflow() {
  const source = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  const manual = source.nodes.find((node) => String(node.type || '') === 'n8n-nodes-base.manualTrigger');
  if (!manual) throw new Error(`No manualTrigger node in ${path.basename(exportPath)}`);

  const manualConnections = source.connections?.[manual.name];
  if (!manualConnections?.main?.length) {
    throw new Error(`manualTrigger ${manual.name} has no downstream connections`);
  }

  const webhookName = `Webhook：temp-run-${crypto.randomBytes(4).toString('hex')}`;
  const webhookPath = `tmp-run-${crypto.randomBytes(8).toString('hex')}`;
  const webhookNode = {
    id: `tmp-webhook-${crypto.randomBytes(8).toString('hex')}`,
    name: webhookName,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: manual.position || [240, 240],
    webhookId: `tmp-run-${crypto.randomBytes(8).toString('hex')}`,
    parameters: {
      httpMethod: 'POST',
      path: webhookPath,
      responseMode: 'onReceived',
    },
  };

  const nodes = source.nodes
    .filter((node) => node.name !== manual.name)
    .map((node) => JSON.parse(JSON.stringify(node)));
  nodes.unshift(webhookNode);

  const connections = JSON.parse(JSON.stringify(source.connections || {}));
  delete connections[manual.name];
  connections[webhookName] = manualConnections;

  return {
    webhookPath,
    payload: {
      name: `tmp-run-${path.basename(exportPath, '.json')}`,
      nodes,
      connections,
      settings: source.settings?.executionOrder
        ? { executionOrder: source.settings.executionOrder }
        : { executionOrder: 'v1' },
    },
  };
}

const { webhookPath, payload } = buildTempWorkflow();
const created = await apiRequest(`${baseUrl}/workflows`, {
  method: 'POST',
  headers: headers(),
  body: JSON.stringify(payload),
});

const workflowId = created.id;
if (!workflowId) throw new Error('Temporary workflow creation returned no id');

try {
  await activateWorkflow(workflowId);
  const webhookUrl = `${new URL(baseUrl).origin}/webhook/${webhookPath}`;
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'codex-temp-workflow-run', exportPath: path.basename(exportPath) }),
  });
  const parsed = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(`POST ${webhookUrl} failed: status=${response.status}; body=${parsed.text.slice(0, 500)}`);
  }

  const execution = await waitForExecution(workflowId);

  console.log(JSON.stringify({
    exportPath,
    workflowId,
    executionId: execution.id ?? null,
    status: execution.status ?? null,
    success: execution.success ?? null,
    startedAt: execution.startedAt ?? null,
    stoppedAt: execution.stoppedAt ?? null,
  }, null, 2));
} finally {
  await deleteWorkflow(workflowId);
}
