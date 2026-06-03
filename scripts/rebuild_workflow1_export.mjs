import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const BASE_URL = String(process.env.N8N_API_BASE_URL || process.env.N8N_API_URL || '').trim().replace(/\/+$/, '');
const API_KEY = String(process.env.N8N_API_KEY || '').trim();
const WORKFLOW_ID = 'pqnpr72wTiOE2m8I';
const EXPORT_PATH = path.join(ROOT, 'n8n', 'live_Workflow1_面試解析.json');

const EXTRACTOR_CODE = String.raw`const item = $input.item.json;
const subject = item.subject || '';
const rawBody = item.body?.content || item.bodyPreview || '';
const body = rawBody
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&#\d+;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const SKIP = new Set(['通知', '安排', '確認', '面試', '邀請', '時間', '地點', '更改', '更新', '推薦', '取消', '履歷', '回覆']);
let candidateName = null;

const namePatterns = [
  /【[^】]*】\s*[-－—–_~～:：]\s*([a-zA-Z\u4e00-\u9fa5/／、,，\s]{2,30})/,
  /[-－—–_~～:：]\s*([a-zA-Z\u4e00-\u9fa5/／、,，\s]{2,30})\s*$/,
  /】\s*([a-zA-Z\u4e00-\u9fa5]{2,10})\s*(?:先生|女士|小姐)/
];

for (const pattern of namePatterns) {
  const match = subject.match(pattern);
  if (!match || !match[1]) continue;
  const rawCandidate = match[1].trim().replace(/^(?:先生|女士|小姐)\s*/, '');
  const compactCandidate = rawCandidate.replace(/\s+/g, '');
  if (!compactCandidate || compactCandidate.length > 30 || SKIP.has(compactCandidate)) continue;
  candidateName = compactCandidate;
  break;
}

if (!candidateName && /[-－—–_~～:：]/.test(subject)) {
  const parts = subject.split(/[-－—–_~～:：]/);
  const possibleName = String(parts[parts.length - 1] || '').trim().replace(/\s+/g, '');
  if (possibleName.length >= 2 && possibleName.length <= 30 && !SKIP.has(possibleName)) {
    candidateName = possibleName;
  }
}

let interviewDate = null;
const searchText = subject + ' ' + body.substring(0, 800);
const datePatterns = [
  { re: /(\d{4})年(\d{1,2})月(\d{1,2})日/, fn: m => m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') },
  { re: /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/, fn: m => m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') },
  { re: /(\d{1,2})月(\d{1,2})日/, fn: m => String(new Date().getFullYear()) + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') },
  { re: /(\d{1,2})[\/\-](\d{1,2})/, fn: m => String(new Date().getFullYear()) + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') },
];
for (const { re, fn } of datePatterns) {
  const match = searchText.match(re);
  if (match) {
    interviewDate = fn(match);
    break;
  }
}

let interviewTime = null;
const timeMatch = searchText.match(/(\d{1,2})[:：](\d{2})/);
if (timeMatch) {
  interviewTime = timeMatch[1].padStart(2, '0') + ':' + timeMatch[2];
}

return {
  email_msg_id: item.id,
  email_subject: subject,
  email_web_link: item.webLink || null,
  sender: item.from?.emailAddress?.address || null,
  received_at: item.receivedDateTime,
  candidate_name: candidateName,
  interview_date: interviewDate,
  interview_time: interviewTime,
  body_text: body.substring(0, 2000),
};`;

const CLAUDE_REQUEST_CODE = String.raw`const item = $input.item.json;
return {
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 500,
  system: [
    '你是 HR 招募郵件解析助手，只能輸出 JSON。',
    '請從郵件主旨與內文判斷：candidate_name、applied_position、department、interview_date、interview_time、round、location、hr_owner、status、intent、ai_action_item。',
    'intent 只能是 recommend|request_invite|schedule|update_time|cancel|second_schedule|other。',
    '日期格式 YYYY-MM-DD；時間格式 HH:MM；沒有值就回 null。',
    'status 只用 pending_review、in_progress、withdrawn。',
    '不要輸出任何解釋文字。'
  ].join('\n'),
  messages: [
    {
      role: 'user',
      content: '主旨：' + item.email_subject + '\n\n' + item.body_text
    }
  ]
};`;

const SPLIT_MULTI_CANDIDATES_CODE = String.raw`const item = $input.item.json;

function splitCandidateNames(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value || value === '未知姓名') return [value || '未知姓名'];

  const cleaned = value
    .replace(/[()（）]/g, ' ')
    .replace(/(?:先生|女士|小姐|同學)/g, '')
    .replace(/\s+/g, '');

  const parts = cleaned
    .split(/[\/／、,，;；]+/)
    .map(part => part.trim())
    .filter(Boolean);

  const names = (parts.length ? parts : [cleaned]).filter(name => name.length >= 2 && name.length <= 12);
  return [...new Set(names)];
}

const candidateNames = splitCandidateNames(item.candidate_name);
const originalEmailMsgId = String(item.email_msg_id || '');

return candidateNames.map((candidateName, index) => ({
  ...item,
  candidate_name: candidateName,
  original_email_msg_id: originalEmailMsgId,
  email_msg_id: candidateNames.length > 1 && originalEmailMsgId ? originalEmailMsgId + '#' + (index + 1) : originalEmailMsgId,
  multi_candidate_total: candidateNames.length,
  multi_candidate_index: index + 1,
  multi_candidate_names: candidateNames,
}));`;

const EXPECTED_ORDER = [
  'Outlook 收信觸發',
  'IF：主旨過濾',
  'Code：萃取基本資訊',
  'Code：非面試信件略過',
  'PG：記錄略過信件',
  'Code：組裝 Claude Request Body',
  'Claude：AI 解析意圖',
  'Code：整合輸出',
  'Code：拆分多人推薦',
  'PG：寫入 candidates',
  'PG：寫入 interviews',
  'PG：寫入 email_logs',
];

const EXPECTED_CONNECTIONS = {
  'Outlook 收信觸發': {
    main: [[{ node: 'IF：主旨過濾', type: 'main', index: 0 }]],
  },
  'IF：主旨過濾': {
    main: [
      [{ node: 'Code：萃取基本資訊', type: 'main', index: 0 }],
      [{ node: 'Code：非面試信件略過', type: 'main', index: 0 }],
    ],
  },
  'Code：萃取基本資訊': {
    main: [[{ node: 'Code：組裝 Claude Request Body', type: 'main', index: 0 }]],
  },
  'Code：組裝 Claude Request Body': {
    main: [[{ node: 'Claude：AI 解析意圖', type: 'main', index: 0 }]],
  },
  'Claude：AI 解析意圖': {
    main: [[{ node: 'Code：整合輸出', type: 'main', index: 0 }]],
  },
  'Code：整合輸出': {
    main: [[{ node: 'Code：拆分多人推薦', type: 'main', index: 0 }]],
  },
  'Code：拆分多人推薦': {
    main: [[{ node: 'PG：寫入 candidates', type: 'main', index: 0 }]],
  },
  'PG：寫入 candidates': {
    main: [[{ node: 'PG：寫入 interviews', type: 'main', index: 0 }]],
  },
  'PG：寫入 interviews': {
    main: [[{ node: 'PG：寫入 email_logs', type: 'main', index: 0 }]],
  },
  'Code：非面試信件略過': {
    main: [[{ node: 'PG：記錄略過信件', type: 'main', index: 0 }]],
  },
};

function assertEnv() {
  if (!BASE_URL) throw new Error('Missing N8N_API_BASE_URL or N8N_API_URL');
  if (!API_KEY) throw new Error('Missing N8N_API_KEY');
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${url} failed: status=${res.status}; body=${text.slice(0, 300)}`);
  }
  return json;
}

function dedupeNodes(nodes) {
  const byName = new Map();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node?.name) continue;
    if (!byName.has(node.name)) byName.set(node.name, node);
  }

  const ordered = [];
  for (const name of EXPECTED_ORDER) {
    const node = byName.get(name);
    if (!node) throw new Error(`Workflow 1 is missing required node: ${name}`);
    ordered.push(node);
  }
  return ordered;
}

function patchNodes(nodes) {
  for (const node of nodes) {
    if (node.name === 'Code：萃取基本資訊') {
      node.parameters = { ...node.parameters, mode: 'runOnceForEachItem', jsCode: EXTRACTOR_CODE };
    }
    if (node.name === 'Code：組裝 Claude Request Body') {
      node.parameters = { ...node.parameters, mode: 'runOnceForEachItem', jsCode: CLAUDE_REQUEST_CODE };
    }
    if (node.name === 'Code：拆分多人推薦') {
      node.parameters = { ...node.parameters, mode: 'runOnceForEachItem', jsCode: SPLIT_MULTI_CANDIDATES_CODE };
    }
    if (node.name === 'IF：主旨過濾') {
      node.parameters = {
        ...node.parameters,
        conditions: {
          options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 1,
          },
          conditions: [
            {
              id: 'kw-filter',
              leftValue: '={{ $json.subject }}',
              rightValue: '.*(面試|面談|初試|複試|面試通知|面談通知|interview|履歷推薦).*',
              operator: {
                type: 'string',
                operation: 'regex',
              },
            },
          ],
          combinator: 'and',
        },
      };
    }
    if (node.name === 'Claude：AI 解析意圖') {
      node.parameters = { ...node.parameters, jsonBody: '={{ $json }}' };
    }
  }
  return nodes;
}

async function main() {
  assertEnv();
  const headers = {
    'Content-Type': 'application/json',
    'X-N8N-API-KEY': API_KEY,
  };
  const live = await requestJson(`${BASE_URL}/workflows/${WORKFLOW_ID}`, { headers });
  const nodes = patchNodes(dedupeNodes(live.nodes));

  const output = {
    updatedAt: live.updatedAt || null,
    createdAt: live.createdAt || null,
    id: WORKFLOW_ID,
    name: 'HR Workflow 1：面試信件解析',
    description: live.description ?? null,
    active: live.active ?? true,
    isArchived: live.isArchived ?? false,
    nodes,
    connections: EXPECTED_CONNECTIONS,
    settings: live.settings || {},
  };

  fs.writeFileSync(EXPORT_PATH, JSON.stringify(output, null, 4), 'utf8');
  JSON.parse(fs.readFileSync(EXPORT_PATH, 'utf8'));

  console.log(JSON.stringify({
    exportPath: EXPORT_PATH,
    workflowId: WORKFLOW_ID,
    nodeCount: nodes.length,
    active: output.active,
    updatedAt: output.updatedAt,
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || String(error));
  process.exit(1);
});
