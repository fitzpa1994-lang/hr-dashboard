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
const gitignore = fs.existsSync(path.join(root, '.gitignore'))
  ? fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
  : '';
const envExample = fs.existsSync(path.join(root, '.env.example'))
  ? fs.readFileSync(path.join(root, '.env.example'), 'utf8')
  : '';

if (rootPkg) {
  expectEqual(rootPkg.scripts?.start, 'node dashboard/server.js', 'root start script');
  expectEqual(rootPkg.scripts?.['verify:deployment'], 'node scripts/verify_deployment.mjs', 'deployment verification script');
  expectEqual(rootPkg.scripts?.['diagnose:deployment'], 'node scripts/diagnose_deployment.mjs', 'deployment diagnosis script');
  expectEqual(rootPkg.scripts?.['audit:onboarding-matches'], 'node scripts/audit_onboarding_matches.mjs', 'onboarding match audit script');
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
run('Zeabur env preparation syntax check', 'node', ['--check', 'scripts/prepare_zeabur_env.mjs']);
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
