import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

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

function responseError(label, url, result) {
  return new Error(
    `${label} ${url} failed: status=${result.res.status}; body=${result.text.slice(0, 200)}`,
  );
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

export function usesVersionedPublishing(workflow) {
  return hasOwn(workflow, 'activeVersionId') || hasOwn(workflow, 'activeVersion');
}

export function publishedVersionId(workflow) {
  return workflow?.activeVersionId || workflow?.activeVersion?.versionId || null;
}

export function isWorkflowPublished(workflow, versioned = usesVersionedPublishing(workflow)) {
  return versioned ? Boolean(publishedVersionId(workflow)) : workflow?.active === true;
}

function normalizeQuery(value) {
  return String(value ?? '').replace(/\r\n/g, '\n');
}

function queryNodeKey(node) {
  return node?.id ? `id:${node.id}` : `name:${node?.name || ''}`;
}

function collectQueries(nodes) {
  const queries = new Map();
  for (const node of nodes || []) {
    if (typeof node?.parameters?.query !== 'string') continue;
    queries.set(queryNodeKey(node), {
      name: node.name || node.id || '(unnamed query node)',
      query: normalizeQuery(node.parameters.query),
    });
  }
  return queries;
}

export function assertWorkflowQueriesEqual(expectedNodes, actualNodes, label = 'workflow') {
  if (!Array.isArray(actualNodes)) {
    throw new Error(`${label}: response is missing nodes needed to verify deployed queries`);
  }

  const expected = collectQueries(expectedNodes);
  const actual = collectQueries(actualNodes);
  if (expected.size !== actual.size) {
    throw new Error(
      `${label}: query node count mismatch; expected=${expected.size}; actual=${actual.size}`,
    );
  }

  for (const [key, expectedNode] of expected) {
    const actualNode = actual.get(key);
    if (!actualNode) {
      throw new Error(`${label}: active workflow is missing query node "${expectedNode.name}"`);
    }
    if (actualNode.query !== expectedNode.query) {
      throw new Error(`${label}: deployed query differs for node "${expectedNode.name}"`);
    }
  }
}

async function freshWorkflow(url, headers, requestJsonFn, label = 'GET') {
  const result = await requestJsonFn(url, { headers });
  if (!result.res.ok) throw responseError(label, url, result);
  return result.json || {};
}

function assertSavedVersion(current, savedVersionId, workflowId) {
  if (current.versionId !== savedVersionId) {
    throw new Error(
      `Workflow ${workflowId} changed after PUT: saved version=${savedVersionId}; current version=${current.versionId || 'missing'}. Refusing to publish a possibly concurrent edit.`,
    );
  }
}

export async function deployAndVerifyWorkflow({
  url,
  headers,
  workflowId,
  payload,
  live,
  requestJsonFn = requestJson,
}) {
  const versioned = usesVersionedPublishing(live);
  const wasPublished = isWorkflowPublished(live, versioned);
  const putResult = await requestJsonFn(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });

  if (!putResult.res.ok) throw responseError('PUT', url, putResult);

  const saved = putResult.json || {};
  const savedVersionId = saved.versionId || null;
  if (versioned && !savedVersionId) {
    throw new Error(
      `PUT ${url} returned no versionId; refusing to guess which saved version should be published`,
    );
  }

  let verified = await freshWorkflow(url, headers, requestJsonFn, 'GET after PUT');

  if (versioned) {
    assertSavedVersion(verified, savedVersionId, workflowId);

    if (wasPublished && publishedVersionId(verified) !== savedVersionId) {
      const currentPublishedVersionId = publishedVersionId(verified);
      // Current n8n atomically republishes an already-published workflow during
      // PUT. A lagging/different active version therefore indicates a failed or
      // concurrent publication decision. The public API has no conditional
      // activate operation, so a follow-up POST would have a TOCTOU race and
      // could overwrite a human unpublish/publish action.
      throw new Error(
        `Workflow ${workflowId} active version did not advance to the saved version after PUT: saved=${savedVersionId}; active=${currentPublishedVersionId || 'none'}. Refusing to publish automatically.`,
      );
    }

    const activeVersionId = publishedVersionId(verified);
    if (wasPublished && activeVersionId !== savedVersionId) {
      throw new Error(
        `Workflow ${workflowId} publish verification failed: saved version=${savedVersionId}; active version=${activeVersionId || 'missing'}`,
      );
    }
    if (!wasPublished && activeVersionId) {
      throw new Error(
        `Workflow ${workflowId} was unpublished before deployment but is now published as ${activeVersionId}`,
      );
    }
  } else if (wasPublished && verified.active !== true) {
    // Legacy n8n cannot address a specific saved version when publishing.
    // PUT normally preserves active=true, so a true -> false transition may be
    // a concurrent human action and must never be overwritten automatically.
    throw new Error(
      `Workflow ${workflowId} became inactive after PUT; refusing to reactivate it without a version-addressable publication check`,
    );
  }

  if (!versioned) {
    if (!wasPublished && verified.active === true) {
      throw new Error(`Workflow ${workflowId} was inactive before deployment but is now active`);
    }
  }

  const deployedNodes = versioned && wasPublished
    ? verified.activeVersion?.nodes
    : verified.nodes;
  assertWorkflowQueriesEqual(
    payload.nodes,
    deployedNodes,
    versioned && wasPublished ? 'activeVersion' : 'saved workflow',
  );

  return {
    saved,
    verified,
    savedVersionId,
    activeVersionId: publishedVersionId(verified),
    versioned,
    wasPublished,
  };
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

  const deployment = await deployAndVerifyWorkflow({
    url,
    headers,
    workflowId,
    payload,
    live,
  });
  const after = deployment.verified;
  console.log(JSON.stringify({
    workflowId,
    exportPath,
    fileName,
    name: after.name || body.name,
    active: after.active ?? deployment.wasPublished,
    versionId: deployment.savedVersionId,
    activeVersionId: deployment.activeVersionId,
    publishMode: deployment.versioned ? 'versioned' : 'legacy',
    publishedBeforeDeploy: deployment.wasPublished,
    verifiedQueries: true,
    updatedAt: after.updatedAt || null,
  }, null, 2));
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch(error => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}
