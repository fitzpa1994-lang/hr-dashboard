import process from 'node:process';

const baseUrl = normalizeBaseUrl(
  process.argv[2] ||
  process.env.HR_DASHBOARD_URL ||
  process.env.ZEABUR_DASHBOARD_URL ||
  'https://sp-hr.zeabur.app'
);
const password = process.env.HR_DASHBOARD_PASSWORD || process.env.DEPLOYMENT_DASHBOARD_PASSWORD || '';

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function preview(value, size = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, size);
}

async function request(pathname, options = {}) {
  const url = `${baseUrl}${pathname}`;
  const timeoutMs = options.timeoutMs || 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    return {
      ok: true,
      status: res.status,
      headers: res.headers,
      text
    };
  } catch (error) {
    return {
      ok: false,
      error: error.name === 'AbortError'
        ? `timed out after ${timeoutMs}ms`
        : error.message
    };
  } finally {
    clearTimeout(timer);
  }
}

function printCheck(label, state, detail = '') {
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`${state} ${label}${suffix}`);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function diagnose() {
  console.log(`Diagnosing deployment: ${baseUrl}`);

  const home = await request('/');
  if (!home.ok) {
    printCheck('GET /', 'FAIL', home.error);
  } else {
    const hasOldDemo = home.text.includes('示意版') || home.text.includes('no_response');
    const hasCurrentShell =
      (home.text.includes('login-overlay') && home.text.includes('last-updated')) ||
      (home.text.includes('SPORTON HRIS') && home.text.includes('refresh-btn') && home.text.includes('candidate-search'));
    if (hasOldDemo) {
      printCheck('GET / UI version', 'FAIL', 'old static dashboard detected');
    } else if (hasCurrentShell) {
      printCheck('GET / UI version', 'PASS', 'current SPA shell detected');
    } else {
      printCheck('GET / UI version', 'WARN', `unrecognized HTML; status=${home.status}; body=${preview(home.text)}`);
    }
  }

  const health = await request('/api/health');
  if (!health.ok) {
    printCheck('/api/health reachable', 'FAIL', health.error);
    return 1;
  }

  const healthType = health.headers.get('content-type') || '';
  const healthJson = parseJson(health.text);
  if (!healthJson) {
    const looksHtml = health.text.trim().startsWith('<!DOCTYPE html') || healthType.includes('text/html');
    if (looksHtml) {
      printCheck('/api/health', 'FAIL', 'returned HTML; Zeabur is still serving the old static site or wrong root');
    } else {
      printCheck('/api/health', 'FAIL', `not JSON; status=${health.status}; body=${preview(health.text)}`);
    }
    return 1;
  }

  if (healthJson.service !== 'hr-dashboard') {
    printCheck('/api/health service', 'FAIL', `expected hr-dashboard, got ${healthJson.service}`);
    return 1;
  }
  printCheck('/api/health service', 'PASS', `status=${health.status}`);

  const requiredEnv = ['HR_DASHBOARD_PASSWORD', 'SESSION_SECRET', 'N8N_HR_WEBHOOK_URL', 'N8N_HR_TOKEN'];
  const missingEnv = requiredEnv.filter(key => healthJson.env?.[key] !== true);
  if (missingEnv.length) {
    printCheck('Zeabur env', 'FAIL', `missing/unset: ${missingEnv.join(', ')}`);
    return 1;
  }
  printCheck('Zeabur env', 'PASS', 'all required keys reported true');
  if (healthJson.env?.N8N_HR_WRITE_WEBHOOK_URL !== true) {
    printCheck('Job write env', 'FAIL', 'N8N_HR_WRITE_WEBHOOK_URL is missing/unset');
  } else {
    printCheck('Job write env', 'PASS', 'write webhook URL reported true');
  }

  if (!password) {
    printCheck('Authenticated flow', 'SKIP', 'set HR_DASHBOARD_PASSWORD to diagnose login and proxy');
    return healthJson.ok === true ? 0 : 1;
  }

  const protectedDashboard = await request('/api/hr-dashboard');
  if (!protectedDashboard.ok || protectedDashboard.status !== 401) {
    printCheck('/api/hr-dashboard auth guard', 'FAIL', protectedDashboard.ok ? `status=${protectedDashboard.status}` : protectedDashboard.error);
    return 1;
  }
  printCheck('/api/hr-dashboard auth guard', 'PASS', 'unauthenticated request returned 401');

  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!login.ok || login.status !== 200) {
    printCheck('/api/login', 'FAIL', login.ok ? `status=${login.status}; body=${preview(login.text)}` : login.error);
    return 1;
  }

  const cookie = login.headers.get('set-cookie') || '';
  if (!cookie.includes('hr_sid=')) {
    printCheck('/api/login cookie', 'FAIL', 'missing hr_sid');
    return 1;
  }
  printCheck('/api/login', 'PASS', 'session cookie issued');

  const dashboard = await request('/api/hr-dashboard', {
    headers: { Cookie: cookie },
    timeoutMs: 20_000
  });
  if (!dashboard.ok) {
    printCheck('/api/hr-dashboard proxy', 'FAIL', dashboard.error);
    return 1;
  }
  const dashboardJson = parseJson(dashboard.text);
  if (dashboard.status !== 200 || !dashboardJson) {
    printCheck('/api/hr-dashboard proxy', 'FAIL', `status=${dashboard.status}; body=${preview(dashboard.text)}`);
    return 1;
  }

  const missingFields = ['today', 'schedEvents', 'onboardData', 'resignData', 'candidatesData', 'jobsData', 'monthlyTrend', 'departmentStats', 'stats']
    .filter(key => !Object.prototype.hasOwnProperty.call(dashboardJson, key));
  if (missingFields.length) {
    printCheck('/api/hr-dashboard contract', 'FAIL', `missing: ${missingFields.join(', ')}`);
    return 1;
  }
  printCheck('/api/hr-dashboard proxy', 'PASS', 'Dashboard API contract present');

  const writeProbe = await request('/api/job-requisitions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie
    },
    body: JSON.stringify({})
  });
  if (!writeProbe.ok) {
    printCheck('/api/job-requisitions write route', 'FAIL', writeProbe.error);
    return 1;
  }
  if (writeProbe.status === 400) {
    printCheck('/api/job-requisitions write route', 'PASS', 'route is live and validation responded 400');
  } else {
    printCheck('/api/job-requisitions write route', 'FAIL', `expected 400 validation response, got ${writeProbe.status}; body=${preview(writeProbe.text)}`);
    return 1;
  }

  return 0;
}

diagnose().then(code => {
  process.exitCode = code;
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
