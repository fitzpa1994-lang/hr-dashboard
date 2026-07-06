// 唯讀：調出指定關鍵字信件的內文（驗證 AI 判讀）
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const KEYWORD = process.argv[2];
if (!KEYWORD) { console.error('用法：node tmp_read_bodies.mjs <主旨關鍵字>'); process.exit(1); }

const ROOT = process.cwd();
const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
  .filter(Boolean).map((m) => [m[1], m[2].trim()]));
const base = env.N8N_API_BASE_URL.replace(/\/+$/, '');
const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };

const filter = encodeURIComponent(`contains(subject,'${KEYWORD}')`);
const url = `https://graph.microsoft.com/v1.0/me/messages?$filter=${filter}&$select=subject,receivedDateTime,body&$top=20`;
const hookPath = `tmp-bodies-${crypto.randomBytes(6).toString('hex')}`;

async function api(pathname, options = {}) {
  const res = await fetch(`${base}${pathname}`, { headers, ...options });
  const text = await res.text();
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${pathname} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const wf = await api('/workflows', {
  method: 'POST',
  body: JSON.stringify({
    name: 'tmp-read-bodies',
    nodes: [
      { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0],
        parameters: { httpMethod: 'POST', path: hookPath, responseMode: 'lastNode' } },
      { id: 'g', name: 'Graph', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [260, 0],
        parameters: { method: 'GET', url, authentication: 'predefinedCredentialType', nodeCredentialType: 'microsoftOutlookOAuth2Api', options: {} },
        credentials: { microsoftOutlookOAuth2Api: { id: 'gRnSdH5u4gDyDZzB', name: 'Microsoft Outlook account' } } },
    ],
    connections: { Webhook: { main: [[{ node: 'Graph', type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1' },
  }),
});
try {
  await api(`/workflows/${wf.id}/activate`, { method: 'POST' });
  const res = await fetch(`${new URL(base).origin}/webhook/${hookPath}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`webhook -> ${res.status}: ${text.slice(0, 300)}`);
  const msgs = (JSON.parse(text).value || []).sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime));
  for (const m of msgs) {
    const body = String(m.body?.content || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400);
    console.log(`\n===== ${m.receivedDateTime.slice(0, 16)}  ${m.subject.trim()}`);
    console.log(body);
  }
} finally {
  await fetch(`${base}/workflows/${wf.id}`, { method: 'DELETE', headers });
}
