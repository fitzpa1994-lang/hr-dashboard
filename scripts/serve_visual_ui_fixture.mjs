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
    { name: '林美芳', dept: 'HR', pos: 'HR Specialist', date: '2026-05-28', hr: 'Yen', status: 'pending', emailLink: '' },
    { name: '張雅婷', dept: 'IT', pos: 'Data Analyst', date: '2026-05-20', hr: 'Peggy', status: 'onboarded', emailLink: '' }
  ],
  resignData: [
    { name: '陳志豪', dept: 'RF', pos: 'RF Engineer', lastDay: '2026-05-31', hr: 'Evan', reason: '個人生涯規劃', status: 'active', emailLink: '' }
  ],
  candidatesData: [
    {
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
    { name: '林美芳', pos: 'HR Specialist', dept: 'HR', date: '2026-05-18', latestDate: '2026-05-18', status: 'onboarded', hr: 'Yen', note: '已完成報到通知。', source: 'LinkedIn', emailLink: '', resumeLink: '', history: [] }
  ],
  jobsData: [
    { pos: '資深軟體工程師', dept: 'IT', open: '2026-05-01', target: '2026-06-15', headcount: 2, filled: 0, cands: 4, hired: 0, urgency: 5, status: 'open', note: '' }
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
  const html = await readFile(path.join(ROOT, 'dashboard', 'index.html'), 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Visual UI fixture: http://127.0.0.1:${PORT}`);
});
