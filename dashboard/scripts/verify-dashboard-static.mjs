import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(dashboardDir, 'index.html'), 'utf8');
const serverJs = fs.readFileSync(path.join(dashboardDir, 'server.js'), 'utf8');
const jobsEditorJs = fs.readFileSync(path.join(dashboardDir, 'js', 'jobsEditor.js'), 'utf8');
const jobReconciliationJs = fs.readFileSync(path.join(dashboardDir, 'js', 'jobReconciliation.js'), 'utf8');
const sync104ContractJs = fs.readFileSync(path.join(dashboardDir, 'js', 'sync104Contract.js'), 'utf8');
const talentSearchNavigatorJs = fs.readFileSync(path.join(dashboardDir, 'js', 'talentSearchNavigator.js'), 'utf8');
const monthlyFunnelDashboardJs = fs.readFileSync(path.join(dashboardDir, 'js', 'monthlyFunnelDashboard.js'), 'utf8');
const monthlyFunnelUtilsJs = fs.readFileSync(path.join(dashboardDir, 'js', 'monthlyFunnelUtils.js'), 'utf8');
const reportingMonthUtilsJs = fs.readFileSync(path.join(dashboardDir, 'js', 'reportingMonthUtils.js'), 'utf8');

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

for (const [label, source] of [
  ['jobs editor', jobsEditorJs],
  ['job reconciliation', jobReconciliationJs],
  ['104 sync contract', sync104ContractJs],
  ['talent search navigator', talentSearchNavigatorJs],
  ['monthly funnel dashboard', monthlyFunnelDashboardJs],
  ['monthly funnel utilities', monthlyFunnelUtilsJs],
]) {
  try {
    parse(source, { sourceType: 'module' });
  } catch (error) {
    errors.push(`${label} module parse failed: ${error.message}`);
  }
}

try {
  parse(reportingMonthUtilsJs, { sourceType: 'script' });
} catch (error) {
  errors.push(`reporting month utilities script parse failed: ${error.message}`);
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
expectIncludes(indexHtml, 'id="job-priority-board"', '104 priority board');
expectNotIncludes(indexHtml, '<tbody id="job-tbody"', 'legacy internal jobs table markup');
expectNotIncludes(indexHtml, 'data-job-filter="', 'legacy internal jobs filter controls');
expectNotIncludes(indexHtml, '<th>缺額</th>', 'deferred headcount column');
expectNotIncludes(indexHtml, '<th>已補數</th>', 'deferred filled-count column');
expectIncludes(indexHtml, 'window.hrRequestJson = requestJson', 'request bridge');
expectIncludes(indexHtml, 'window.hrDashboardBridge = {', 'jobs bridge');
expectIncludes(indexHtml, 'getExternal104Sync: () => ({ ...external104Sync })', 'authoritative 104 sync metadata bridge');
expectIncludes(indexHtml, 'external104Sync = d.external104Sync', '104 sync metadata load');
expectIncludes(indexHtml, 'js/jobsEditor.js', 'jobs editor module include');
expectIncludes(indexHtml, 'id="tab-talent-search"', '104 talent search page');
expectIncludes(indexHtml, 'id="monthly-funnel-dashboard"', 'monthly funnel dashboard');
expectIncludes(indexHtml, 'id="funnel-kpi-grid"', 'monthly funnel KPI grid');
expectIncludes(indexHtml, 'id="funnel-trend-grid"', 'monthly funnel small multiples');
expectIncludes(indexHtml, 'id="funnel-conversion-content"', 'monthly funnel conversion summary');
expectIncludes(indexHtml, '查看每月詳細數據', 'collapsed monthly funnel details');
expectIncludes(indexHtml, 'js/monthlyFunnelDashboard.js', 'monthly funnel dashboard module include');
expectIncludes(indexHtml, 'js/reportingMonthUtils.js', 'shared reporting month utilities include');
expectIncludes(indexHtml, 'window._monthlyFunnelCurrentMonth = TODAY.substring(0, 7)', 'API today monthly funnel anchor');
expectIncludes(monthlyFunnelDashboardJs, "currentMonth: window._monthlyFunnelCurrentMonth || ''", 'monthly funnel current month wiring');
expectCount(
  indexHtml,
  /aggregateDepartmentFunnelTrend\(\s*window\._monthlyFunnelByDepartment,\s*TODAY,\s*6\s*\)/g,
  2,
  'overview and analytics trends use authoritative department funnel data'
);
expectIncludes(indexHtml, 'buildReportingMonthWindow(TODAY, 6)', 'department chart uses API today window');
expectIncludes(indexHtml, 'filterRowsToReportingWindow(funnelRows, TODAY, 6)', 'department results exclude future months');
expectNotIncludes(indexHtml, 'monthlyTrend.slice(-6)', 'unanchored analytics trend slicing');
expectNotIncludes(indexHtml, '(monthlyTrend || []).slice(-6)', 'unanchored overview trend slicing');
expectNotIncludes(indexHtml, 'alignRowsToReportingWindow(monthlyTrend', 'legacy monthly trend chart source');
expectIncludes(monthlyFunnelDashboardJs, '未綁定職缺者不列入', 'job dimension binding scope note');
expectNotIncludes(indexHtml, 'id="job-reconciliation-panel"', 'manual 104 pairing panel removed');
expectIncludes(indexHtml, 'data-job-workspace-target="talent-search"', 'unified jobs workspace switch');
expectIncludes(indexHtml, 'data-nav-tab="hr-events"', 'semantic sidebar tab target');
expectNotIncludes(indexHtml, "document.querySelectorAll('.menu-item')[", 'numeric sidebar navigation index');
expectIncludes(indexHtml, 'js/talentSearchNavigator.js', '104 talent search module include');
expectIncludes(indexHtml, 'id="talent-nav-sync-button"', '104 manual sync button');
expectIncludes(indexHtml, '優先順序', '104 priority workspace label');
expectIncludes(indexHtml, 'for (const j of external104Jobs.filter', 'global search uses authoritative 104 jobs');
expectNotIncludes(indexHtml, 'for (const j of jobsData) {', 'global search legacy internal jobs source');
expectIncludes(indexHtml, 'getOverviewKpis()', 'overview KPI helper invocation');
expectIncludes(indexHtml, 'function getOverviewKpis()', 'overview KPI helper definition');
expectIncludes(indexHtml, 'id="ops-onboard-resign"', 'today onboard/resign indicator');
expectIncludes(indexHtml, 'id="overview-today-tbody"', 'today interviews table');
expectIncludes(indexHtml, 'id="overview-dept-tbody"', 'department progress table');
expectIncludes(indexHtml, 'id="focus-body"', 'candidate focus panel');
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
expectIncludes(jobsEditorJs, 'bridge.setRenderJobs(renderPriorityBoard)', '104 priority board render override');
expectNotIncludes(jobsEditorJs, 'renderReconciliationPanel(reconciliation, snapshot);', 'manual 104 pairing panel is not rendered');
expectNotIncludes(jobsEditorJs, '/api/job-requisitions', 'legacy internal jobs editor API usage');
expectIncludes(jobsEditorJs, '/api/job-requisition-sources/104/priorities', '104 priority write API usage');
expectIncludes(jobsEditorJs, 'normalizeOpen104PriorityJobs', 'open 104 posting filtering');
expectIncludes(jobsEditorJs, 'movePriorityJob', '104 drag ordering helper');
expectIncludes(jobsEditorJs, 'data-priority-group', 'priority group drop targets');
expectIncludes(jobsEditorJs, 'result.data?.ok !== true', 'explicit priority write success gate');
expectIncludes(jobsEditorJs, 'validatePriorityWriteResponse', 'priority response shape validation');
expectIncludes(jobsEditorJs, 'updated !== Number(expectedCount)', 'exact priority update count gate');
expectIncludes(jobReconciliationJs, 'jobRequisitionId', 'persisted 104 mapping usage');
expectIncludes(talentSearchNavigatorJs, '/api/job-requisitions/sync-104', '104 snapshot persistence API usage');
expectIncludes(talentSearchNavigatorJs, 'validateComplete104SyncPayload(event.data)', 'strict extension response validation');
expectIncludes(talentSearchNavigatorJs, 'result.data?.ok !== true', 'explicit 104 sync write success gate');
expectIncludes(talentSearchNavigatorJs, 'validate104SyncWriteResponse', '104 sync response metadata validation');
expectIncludes(talentSearchNavigatorJs, 'body: JSON.stringify(payload)', 'complete v2 sync forwarding');
expectNotIncludes(talentSearchNavigatorJs, 'event.data.scannedCount ?? event.data.jobs.length', 'legacy inferred sync counts');
expectIncludes(sync104ContractJs, 'raw.contractVersion !== SYNC_104_CONTRACT_VERSION', 'strict 104 v2 contract gate');
expectIncludes(sync104ContractJs, 'raw.publishedCount !== raw.jobs.length', 'published job count integrity');
expectIncludes(serverJs, "req.method === 'GET' && url.pathname === '/api/session'", 'session endpoint');
expectIncludes(serverJs, "req.method === 'POST' && url.pathname === '/api/logout'", 'logout endpoint');
expectIncludes(serverJs, "req.method === 'GET' && url.pathname === '/api/hr-dashboard'", 'dashboard proxy endpoint');
expectIncludes(serverJs, "req.method === 'POST' && url.pathname === '/api/job-requisitions'", 'job requisition create endpoint');
expectIncludes(serverJs, "req.method === 'PATCH' && match?.[1]", 'job requisition update endpoint');
expectIncludes(serverJs, "req.method === 'PATCH' && url.pathname === '/api/job-requisition-sources/104/priorities'", '104 priority update endpoint');
expectIncludes(serverJs, 'normalize104JobPrioritiesPayload', '104 priority payload validation');
expectIncludes(serverJs, "action: 'update_104_job_priorities'", '104 priority write forwarding');
expectIncludes(serverJs, 'N8N_HR_WRITE_WEBHOOK_URL', 'write webhook env');
expectIncludes(serverJs, 'contractVersion: normalized.value.contractVersion', '104 contract version forwarding');
expectIncludes(serverJs, 'sourceTotalCount: normalized.value.sourceTotalCount', '104 source count forwarding');
expectIncludes(serverJs, 'publishedCount: normalized.value.publishedCount', '104 published count forwarding');
expectIncludes(serverJs, 'SYNC_104_MAX_FUTURE_SKEW_MS', '104 future timestamp skew guard');
expectIncludes(serverJs, "'Cache-Control': 'no-store'", 'no-store API responses');

if (errors.length) {
  console.error('Dashboard static verification failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('Dashboard static verification passed');
