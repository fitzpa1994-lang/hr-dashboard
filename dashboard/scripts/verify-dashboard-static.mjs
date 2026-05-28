import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(dashboardDir, 'index.html'), 'utf8');
const serverJs = fs.readFileSync(path.join(dashboardDir, 'server.js'), 'utf8');

const errors = [];

function expectIncludes(source, needle, label) {
  if (!source.includes(needle)) errors.push(`missing ${label}: ${needle}`);
}

function expectNotIncludes(source, needle, label) {
  if (source.includes(needle)) errors.push(`unexpected ${label}: ${needle}`);
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function expectCount(source, pattern, expected, label) {
  const actual = countMatches(source, pattern);
  if (actual !== expected) errors.push(`${label}: expected ${expected}, got ${actual}`);
}

function inlineScripts(html) {
  const scripts = [];
  let rest = html;
  while (rest.includes('<script')) {
    rest = rest.slice(rest.indexOf('<script'));
    rest = rest.slice(rest.indexOf('>') + 1);
    const end = rest.indexOf('</script>');
    scripts.push(rest.slice(0, end));
    rest = rest.slice(end + 9);
  }
  return scripts;
}

for (const script of inlineScripts(indexHtml)) {
  try {
    parse(script, { sourceType: 'script' });
  } catch (error) {
    errors.push(`inline script parse failed: ${error.message}`);
  }
}

expectNotIncludes(indexHtml, '示意版', 'demo label');
expectIncludes(indexHtml, 'id="last-updated"', 'last updated indicator');
expectIncludes(indexHtml, 'id="refresh-btn"', 'manual refresh button');
expectIncludes(indexHtml, 'logoutDashboard()', 'logout action');
expectIncludes(indexHtml, 'id="global-search"', 'global search input');
expectIncludes(indexHtml, "setCandF('pending_review'", 'pending review filter');
expectNotIncludes(indexHtml, "setCandF('no_response'", 'unsupported no_response filter');
expectNotIncludes(indexHtml, 'no_response', 'unsupported no_response status remnants');
expectIncludes(indexHtml, 'chart-empty', 'empty chart overlay');
expectIncludes(indexHtml, 'departmentStats', 'department stats chart data');
expectIncludes(indexHtml, 'openScheduleItem', 'schedule card click fallback');
expectIncludes(indexHtml, '本週離職（至週日）', 'explicit resignation date range');
expectIncludes(indexHtml, '待到職 <span', 'split pending onboard section');
expectIncludes(indexHtml, '已到職 <span', 'split completed onboard section');
expectIncludes(indexHtml, 'email_web_link 為空', 'missing Outlook link explanation');
expectIncludes(indexHtml, 'resumeLink 為空', 'missing resume link explanation');
expectIncludes(indexHtml, 'history.replaceState', 'tab URL hash sync');
expectIncludes(indexHtml, 'fetchWithTimeout', 'network timeout handling');
expectIncludes(indexHtml, 'window.hrShowLogin = showLogin', 'expired session login recovery hook');
expectIncludes(indexHtml, 'res.status === 401', 'expired session detection');
expectIncludes(indexHtml, '登入狀態已過期', 'expired session user message');
expectIncludes(indexHtml, 'function toLocalISODate', 'local date formatter for Taiwan timezone');
expectNotIncludes(indexHtml, 'weekEnd.toISOString()', 'timezone-sensitive week end formatting');
expectIncludes(indexHtml, '((7-d.getDay())%7)', 'week resignation range ends on Sunday');
expectIncludes(indexHtml, 'pendingCands.slice(0,3)', 'pending review named chips');
expectCount(indexHtml, /function openDrawer\s*\(/g, 1, 'openDrawer definition count');
expectCount(indexHtml, /function dateDiff\s*\(/g, 1, 'dateDiff definition count');
expectCount(indexHtml, /function fmtDate\s*\(/g, 1, 'fmtDate definition count');
expectCount(indexHtml, /document\.addEventListener\('keydown'/g, 1, 'Escape listener count');

expectIncludes(serverJs, 'const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000);', '8 hour session default');
expectIncludes(serverJs, 'Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}', 'session cookie max age');
expectIncludes(serverJs, 'DEFAULT_N8N_PROXY_TIMEOUT_MS', 'dashboard upstream timeout default');
expectIncludes(serverJs, 'controller.abort()', 'dashboard upstream abort timeout');
expectIncludes(serverJs, "sendJson(res, 504", 'dashboard upstream timeout response');
expectIncludes(serverJs, 'function healthPayload()', 'deployment health payload');
expectIncludes(serverJs, "url.pathname === '/api/health'", 'health endpoint');
expectIncludes(serverJs, "req.method === 'POST' && url.pathname === '/api/login'", 'login endpoint');
expectIncludes(serverJs, "req.method === 'GET' && url.pathname === '/api/session'", 'session endpoint');
expectIncludes(serverJs, "req.method === 'POST' && url.pathname === '/api/logout'", 'logout endpoint');
expectIncludes(serverJs, "req.method === 'GET' && url.pathname === '/api/hr-dashboard'", 'dashboard proxy endpoint');
expectIncludes(serverJs, "'Cache-Control': 'no-store'", 'no-store API responses');

if (errors.length) {
  console.error('Dashboard static verification failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('Dashboard static verification passed');
