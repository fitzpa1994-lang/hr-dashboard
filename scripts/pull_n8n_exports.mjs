// 線上 → 本地：抓取 n8n workflow 覆寫本地快照（deploy_n8n_export.mjs 的反向操作）。
// 用法：node scripts/pull_n8n_exports.mjs [檔名...]（預設抓 KNOWN_WORKFLOWS 全部）
// 在 n8n UI 或 API 改過線上之後執行，接著 commit 快照，維持「快照＝線上」的不變式。
import fs from 'node:fs';
import path from 'node:path';
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

const requested = process.argv.slice(2).map((f) => path.basename(f));
const targets = requested.length ? requested : [...KNOWN_WORKFLOWS.keys()];

for (const fileName of targets) {
  const workflowId = KNOWN_WORKFLOWS.get(fileName);
  if (!workflowId) {
    console.error(`跳過 ${fileName}：不在 KNOWN_WORKFLOWS 對照表`);
    continue;
  }
  const res = await fetch(`${baseUrl}/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': apiKey },
  });
  if (!res.ok) {
    console.error(`GET ${fileName} 失敗：${res.status}`);
    process.exitCode = 1;
    continue;
  }
  const wf = await res.json();
  const outPath = path.join(ROOT, 'n8n', fileName);
  fs.writeFileSync(outPath, JSON.stringify(wf, null, 2) + '\n');
  console.log(`已同步 ${fileName}（updatedAt=${wf.updatedAt}, active=${wf.active}, nodes=${wf.nodes.length}）`);
}
