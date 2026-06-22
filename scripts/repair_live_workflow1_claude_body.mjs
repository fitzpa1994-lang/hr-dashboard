import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const N8N_DIR = path.join(ROOT, 'n8n');
const WORKFLOW_ID = 'pqnpr72wTiOE2m8I';
const BASE_URL = String(process.env.N8N_API_BASE_URL || process.env.N8N_API_URL || '').trim().replace(/\/+$/, '');
const API_KEY = String(process.env.N8N_API_KEY || '').trim();

const NODE_IDS = {
  extract: 'd265f169-59ed-42a6-a38c-ef5bca944e69',
  assemble: 'code-assemble-claude-body-001',
  claude: '25c4c840-44f9-4970-a775-f506acade7f0',
  merge: 'cb35b346-7ff3-42c8-b1ae-80a15dbd35cd',
  split: 'code-split-multi-candidates-001',
};

const NODE_NAMES = {
  extract: 'Code：萃取基本資訊',
  assemble: 'Code：組裝 Claude Request Body',
  claude: 'Claude：AI 解析意圖',
  merge: 'Code：整合輸出',
  split: 'Code：拆分多人推薦',
};

if (!BASE_URL) {
  throw new Error('Missing N8N_API_BASE_URL');
}

if (!API_KEY) {
  throw new Error('Missing N8N_API_KEY');
}

function findWorkflowExportPath() {
  const fileName = fs.readdirSync(N8N_DIR).find((entry) => entry.startsWith('live_Workflow1_') && entry.endsWith('.json'));
  if (!fileName) {
    throw new Error('Cannot find live_Workflow1 export file');
  }
  return path.join(N8N_DIR, fileName);
}

const WORKFLOW_PATH = findWorkflowExportPath();

const EXTRACT_JS = `const item = $input.item.json;
const subject = String(item.subject || '').trim();
const rawBody = item.body?.content || item.bodyPreview || '';
const body = String(rawBody)
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&#\\d+;/g, ' ')
  .replace(/\\s+/g, ' ')
  .trim();

const sender = typeof item.from === 'string'
  ? item.from
  : (item.from?.emailAddress?.address || item.sender?.emailAddress?.address || null);
const receivedAt = item.receivedDateTime || item.sentDateTime || item.createdDateTime || item.lastModifiedDateTime || new Date().toISOString();

const SKIP = new Set([
  '通知', '安排', '確認', '面試', '邀請', '時間',
  '地點', '更改', '更新', '推薦', '取消', '履歷',
  '回覆', 're', 'fw', 'fwd'
]);

const normalizeCandidate = (value) => String(value || '')
  .replace(/^(?:RE|FW|FWD)\\s*:\\s*/i, '')
  .replace(/[()]/g, ' ')
  .replace(/(?:先生|女士|小姐|同學)$/g, '')
  .replace(/\\s+/g, '')
  .trim();

const isLikelyCandidate = (value) => {
  if (!value) return false;
  if (value.length < 2 || value.length > 16) return false;
  if (SKIP.has(value.toLowerCase()) || SKIP.has(value)) return false;
  if (/^(?:面試時間|履歷推薦|面試安排|面試通知|錄取通知|新進人員通知)$/i.test(value)) return false;
  return /[\\u4e00-\\u9fa5A-Za-z]/.test(value);
};

let candidateName = null;
const subjectPatterns = [
  /[\\u3010\\[][^\\u3011\\]]+[\\u3011\\]]\\s*[\\-\\uff0d\\u2014\\u2013:\\uff1a]\\s*([^\\n]+?)\\s*$/,
  /[\\u3010\\[][^\\u3011\\]]+[\\u3011\\]]\\s*([^\\n]+?)\\s*$/,
  /[\\-\\uff0d\\u2014\\u2013:\\uff1a]\\s*([^\\n]+?)\\s*$/,
  /([^\\n]+?)\\s*(?:先生|女士|小姐)\\s*$/,
];
for (const pattern of subjectPatterns) {
  const match = subject.match(pattern);
  if (!match || !match[1]) continue;
  const normalized = normalizeCandidate(match[1]);
  if (isLikelyCandidate(normalized)) {
    candidateName = normalized;
    break;
  }
}

if (!candidateName) {
  const bodyNamePatterns = [
    /候選人[：: ]*([\\u4e00-\\u9fa5A-Za-z]{2,16})/,
    /姓名[：: ]*([\\u4e00-\\u9fa5A-Za-z]{2,16})/,
    /([\\u4e00-\\u9fa5]{2,4})\\s*(?:先生|女士|小姐)\\s*您好/,
  ];
  for (const pattern of bodyNamePatterns) {
    const match = body.match(pattern);
    if (!match || !match[1]) continue;
    const normalized = normalizeCandidate(match[1]);
    if (isLikelyCandidate(normalized)) {
      candidateName = normalized;
      break;
    }
  }
}

const explicitDepartmentMatch = body.match(/部門[：: ]*([^\\s，。,；;]+)/);
const explicitDepartment = explicitDepartmentMatch ? explicitDepartmentMatch[1].trim() : null;

const positionFromSubjectMatch = subject.match(/[\\u3010\\[]([^\\u3011\\]]+)[\\u3011\\]]/);
const explicitPositionMatch = body.match(/(?:職缺|職稱|應徵職位)[：: ]*([^\\n]+)/);
const inferredPosition = explicitPositionMatch
  ? explicitPositionMatch[1].trim()
  : (positionFromSubjectMatch ? positionFromSubjectMatch[1].trim() : null);

const deriveDepartment = (position, department, text) => {
  if (department) return department;
  const source = String(position || text || '');
  const patterns = [
    { re: /\\bICC\\b|ICC/, value: 'ICC' },
    { re: /WBU|SAR|RF\\s*PM|文件專員|文件組/, value: 'WBU' },
    { re: /新竹/, value: '新竹' },
    { re: /新華/, value: '新華' },
    { re: /安規|電池/, value: '安規' },
    { re: /董事長室|財務|行政|MIS|資訊部|軟體工程師/, value: '行政' },
  ];
  for (const entry of patterns) {
    if (entry.re.test(source)) return entry.value;
  }
  return null;
};

const inferredDepartment = deriveDepartment(inferredPosition, explicitDepartment, subject + ' ' + body);

const searchText = subject + ' ' + body.substring(0, 800);
const hasTentativeScheduling = /(可安排|皆可安排|可配合|可面試|可約|方便面試|請評估|再約|可於|起皆可)/.test(searchText);

let interviewDate = null;
if (!hasTentativeScheduling) {
  const currentYear = new Date(receivedAt || Date.now()).getFullYear();
  const datePatterns = [
    { re: /(\\d{4})年(\\d{1,2})月(\\d{1,2})日/, fn: (m) => m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') },
    { re: /(\\d{4})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{1,2})/, fn: (m) => m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') },
    { re: /(\\d{1,2})月(\\d{1,2})日/, fn: (m) => String(currentYear) + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') },
  ];
  for (const entry of datePatterns) {
    const match = searchText.match(entry.re);
    if (match) {
      interviewDate = entry.fn(match);
      break;
    }
  }
}

let interviewTime = null;
if (!hasTentativeScheduling) {
  const timeMatch = searchText.match(/(?:上午|下午|AM|PM|am|pm)?\\s*(\\d{1,2})[:：](\\d{2})/);
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const marker = timeMatch[0];
    if (/(下午|PM|pm)/.test(marker) && hour < 12) hour += 12;
    if (/(上午|AM|am)/.test(marker) && hour === 12) hour = 0;
    interviewTime = String(hour).padStart(2, '0') + ':' + timeMatch[2];
  }
}

return {
  email_msg_id: item.id,
  email_subject: subject,
  email_web_link: item.webLink || null,
  sender,
  received_at: receivedAt,
  candidate_name: candidateName,
  interview_date: interviewDate,
  interview_time: interviewTime,
  inferred_department: inferredDepartment,
  inferred_applied_position: inferredPosition,
  has_tentative_scheduling: hasTentativeScheduling,
  body_text: body.substring(0, 2000),
};`;

const ASSEMBLE_JS = `const item = $input.item.json;
return {
  model: "claude-haiku-4-5-20251001",
  max_tokens: 500,
  system: [
    "你是 HR 信件解析助手，請從信件中萃取結構化資訊並只輸出 JSON。",
    "若無法判定，請保守填 null 或「未知職位」/「未分類」。",
    "intent 僅可輸出 recommend|request_invite|schedule|update_time|cancel|second_schedule|other。",
    "request_invite 代表主管同意邀約但尚未有確定面試時間。",
    "schedule / second_schedule 代表已出現確定面試日期時間。",
    "主旨不是判斷唯一依據；即使主旨是 RE: 履歷推薦，只要內文明確出現已安排的日期時間，仍可判為 schedule。",
    "update_time 代表既有面試改期。",
    "cancel 代表取消面試或取消流程。",
    "若信中只是說 6/18 起可安排、方便時間、可配合時段，這不是 schedule，應偏向 request_invite。",
    "",
    "輸出欄位：",
    "- candidate_name",
    "- applied_position",
    "- department",
    "- interview_date",
    "- interview_time",
    "- round",
    "- location",
    "- hr_owner",
    "- status",
    "- intent",
    "- ai_action_item"
  ].join("\\n"),
  messages: [
    {
      role: "user",
      content: "主旨：" + (item.email_subject || "") + "\\n\\n內文：" + (item.body_text || "")
    }
  ]
};`;

const MERGE_JS = `const base = $('Code：萃取基本資訊').item.json;
let aiResult = {};
try {
  const raw = $input.item.json.content;
  const text = Array.isArray(raw) ? (raw[0]?.text || '') : (typeof raw === 'string' ? raw : '');
  const match = text.match(/\\{[\\s\\S]*\\}/);
  if (match) aiResult = JSON.parse(match[0]);
} catch (error) {}

const ns = (value) => {
  if (value === null || value === undefined) return 'null';
  const text = String(value).trim();
  if (text === '' || text === 'null' || text === 'undefined') return 'null';
  return text;
};

const intent = aiResult.intent || 'recommend';
const candidateStatus = intent === 'cancel'
  ? 'withdrawn'
  : (intent === 'request_invite'
      ? 'approved_to_invite'
      : (['recommend', 'other'].includes(intent) ? 'pending_review' : 'in_progress'));
const dbStatus = candidateStatus === 'approved_to_invite' ? 'pending_review' : candidateStatus;
const hrOwner = ns(aiResult.hr_owner);
const systemStageNote = candidateStatus === 'approved_to_invite'
  ? '[SYS_STAGE:approved_to_invite|HR:' + (hrOwner === 'null' ? '' : hrOwner) + ']'
  : '';

const inferredPosition = ns(base.inferred_applied_position) !== 'null' ? base.inferred_applied_position : null;
const inferredDepartment = ns(base.inferred_department) !== 'null' ? base.inferred_department : null;

const appliedPosition = ns(aiResult.applied_position) !== 'null'
  ? aiResult.applied_position
  : (inferredPosition || '未知職位');
const isWeakDepartment = (value) => {
  const text = String(value || '').trim();
  if (!text) return true;
  return ['未分類', '未知部門', '未知單位', '人力資源部', 'HR', 'HR部門'].includes(text);
};
const aiDepartment = ns(aiResult.department) !== 'null' ? aiResult.department : null;
const department = (!isWeakDepartment(aiDepartment) ? aiDepartment : null)
  || inferredDepartment
  || '未分類';

const forcePendingScheduling = ['request_invite', 'recommend', 'other'].includes(intent) || !!base.has_tentative_scheduling;
const interviewDate = forcePendingScheduling
  ? 'null'
  : ns(base.interview_date || aiResult.interview_date);
const interviewTime = forcePendingScheduling
  ? 'null'
  : ns(base.interview_time || aiResult.interview_time);

const interviewStatus = intent === 'cancel'
  ? 'cancelled'
  : (intent === 'update_time'
      ? 'rescheduled'
      : (['schedule', 'second_schedule'].includes(intent) ? 'scheduled' : 'pending'));

return {
  email_msg_id: base.email_msg_id,
  email_subject: base.email_subject,
  email_web_link: ns(base.email_web_link),
  sender: ns(base.sender),
  received_at: ns(base.received_at),
  candidate_name: base.candidate_name || aiResult.candidate_name || '未知姓名',
  applied_position: appliedPosition,
  department,
  interview_date: interviewDate,
  interview_time: interviewTime,
  round: Number(aiResult.round) || 1,
  location: ns(aiResult.location),
  hr_owner: hrOwner,
  intent,
  status: candidateStatus,
  db_status: dbStatus,
  system_stage_note: systemStageNote,
  interview_status: interviewStatus,
};`;

const SPLIT_JS = `function splitCandidateNames(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value || value === '未知姓名') return [value || '未知姓名'];

  const cleaned = value
    .replace(/[()]/g, ' ')
    .replace(/(?:先生|女士|小姐|同學)/g, '')
    .replace(/\\s+/g, '');

  const parts = cleaned
    .split(/[\\/,;、，；]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const names = (parts.length ? parts : [cleaned]).filter((name) => name.length >= 2 && name.length <= 12);
  return [...new Set(names)];
}

return $input.all().flatMap((entry) => {
  const item = entry.json || {};
  const candidateNames = splitCandidateNames(item.candidate_name);
  const originalEmailMsgId = String(item.email_msg_id || '');

  return candidateNames.map((candidateName, index) => ({
    json: {
      ...item,
      candidate_name: candidateName,
      original_email_msg_id: originalEmailMsgId,
      email_msg_id: candidateNames.length > 1 && originalEmailMsgId ? originalEmailMsgId + '#' + (index + 1) : originalEmailMsgId,
      multi_candidate_total: candidateNames.length,
      multi_candidate_index: index + 1,
      multi_candidate_names: candidateNames,
    }
  }));
});`;

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${url} failed: ${response.status} ${text.slice(0, 400)}`);
  }
  return json;
}

function getNode(workflow, id) {
  const node = workflow.nodes.find((entry) => entry.id === id);
  if (!node) {
    throw new Error(`Missing node id: ${id}`);
  }
  return node;
}

function repairWorkflow(workflow) {
  const extractNode = getNode(workflow, NODE_IDS.extract);
  extractNode.name = NODE_NAMES.extract;
  extractNode.type = 'n8n-nodes-base.code';
  extractNode.typeVersion = 2;
  extractNode.parameters = {
    mode: 'runOnceForEachItem',
    jsCode: EXTRACT_JS,
  };

  const assembleNode = getNode(workflow, NODE_IDS.assemble);
  assembleNode.name = NODE_NAMES.assemble;
  assembleNode.type = 'n8n-nodes-base.code';
  assembleNode.typeVersion = 2;
  assembleNode.position = [2048, 320];
  assembleNode.parameters = {
    mode: 'runOnceForEachItem',
    jsCode: ASSEMBLE_JS,
  };

  const claudeNode = getNode(workflow, NODE_IDS.claude);
  claudeNode.name = NODE_NAMES.claude;
  claudeNode.parameters.jsonBody = '={{ $json }}';

  const mergeNode = getNode(workflow, NODE_IDS.merge);
  mergeNode.name = NODE_NAMES.merge;
  mergeNode.type = 'n8n-nodes-base.code';
  mergeNode.typeVersion = 2;
  mergeNode.parameters = {
    mode: 'runOnceForEachItem',
    jsCode: MERGE_JS,
  };

  const splitNode = getNode(workflow, NODE_IDS.split);
  splitNode.name = NODE_NAMES.split;
  splitNode.type = 'n8n-nodes-base.code';
  splitNode.typeVersion = 2;
  splitNode.position = [2608, 320];
  splitNode.parameters = {
    mode: 'runOnceForAllItems',
    jsCode: SPLIT_JS,
  };

  workflow.connections[NODE_NAMES.extract] = {
    main: [[{ node: NODE_NAMES.assemble, type: 'main', index: 0 }]],
  };
  workflow.connections[NODE_NAMES.assemble] = {
    main: [[{ node: NODE_NAMES.claude, type: 'main', index: 0 }]],
  };
  workflow.connections[NODE_NAMES.claude] = {
    main: [[{ node: NODE_NAMES.merge, type: 'main', index: 0 }]],
  };
  workflow.connections[NODE_NAMES.merge] = {
    main: [[{ node: NODE_NAMES.split, type: 'main', index: 0 }]],
  };
  workflow.connections[NODE_NAMES.split] = {
    main: [[{ node: 'PG：寫入 candidates', type: 'main', index: 0 }]],
  };

  return workflow;
}

const headers = {
  'Content-Type': 'application/json',
  'X-N8N-API-KEY': API_KEY,
};

const workflowUrl = `${BASE_URL}/workflows/${WORKFLOW_ID}`;
const liveWorkflow = await requestJson(workflowUrl, { headers });
const repaired = repairWorkflow(liveWorkflow);

const payload = {
  name: repaired.name,
  nodes: repaired.nodes,
  connections: repaired.connections,
};

if (repaired.settings?.executionOrder) {
  payload.settings = { executionOrder: repaired.settings.executionOrder };
}

await requestJson(workflowUrl, {
  method: 'PUT',
  headers,
  body: JSON.stringify(payload),
});

const after = await requestJson(workflowUrl, { headers });
fs.writeFileSync(WORKFLOW_PATH, `${JSON.stringify(after, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  workflowId: WORKFLOW_ID,
  updatedAt: after.updatedAt,
  localPath: WORKFLOW_PATH,
}, null, 2));
