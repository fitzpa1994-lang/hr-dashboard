import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { POSTGRES_INTEGER_MAX, validateComplete104SyncPayload } from './js/sync104Contract.js';

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
const DEFAULT_OUTLOOK_OPEN_TIMEOUT_MS = 20_000;
const DEFAULT_REQUEST_BODY_MAX_BYTES = 10_000;
const SYNC_104_REQUEST_BODY_MAX_BYTES = 512 * 1024;
const SYNC_104_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
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

class RequestBodyError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'RequestBodyError';
    this.statusCode = statusCode;
  }
}

async function readBody(req, { maxBytes = DEFAULT_REQUEST_BODY_MAX_BYTES } = {}) {
  const chunks = [];
  let totalBytes = 0;
  let exceededLimit = false;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      exceededLimit = true;
      continue;
    }
    chunks.push(buffer);
  }

  if (exceededLimit) {
    throw new RequestBodyError(`Request body exceeds ${maxBytes} bytes`, 413);
  }

  const raw = Buffer.concat(chunks, totalBytes).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new RequestBodyError('Request body must be valid JSON', 400);
  }
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

function normalize104SyncPayload(body) {
  const envelope = validateComplete104SyncPayload(body);
  if (!envelope.ok) return { error: envelope.error };
  if (Date.parse(envelope.value.syncedAt) > Date.now() + SYNC_104_MAX_FUTURE_SKEW_MS) {
    return { error: 'syncedAt cannot be more than 5 minutes in the future' };
  }

  const normalizedJobs = [];
  for (let index = 0; index < envelope.value.jobs.length; index += 1) {
    const job = envelope.value.jobs[index];

    const externalId = job.externalId.trim();

    const title = typeof job.title === 'string' ? job.title.trim() : '';
    if (!title || title.length > 200) {
      return { error: `jobs[${index}].title must be between 1 and 200 characters` };
    }

    if (typeof job.url !== 'string' || !job.url.trim() || job.url.trim().length > 2048) {
      return { error: `jobs[${index}].url must be a valid 104 URL` };
    }

    let jobUrl;
    try {
      jobUrl = new URL(job.url.trim());
    } catch {
      return { error: `jobs[${index}].url must be a valid 104 URL` };
    }
    if (
      jobUrl.origin !== 'https://vip.104.com.tw'
      || jobUrl.username
      || jobUrl.password
      || jobUrl.pathname !== '/job/jobmaster'
      || jobUrl.searchParams.get('jobno') !== externalId
    ) {
      return { error: `jobs[${index}].url must match its https://vip.104.com.tw job number` };
    }

    if (typeof job.updatedDate !== 'string' || job.updatedDate.trim().length > 64) {
      return { error: `jobs[${index}].updatedDate must be a string of at most 64 characters` };
    }

    normalizedJobs.push({
      externalId,
      title,
      url: jobUrl.href,
      updatedDate: job.updatedDate.trim(),
      status: 'open'
    });
  }

  return {
    value: {
      contractVersion: envelope.value.contractVersion,
      syncedAt: envelope.value.syncedAt,
      complete: true,
      sourceTotalCount: envelope.value.sourceTotalCount,
      publishedCount: envelope.value.publishedCount,
      scannedCount: envelope.value.scannedCount,
      jobs: normalizedJobs
    }
  };
}

function normalize104JobLinkPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'jobRequisitionId')) {
    return { error: 'jobRequisitionId is required' };
  }
  if (
    body.jobRequisitionId !== null
    && (
      !Number.isInteger(body.jobRequisitionId)
      || body.jobRequisitionId <= 0
      || body.jobRequisitionId > POSTGRES_INTEGER_MAX
    )
  ) {
    return { error: 'jobRequisitionId must be a PostgreSQL positive integer or null' };
  }
  return { value: body.jobRequisitionId };
}

function normalize104JobPrioritiesPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }
  if (!Array.isArray(body.jobs)) {
    return { error: 'jobs must be an array' };
  }
  if (body.jobs.length > 500) {
    return { error: 'jobs must contain at most 500 items' };
  }

  const seenExternalIds = new Set();
  const jobs = [];
  for (let index = 0; index < body.jobs.length; index += 1) {
    const job = body.jobs[index];
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      return { error: `jobs[${index}] must be an object` };
    }
    if (typeof job.externalId !== 'string' || !/^[0-9]{1,32}$/.test(job.externalId)) {
      return { error: `jobs[${index}].externalId must be a digit string` };
    }
    if (seenExternalIds.has(job.externalId)) {
      return { error: `jobs contains duplicate externalId: ${job.externalId}` };
    }
    if (!Number.isInteger(job.priorityLevel) || job.priorityLevel < 1 || job.priorityLevel > 3) {
      return { error: `jobs[${index}].priorityLevel must be an integer between 1 and 3` };
    }
    if (
      !Number.isInteger(job.displayOrder)
      || job.displayOrder < 0
      || job.displayOrder > POSTGRES_INTEGER_MAX
    ) {
      return { error: `jobs[${index}].displayOrder must be a PostgreSQL non-negative integer` };
    }

    seenExternalIds.add(job.externalId);
    jobs.push({
      externalId: job.externalId,
      priorityLevel: job.priorityLevel,
      displayOrder: job.displayOrder
    });
  }

  return { value: jobs };
}

function getProxyTimeoutMs() {
  const configured = Number(process.env.N8N_PROXY_TIMEOUT_MS || DEFAULT_N8N_PROXY_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_N8N_PROXY_TIMEOUT_MS;
}

function getOutlookOpenTimeoutMs() {
  const configured = Number(process.env.OUTLOOK_OPEN_TIMEOUT_MS || DEFAULT_OUTLOOK_OPEN_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_OUTLOOK_OPEN_TIMEOUT_MS;
}

function normalizeQueryText(value, maxLength) {
  const text = String(value || '').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function getSafeFallbackUrl(value) {
  const text = normalizeQueryText(value, 2048);
  if (!text) return '';
  try {
    const url = new URL(text);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

const OUTLOOK_OPEN_SCRIPT = String.raw`& {
param(
  [string]$MessageId,
  [string]$Subject,
  [string]$ReceivedAt
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Normalize-Text([string]$Value) {
  if ($null -eq $Value) { return '' }
  return ($Value -replace '\s+', ' ').Trim()
}

function Escape-Dasl([string]$Value) {
  return $Value.Replace("'", "''")
}

function Get-MailFolders($Folder) {
  if ($null -eq $Folder) { return }
  try {
    if ($Folder.DefaultItemType -eq 0) { $Folder }
    foreach ($Child in @($Folder.Folders)) {
      Get-MailFolders $Child
    }
  } catch {}
}

function Restrict-BySubject($Items, [string]$SubjectText) {
  if ([string]::IsNullOrWhiteSpace($SubjectText)) { return @() }
  $EscapedSubject = Escape-Dasl $SubjectText
  $Filter = "@SQL=""http://schemas.microsoft.com/mapi/proptag/0x0037001f"" = '$EscapedSubject'"
  try {
    return @($Items.Restrict($Filter))
  } catch {
    return @()
  }
}

function Score-Mail($Mail, [string]$SubjectText, [Nullable[datetime]]$ReceivedDate) {
  $Score = 0
  $MailSubject = Normalize-Text ([string]$Mail.Subject)
  $TargetSubject = Normalize-Text $SubjectText
  if ($TargetSubject -and $MailSubject -eq $TargetSubject) {
    $Score += 1000
  } elseif ($TargetSubject -and $MailSubject.Contains($TargetSubject)) {
    $Score += 500
  }
  if ($ReceivedDate.HasValue) {
    try {
      $Minutes = [math]::Abs((([datetime]$Mail.ReceivedTime) - $ReceivedDate.Value).TotalMinutes)
      $Score += [math]::Max(0, 300 - [int]$Minutes)
    } catch {}
  }
  return $Score
}

$TargetSubject = Normalize-Text $Subject
if ([string]::IsNullOrWhiteSpace($TargetSubject)) {
  throw '缺少履歷推薦郵件主旨，無法在 Outlook 搜尋。'
}

$TargetReceivedAt = $null
if (-not [string]::IsNullOrWhiteSpace($ReceivedAt)) {
  try {
    $TargetReceivedAt = [datetime]::Parse(
      $ReceivedAt,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeLocal
    )
  } catch {
    $TargetReceivedAt = $null
  }
}

$Outlook = New-Object -ComObject Outlook.Application
$Session = $Outlook.Session
$BestMail = $null
$BestScore = -1

foreach ($Store in @($Session.Stores)) {
  try {
    $Root = $Store.GetRootFolder()
  } catch {
    continue
  }

  foreach ($Folder in @(Get-MailFolders $Root)) {
    try {
      $Items = $Folder.Items
      $Items.Sort('[ReceivedTime]', $true)
      foreach ($Mail in @(Restrict-BySubject $Items $TargetSubject)) {
        if ($null -eq $Mail) { continue }
        if ($Mail.Class -ne 43) { continue }
        $Score = Score-Mail $Mail $TargetSubject $TargetReceivedAt
        if ($Score -gt $BestScore) {
          $BestScore = $Score
          $BestMail = $Mail
        }
      }
    } catch {}
  }
}

if ($null -eq $BestMail) {
  throw ('找不到對應的 Outlook 郵件：' + $TargetSubject)
}

$BestMail.Display($false)
try { $BestMail.Activate() } catch {}

@{
  ok = $true
  subject = [string]$BestMail.Subject
  receivedAt = [string]$BestMail.ReceivedTime
  folder = [string]$BestMail.Parent.FolderPath
  messageId = [string]$MessageId
} | ConvertTo-Json -Compress
}`;

function runPowerShell(script, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
      ...args
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('Opening Outlook timed out'));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `PowerShell exited with code ${code}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function outlookResultPage({ title, message, fallbackUrl = '', isError = false }) {
  const fallback = getSafeFallbackUrl(fallbackUrl);
  const fallbackHtml = fallback
    ? `<p><a href="${escapeHtml(fallback)}" target="_blank" rel="noopener">改用 Outlook Web 開啟</a></p>`
    : '';
  return `<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body{font-family:system-ui,"Noto Sans TC",sans-serif;margin:32px;color:#1C1917;background:#F7F6F3}
    main{max-width:560px;background:#fff;border:1px solid #E7E5E1;border-radius:8px;padding:24px}
    h1{font-size:18px;margin:0 0 10px;color:${isError ? '#C2410C' : '#1E3A5F'}}
    p{font-size:13px;line-height:1.65;color:#57534E}
    a{color:#1E3A5F;font-weight:600}
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${fallbackHtml}
  </main>
</body>
</html>`;
}

async function openOutlookMail(req, res, url) {
  if (!getSession(req)) return sendJson(res, 401, { error: 'Unauthorized' });

  const messageId = normalizeQueryText(url.searchParams.get('messageId'), 512).replace(/#\d+$/, '');
  const subject = normalizeQueryText(url.searchParams.get('subject'), 500);
  const receivedAt = normalizeQueryText(url.searchParams.get('receivedAt'), 64);
  const fallbackUrl = getSafeFallbackUrl(url.searchParams.get('fallback'));

  if (!subject && !messageId) {
    return sendHtml(res, 400, outlookResultPage({
      title: '無法開啟 Outlook 郵件',
      message: '缺少履歷推薦郵件定位資訊。',
      fallbackUrl,
      isError: true
    }));
  }

  if (process.platform !== 'win32') {
    return sendHtml(res, 501, outlookResultPage({
      title: '此環境無法開啟本機 Outlook',
      message: '本機 Outlook 開信功能只能在 Windows 本機 dashboard server 上使用。',
      fallbackUrl,
      isError: true
    }));
  }

  try {
    await runPowerShell(OUTLOOK_OPEN_SCRIPT, [messageId, subject, receivedAt], getOutlookOpenTimeoutMs());
    return sendHtml(res, 200, outlookResultPage({
      title: '已送出 Outlook 開信指令',
      message: '如果 Outlook 已安裝並登入同一個信箱，指定的履歷推薦郵件應該已經開啟。'
    }));
  } catch (error) {
    return sendHtml(res, 404, outlookResultPage({
      title: '找不到 Outlook 郵件',
      message: error.message || 'Outlook 沒有回傳可用的錯誤訊息。',
      fallbackUrl,
      isError: true
    }));
  }
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

async function forward104JobWrite(res, payload) {
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
      body: JSON.stringify(payload)
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(text);
  } catch (error) {
    if (error.name === 'AbortError') {
      return sendJson(res, 504, { error: '104 job upstream timed out' });
    }
    console.error(error);
    return sendJson(res, 502, { error: '104 job upstream unavailable' });
  } finally {
    clearTimeout(timer);
  }
}

async function proxy104JobSync(req, res) {
  if (!getSession(req)) return sendJson(res, 401, { error: 'Unauthorized' });
  if (!writeEnvReady()) return sendJson(res, 500, { error: '104 job sync API is not configured' });

  const body = await readBody(req, { maxBytes: SYNC_104_REQUEST_BODY_MAX_BYTES });
  const normalized = normalize104SyncPayload(body);
  if (normalized.error) return sendJson(res, 400, { error: normalized.error });

  return forward104JobWrite(res, {
    action: 'sync_104_jobs',
    jobs: normalized.value.jobs,
    contractVersion: normalized.value.contractVersion,
    syncedAt: normalized.value.syncedAt,
    sourceTotalCount: normalized.value.sourceTotalCount,
    publishedCount: normalized.value.publishedCount,
    scannedCount: normalized.value.scannedCount,
    complete: normalized.value.complete
  });
}

async function proxy104JobLink(req, res, externalId) {
  if (!getSession(req)) return sendJson(res, 401, { error: 'Unauthorized' });
  if (!writeEnvReady()) return sendJson(res, 500, { error: '104 job link API is not configured' });

  const body = await readBody(req);
  const normalized = normalize104JobLinkPayload(body);
  if (normalized.error) return sendJson(res, 400, { error: normalized.error });

  return forward104JobWrite(res, {
    action: 'link_external_job',
    provider: '104',
    externalId,
    jobRequisitionId: normalized.value
  });
}

async function proxy104JobPriorities(req, res) {
  if (!getSession(req)) return sendJson(res, 401, { error: 'Unauthorized' });
  if (!writeEnvReady()) return sendJson(res, 500, { error: '104 job priority API is not configured' });

  const body = await readBody(req, { maxBytes: SYNC_104_REQUEST_BODY_MAX_BYTES });
  const normalized = normalize104JobPrioritiesPayload(body);
  if (normalized.error) return sendJson(res, 400, { error: normalized.error });

  return forward104JobWrite(res, {
    action: 'update_104_job_priorities',
    jobs: normalized.value
  });
}

async function proxyCandidateUpdate(req, res, id) {
  if (!getSession(req)) return sendJson(res, 401, { error: 'Unauthorized' });
  if (!writeEnvReady()) return sendJson(res, 500, { error: 'Write API is not configured' });

  const body = await readBody(req);
  const allowedStatuses = ['withdrawn', 'rejected', 'dept_scheduling'];
  let webhookBody;
  if (body.department !== undefined) {
    const department = String(body.department || '').trim();
    if (!department) return sendJson(res, 400, { error: 'Department is required' });
    if (department.length > 200) return sendJson(res, 400, { error: 'Department is too long' });
    webhookBody = { action: 'update_candidate_department', candidateId: id, candidateDepartment: department };
  } else if (body.status && allowedStatuses.includes(body.status)) {
    webhookBody = { action: 'update_candidate_status', candidateId: id, candidateStatus: body.status };
  } else {
    return sendJson(res, 400, { error: 'Invalid status. Allowed: withdrawn, rejected, dept_scheduling' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getProxyTimeoutMs());
  try {
    const upstream = await fetch(buildWebhookUrl(N8N_WRITE_WEBHOOK_URL), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${N8N_TOKEN}` },
      body: JSON.stringify(webhookBody)
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

async function proxyOnboardingUpdate(req, res, id) {
  if (!getSession(req)) return sendJson(res, 401, { error: 'Unauthorized' });
  if (!writeEnvReady()) return sendJson(res, 500, { error: 'Write API is not configured' });

  const body = await readBody(req);
  const allowedStatuses = ['onboarded', 'no_show', 'pending', 'cancelled'];
  let action, onboardStatus;

  if (body.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return sendJson(res, 400, { error: 'Invalid date format' });
    action = 'update_onboard_date';
    onboardStatus = body.date;
  } else if (body.status) {
    if (!allowedStatuses.includes(body.status)) return sendJson(res, 400, { error: 'Invalid status' });
    action = 'update_onboard';
    onboardStatus = body.status;
  } else {
    return sendJson(res, 400, { error: 'Missing status or date' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getProxyTimeoutMs());
  try {
    const upstream = await fetch(buildWebhookUrl(N8N_WRITE_WEBHOOK_URL), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${N8N_TOKEN}` },
      body: JSON.stringify({ action, onboardId: id, onboardStatus })
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
    const jobSourceMatch = url.pathname.match(/^\/api\/job-requisition-sources\/104\/(\d+)$/);

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

    if (req.method === 'GET' && url.pathname === '/api/outlook/open') {
      return openOutlookMail(req, res, url);
    }

    if (req.method === 'POST' && url.pathname === '/api/job-requisitions/sync-104') {
      return await proxy104JobSync(req, res);
    }

    if (req.method === 'PATCH' && url.pathname === '/api/job-requisition-sources/104/priorities') {
      return await proxy104JobPriorities(req, res);
    }

    if (req.method === 'PATCH' && jobSourceMatch) {
      return await proxy104JobLink(req, res, jobSourceMatch[1]);
    }

    if (req.method === 'POST' && url.pathname === '/api/job-requisitions') {
      return proxyJobRequisitionWrite(req, res, 'create');
    }

    if (req.method === 'PATCH' && match?.[1]) {
      return proxyJobRequisitionWrite(req, res, 'update', Number(match[1]));
    }

    const candidateMatch = url.pathname.match(/^\/api\/candidates\/(\d+)$/);
    if (req.method === 'PATCH' && candidateMatch) {
      return proxyCandidateUpdate(req, res, Number(candidateMatch[1]));
    }

    const onboardMatch = url.pathname.match(/^\/api\/onboardings\/(\d+)$/);
    if (req.method === 'PATCH' && onboardMatch) {
      return proxyOnboardingUpdate(req, res, Number(onboardMatch[1]));
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    sendJson(res, 405, { error: 'Method Not Allowed' }, { Allow: 'GET,HEAD,POST,PATCH' });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return sendJson(res, error.statusCode, { error: error.message });
    }
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
