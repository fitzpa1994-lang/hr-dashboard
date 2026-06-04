import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const n8nDir = path.join(root, 'n8n');

function findWorkflowFile(prefix) {
  const file = fs.readdirSync(n8nDir).find((name) => name.startsWith(prefix) && name.endsWith('.json'));
  if (!file) throw new Error(`Missing workflow export with prefix ${prefix}`);
  return path.join(n8nDir, file);
}

const WORKFLOW1_PATH = findWorkflowFile('live_Workflow1_');
const WORKFLOW2_PATH = findWorkflowFile('live_Workflow2_歷史匯入.json'.replace('.json', ''));
const WORKFLOW2_30DAY_PATH = findWorkflowFile('live_Workflow2_歷史匯入_近30天');
const WORKFLOW3_PATH = findWorkflowFile('live_Workflow3_');

const EXTRACTOR_CODE = String.raw`const item = $input.item.json;
const subject = String(item.subject || '');
const rawBody = String(item.body?.content || item.bodyPreview || '');
const body = rawBody
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/\s+/g, ' ')
  .trim();

const SKIP = new Set([
  '面試時間',
  '履歷推薦',
  '面談通知',
  '初試',
  '複試',
  'interview',
  '通知',
  '安排',
  '主管',
  '候選人',
  '應徵者',
  '人選',
]);

function normalizeCandidateName(value) {
  const cleaned = String(value || '')
    .replace(/^(?:RE|FW|FWD)\s*:\s*/gi, '')
    .replace(/[【】\[\]<>]/g, ' ')
    .replace(/(?:先生|小姐|同學|人選|候選人)$/g, '')
    .replace(/^[\s:,\-–—]+|[\s:,\-–—]+$/g, '')
    .replace(/\s+/g, '');

  if (!cleaned) return null;
  if (SKIP.has(cleaned)) return null;
  if (cleaned.length < 2 || cleaned.length > 20) return null;
  return cleaned;
}

let candidateName = null;
const subjectPatterns = [
  /[】-]\s*([^\s/、,()<>]{2,20})$/,
  /【[^】]+】[-–—]?\s*([^\s/、,()<>]{2,20})$/,
  /面試時間【[^】]+】[-–—]?\s*([^\s/、,()<>]{2,20})/,
];

for (const pattern of subjectPatterns) {
  const match = subject.match(pattern);
  if (!match?.[1]) continue;
  candidateName = normalizeCandidateName(match[1]);
  if (candidateName) break;
}

if (!candidateName && /[\/、,]/.test(subject)) {
  const tail = subject.split(/[】-]/).pop();
  candidateName = normalizeCandidateName(tail);
}

const searchText = subject + ' ' + body.slice(0, 800);
const baseYear = new Date(item.receivedDateTime || Date.now()).getFullYear();

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toDate(year, month, day) {
  return String(year) + '-' + pad2(month) + '-' + pad2(day);
}

let interviewDate = null;
const datePatterns = [
  { re: /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/, fn: (m) => toDate(m[1], m[2], m[3]) },
  { re: /(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/, fn: (m) => toDate(m[1], m[2], m[3]) },
  { re: /(\d{1,2})月\s*(\d{1,2})日/, fn: (m) => toDate(baseYear, m[1], m[2]) },
  { re: /(\d{1,2})[\/-](\d{1,2})/, fn: (m) => toDate(baseYear, m[1], m[2]) },
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
  let hour = Number(timeMatch[1]);
  const context = searchText.slice(Math.max(0, searchText.indexOf(timeMatch[0]) - 12), searchText.indexOf(timeMatch[0]) + 12);
  if (/(下午|PM|pm)/.test(context) && hour < 12) hour += 12;
  interviewTime = pad2(hour) + ':' + timeMatch[2];
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
  body_text: body.slice(0, 2000),
};`;

const SPLIT_MULTI_CANDIDATES_CODE = String.raw`const source = $input.item.json || {};

function splitCandidateNames(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value || value === '未知姓名') return [value || '未知姓名'];

  const cleaned = value
    .replace(/[()<>]/g, ' ')
    .replace(/(?:先生|小姐|同學|候選人|人選)/g, '')
    .replace(/\s+/g, '');

  const parts = cleaned
    .split(/[\/、,，+＋]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const names = (parts.length ? parts : [cleaned]).filter((name) => name.length >= 2 && name.length <= 20);
  return [...new Set(names)];
}

const candidateNames = splitCandidateNames(source.candidate_name);
const originalEmailMsgId = String(source.email_msg_id || '');

return candidateNames.map((candidateName, index) => ({
  json: {
    ...source,
    candidate_name: candidateName,
    original_email_msg_id: originalEmailMsgId,
    email_msg_id: candidateNames.length > 1 && originalEmailMsgId
      ? originalEmailMsgId + '#' + (index + 1)
      : originalEmailMsgId,
    multi_candidate_total: candidateNames.length,
    multi_candidate_index: index + 1,
    multi_candidate_names: candidateNames,
  },
}));`;

const ONBOARDING_INTEGRATION_CODE = String.raw`const base = $('Code：萃取 name_from_subject').item.json;
let aiResult = {};
try {
  const raw = $input.item.json.content;
  const text = Array.isArray(raw) ? (raw[0]?.text || '') : (typeof raw === 'string' ? raw : '');
  const match = text.match(/\{[\s\S]*\}/);
  if (match) aiResult = JSON.parse(match[0]);
} catch {}

let regexDate = null;
const bodyText = base.body_text || '';
const fallbackYear = String(new Date(base.received_at || Date.now()).getFullYear());
const datePatterns = [
  { re: /(?:報到日期|預定報到日期|預計於|改為|改到|延後到|延至|更改報到|調整報到)\s*(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/, fn: (m) => m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0') },
  { re: /(?:報到日期|預定報到日期|預計於|改為|改到|延後到|延至|更改報到|調整報到)\s*(\d{1,2})[\/\-月](\d{1,2})/, fn: (m) => fallbackYear+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0') },
];
for (const { re, fn } of datePatterns) {
  const m = bodyText.match(re);
  if (m) {
    regexDate = fn(m);
    break;
  }
}

return {
  email_msg_id: base.email_msg_id,
  email_subject: base.email_subject,
  email_web_link: base.email_web_link,
  sender: base.sender,
  received_at: base.received_at,
  source_type: 'onboarding',
  name: base.name_from_subject || aiResult.name || '未知姓名',
  scheduled_onboard_date: regexDate || aiResult.scheduled_onboard_date || null,
  department: aiResult.department || null,
  position: aiResult.position || null,
  hr_owner: aiResult.hr_owner || null,
  intent: aiResult.intent || 'new_onboard',
};`;

function patchWorkflow(filePath, patches) {
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const patch of patches) {
    const node = json.nodes.find((entry) => entry.id === patch.id);
    if (!node) throw new Error(`Missing node ${patch.id} in ${path.basename(filePath)}`);
    node.parameters = {
      ...node.parameters,
      mode: patch.mode || node.parameters?.mode,
      jsCode: patch.jsCode,
    };
  }
  fs.writeFileSync(filePath, JSON.stringify(json, null, 4), 'utf8');
}

patchWorkflow(WORKFLOW1_PATH, [
  { id: 'd265f169-59ed-42a6-a38c-ef5bca944e69', mode: 'runOnceForEachItem', jsCode: EXTRACTOR_CODE },
  { id: 'code-split-multi-candidates-001', mode: 'runOnceForEachItem', jsCode: SPLIT_MULTI_CANDIDATES_CODE },
]);

patchWorkflow(WORKFLOW2_PATH, [
  { id: '002204b0-1719-4a16-bc1f-965e28c071db', mode: 'runOnceForEachItem', jsCode: EXTRACTOR_CODE },
]);

patchWorkflow(WORKFLOW2_30DAY_PATH, [
  { id: 'code-parse-interview', mode: 'runOnceForEachItem', jsCode: EXTRACTOR_CODE },
]);

patchWorkflow(WORKFLOW3_PATH, [
  { id: 'code-integrate-onboard-001', mode: 'runOnceForEachItem', jsCode: ONBOARDING_INTEGRATION_CODE },
]);

console.log(JSON.stringify({
  patched: [
    path.relative(root, WORKFLOW1_PATH),
    path.relative(root, WORKFLOW2_PATH),
    path.relative(root, WORKFLOW2_30DAY_PATH),
    path.relative(root, WORKFLOW3_PATH),
  ],
}, null, 2));
