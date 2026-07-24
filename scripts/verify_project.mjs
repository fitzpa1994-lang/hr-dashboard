import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const errors = [];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  } catch (error) {
    errors.push(`${file}: invalid JSON: ${error.message}`);
    return null;
  }
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) errors.push(`${label}: expected ${expected}, got ${actual}`);
}

function expectIncludes(value, needle, label) {
  if (!String(value || '').includes(needle)) errors.push(`${label}: missing ${needle}`);
}

function expectNotIncludes(value, needle, label) {
  if (String(value || '').includes(needle)) errors.push(`${label}: must not include ${needle}`);
}

function normalizeSql(value) {
  return String(value || '').replace(/\r\n?/g, '\n');
}

function run(label, command, args, options = {}) {
  console.log(`\n> ${label}`);
  const executable = process.platform === 'win32' && command === 'npm'
    ? 'npm.cmd'
    : command;
  const result = spawnSync(executable, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (result.error) {
    errors.push(`${label}: ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    errors.push(`${label}: command failed with exit code ${result.status}`);
  }
}

const rootPkg = readJson('package.json');
const zeabur = readJson('zbpack.json');
const dashboardPkg = readJson('dashboard/package.json');
const dashboardWorkflow = readJson('n8n/live_Dashboard_API.json');
const jobWriteWorkflow = readJson('n8n/live_Job_Requisition_Write.json');
const gitignore = fs.existsSync(path.join(root, '.gitignore'))
  ? fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
  : '';
const envExample = fs.existsSync(path.join(root, '.env.example'))
  ? fs.readFileSync(path.join(root, '.env.example'), 'utf8')
  : '';
const externalJobSchema = fs.existsSync(path.join(root, 'database/job_requisition_sources_pg.sql'))
  ? fs.readFileSync(path.join(root, 'database/job_requisition_sources_pg.sql'), 'utf8')
  : '';

function workflowQueries(workflow, nodeName) {
  return [workflow?.nodes, workflow?.activeVersion?.nodes]
    .filter(Array.isArray)
    .map(nodes => nodes.find(node => node.name === nodeName)?.parameters?.query || '');
}

if (rootPkg) {
  expectEqual(rootPkg.scripts?.start, 'node dashboard/server.js', 'root start script');
  expectEqual(rootPkg.scripts?.['verify:deployment'], 'node scripts/verify_deployment.mjs', 'deployment verification script');
  expectEqual(rootPkg.scripts?.['diagnose:deployment'], 'node scripts/diagnose_deployment.mjs', 'deployment diagnosis script');
  expectEqual(rootPkg.scripts?.['audit:onboarding-matches'], 'node scripts/audit_onboarding_matches.mjs', 'onboarding match audit script');
  expectEqual(rootPkg.scripts?.['deploy:n8n:workflow3'], 'node scripts/deploy_n8n_export.mjs n8n/live_Workflow3_到職離職.json', 'Workflow3 deployment script');
  expectEqual(rootPkg.scripts?.['migrate:live-requisitions'], 'node scripts/migrate_live_requisitions.mjs', 'live requisition migration script');
  expectEqual(rootPkg.scripts?.['prepare:zeabur-env'], 'node scripts/prepare_zeabur_env.mjs', 'Zeabur env preparation script');
  expectIncludes(rootPkg.scripts?.['package:deployment'], 'scripts/create_deployment_package.ps1', 'deployment package script');
  expectIncludes(rootPkg.scripts?.['verify:package'], 'scripts/verify_deployment_package.ps1', 'deployment package verification script');
  expectIncludes(rootPkg.engines?.node, '>=20', 'root node engine');
}

if (zeabur) {
  expectEqual(zeabur.start_command, 'npm start', 'Zeabur start command');
  expectEqual(zeabur.build_command, '', 'Zeabur build command');
}

if (dashboardPkg) {
  expectIncludes(dashboardPkg.scripts?.test, 'verify-dashboard-static.mjs', 'dashboard test script');
  expectIncludes(dashboardPkg.scripts?.test, 'jest', 'dashboard test script');
}

const dashboardQueries = workflowQueries(dashboardWorkflow, 'PG：查詢所有儀表板資料');
for (const [index, query] of dashboardQueries.entries()) {
  expectIncludes(query, "'external104Jobs'", `Dashboard API external104Jobs query copy ${index + 1}`);
  expectIncludes(query, 'job_requisition_sources', `Dashboard API external job source table copy ${index + 1}`);
  expectIncludes(query, "'external104Sync'", `Dashboard API external104Sync query copy ${index + 1}`);
  expectIncludes(query, 'job_requisition_source_syncs', `Dashboard API source sync metadata copy ${index + 1}`);
  expectIncludes(query, "'hasSnapshot'", `Dashboard API source sync snapshot flag copy ${index + 1}`);
}
if (dashboardQueries.length === 2) {
  expectEqual(
    normalizeSql(dashboardQueries[0]),
    normalizeSql(dashboardQueries[1]),
    'Dashboard API root and activeVersion SQL'
  );
}

const jobWriteQueries = workflowQueries(jobWriteWorkflow, 'PG: Write job requisition');
for (const [index, query] of jobWriteQueries.entries()) {
  expectIncludes(query, 'sync_104_jobs', `job write 104 sync action copy ${index + 1}`);
  expectIncludes(query, 'link_external_job', `job write 104 link action copy ${index + 1}`);
  expectIncludes(query, 'pending_confirmation', `job write safe missing state copy ${index + 1}`);
  expectIncludes(query, 'sync_claimed AS (', `job write serialized sync claim copy ${index + 1}`);
  expectIncludes(query, 'job_requisition_source_syncs', `job write source sync metadata copy ${index + 1}`);
  expectIncludes(query, 'input.snapshot_complete', `job write complete snapshot gate copy ${index + 1}`);
  expectIncludes(query, 'input.contract_version = 2', `job write v2 contract gate copy ${index + 1}`);
  expectIncludes(query, 'input.external_jobs_is_array', `job write jobs array gate copy ${index + 1}`);
  expectIncludes(query, 'jsonb_array_length(input.external_jobs) <= 500', `job write maximum job count copy ${index + 1}`);
  expectIncludes(query, 'input.client_synced_at_valid', `job write client timestamp validity copy ${index + 1}`);
  expectIncludes(query, 'TO_TIMESTAMP({{ typeof $json.body.syncedAt', `job write safe timestamp conversion copy ${index + 1}`);
  expectIncludes(query, "input.external_synced_at <= NOW() + INTERVAL '5 minutes'", `job write future timestamp guard copy ${index + 1}`);
  expectIncludes(query, 'clock_timestamp()', `job write database claim timestamp copy ${index + 1}`);
  expectIncludes(query, 'input.scanned_count = input.source_total_count', `job write source total count gate copy ${index + 1}`);
  expectIncludes(query, 'input.published_count = jsonb_array_length(input.external_jobs)', `job write published count gate copy ${index + 1}`);
  expectIncludes(query, 'job_requisition_source_syncs.last_complete_synced_at < EXCLUDED.last_complete_synced_at', `job write serialized provider claim copy ${index + 1}`);
  expectIncludes(query, 'Number.isInteger($json.body.scannedCount)', `job write strict scanned count type copy ${index + 1}`);
  expectIncludes(query, '$json.body.sourceTotalCount <= 2147483647', `job write source count int32 bound copy ${index + 1}`);
  expectIncludes(query, '$json.body.publishedCount <= 2147483647', `job write published count int32 bound copy ${index + 1}`);
  expectIncludes(query, "jsonb_typeof(job_value->'externalId') = 'string'", `job write external id JSON type copy ${index + 1}`);
  expectIncludes(query, "jsonb_typeof(job_value->'title') = 'string'", `job write title JSON type copy ${index + 1}`);
  expectIncludes(query, "jsonb_typeof(job_value->'url') = 'string'", `job write URL JSON type copy ${index + 1}`);
  expectIncludes(query, "jsonb_typeof(job_value->'updatedDate') = 'string'", `job write updated date JSON type copy ${index + 1}`);
  expectIncludes(query, "job_value->>'status' = 'open'", `job write explicit open status copy ${index + 1}`);
  expectIncludes(query, "POSITION('/job/jobmaster?' IN url) > 0", `job write exact 104 job path copy ${index + 1}`);
  expectIncludes(query, "split_part(parameter.value, '=', 1) = 'jobno'", `job write URL job number match copy ${index + 1}`);
  expectIncludes(query, "SELECT TO_CHAR(sync_claimed.last_complete_synced_at AT TIME ZONE 'UTC'", `job write claimed response timestamp copy ${index + 1}`);
  expectNotIncludes(query, "COALESCE(NULLIF(BTRIM(job.value->>'status'), ''), 'open')", `job write missing-status fallback copy ${index + 1}`);
  expectNotIncludes(query, "TO_CHAR(input.external_synced_at AT TIME ZONE 'UTC'", `job write raw client response timestamp copy ${index + 1}`);
  expectNotIncludes(query, 'LEAST(sync_request.external_synced_at, NOW())', `job write client-ordered claim timestamp copy ${index + 1}`);
}
if (jobWriteQueries.length === 2) {
  expectEqual(jobWriteQueries[0], jobWriteQueries[1], 'job write root and activeVersion SQL');
}

expectIncludes(gitignore, 'node_modules/', '.gitignore');
expectIncludes(gitignore, 'dist/', '.gitignore');
expectIncludes(gitignore, '.env', '.gitignore');
expectIncludes(gitignore, '*.log', '.gitignore');
expectIncludes(gitignore, '*.sqlite', '.gitignore');
expectIncludes(envExample, 'HR_DASHBOARD_PASSWORD=', '.env.example');
expectIncludes(envExample, 'HR_DASHBOARD_URL=', '.env.example');
expectIncludes(envExample, 'SESSION_SECRET=', '.env.example');
expectIncludes(envExample, 'N8N_HR_WEBHOOK_URL=', '.env.example');
expectIncludes(envExample, 'N8N_HR_TOKEN=', '.env.example');
expectIncludes(envExample, 'N8N_PROXY_TIMEOUT_MS=', '.env.example');
expectIncludes(externalJobSchema, 'CREATE TABLE IF NOT EXISTS job_requisition_sources', '104 source migration');
expectIncludes(externalJobSchema, 'REFERENCES job_requisitions(id)', '104 source mapping foreign key');
expectIncludes(externalJobSchema, 'CREATE TABLE IF NOT EXISTS job_requisition_source_syncs', '104 source sync metadata migration');
expectIncludes(externalJobSchema, 'last_complete_synced_at', '104 source sync claim timestamp');
expectIncludes(externalJobSchema, 'CHECK (published_count <= source_total_count)', '104 source sync count constraint');

if (!fs.existsSync(path.join(root, 'scripts/create_deployment_package.ps1'))) {
  errors.push('scripts/create_deployment_package.ps1: missing deployment package script');
}
if (!fs.existsSync(path.join(root, 'scripts/verify_deployment_package.ps1'))) {
  errors.push('scripts/verify_deployment_package.ps1: missing deployment package verification script');
}
if (!fs.existsSync(path.join(root, 'database/job_requisitions_seed.sql'))) {
  errors.push('database/job_requisitions_seed.sql: missing requisition seed SQL');
}
if (!fs.existsSync(path.join(root, 'database/job_requisitions_duplicate_audit.sql'))) {
  errors.push('database/job_requisitions_duplicate_audit.sql: missing duplicate audit SQL');
}

run('Dashboard static verification', 'node', ['dashboard/scripts/verify-dashboard-static.mjs']);
run('Dashboard Jest tests', 'node', [
  '--experimental-vm-modules',
  'dashboard/node_modules/jest/bin/jest.js',
  '--runInBand'
]);
run('Runtime HTTP verification', 'node', ['scripts/verify_runtime.mjs']);
run('Deployment diagnosis syntax check', 'node', ['--check', 'scripts/diagnose_deployment.mjs']);
run('Deployment verifier syntax check', 'node', ['--check', 'scripts/verify_deployment.mjs']);
run('Onboarding match audit syntax check', 'node', ['--check', 'scripts/audit_onboarding_matches.mjs']);
run('n8n export deploy syntax check', 'node', ['--check', 'scripts/deploy_n8n_export.mjs']);
run('n8n export deploy helper tests', 'node', [
  '--test',
  '--test-isolation=none',
  'scripts/__tests__/deploy_n8n_export.test.mjs'
]);
run('Job requisition write sync contract tests', 'node', [
  '--test',
  '--test-isolation=none',
  'scripts/__tests__/job_requisition_write_sync_contract.test.mjs'
]);
run('Workflow1 candidate routing contract tests', 'node', [
  '--test',
  '--test-isolation=none',
  'scripts/__tests__/workflow1_candidate_routing_contract.test.mjs'
]);
run('104 search capture tests', 'node', [
  '--test',
  '--test-isolation=none',
  'scripts/__tests__/search_capture.test.mjs'
]);
run('Live requisition migration syntax check', 'node', ['--check', 'scripts/migrate_live_requisitions.mjs']);
run('Zeabur env preparation syntax check', 'node', ['--check', 'scripts/prepare_zeabur_env.mjs']);
run('Dashboard external jobs patch syntax check', 'node', ['--check', 'scripts/patch_dashboard_api_external104_jobs.mjs']);
run('Job source sync v2 patch syntax check', 'node', ['--check', 'scripts/patch_job_requisition_source_sync_v2.mjs']);
run('Job source sync v2 contract verification', 'node', ['scripts/verify_job_source_sync_v2.mjs']);
run('Visual fixture syntax check', 'node', ['--check', 'scripts/serve_visual_fixture.mjs']);
run('Visual UI fixture syntax check', 'node', ['--check', 'scripts/serve_visual_ui_fixture.mjs']);
run('n8n export validation', 'python', ['scripts/validate_n8n_exports.py']);
run('Job requisition asset validation', 'python', ['scripts/validate_job_requisition_assets.py']);
run('Python verifier compile', 'python', [
  '-m',
  'py_compile',
  'scripts/validate_dashboard_api.py',
  'scripts/validate_n8n_exports.py',
  'scripts/validate_job_requisition_assets.py'
]);

if (errors.length) {
  console.error('\nProject verification failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('\nProject verification passed');
