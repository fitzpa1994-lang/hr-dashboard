import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const PASSWORD = process.env.HR_DASHBOARD_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const N8N_WEBHOOK_URL = process.env.N8N_HR_WEBHOOK_URL;
const N8N_WRITE_WEBHOOK_URL = process.env.N8N_HR_WRITE_WEBHOOK_URL;
const N8N_TOKEN = process.env.N8N_HR_TOKEN;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000);
const IS_PROD = process.env.NODE_ENV === 'production';
const DEFAULT_N8N_PROXY_TIMEOUT_MS = 10_000;

const sessions = new Map();
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon']
]);

function requiredEnvReady() {
  return Boolean(PASSWORD && SESSION_SECRET && N8N_WEBHOOK_URL && N8N_TOKEN);
}

function writeEnvReady() {
  return Boolean(requiredEnvReady() && N8N_WRITE_WEBHOOK_URL);
}

function healthPayload() {
  const env = {
    HR_DASHBOARD_PASSWORD: Boolean(PASSWORD),
    SESSION_SECRET: Boolean(SESSION_SECRET),
    N8N_HR_WEBHOOK_URL: Boolean(N8N_WEBHOOK_URL),
    N8N_HR_WRITE_WEBHOOK_URL: Boolean(N8N_WRITE_WEBHOOK_URL),
    N8N_HR_TOKEN: Boolean(N8N_TOKEN)
  };
  return {
    ok: Boolean(PASSWORD && SESSION_SECRET && N8N_WEBHOOK_URL && N8N_TOKEN),
    service: 'hr-dashboard',
    nodeEnv: process.env.NODE_ENV || 'development',
    uptimeSec: Math.floor(process.uptime()),
    proxyTimeoutMs: getProxyTimeoutMs(),
    env
  };
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map(part => {
    const [key, ...rest] = part.trim().split('=');
    return [decodeURIComponent(key || ''), decodeURIComponent(rest.join('=') || '')];
  }).filter(([key]) => key));
}

function getSession(req) {
  if (!SESSION_SECRET) return null;
  const raw = parseCookies(req).hr_sid;
  if (!raw) return null;
  const [sid, sig] = raw.split('.');
  if (!sid || !sig || !timingSafeEqualText(sig, sign(sid))) return null;
  const session = sessions.get(sid);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(sid);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(JSON.stringify(body));
}

function setSessionCookie(res, sid) {
  const cookie = [
    `hr_sid=${encodeURIComponent(`${sid}.${sign(sid)}`)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (IS_PROD) cookie.push('Secure');
  res.setHeader('Set-Cookie', cookie.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'hr_sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (raw.length > 10_000) throw new Error('Request body too large');
  return raw ? JSON.parse(raw) : {};
}

function buildWebhookUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (!url.searchParams.has('token')) url.searchParams.set('token', N8N_TOKEN);
  return url;
}

function parseJsonDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeJobRequisitionPayload(body, { requireId = false } = {}) {
  const positionTitle = String(body.positionTitle || body.position_title || '').trim();
  const department = String(body.department || '').trim();
  const rawHeadcount = Number(body.headcount);
  const rawUrgency = body.urgency == null || body.urgency === '' ? 3 : Number(body.urgency);
  const status = String(body.status || (rawHeadcount > 0 ? 'open' : 'cancelled')).trim();
  const notes = body.notes == null ? '' : String(body.notes);
  const openDate = parseJsonDate(body.openDate || body.open_date);
  const targetDate = parseJsonDate(body.targetDate || body.target_date);
  const allowedStatus = new Set(['open', 'filled', 'on_hold', 'cancelled']);

  if (requireId) {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return { error: 'id must be a positive integer' };
    }
  }

  if (!department) return { error: 'department is required' };
  if (!positionTitle) return { error: 'positionTitle is required' };
  if (!Number.isInteger(rawHeadcount) || rawHeadcount < 0) {
    return { error: 'headcount must be a non-negative integer' };
  }
  if (!Number.isInteger(rawUrgency) || rawUrgency < 1 || rawUrgency > 5) {
    return { error: 'urgency must be an integer between 1 and 5' };
  }
  if (!allowedStatus.has(status)) {
    return { error: 'status must be one of open, filled, on_hold, cancelled' };
  }

  return {
    value: {
      ...(requireId ? { id: Number(body.id) } : {}),
      department,
      positionTitle,
      headcount: rawHeadcount,
      status,
      urgency: rawUrgency,
      notes,
      openDate,
      targetDate
    }
  };
}

function getProxyTimeoutMs() {
  const configured = Number(process.env.N8N_PROXY_TIMEOUT_MS || DEFAULT_N8N_PROXY_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_N8N_PROXY_TIMEOUT_MS;
}

async function proxyDashboard(req, res) {
  if (!getSession(req)) return sendJson(res, 401, { error: 'Unauthorized' });
  if (!requiredEnvReady()) return sendJson(res, 500, { error: 'Server auth is not configured' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getProxyTimeoutMs());
  try {
    const upstream = await fetch(buildWebhookUrl(N8N_WEBHOOK_URL), {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${N8N_TOKEN}`
      }
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(text);
  } catch (error) {
    if (error.name === 'AbortError') {
      return sendJson(res, 504, { error: 'Dashboard upstream timed out' });
    }
    console.error(error);
    return sendJson(res, 502, { error: 'Dashboard upstream unavailable' });
  } finally {
    clearTimeout(timer);
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  let filePath;

  if (pathname === '/') {
    filePath = path.join(__dirname, 'index.html');
  } else {
    const relativePath = pathname.replace(/^[/\\]+/, '');
    filePath = path.resolve(__dirname, relativePath);
  }

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = path.join(__dirname, 'index.html');

  res.writeHead(200, {
    'Content-Type': mimeTypes.get(path.extname(filePath)) || 'application/octet-stream',
    'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=3600'
  });
  createReadStream(filePath).on('error', error => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end('Internal Server Error');
  }).pipe(res);
}

async function proxyJobRequisitionWrite(req, res, action, id = null) {
  if (!getSession(req)) return sendJson(res, 401, { error: 'Unauthorized' });
  if (!writeEnvReady()) return sendJson(res, 500, { error: 'Job requisition write API is not configured' });

  const body = await readBody(req);
  const normalized = normalizeJobRequisitionPayload({ ...body, ...(id ? { id } : {}) }, { requireId: action === 'update' });
  if (normalized.error) return sendJson(res, 400, { error: normalized.error });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getProxyTimeoutMs());
  try {
    const upstream = await fetch(buildWebhookUrl(N8N_WRITE_WEBHOOK_URL), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${N8N_TOKEN}`
      },
      body: JSON.stringify({
        action,
        requisition: normalized.value
      })
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(text);
  } catch (error) {
    if (error.name === 'AbortError') {
      return sendJson(res, 504, { error: 'Job requisition upstream timed out' });
    }
    console.error(error);
    return sendJson(res, 502, { error: 'Job requisition upstream unavailable' });
  } finally {
    clearTimeout(timer);
  }
}

async function proxyOnboardingStatusUpdate(req, res, id) {
  if (!getSession(req)) return sendJson(res, 401, { error: 'Unauthorized' });
  if (!writeEnvReady()) return sendJson(res, 500, { error: 'Write API is not configured' });

  const body = await readBody(req);
  const allowed = ['onboarded', 'no_show', 'pending', 'cancelled'];
  if (!allowed.includes(body.status)) return sendJson(res, 400, { error: 'Invalid status' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getProxyTimeoutMs());
  try {
    const upstream = await fetch(buildWebhookUrl(N8N_WRITE_WEBHOOK_URL), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${N8N_TOKEN}` },
      body: JSON.stringify({ action: 'update_onboard', onboardId: id, onboardStatus: body.status })
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(text);
  } catch (error) {
    if (error.name === 'AbortError') return sendJson(res, 504, { error: 'Upstream timed out' });
    return sendJson(res, 502, { error: 'Upstream unavailable' });
  } finally {
    clearTimeout(timer);
  }
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/api\/job-requisitions(?:\/(\d+))?$/);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      const payload = healthPayload();
      return sendJson(res, payload.ok ? 200 : 503, payload);
    }

    if (req.method === 'GET' && url.pathname === '/api/session') {
      return sendJson(res, getSession(req) ? 200 : 401, { authenticated: Boolean(getSession(req)) });
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      if (!requiredEnvReady()) return sendJson(res, 500, { error: 'Server auth is not configured' });
      const body = await readBody(req);
      if (!timingSafeEqualText(body.password, PASSWORD)) return sendJson(res, 401, { error: '密碼錯誤，請重新輸入' });
      const sid = crypto.randomBytes(32).toString('base64url');
      sessions.set(sid, { expiresAt: Date.now() + SESSION_TTL_MS });
      setSessionCookie(res, sid);
      return sendJson(res, 200, { authenticated: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const raw = parseCookies(req).hr_sid;
      const sid = raw?.split('.')[0];
      if (sid) sessions.delete(sid);
      clearSessionCookie(res);
      return sendJson(res, 200, { authenticated: false });
    }

    if (req.method === 'GET' && url.pathname === '/api/hr-dashboard') {
      return proxyDashboard(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/api/job-requisitions') {
      return proxyJobRequisitionWrite(req, res, 'create');
    }

    if (req.method === 'PATCH' && match?.[1]) {
      return proxyJobRequisitionWrite(req, res, 'update', Number(match[1]));
    }

    const onboardMatch = url.pathname.match(/^\/api\/onboardings\/(\d+)$/);
    if (req.method === 'PATCH' && onboardMatch) {
      return proxyOnboardingStatusUpdate(req, res, Number(onboardMatch[1]));
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    sendJson(res, 405, { error: 'Method Not Allowed' }, { Allow: 'GET,HEAD,POST,PATCH' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'Internal Server Error' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`HR dashboard listening on http://localhost:${PORT}`);
    if (!requiredEnvReady()) {
      console.warn('Missing one or more required env vars: HR_DASHBOARD_PASSWORD, SESSION_SECRET, N8N_HR_WEBHOOK_URL, N8N_HR_TOKEN');
    }
  });
}

