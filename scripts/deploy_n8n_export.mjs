import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const DEFAULT_BASE_URL = process.env.N8N_API_BASE_URL || process.env.N8N_API_URL || '';
const DEFAULT_API_KEY = process.env.N8N_API_KEY || '';

const KNOWN_WORKFLOWS = new Map([
  ['live_Workflow1_面試解析.json', 'pqnpr72wTiOE2m8I'],
  ['live_Workflow3_到職離職.json', 'zEIwksk6hz9Ri8NA'],
  ['live_Dashboard_API.json', 'x4Olor5YtMfthzWp'],
  ['live_Job_Requisition_Write.json', '3aaTC9KMPXTZ1tP6'],
  ['live_temp_db_check.json', 'uyDXjECy9kPFaFUy'],
]);

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function resolveExportPath(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('Missing export path. Pass a file path such as n8n/live_Workflow3_到職離職.json');
  }
  return path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
}

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

async function main() {
  const exportPath = resolveExportPath(process.argv[2]);
  const baseUrl = normalizeBaseUrl(process.argv[3] || DEFAULT_BASE_URL);
  const apiKey = String(process.argv[4] || DEFAULT_API_KEY).trim();

  if (!fs.existsSync(exportPath)) {
    throw new Error(`Export file not found: ${exportPath}`);
  }
  if (!baseUrl) {
    throw new Error('Missing N8N API base URL. Set N8N_API_BASE_URL or pass argv[3].');
  }
  if (!apiKey) {
    throw new Error('Missing N8N API key. Set N8N_API_KEY or pass argv[4].');
  }

  const fileName = path.basename(exportPath);
  const workflowId = process.argv[5] || KNOWN_WORKFLOWS.get(fileName);
  if (!workflowId) {
    throw new Error(`Missing workflow ID for ${fileName}. Pass it as argv[5].`);
  }

  const body = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  const url = `${baseUrl}/workflows/${workflowId}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-N8N-API-KEY': apiKey,
  };

  const getResult = await requestJson(url, { headers });
  if (!getResult.res.ok) {
    throw new Error(`GET ${url} failed: status=${getResult.res.status}; body=${getResult.text.slice(0, 200)}`);
  }

  const live = getResult.json || {};
  const payload = {
    name: body.name,
    nodes: body.nodes,
    connections: body.connections,
  };
  if (body.settings?.executionOrder) {
    payload.settings = { executionOrder: body.settings.executionOrder };
  }

  if (!payload.name || !Array.isArray(payload.nodes) || !payload.connections) {
    throw new Error(`Export ${fileName} is missing required workflow fields`);
  }

  const putResult = await requestJson(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });

  if (!putResult.res.ok) {
    throw new Error(`PUT ${url} failed: status=${putResult.res.status}; body=${putResult.text.slice(0, 200)}`);
  }

  const after = putResult.json || {};
  console.log(JSON.stringify({
    workflowId,
    exportPath,
    fileName,
    name: after.name || body.name,
    active: after.active ?? live.active ?? body.active ?? false,
    updatedAt: after.updatedAt || null,
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
