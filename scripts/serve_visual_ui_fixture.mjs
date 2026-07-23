import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.VISUAL_UI_PORT || 19083);

const payload = {
  today: '2026-05-28',
  generatedAt: '2026-05-28T09:30:00',
  schedEvents: [
    { type: 'interview', name: '王小明', pos: '資深軟體工程師', dept: 'IT', date: '2026-05-28', time: '10:00', hr: 'Peggy', round: 2, note: 'Teams 線上面試', emailLink: '' },
    { type: 'onboard', name: '林美芳', pos: 'HR Specialist', dept: 'HR', date: '2026-05-28', time: '09:00', hr: 'Yen', emailLink: '' },
    { type: 'resign', name: '陳志豪', pos: 'RF Engineer', dept: 'RF', date: '2026-05-31', time: '', hr: 'Evan', note: '本週最後工作日', emailLink: '' }
  ],
  onboardData: [
    { id: 201, name: '林美芳', dept: 'HR', pos: 'HR Specialist', date: '2026-05-28', hr: 'Yen', status: 'pending', emailLink: '' },
    { id: 202, name: '張雅婷', dept: 'IT', pos: 'Data Analyst', date: '2026-05-20', hr: 'Peggy', status: 'onboarded', emailLink: '' },
    { id: 203, name: '吳建霖', dept: 'RF', pos: 'RF Engineer', date: '2026-05-10', hr: 'Evan', status: 'pending', emailLink: '' }
  ],
  resignData: [
    { name: '陳志豪', dept: 'RF', pos: 'RF Engineer', lastDay: '2026-05-31', hr: 'Evan', reason: '個人生涯規劃', status: 'active', emailLink: '' }
  ],
  candidatesData: [
    {
      id: 301,
      name: '王小明',
      pos: '資深軟體工程師',
      dept: 'IT',
      date: '2026-05-28',
      latestDate: '2026-05-28',
      status: 'pending_review',
      hr: 'Peggy',
      note: '待確認可面試時段，履歷符合 senior backend 需求，需追蹤英文溝通能力。',
      source: '104',
      emailLink: '',
      resumeLink: '',
      history: [{ date: '2026-05-28', type: 'interview', title: '第2輪面試 - scheduled', note: 'Teams 線上面試', color: 'blue' }]
    },
    { id: 302, name: '林美芳', pos: 'HR Specialist', dept: 'HR', date: '2026-05-18', latestDate: '2026-05-18', status: 'onboarded', hr: 'Yen', note: '已完成報到通知。', source: 'LinkedIn', emailLink: '', resumeLink: '', history: [] },
    { id: 303, name: '陳小華', pos: '未分類職缺', dept: '', date: '2026-05-15', latestDate: '2026-05-15', status: 'pending_review', hr: '', note: '', source: 'Email', emailLink: '', resumeLink: '', history: [] }
  ],
  jobsData: [
    { id: 1, pos: '資深軟體工程師', dept: 'IT', open: '2026-05-01', target: '2026-06-15', headcount: 2, filled: 0, cands: 4, hired: 0, urgency: 5, status: 'open', note: '' },
    { id: 2, pos: '行政專員', dept: '行政 / 人資部', open: '2026-05-03', target: '2026-06-20', headcount: 0, filled: 1, cands: 2, hired: 1, urgency: 2, status: 'filled', note: '已補滿，等待 104 下架確認。' }
  ],
  external104Sync: { hasSnapshot: true, source: '104', contractVersion: 2, sourceTotalCount: 3, publishedCount: 3, lastSyncAt: '2026-07-20T03:30:00Z' },
  external104Jobs: [
    { externalId: '123456', jobRequisitionId: 1, title: '資深軟體工程師（台北）', url: 'https://vip.104.com.tw/job/jobmaster?jobno=123456', updatedDate: '07/20', status: 'open', firstSeenAt: '2026-07-20T02:00:00Z', lastSeenAt: '2026-07-20T03:30:00Z', lastSyncedAt: '2026-07-20T03:30:00Z' },
    { externalId: '654321', jobRequisitionId: null, title: 'RF 測試工程師', url: 'https://vip.104.com.tw/job/jobmaster?jobno=654321', updatedDate: '07/19', status: 'open', firstSeenAt: '2026-07-20T02:00:00Z', lastSeenAt: '2026-07-20T03:30:00Z', lastSyncedAt: '2026-07-20T03:30:00Z' },
    { externalId: '777777', jobRequisitionId: 2, title: '行政專員', url: 'https://vip.104.com.tw/job/jobmaster?jobno=777777', updatedDate: '07/18', status: 'open', firstSeenAt: '2026-07-20T02:00:00Z', lastSeenAt: '2026-07-20T03:30:00Z', lastSyncedAt: '2026-07-20T03:30:00Z' }
  ],
  monthlyTrend: [
    { month: '2026-03', interviews: 8, offers: 2, onboarded: 1 },
    { month: '2026-04', interviews: 12, offers: 3, onboarded: 2 },
    { month: '2026-05', interviews: 15, offers: 4, onboarded: 2 }
  ],
  departmentStats: [
    { dept: 'IT', candidates: 4, hired: 0, avgDaysToOffer: 18 },
    { dept: 'HR', candidates: 2, hired: 1, avgDaysToOffer: 12 }
  ],
  monthlyFunnelByDepartment: [
    { department: 'ICC', month: '2026-03', recommend: 6, interview: 3, onboard: 1, resign: 0 },
    { department: 'ICC', month: '2026-04', recommend: 9, interview: 5, onboard: 2, resign: 1 },
    { department: 'ICC', month: '2026-05', recommend: 12, interview: 6, onboard: 0, resign: 0 },
    { department: 'WBU', month: '2026-03', recommend: 2, interview: 1, onboard: 1, resign: 0 },
    { department: 'WBU', month: '2026-04', recommend: 3, interview: 2, onboard: 0, resign: 0 },
    { department: 'WBU', month: '2026-05', recommend: 4, interview: 2, onboard: 1, resign: 0 },
    { department: '安規', month: '2026-03', recommend: 4, interview: 2, onboard: 0, resign: 1 },
    { department: '安規', month: '2026-04', recommend: 5, interview: 3, onboard: 1, resign: 0 },
    { department: '安規', month: '2026-05', recommend: 3, interview: 1, onboard: 0, resign: 1 }
  ],
  monthlyFunnelByJob: [
    { job_requisition_id: 1, department: 'ICC', position_title: '資深軟體工程師', month: '2026-04', recommend: 6, interview: 3 },
    { job_requisition_id: 1, department: 'ICC', position_title: '資深軟體工程師', month: '2026-05', recommend: 8, interview: 4 },
    { job_requisition_id: 2, department: '行政', position_title: '行政專員', month: '2026-05', recommend: 2, interview: 2 }
  ],
  stats: {
    activeCount: 4,
    offerCount: 1,
    pendingOnboard: 1,
    pendingResign: 1,
    monthOnboard: 2,
    monthResign: 1,
    hireRate: 27,
    pendingReviewCount: 1,
    avgDaysToOffer: 15
  }
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/session') return sendJson(res, 200, { authenticated: true });
  if (url.pathname === '/api/login') return sendJson(res, 200, { authenticated: true });
  if (url.pathname === '/api/logout') return sendJson(res, 200, { authenticated: false });
  if (url.pathname === '/api/hr-dashboard') return sendJson(res, 200, payload);
  const onboardMatch = url.pathname.match(/^\/api\/onboardings\/(\d+)$/);
  if (req.method === 'PATCH' && onboardMatch) {
    const id = Number(onboardMatch[1]);
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = body ? JSON.parse(body) : {};
    const item = payload.onboardData.find(o => o.id === id);
    if (item && parsed.status) item.status = parsed.status;
    if (item && parsed.date) item.date = parsed.date;
    return sendJson(res, 200, { ok: true });
  }
  const candidateMatch = url.pathname.match(/^\/api\/candidates\/(\d+)$/);
  if (req.method === 'PATCH' && candidateMatch) {
    const id = Number(candidateMatch[1]);
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = body ? JSON.parse(body) : {};
    const item = payload.candidatesData.find(c => c.id === id);
    if (item && parsed.department) item.dept = parsed.department;
    if (item && parsed.status) item.status = parsed.status;
    return sendJson(res, 200, { ok: true });
  }
  const html = await readFile(path.join(ROOT, 'dashboard', 'index.html'), 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Visual UI fixture: http://127.0.0.1:${PORT}`);
});
