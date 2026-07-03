import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(dashboardDir, 'index.html'), 'utf8');
const serverJs = fs.readFileSync(path.join(dashboardDir, 'server.js'), 'utf8');
const jobsEditorJs = fs.readFileSync(path.join(dashboardDir, 'js', 'jobsEditor.js'), 'utf8');

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

try {
  parse(jobsEditorJs, { sourceType: 'module' });
} catch (error) {
  errors.push(`jobs editor module parse failed: ${error.message}`);
}
}

expectNotIncludes(indexHtml, '示意版', 'demo label');
expectIncludes(indexHtml, 'id="last-updated"', 'last updated indicator');
expectIncludes(indexHtml, 'id="refresh-btn"', 'manual refresh button');
expectIncludes(indexHtml, 'logoutDashboard()', 'logout action');
expectIncludes(indexHtml, 'id="global-search"', 'global search input');
expectIncludes(indexHtml, 'id="candidate-search"', 'candidate search input');
expectIncludes(indexHtml, 'id="cand-count"', 'candidate counter');
expectIncludes(indexHtml, "setCandF('arranging'", 'arranging filter');
expectIncludes(indexHtml, "setCandF('interviewing'", 'interviewing filter');
expectIncludes(indexHtml, "setCandF('rejected'", 'rejected filter');
expectNotIncludes(indexHtml, "setCandF('no_response'", 'unsupported no_response filter');
expectNotIncludes(indexHtml, 'no_response', 'unsupported no_response status remnants');
expectIncludes(indexHtml, 'history.replaceState', 'tab URL hash sync');
expectIncludes(indexHtml, 'fetchWithTimeout', 'network timeout handling');
expectIncludes(indexHtml, 'window.hrShowLogin = showLogin', 'expired session login recovery hook');
expectIncludes(indexHtml, 'res.status === 401', 'expired session detection');
expectIncludes(indexHtml, "id=\"job-tbody\"", 'jobs table body');
expectIncludes(indexHtml, 'window.hrRequestJson = requestJson', 'request bridge');
expectIncludes(indexHtml, 'window.hrDashboardBridge = {', 'jobs bridge');
expectIncludes(indexHtml, 'js/jobsEditor.js', 'jobs editor module include');
expectIncludes(indexHtml, '急迫度', 'urgency column');
expectIncludes(indexHtml, 'getOverviewKpis()', 'overview KPI helper invocation');
expectIncludes(indexHtml, 'function getOverviewKpis()', 'overview KPI helper definition');
expectIncludes(indexHtml, 'id="kpi-today-onboard"', 'today onboard KPI');
expectIncludes(indexHtml, 'id="kpi-today-resign"', 'today resign KPI');
expectIncludes(indexHtml, 'id="overview-progress-tbody"', 'overview progress table');
expectIncludes(indexHtml, "const API_URL = '/api/hr-dashboard';", 'dashboard API endpoint');
expectIncludes(indexHtml, 'departmentStats = d.departmentStats || []', 'department stats assignment');
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
expectIncludes(jobsEditorJs, 'bridge.setRenderJobs(renderEditableJobs)', 'jobs editor render override');
expectIncludes(jobsEditorJs, '/api/job-requisitions', 'jobs editor API usage');
expectIncludes(serverJs, "req.method === 'GET' && url.pathname === '/api/session'", 'session endpoint');
expectIncludes(serverJs, "req.method === 'POST' && url.pathname === '/api/logout'", 'logout endpoint');
expectIncludes(serverJs, "req.method === 'GET' && url.pathname === '/api/hr-dashboard'", 'dashboard proxy endpoint');
expectIncludes(serverJs, "req.method === 'POST' && url.pathname === '/api/job-requisitions'", 'job requisition create endpoint');
expectIncludes(serverJs, "req.method === 'PATCH' && match?.[1]", 'job requisition update endpoint');
expectIncludes(serverJs, 'N8N_HR_WRITE_WEBHOOK_URL', 'write webhook env');
expectIncludes(serverJs, "'Cache-Control': 'no-store'", 'no-store API responses');

if (errors.length) {
  console.error('Dashboard static verification failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('Dashboard static verification passed');
