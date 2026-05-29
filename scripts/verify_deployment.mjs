import process from 'node:process';

const baseUrl = normalizeBaseUrl(
  process.argv[2] ||
  process.env.HR_DASHBOARD_URL ||
  process.env.ZEABUR_DASHBOARD_URL ||
  ''
);
const password = process.env.HR_DASHBOARD_PASSWORD || process.env.DEPLOYMENT_DASHBOARD_PASSWORD || '';

class VerificationError extends Error {}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function fail(message) {
  throw new VerificationError(message);
}

async function request(pathname, options = {}) {
  const url = `${baseUrl}${pathname}`;
  const timeoutMs = options.timeoutMs || 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') fail(`${pathname} timed out after ${timeoutMs}ms`);
    fail(`${pathname} request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res, pathname) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    fail(`${pathname} did not return JSON; status=${res.status}; body=${text.slice(0, 120)}`);
  }
}

function expect(condition, message) {
  if (!condition) fail(message);
}

function expectNoSecretLeak(text, label) {
  if (password) {
    expect(!text.includes(password), `${label} leaked dashboard password`);
  }
}

async function main() {
  if (!baseUrl) {
    fail('missing target URL. Pass it as argv[2] or set HR_DASHBOARD_URL / ZEABUR_DASHBOARD_URL');
  }

  console.log(`Verifying deployment: ${baseUrl}`);

  const healthRes = await request('/api/health');
  const healthText = await healthRes.text();
  expectNoSecretLeak(healthText, '/api/health');

  if (healthRes.status === 404 || healthRes.status === 405) {
    fail(`/api/health returned ${healthRes.status}; this usually means Zeabur is not running the Node dashboard server`);
  }
  expect([200, 503].includes(healthRes.status), `/api/health returned unexpected status ${healthRes.status}`);

  let health;
  try {
    health = JSON.parse(healthText);
  } catch {
    fail(`/api/health did not return JSON; body=${healthText.slice(0, 120)}`);
  }
  expect(health.service === 'hr-dashboard', '/api/health service is not hr-dashboard');
  expect(health.env && typeof health.env === 'object', '/api/health missing env map');
  for (const key of ['HR_DASHBOARD_PASSWORD', 'SESSION_SECRET', 'N8N_HR_WEBHOOK_URL', 'N8N_HR_TOKEN', 'N8N_HR_WRITE_WEBHOOK_URL']) {
    expect(typeof health.env[key] === 'boolean', `/api/health env.${key} must be boolean`);
  }
  expect(health.ok === true, `/api/health not ok; env=${JSON.stringify(health.env)}`);
  expect(health.env.N8N_HR_WRITE_WEBHOOK_URL === true, '/api/health indicates N8N_HR_WRITE_WEBHOOK_URL is missing');
  console.log('Health check passed');

  if (!password) {
    console.log('No HR_DASHBOARD_PASSWORD provided; skipping authenticated flow.');
    console.log('Set HR_DASHBOARD_PASSWORD to verify login, session, dashboard proxy, and logout.');
    return;
  }

  const protectedRes = await request('/api/hr-dashboard');
  expect(protectedRes.status === 401, `/api/hr-dashboard without session returned ${protectedRes.status}, expected 401`);

  const wrongLogin = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: `${password}-wrong` })
  });
  expect(wrongLogin.status === 401, `/api/login wrong password returned ${wrongLogin.status}, expected 401`);

  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  const loginText = await login.text();
  expectNoSecretLeak(loginText, '/api/login');
  expect(login.status === 200, `/api/login returned ${login.status}; body=${loginText.slice(0, 120)}`);

  const cookie = login.headers.get('set-cookie') || '';
  expect(cookie.includes('hr_sid='), '/api/login did not set hr_sid cookie');
  expect(cookie.includes('HttpOnly'), '/api/login cookie is not HttpOnly');
  expect(cookie.includes('Max-Age=28800'), '/api/login cookie does not use the default 8 hour session');

  const session = await request('/api/session', { headers: { Cookie: cookie } });
  expect(session.status === 200, `/api/session after login returned ${session.status}`);
  const sessionData = await readJson(session, '/api/session');
  expect(sessionData.authenticated === true, '/api/session did not return authenticated=true');

  const dashboard = await request('/api/hr-dashboard', { headers: { Cookie: cookie }, timeoutMs: 20_000 });
  const dashboardText = await dashboard.text();
  expectNoSecretLeak(dashboardText, '/api/hr-dashboard');
  expect(dashboard.status === 200, `/api/hr-dashboard returned ${dashboard.status}; body=${dashboardText.slice(0, 160)}`);

  let dashboardData;
  try {
    dashboardData = JSON.parse(dashboardText);
  } catch {
    fail(`/api/hr-dashboard did not return JSON; body=${dashboardText.slice(0, 160)}`);
  }
  for (const key of ['today', 'schedEvents', 'onboardData', 'resignData', 'candidatesData', 'jobsData', 'monthlyTrend', 'departmentStats', 'stats']) {
    expect(Object.prototype.hasOwnProperty.call(dashboardData, key), `/api/hr-dashboard missing ${key}`);
  }

  const writeProbe = await request('/api/job-requisitions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie
    },
    body: JSON.stringify({})
  });
  const writeProbeText = await writeProbe.text();
  expectNoSecretLeak(writeProbeText, '/api/job-requisitions');
  expect(
    writeProbe.status === 400,
    `/api/job-requisitions probe returned ${writeProbe.status}, expected 400 validation response; body=${writeProbeText.slice(0, 160)}`
  );

  const logout = await request('/api/logout', {
    method: 'POST',
    headers: { Cookie: cookie }
  });
  expect(logout.status === 200, `/api/logout returned ${logout.status}`);

  const afterLogout = await request('/api/session', { headers: { Cookie: cookie } });
  expect(afterLogout.status === 401, `/api/session after logout returned ${afterLogout.status}, expected 401`);

  console.log('Authenticated deployment flow passed');
  console.log('Deployment verification passed');
}

main().catch(error => {
  if (error instanceof VerificationError) {
    console.error(`Deployment verification failed: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
