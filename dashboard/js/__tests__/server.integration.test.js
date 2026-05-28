import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import http from 'node:http';
import { once } from 'node:events';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function close(server) {
  if (!server?.listening) return;
  server.close();
  await once(server, 'close');
}

async function startMockN8n() {
  const requests = [];
  const state = { delayMs: 0 };
  const server = http.createServer(async (req, res) => {
    requests.push({
      url: req.url,
      authorization: req.headers.authorization
    });
    if (state.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, state.delayMs));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      today: '2026-05-28',
      generatedAt: '2026-05-28T09:00:00',
      schedEvents: [],
      onboardData: [],
      resignData: [],
      candidatesData: [],
      jobsData: [],
      monthlyTrend: [],
      departmentStats: [],
      stats: { pendingReviewCount: 0 }
    }));
  });
  return { server, requests, state, port: await listen(server) };
}

describe('dashboard server auth flow', () => {
  let mock;
  let server;
  let baseUrl;

  beforeEach(async () => {
    mock = await startMockN8n();
    process.env.HR_DASHBOARD_PASSWORD = 'correct-password';
    process.env.SESSION_SECRET = 'test-session-secret';
    process.env.N8N_HR_WEBHOOK_URL = `http://127.0.0.1:${mock.port}/webhook/hr-dashboard`;
    process.env.N8N_HR_TOKEN = 'test-token';

    const imported = await import(`../../server.js?test=${Date.now()}-${Math.random()}`);
    server = imported.server;
    baseUrl = `http://127.0.0.1:${await listen(server)}`;
  });

  afterEach(async () => {
    delete process.env.N8N_PROXY_TIMEOUT_MS;
    delete process.env.SESSION_TTL_MS;
    await close(server);
    await close(mock?.server);
  });

  test('exposes deployment health without leaking secrets', async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
    const text = await health.text();
    expect(text).not.toContain('correct-password');
    expect(text).not.toContain('test-session-secret');
    expect(text).not.toContain('test-token');

    const data = JSON.parse(text);
    expect(data.ok).toBe(true);
    expect(data.service).toBe('hr-dashboard');
    expect(data.proxyTimeoutMs).toBe(10000);
    expect(data.env).toEqual({
      HR_DASHBOARD_PASSWORD: true,
      SESSION_SECRET: true,
      N8N_HR_WEBHOOK_URL: true,
      N8N_HR_TOKEN: true
    });
  });

  test('rejects wrong password, accepts login, proxies dashboard, and logs out', async () => {
    const wrong = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' })
    });
    expect(wrong.status).toBe(401);

    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' })
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie');
    expect(cookie).toContain('hr_sid=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=28800');

    const session = await fetch(`${baseUrl}/api/session`, {
      headers: { Cookie: cookie }
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({ authenticated: true });

    const dashboard = await fetch(`${baseUrl}/api/hr-dashboard`, {
      headers: { Cookie: cookie }
    });
    expect(dashboard.status).toBe(200);
    const data = await dashboard.json();
    expect(data.today).toBe('2026-05-28');
    expect(data.departmentStats).toEqual([]);
    expect(mock.requests[0].authorization).toBe('Bearer test-token');
    expect(mock.requests[0].url).toContain('token=test-token');

    const logout = await fetch(`${baseUrl}/api/logout`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    expect(logout.status).toBe(200);

    const afterLogout = await fetch(`${baseUrl}/api/session`, {
      headers: { Cookie: cookie }
    });
    expect(afterLogout.status).toBe(401);
  });

  test('protects dashboard proxy without a session', async () => {
    const dashboard = await fetch(`${baseUrl}/api/hr-dashboard`);
    expect(dashboard.status).toBe(401);
  });

  test('returns 504 when dashboard upstream times out', async () => {
    process.env.N8N_PROXY_TIMEOUT_MS = '50';
    mock.state.delayMs = 200;

    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' })
    });
    const cookie = login.headers.get('set-cookie');

    const dashboard = await fetch(`${baseUrl}/api/hr-dashboard`, {
      headers: { Cookie: cookie }
    });
    expect(dashboard.status).toBe(504);
    expect(await dashboard.json()).toEqual({ error: 'Dashboard upstream timed out' });
  });
});

test('expires sessions after the configured TTL', async () => {
  const mock = await startMockN8n();
  let server;

  try {
    process.env.HR_DASHBOARD_PASSWORD = 'ttl-password';
    process.env.SESSION_SECRET = 'ttl-session-secret';
    process.env.N8N_HR_WEBHOOK_URL = `http://127.0.0.1:${mock.port}/webhook/hr-dashboard`;
    process.env.N8N_HR_TOKEN = 'ttl-token';
    process.env.SESSION_TTL_MS = '1200';

    const imported = await import(`../../server.js?ttl=${Date.now()}-${Math.random()}`);
    server = imported.server;
    const baseUrl = `http://127.0.0.1:${await listen(server)}`;

    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'ttl-password' })
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie');
    expect(cookie).toContain('Max-Age=1');

    await new Promise(resolve => setTimeout(resolve, 1400));

    const expired = await fetch(`${baseUrl}/api/session`, {
      headers: { Cookie: cookie }
    });
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ authenticated: false });
  } finally {
    delete process.env.SESSION_TTL_MS;
    await close(server);
    await close(mock.server);
  }
});
