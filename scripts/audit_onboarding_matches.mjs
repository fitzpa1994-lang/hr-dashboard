import process from 'node:process';
import { analyzeOnboardingRequisitionMatches } from '../dashboard/js/dataUtils.js';

const baseUrl = String(
  process.argv[2] ||
  process.env.HR_DASHBOARD_URL ||
  process.env.ZEABUR_DASHBOARD_URL ||
  'https://sp-hr.zeabur.app'
).trim().replace(/\/+$/, '');

const password = process.env.HR_DASHBOARD_PASSWORD || process.env.DEPLOYMENT_DASHBOARD_PASSWORD || '';

if (!password) {
  console.error('Missing HR_DASHBOARD_PASSWORD or DEPLOYMENT_DASHBOARD_PASSWORD');
  process.exit(1);
}

function previewRows(rows, limit = 10) {
  return rows.slice(0, limit).map(item => ({
    name: item.name,
    dept: item.dept,
    pos: item.pos,
    date: item.date,
  }));
}

const login = await fetch(`${baseUrl}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password }),
});

if (login.status !== 200) {
  const body = await login.text();
  console.error(`Login failed: status=${login.status}; body=${body.slice(0, 160)}`);
  process.exit(1);
}

const cookie = login.headers.get('set-cookie') || '';
if (!cookie.includes('hr_sid=')) {
  console.error('Login succeeded but no hr_sid cookie was returned');
  process.exit(1);
}

const dashboardRes = await fetch(`${baseUrl}/api/hr-dashboard`, {
  headers: { Cookie: cookie },
});

if (dashboardRes.status !== 200) {
  const body = await dashboardRes.text();
  console.error(`/api/hr-dashboard failed: status=${dashboardRes.status}; body=${body.slice(0, 160)}`);
  process.exit(1);
}

const dashboard = await dashboardRes.json();
const audit = analyzeOnboardingRequisitionMatches(dashboard.onboardData || [], dashboard.jobsData || []);

console.log(JSON.stringify({
  baseUrl,
  pendingOnboardCount: audit.pendingOnboardCount,
  matchedCount: audit.matchedCount,
  unmatchedCount: audit.unmatchedCount,
  decrementableMatchCount: audit.decrementableMatchCount,
  matchedPreview: audit.matched.slice(0, 10).map(item => ({
    name: item.onboarding.name,
    dept: item.onboarding.dept,
    pos: item.onboarding.pos,
    date: item.onboarding.date,
    jobDept: item.job.dept,
    jobPos: item.job.pos,
    jobStatus: item.job.status,
    jobHeadcount: item.job.headcount,
    canDecrement: item.canDecrement,
  })),
  unmatchedPreview: previewRows(audit.unmatched),
}, null, 2));
