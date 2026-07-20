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

function currentSyncTimestamp() {
  return new Date().toISOString();
}

async function startMockN8n() {
  const requests = [];
  const state = { delayMs: 0 };
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({
      url: req.url,
      method: req.method,
      authorization: req.headers.authorization,
      body: body ? JSON.parse(body) : null
    });
    if (state.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, state.delayMs));
    }
    if (req.url.includes('/webhook/hr-dashboard-write')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        action: requests.at(-1).body?.action || null,
        requisition: requests.at(-1).body?.requisition || null
      }));
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
    process.env.N8N_HR_WRITE_WEBHOOK_URL = `http://127.0.0.1:${mock.port}/webhook/hr-dashboard-write`;
    process.env.N8N_HR_TOKEN = 'test-token';

    const imported = await import(`../../server.js?test=${Date.now()}-${Math.random()}`);
    server = imported.server;
    baseUrl = `http://127.0.0.1:${await listen(server)}`;
  });

  afterEach(async () => {
    delete process.env.N8N_PROXY_TIMEOUT_MS;
    delete process.env.SESSION_TTL_MS;
    delete process.env.N8N_HR_WRITE_WEBHOOK_URL;
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
      N8N_HR_WRITE_WEBHOOK_URL: true,
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

  test('protects local Outlook opener without a session', async () => {
    const response = await fetch(`${baseUrl}/api/outlook/open?subject=${encodeURIComponent('履歷推薦')}`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  test('creates and updates job requisitions through the write webhook', async () => {
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' })
    });
    const cookie = login.headers.get('set-cookie');

    const created = await fetch(`${baseUrl}/api/job-requisitions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({
        department: '五部',
        positionTitle: 'RF SAR 測試工程師',
        headcount: 999,
        status: 'open',
        urgency: 4,
        notes: '數名'
      })
    });
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    expect(createdBody.ok).toBe(true);
    expect(createdBody.action).toBe('create');
    expect(createdBody.requisition.positionTitle).toBe('RF SAR 測試工程師');

    const updated = await fetch(`${baseUrl}/api/job-requisitions/7`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({
        department: '五部',
        positionTitle: 'RF SAR 測試工程師',
        headcount: 12,
        status: 'open',
        urgency: 4,
        notes: '調整缺額'
      })
    });
    expect(updated.status).toBe(200);
    const updatedBody = await updated.json();
    expect(updatedBody.ok).toBe(true);
    expect(updatedBody.action).toBe('update');
    expect(updatedBody.requisition.id).toBe(7);
    expect(updatedBody.requisition.headcount).toBe(12);

    const writeRequests = mock.requests.filter(request => request.url.includes('/webhook/hr-dashboard-write'));
    expect(writeRequests).toHaveLength(2);
    expect(writeRequests[0].method).toBe('POST');
    expect(writeRequests[0].authorization).toBe('Bearer test-token');
    expect(writeRequests[0].url).toContain('token=test-token');
    expect(writeRequests[0].body).toEqual({
      action: 'create',
      requisition: {
        department: '五部',
        positionTitle: 'RF SAR 測試工程師',
        headcount: 999,
        status: 'open',
        urgency: 4,
        notes: '數名',
        openDate: null,
        targetDate: null
      }
    });
    expect(writeRequests[1].body.requisition.id).toBe(7);
  });

  test('validates job requisition payloads before proxying upstream', async () => {
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' })
    });
    const cookie = login.headers.get('set-cookie');

    const bad = await fetch(`${baseUrl}/api/job-requisitions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({
        department: '',
        positionTitle: '',
        headcount: -1,
        urgency: 9,
        status: 'invalid'
      })
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'department is required' });
  });

  test('protects 104 sync and link APIs without a session', async () => {
    const sync = await fetch(`${baseUrl}/api/job-requisitions/sync-104`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        syncedAt: '2026-07-20T08:30:00.000Z',
        complete: true,
        scannedCount: 1,
        jobs: [{
          externalId: '123456',
          title: 'Software Engineer',
          url: 'https://vip.104.com.tw/job/jobmaster?jobno=123456',
          updatedDate: '2026-07-20',
          status: 'open'
        }]
      })
    });
    expect(sync.status).toBe(401);
    expect(await sync.json()).toEqual({ error: 'Unauthorized' });

    const link = await fetch(`${baseUrl}/api/job-requisition-sources/104/123456`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobRequisitionId: 7 })
    });
    expect(link.status).toBe(401);
    expect(await link.json()).toEqual({ error: 'Unauthorized' });
    expect(mock.requests.filter(request => request.url.includes('/webhook/hr-dashboard-write'))).toHaveLength(0);
  });

  test('validates and forwards every v2 completeness field for a 104 snapshot larger than 10 KB', async () => {
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' })
    });
    const cookie = login.headers.get('set-cookie');
    const jobs = Array.from({ length: 100 }, (_, index) => ({
      externalId: String(700000 + index),
      title: `  Software Engineer ${index} ${'x'.repeat(100)}  `,
      url: `https://vip.104.com.tw/job/jobmaster?jobno=${700000 + index}`,
      updatedDate: '2026-07-20',
      status: 'open'
    }));
    const payload = {
      contractVersion: 2,
      syncedAt: currentSyncTimestamp(),
      complete: true,
      sourceTotalCount: 125,
      publishedCount: 100,
      scannedCount: 125,
      jobs
    };
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(10_000);

    const response = await fetch(`${baseUrl}/api/job-requisitions/sync-104`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify(payload)
    });
    expect(response.status).toBe(200);
    expect((await response.json()).action).toBe('sync_104_jobs');

    const writeRequest = mock.requests.find(request => request.body?.action === 'sync_104_jobs');
    expect(writeRequest.authorization).toBe('Bearer test-token');
    expect(writeRequest.url).toContain('token=test-token');
    expect(writeRequest.body).toMatchObject({
      action: 'sync_104_jobs',
      contractVersion: 2,
      syncedAt: payload.syncedAt,
      sourceTotalCount: 125,
      publishedCount: 100,
      scannedCount: 125,
      complete: true
    });
    expect(writeRequest.body.jobs).toHaveLength(100);
    expect(writeRequest.body.jobs[0]).toEqual({
      externalId: '700000',
      title: `Software Engineer 0 ${'x'.repeat(100)}`,
      url: 'https://vip.104.com.tw/job/jobmaster?jobno=700000',
      updatedDate: '2026-07-20',
      status: 'open'
    });
  });

  test('rejects incomplete or unsafe 104 snapshots without forwarding them', async () => {
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' })
    });
    const cookie = login.headers.get('set-cookie');
    const validJob = {
      externalId: '123456',
      title: 'Software Engineer',
      url: 'https://vip.104.com.tw/job/jobmaster?jobno=123456',
      updatedDate: '2026-07-20',
      status: 'open'
    };
    const validPayload = {
      contractVersion: 2,
      syncedAt: currentSyncTimestamp(),
      complete: true,
      sourceTotalCount: 1,
      publishedCount: 1,
      scannedCount: 1,
      jobs: [validJob]
    };
    const invalidPayloads = [
      { ...validPayload, contractVersion: 1 },
      { ...validPayload, complete: false },
      { ...validPayload, syncedAt: 'not-a-date' },
      { ...validPayload, syncedAt: undefined },
      { ...validPayload, syncedAt: new Date(Date.now() + 6 * 60 * 1000).toISOString() },
      { ...validPayload, sourceTotalCount: 0, publishedCount: 0, scannedCount: 0, jobs: undefined },
      { ...validPayload, scannedCount: 0 },
      { ...validPayload, publishedCount: 0 },
      { ...validPayload, sourceTotalCount: 2_147_483_648, scannedCount: 2_147_483_648 },
      { ...validPayload, jobs: [{ ...validJob, status: 'closed' }] },
      { ...validPayload, jobs: [{ ...validJob, externalId: 'ABC' }] },
      { ...validPayload, jobs: [{ ...validJob, externalId: 123456 }] },
      { ...validPayload, jobs: [{ ...validJob, title: '' }] },
      { ...validPayload, jobs: [{ ...validJob, title: 123 }] },
      { ...validPayload, jobs: [{ ...validJob, url: 'https://example.com/job/123456' }] },
      { ...validPayload, jobs: [{ ...validJob, updatedDate: 20260720 }] },
      { ...validPayload, sourceTotalCount: 2, publishedCount: 2, scannedCount: 2, jobs: [validJob, { ...validJob }] },
      {
        ...validPayload,
        sourceTotalCount: 501,
        publishedCount: 501,
        scannedCount: 501,
        jobs: Array.from({ length: 501 }, (_, index) => ({
          ...validJob,
          externalId: String(index + 1),
          url: `https://vip.104.com.tw/job/jobmaster?jobno=${index + 1}`
        }))
      }
    ];

    for (const payload of invalidPayloads) {
      const response = await fetch(`${baseUrl}/api/job-requisitions/sync-104`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(payload)
      });
      expect(response.status).toBe(400);
    }

    const oversized = await fetch(`${baseUrl}/api/job-requisitions/sync-104`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ...validPayload, padding: 'x'.repeat(512 * 1024) })
    });
    expect(oversized.status).toBe(413);
    expect(mock.requests.filter(request => request.body?.action === 'sync_104_jobs')).toHaveLength(0);
  });

  test('accepts a complete v2 snapshot with zero published jobs', async () => {
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' })
    });
    const cookie = login.headers.get('set-cookie');
    const response = await fetch(`${baseUrl}/api/job-requisitions/sync-104`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        contractVersion: 2,
        syncedAt: currentSyncTimestamp(),
        complete: true,
        sourceTotalCount: 4,
        publishedCount: 0,
        scannedCount: 4,
        jobs: []
      })
    });

    expect(response.status).toBe(200);
    expect(mock.requests.find(request => request.body?.action === 'sync_104_jobs')?.body).toMatchObject({
      contractVersion: 2,
      sourceTotalCount: 4,
      publishedCount: 0,
      scannedCount: 4,
      jobs: []
    });
  });

  test('links and unlinks a 104 source through the write webhook', async () => {
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' })
    });
    const cookie = login.headers.get('set-cookie');

    for (const jobRequisitionId of [7, null]) {
      const response = await fetch(`${baseUrl}/api/job-requisition-sources/104/123456`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ jobRequisitionId })
      });
      expect(response.status).toBe(200);
    }

    const invalid = await fetch(`${baseUrl}/api/job-requisition-sources/104/123456`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ jobRequisitionId: '7' })
    });
    expect(invalid.status).toBe(400);

    const overflowing = await fetch(`${baseUrl}/api/job-requisition-sources/104/123456`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ jobRequisitionId: 2_147_483_648 })
    });
    expect(overflowing.status).toBe(400);

    const linkRequests = mock.requests.filter(request => request.body?.action === 'link_external_job');
    expect(linkRequests).toHaveLength(2);
    expect(linkRequests[0]).toMatchObject({
      method: 'POST',
      authorization: 'Bearer test-token',
      body: {
        action: 'link_external_job',
        provider: '104',
        externalId: '123456',
        jobRequisitionId: 7
      }
    });
    expect(linkRequests[0].url).toContain('token=test-token');
    expect(linkRequests[1].body.jobRequisitionId).toBeNull();
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
    process.env.N8N_HR_WRITE_WEBHOOK_URL = `http://127.0.0.1:${mock.port}/webhook/hr-dashboard-write`;
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
