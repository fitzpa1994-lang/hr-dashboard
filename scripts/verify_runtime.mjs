import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';

const PASSWORD = 'runtime-password';
const TOKEN = 'runtime-token';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function close(server) {
  if (!server?.listening) return;
  server.close();
  await once(server, 'close');
}

async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function startMockN8n() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      url: req.url,
      authorization: req.headers.authorization
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      today: '2026-05-28',
      generatedAt: '2026-05-28T09:00:00',
      schedEvents: [{
        type: 'interview',
        name: '測試人選',
        pos: '工程師',
        dept: 'IT',
        date: '2026-05-28',
        hr: 'HR',
        emailLink: ''
      }],
      onboardData: [],
      resignData: [],
      candidatesData: [{
        name: '測試人選',
        pos: '工程師',
        dept: 'IT',
        status: 'pending_review',
        emailLink: '',
        resumeLink: '',
        history: []
      }],
      jobsData: [],
      monthlyTrend: [],
      departmentStats: [],
      stats: {
        activeCount: 1,
        offerCount: 0,
        pendingOnboard: 0,
        pendingResign: 0,
        monthOnboard: 0,
        monthResign: 0,
        hireRate: 0,
        pendingReviewCount: 1,
        avgDaysToOffer: 0
      }
    }));
  });
  return { server, requests, port: await listen(server) };
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 8_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dashboard server exited early with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/session`);
      if (res.status === 401) return;
      lastError = new Error(`unexpected readiness status ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw lastError || new Error('dashboard server did not become ready');
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const mock = await startMockN8n();
  const appPort = await freePort();
  let child;

  try {
    child = spawn(process.execPath, ['dashboard/server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(appPort),
        HR_DASHBOARD_PASSWORD: PASSWORD,
        SESSION_SECRET: 'runtime-session-secret',
        N8N_HR_WEBHOOK_URL: `http://127.0.0.1:${mock.port}/webhook/hr-dashboard`,
        N8N_HR_TOKEN: TOKEN
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    const baseUrl = `http://127.0.0.1:${appPort}`;
    await waitForServer(baseUrl, child);

    const staticRes = await fetch(`${baseUrl}/`);
    expect(staticRes.status === 200, `GET / returned ${staticRes.status}`);
    expect((staticRes.headers.get('content-type') || '').includes('text/html'), 'GET / did not return HTML');

    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status === 200, `GET /api/health returned ${health.status}`);
    const healthText = await health.text();
    expect(!healthText.includes(PASSWORD), 'health response leaked dashboard password');
    expect(!healthText.includes(TOKEN), 'health response leaked n8n token');
    const healthData = JSON.parse(healthText);
    expect(healthData.ok === true, 'health response did not report ok');
    expect(healthData.env?.N8N_HR_TOKEN === true, 'health response did not report n8n token configured');

    const protectedRes = await fetch(`${baseUrl}/api/hr-dashboard`);
    expect(protectedRes.status === 401, `unauthenticated dashboard returned ${protectedRes.status}`);

    const wrongLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' })
    });
    expect(wrongLogin.status === 401, `wrong password returned ${wrongLogin.status}`);

    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD })
    });
    expect(login.status === 200, `correct password returned ${login.status}`);
    const cookie = login.headers.get('set-cookie') || '';
    expect(cookie.includes('hr_sid='), 'login did not set hr_sid cookie');
    expect(cookie.includes('HttpOnly'), 'session cookie is not HttpOnly');
    expect(cookie.includes('Max-Age=28800'), 'session cookie max age is not 8 hours');

    const session = await fetch(`${baseUrl}/api/session`, {
      headers: { Cookie: cookie }
    });
    expect(session.status === 200, `authenticated session returned ${session.status}`);

    const dashboard = await fetch(`${baseUrl}/api/hr-dashboard`, {
      headers: { Cookie: cookie }
    });
    expect(dashboard.status === 200, `authenticated dashboard returned ${dashboard.status}`);
    const data = await dashboard.json();
    expect(data.stats?.pendingReviewCount === 1, 'dashboard data did not come from mock upstream');
    expect(mock.requests.length === 1, `expected 1 upstream request, got ${mock.requests.length}`);
    expect(mock.requests[0].authorization === `Bearer ${TOKEN}`, 'upstream Authorization header missing token');
    expect(mock.requests[0].url.includes(`token=${TOKEN}`), 'upstream URL missing token query');

    const logout = await fetch(`${baseUrl}/api/logout`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    expect(logout.status === 200, `logout returned ${logout.status}`);

    const afterLogout = await fetch(`${baseUrl}/api/session`, {
      headers: { Cookie: cookie }
    });
    expect(afterLogout.status === 401, `session after logout returned ${afterLogout.status}`);

    if (stderr.trim()) {
      console.warn(stderr.trim());
    }
    console.log('Runtime HTTP verification passed');
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await once(child, 'exit').catch(() => {});
    }
    await close(mock.server);
  }
}

main().catch(error => {
  console.error(`Runtime HTTP verification failed: ${error.message}`);
  process.exit(1);
});
