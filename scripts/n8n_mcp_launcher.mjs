// 以專案 .env 的憑證啟動 n8n-mcp（stdio 模式）。
// .mcp.json 只指向本檔案，因此金鑰只存在 .env，不會進 git。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  console.error('[n8n_mcp_launcher] 缺少 N8N_API_BASE_URL 或 N8N_API_KEY，請先填寫專案根目錄的 .env');
  process.exit(1);
}

const require = createRequire(import.meta.url);
let binPath;
try {
  const pkgPath = require.resolve('n8n-mcp/package.json', { paths: [ROOT] });
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['n8n-mcp'];
  binPath = path.join(path.dirname(pkgPath), bin);
} catch {
  console.error('[n8n_mcp_launcher] 找不到 n8n-mcp 套件，請先在專案根目錄執行 npm install');
  process.exit(1);
}

const child = spawn(process.execPath, [binPath], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    MCP_MODE: 'stdio',
    LOG_LEVEL: 'error',
    DISABLE_CONSOLE_OUTPUT: 'true',
    // n8n-mcp 要的是實例根網址（它會自行加上 /api/v1）
    N8N_API_URL: baseUrl.replace(/\/api\/v1$/, ''),
    N8N_API_KEY: apiKey,
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
