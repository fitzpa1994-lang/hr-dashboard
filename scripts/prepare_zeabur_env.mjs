import { randomBytes } from 'node:crypto';

const dashboardUrl = process.env.HR_DASHBOARD_URL || 'https://sp-hr.zeabur.app';
const sessionSecret = randomBytes(32).toString('hex');

const rows = [
  ['NODE_ENV', 'production'],
  ['PORT', '8080'],
  ['HR_DASHBOARD_PASSWORD', '<set-dashboard-login-password>'],
  ['SESSION_SECRET', sessionSecret],
  ['N8N_HR_WEBHOOK_URL', '<set-live-dashboard-api-webhook-url>'],
  ['N8N_HR_WRITE_WEBHOOK_URL', '<set-live-job-requisition-write-webhook-url>'],
  ['N8N_HR_TOKEN', '<set-rotated-n8n-dashboard-token>'],
  ['N8N_PROXY_TIMEOUT_MS', '10000']
];

console.log('# Zeabur environment variables for the HR dashboard Node service');
console.log('# Paste these into the Zeabur service environment settings.');
console.log('# Replace values wrapped in <...> before redeploying.\n');

for (const [key, value] of rows) {
  console.log(`${key}=${value}`);
}

console.log('\n# Local verification variables');
console.log(`# Use these locally after Zeabur redeploys.`);
console.log(`HR_DASHBOARD_URL=${dashboardUrl}`);
console.log('HR_DASHBOARD_PASSWORD=<same-dashboard-login-password>');

console.log('\n# Verification commands');
console.log('npm run diagnose:deployment');
console.log('npm run verify:deployment');
