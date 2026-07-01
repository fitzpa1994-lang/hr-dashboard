import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const n8nDir = path.join(root, 'n8n');
const workflowFile = fs.readdirSync(n8nDir).find((name) => name.startsWith('live_Workflow1_') && name.endsWith('.json'));

if (!workflowFile) {
  throw new Error('Cannot find live_Workflow1 export');
}

const workflowPath = path.join(n8nDir, workflowFile);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const extractNode = workflow.nodes.find((node) => node.id === 'd265f169-59ed-42a6-a38c-ef5bca944e69');
if (!extractNode) {
  throw new Error('Missing extract node in Workflow1 export');
}

const filterNode = workflow.nodes.find((node) => node.id === '210917e7-a74c-49e3-8d4d-afb1c05e6ca7');
if (!filterNode) {
  throw new Error('Missing subject filter node in Workflow1 export');
}

const extractJs = String(extractNode.parameters?.jsCode || '');
if (!extractJs.includes("const normalizeCandidate = (value) => String(value || '')")) {
  throw new Error('Expected normalizeCandidate block not found');
}
if (!extractJs.includes('const explicitDepartmentMatch =')) {
  throw new Error('Expected extract block boundary not found');
}

const replacementBlock = String.raw`const NEWSLETTER_HINTS = /(電子報|newsletter|訂閱|課程|方案都有解)/iu;

const normalizeCandidate = (value) => String(value || '')
  .replace(/^(?:RE|FW|FWD)\s*:\s*/i, '')
  .replace(/[()（）]/g, ' ')
  .replace(/(?:先生|女士|小姐|同學|您好)$/g, '')
  .replace(/^[\s\-－—–:：]+/g, '')
  .replace(/[\s\-－—–:：]+$/g, '')
  .replace(/\s+/g, '')
  .trim();

const extractTailCandidate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const pieces = raw
    .split(/[\-－—–:：]{1,}/)
    .map((part) => normalizeCandidate(part))
    .filter(Boolean);
  if (!pieces.length) return '';
  return pieces[pieces.length - 1];
};

const isLikelyCandidate = (value) => {
  if (!value) return false;
  if (value.length < 2 || value.length > 20) return false;
  if (SKIP.has(value.toLowerCase()) || SKIP.has(value)) return false;
  if (/^(?:面試時間|履歷推薦|面試安排|面試通知|錄取通知|新進人員通知)$/i.test(value)) return false;
  if (NEWSLETTER_HINTS.test(value)) return false;
  if (/[【】\[\]（）()]/.test(value)) return false;
  if (/^[\u4e00-\u9fa5]{2,5}$/.test(value)) return true;
  if (/^[A-Za-z][A-Za-z.'-]{1,30}$/.test(value)) return true;
  return false;
};

let candidateName = null;
const subjectCandidates = [
  subject.match(/[\u3010\[][^\u3011\]]+[\u3011\]]\s*[\-－—–:：]+\s*([^\n]+?)\s*$/)?.[1],
  subject.match(/[\-－—–:：]+\s*([^\n]+?)\s*$/)?.[1],
  subject.match(/([^\n]+?)\s*(?:先生|女士|小姐)\s*$/)?.[1],
].filter(Boolean);

for (const rawCandidate of subjectCandidates) {
  const normalized = extractTailCandidate(rawCandidate);
  if (isLikelyCandidate(normalized)) {
    candidateName = normalized;
    break;
  }
}

if (!candidateName && !NEWSLETTER_HINTS.test(subject + ' ' + body)) {
  const bodyNamePatterns = [
    /候選人[：: ]*([\u4e00-\u9fa5A-Za-z]{2,20})/,
    /姓名[：: ]*([\u4e00-\u9fa5A-Za-z]{2,20})/,
    /([\u4e00-\u9fa5]{2,5})\s*(?:先生|女士|小姐)\s*您好/
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

const explicitDepartmentMatch =`;

extractNode.parameters.jsCode = extractJs.replace(
  /const normalizeCandidate = \(value\) => String\(value \|\| ''\)[\s\S]*?const explicitDepartmentMatch =/,
  replacementBlock,
);

filterNode.parameters.conditions.conditions[0].rightValue =
  '^(?!.*(?:電子報|newsletter)).*(履歷推薦|面試時間|最新面試時間|更新面試時間|更改面試時間|面試通知|面試邀約|邀約面試|安排面試|可安排面試|請安排面試|請協助安排面試|請通知面試|安排於|安排在|訂於|現場面試|初試時間|複試時間|interview schedule|interview invitation).*';

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  workflowPath,
  patchedNodes: [
    extractNode.id,
    filterNode.id,
  ],
}, null, 2));
