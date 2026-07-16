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
  ['live_Error_Logger.json', 'IwBeD1aQaqpBcxFx'],
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

// Guard: CTE names defined in one SQL statement must not be referenced in a later statement.
// PostgreSQL scopes CTEs to their own statement; cross-; references silently fail at runtime.
function validateNoCteCrossStatementRefs(query, nodeName) {
  // Split on top-level semicolons (ignore those inside string literals)
  const stmts = [];
  let cur = '', depth = 0, inStr = false, strChar = '';
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (inStr) {
      cur += ch;
      if (ch === strChar && query[i - 1] !== '\\') inStr = false;
    } else if (ch === "'" || ch === '"') {
      inStr = true; strChar = ch; cur += ch;
    } else if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth--; cur += ch; }
    else if (ch === ';' && depth === 0) { stmts.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  if (cur.trim()) stmts.push(cur.trim());

  // Collect CTE names from each statement (WITH name AS ...)
  const ctePat = /\bWITH\b[\s\S]*?\b(\w+)\s+AS\s*\(/gi;
  const stmtCtes = stmts.map(s => {
    const names = new Set();
    let m;
    const localPat = /(?:WITH|,)\s+(\w+)\s+AS\s*\(/gi;
    while ((m = localPat.exec(s)) !== null) names.add(m[1].toLowerCase());
    return names;
  });

  const errors = [];
  for (let i = 1; i < stmts.length; i++) {
    const stmt = stmts[i].toLowerCase();
    for (let j = 0; j < i; j++) {
      for (const cte of stmtCtes[j]) {
        // Check for reference: FROM cte or JOIN cte or (SELECT ... FROM cte)
        const refPat = new RegExp(`\\b(?:from|join)\\s+${cte}\\b`);
        if (refPat.test(stmt)) {
          errors.push(`Node "${nodeName}": CTE "${cte}" defined in statement ${j + 1} is referenced in statement ${i + 1} — cross-statement CTE refs fail in PostgreSQL.`);
        }
      }
    }
  }
  return errors;
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

  // Pre-deploy SQL validation: catch cross-statement CTE references
  const sqlErrors = [];
  for (const node of payload.nodes) {
    const q = node.parameters?.query;
    if (typeof q === 'string' && q.includes(';')) {
      sqlErrors.push(...validateNoCteCrossStatementRefs(q, node.name));
    }
  }
  if (sqlErrors.length) {
    throw new Error('SQL validation failed — fix before deploying:\n' + sqlErrors.join('\n'));
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
