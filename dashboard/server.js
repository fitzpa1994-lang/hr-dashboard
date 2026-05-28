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

function healthPayload() {
  const env = {
    HR_DASHBOARD_PASSWORD: Boolean(PASSWORD),
    SESSION_SECRET: Boolean(SESSION_SECRET),
    N8N_HR_WEBHOOK_URL: Boolean(N8N_WEBHOOK_URL),
    N8N_HR_TOKEN: Boolean(N8N_TOKEN)
  };
  return {
    ok: Object.values(env).every(Boolean),
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

function buildWebhookUrl() {
  const url = new URL(N8N_WEBHOOK_URL);
  if (!url.searchParams.has('token')) url.searchParams.set('token', N8N_TOKEN);
  return url;
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
    const upstream = await fetch(buildWebhookUrl(), {
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

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

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

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    sendJson(res, 405, { error: 'Method Not Allowed' }, { Allow: 'GET,HEAD,POST' });
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

