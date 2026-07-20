import http from 'node:http';
import { once } from 'node:events';

const APP_PORT = Number(process.env.VISUAL_APP_PORT || 19081);
const MOCK_PORT = Number(process.env.VISUAL_MOCK_PORT || 19082);
const PASSWORD = process.env.VISUAL_PASSWORD || 'visual-password';
const TOKEN = process.env.VISUAL_TOKEN || 'visual-token';

function listen(server, port) {
  server.listen(port, '127.0.0.1');
  return once(server, 'listening');
}

const mockPayload = {
  today: '2026-05-28',
  generatedAt: '2026-05-28T09:30:00',
  schedEvents: [
    {
      type: 'interview',
      name: '王小明',
      pos: '資深軟體工程師',
      dept: 'IT',
      date: '2026-05-28',
      time: '10:00',
      hr: 'Peggy',
      round: 2,
      note: 'Teams 線上面試',
      emailLink: ''
    },
    {
      type: 'onboard',
      name: '林美芳',
      pos: 'HR Specialist',
      dept: 'HR',
      date: '2026-05-28',
      time: '09:00',
      hr: 'Yen',
      emailLink: ''
    },
    {
      type: 'resign',
      name: '陳志豪',
      pos: 'RF Engineer',
      dept: 'RF',
      date: '2026-05-31',
      time: '',
      hr: 'Evan',
      note: '本週最後工作日',
      emailLink: ''
    }
  ],
  onboardData: [
    {
      name: '林美芳',
      dept: 'HR',
      pos: 'HR Specialist',
      date: '2026-05-28',
      hr: 'Yen',
      status: 'pending',
      emailLink: ''
    },
    {
      name: '張雅婷',
      dept: 'IT',
      pos: 'Data Analyst',
      date: '2026-05-20',
      hr: 'Peggy',
      status: 'onboarded',
      emailLink: ''
    }
  ],
  resignData: [
    {
      name: '陳志豪',
      dept: 'RF',
      pos: 'RF Engineer',
      lastDay: '2026-05-31',
      hr: 'Evan',
      reason: '個人生涯規劃',
      status: 'active',
      emailLink: ''
    }
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
      history: [
        { date: '2026-05-28', type: 'interview', title: '第2輪面試 - scheduled', note: 'Teams 線上面試', color: 'blue' }
      ]
    },
    {
      name: '林美芳',
      pos: 'HR Specialist',
      dept: 'HR',
      date: '2026-05-18',
      latestDate: '2026-05-18',
      status: 'onboarded',
      hr: 'Yen',
      note: '已完成報到通知。',
      source: 'LinkedIn',
      emailLink: '',
      resumeLink: '',
      history: []
    }
  ],
  jobsData: [
    {
      id: 1,
      pos: '資深軟體工程師',
      dept: 'IT',
      open: '2026-05-01',
      target: '2026-06-15',
      headcount: 2,
      filled: 0,
      cands: 4,
      hired: 0,
      urgency: 5,
      status: 'open',
      note: ''
    },
    {
      id: 2,
      pos: '行政專員',
      dept: '行政 / 人資部',
      open: '2026-05-03',
      target: '2026-06-20',
      headcount: 0,
      filled: 1,
      cands: 2,
      hired: 1,
      urgency: 2,
      status: 'filled',
      note: '已補滿，等待 104 下架確認。'
    }
  ],
  external104Sync: {
    hasSnapshot: true,
    source: '104',
    contractVersion: 2,
    sourceTotalCount: 3,
    publishedCount: 3,
    lastSyncAt: '2026-07-20T03:30:00Z'
  },
  external104Jobs: [
    {
      externalId: '123456',
      jobRequisitionId: 1,
      title: '資深軟體工程師（台北）',
      url: 'https://vip.104.com.tw/job/jobmaster?jobno=123456',
      updatedDate: '07/20',
      status: 'open',
      firstSeenAt: '2026-07-20T02:00:00Z',
      lastSeenAt: '2026-07-20T03:30:00Z',
      lastSyncedAt: '2026-07-20T03:30:00Z'
    },
    {
      externalId: '654321',
      jobRequisitionId: null,
      title: 'RF 測試工程師',
      url: 'https://vip.104.com.tw/job/jobmaster?jobno=654321',
      updatedDate: '07/19',
      status: 'open',
      firstSeenAt: '2026-07-20T02:00:00Z',
      lastSeenAt: '2026-07-20T03:30:00Z',
      lastSyncedAt: '2026-07-20T03:30:00Z'
    },
    {
      externalId: '777777',
      jobRequisitionId: 2,
      title: '行政專員',
      url: 'https://vip.104.com.tw/job/jobmaster?jobno=777777',
      updatedDate: '07/18',
      status: 'open',
      firstSeenAt: '2026-07-20T02:00:00Z',
      lastSeenAt: '2026-07-20T03:30:00Z',
      lastSyncedAt: '2026-07-20T03:30:00Z'
    }
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

const mockServer = http.createServer((req, res) => {
  const auth = req.headers.authorization || '';
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (auth !== `Bearer ${TOKEN}` || url.searchParams.get('token') !== TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(mockPayload));
});

process.env.PORT = String(APP_PORT);
process.env.HR_DASHBOARD_PASSWORD = PASSWORD;
process.env.SESSION_SECRET = 'visual-session-secret';
process.env.N8N_HR_WEBHOOK_URL = `http://127.0.0.1:${MOCK_PORT}/webhook/hr-dashboard`;
process.env.N8N_HR_TOKEN = TOKEN;

const { server: dashboardServer } = await import('../dashboard/server.js');

await listen(mockServer, MOCK_PORT);
await listen(dashboardServer, APP_PORT);

console.log(`Visual fixture dashboard: http://127.0.0.1:${APP_PORT}`);
console.log(`Password: ${PASSWORD}`);

async function shutdown() {
  dashboardServer.close();
  mockServer.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
