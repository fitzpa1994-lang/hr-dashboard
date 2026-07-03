// 唯讀比對工具：抓取線上 n8n workflow，與本地 n8n/*.json 快照逐節點比對。
// 用途：接手／部署前確認「本地快照 vs 線上實況」是否同步。
// 用法：node scripts/audit_live_vs_local.mjs [檔名...]（預設比對 KNOWN_WORKFLOWS 全部）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';

const ROOT = process.cwd();

const KNOWN_WORKFLOWS = new Map([
  ['live_Workflow1_面試解析.json', 'pqnpr72wTiOE2m8I'],
  ['live_Workflow3_到職離職.json', 'zEIwksk6hz9Ri8NA'],
  ['live_Dashboard_API.json', 'x4Olor5YtMfthzWp'],
  ['live_Job_Requisition_Write.json', '3aaTC9KMPXTZ1tP6'],
  ['live_temp_db_check.json', 'uyDXjECy9kPFaFUy'],
]);

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

const fileEnv = parseEnvFile(path.join(ROOT, '.env'));
const baseUrl = String(
  process.env.N8N_API_BASE_URL || fileEnv.N8N_API_BASE_URL ||
  process.env.N8N_API_URL || fileEnv.N8N_API_URL || ''
).trim().replace(/\/+$/, '');
const apiKey = String(process.env.N8N_API_KEY || fileEnv.N8N_API_KEY || '').trim();

if (!baseUrl || !apiKey) {
  console.error('缺少 N8N_API_BASE_URL 或 N8N_API_KEY（請填寫專案根目錄 .env）');
  process.exit(1);
}

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

function hash(value) {
  return crypto.createHash('sha1').update(stableStringify(value)).digest('hex').slice(0, 10);
}

function lineCount(text) {
  return String(text ?? '').split('\n').length;
}

function firstDiffLine(a, b) {
  const la = String(a ?? '').split('\n');
  const lb = String(b ?? '').split('\n');
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i += 1) {
    if (la[i] !== lb[i]) return i + 1;
  }
  return null;
}

function diffParameterKeys(localParams = {}, liveParams = {}) {
  const keys = new Set([...Object.keys(localParams), ...Object.keys(liveParams)]);
  const diffs = [];
  for (const key of keys) {
    const localVal = localParams[key];
    const liveVal = liveParams[key];
    if (stableStringify(localVal) === stableStringify(liveVal)) continue;
    if (typeof localVal === 'string' || typeof liveVal === 'string') {
      diffs.push(
        `${key}（local ${lineCount(localVal)} 行 / live ${lineCount(liveVal)} 行，第 ${firstDiffLine(localVal, liveVal) ?? '?'} 行起不同）`,
      );
    } else {
      diffs.push(key);
    }
  }
  return diffs;
}

async function fetchLiveWorkflow(workflowId) {
  const url = `${baseUrl}/workflows/${workflowId}`;
  const res = await fetch(url, { headers: { 'X-N8N-API-KEY': apiKey } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${url} failed: status=${res.status}; body=${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

function compareWorkflow(fileName, local, live) {
  const findings = [];
  const localNodes = new Map((local.nodes || []).map((n) => [n.name, n]));
  const liveNodes = new Map((live.nodes || []).map((n) => [n.name, n]));

  for (const name of localNodes.keys()) {
    if (!liveNodes.has(name)) findings.push(`✖ 線上缺少節點：「${name}」（僅存在本地）`);
  }
  for (const name of liveNodes.keys()) {
    if (!localNodes.has(name)) findings.push(`✖ 本地缺少節點：「${name}」（僅存在線上）`);
  }

  for (const [name, localNode] of localNodes) {
    const liveNode = liveNodes.get(name);
    if (!liveNode) continue;
    if (localNode.type !== liveNode.type) {
      findings.push(`✖ 節點「${name}」type 不同：local=${localNode.type} live=${liveNode.type}`);
      continue;
    }
    if (Boolean(localNode.disabled) !== Boolean(liveNode.disabled)) {
      findings.push(`✖ 節點「${name}」disabled 狀態不同：local=${Boolean(localNode.disabled)} live=${Boolean(liveNode.disabled)}`);
    }
    if (hash(localNode.parameters ?? {}) !== hash(liveNode.parameters ?? {})) {
      const keys = diffParameterKeys(localNode.parameters, liveNode.parameters);
      findings.push(`✖ 節點「${name}」參數不同：${keys.join('、')}`);
    }
  }

  if (hash(local.connections ?? {}) !== hash(live.connections ?? {})) {
    findings.push('✖ connections（節點接線）不同');
  }
  if (local.name && live.name && local.name !== live.name) {
    findings.push(`✖ workflow 名稱不同：local="${local.name}" live="${live.name}"`);
  }
  return findings;
}

async function main() {
  const requested = process.argv.slice(2);
  const targets = requested.length
    ? requested.map((f) => path.basename(f))
    : [...KNOWN_WORKFLOWS.keys()];

  const summary = [];
  for (const fileName of targets) {
    const workflowId = KNOWN_WORKFLOWS.get(fileName);
    console.log(`\n== ${fileName}${workflowId ? ` (${workflowId})` : ''} ==`);
    if (!workflowId) {
      console.log('  跳過：不在 KNOWN_WORKFLOWS 對照表中');
      summary.push({ fileName, verdict: 'SKIPPED' });
      continue;
    }
    const localPath = path.join(ROOT, 'n8n', fileName);
    if (!fs.existsSync(localPath)) {
      console.log(`  跳過：本地檔不存在 ${localPath}`);
      summary.push({ fileName, verdict: 'NO_LOCAL_FILE' });
      continue;
    }
    const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    let live;
    try {
      live = await fetchLiveWorkflow(workflowId);
    } catch (err) {
      console.log(`  取得線上資料失敗：${err.message}`);
      summary.push({ fileName, verdict: 'FETCH_ERROR' });
      continue;
    }
    console.log(`  live: name="${live.name}" active=${live.active} updatedAt=${live.updatedAt}`);
    console.log(`  nodes: local ${local.nodes?.length ?? 0} / live ${live.nodes?.length ?? 0}`);
    const findings = compareWorkflow(fileName, local, live);
    if (findings.length === 0) {
      console.log('  ✔ 本地快照與線上一致（節點、參數、接線）');
      summary.push({ fileName, verdict: 'IN_SYNC', active: live.active });
    } else {
      for (const f of findings) console.log(`  ${f}`);
      summary.push({ fileName, verdict: `DIFFERS (${findings.length})`, active: live.active });
    }
  }

  console.log('\n===== 總結 =====');
  for (const row of summary) {
    console.log(`  ${row.verdict.padEnd(14)} ${row.fileName}${row.active !== undefined ? `（active=${row.active}）` : ''}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
