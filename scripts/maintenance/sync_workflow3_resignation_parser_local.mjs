import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workflowPath = process.argv[2] || path.join(process.cwd(), 'n8n', 'live_Workflow3_到職離職.json');

const RESIGNATION_JS = String.raw`const item = $input.item.json;
const rawBody = item.body?.content || item.bodyPreview || '';
const body = rawBody
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&#\d+;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const subject = item.subject || '';
const fallbackYear = String(new Date(item.receivedDateTime || Date.now()).getFullYear());

const clean = (value) => String(value || '')
  .replace(/\s+/g, ' ')
  .replace(/[□]/g, '')
  .trim();

const parseDate = (raw) => {
  const text = clean(raw).replace(/[()（）一二三四五六日]/g, '');
  const ymd = text.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymd) return ymd[1] + '-' + ymd[2].padStart(2, '0') + '-' + ymd[3].padStart(2, '0');
  const md = text.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (md) return fallbackYear + '-' + md[1].padStart(2, '0') + '-' + md[2].padStart(2, '0');
  return null;
};

const deptMatch = body.match(/單\s*位\s*[：:]\s*([^\r\n□]+)/);
const nameMatch = body.match(/姓\s*名\s*[：:]\s*([^\r\n□]+)/);
const titleMatch = body.match(/職\s*稱\s*[：:]\s*([^\r\n□]+)/);
const effectiveMatch = body.match(/離\s*職\s*生\s*效\s*日\s*[：:]\s*([^\r\n□（(]+)/);
const lastDayMatch = body.match(/最\s*後\s*上\s*班\s*日\s*[：:]\s*([^\r\n□（(]+)/);

let department = clean(deptMatch?.[1] || '');
let name = clean(nameMatch?.[1] || '');
let position = clean(titleMatch?.[1] || '');
let last_day = parseDate(effectiveMatch?.[1] || lastDayMatch?.[1] || '');

const subjectDateMatch = subject.match(/(?:將於|於)\s*(\d{4}\/\d{1,2}\/\d{1,2}|\d{4}-\d{1,2}-\d{1,2})/);
if (!last_day && subjectDateMatch) {
  last_day = parseDate(subjectDateMatch[1]);
}

if (!department || !name) {
  const subjectMatch = subject.match(/(?:今日)?離職人員通知\s*[-：:]\s*([^\s]+)\s+([^\s，,]+)/);
  if (subjectMatch) {
    department ||= clean(subjectMatch[1]);
    name ||= clean(subjectMatch[2]);
  }
}

if (!last_day && subject.includes('今日離職人員通知')) {
  const today = new Date(item.receivedDateTime || Date.now());
  last_day = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
}

if (!position) {
  if (department.includes('文件')) position = '文件專員';
  else if (department.includes('業務')) position = '業務專員';
  else if (department.includes('工程')) position = '工程師';
  else position = '未知職位';
}

return {
  email_msg_id: item.id,
  email_subject: subject,
  email_web_link: item.webLink || null,
  sender: item.from?.emailAddress?.address || item.from || null,
  received_at: item.receivedDateTime,
  source_type: 'resignation',
  name: name || '未知姓名',
  department: department || '未分類',
  position,
  last_day,
};`;

const raw = fs.readFileSync(workflowPath, 'utf8');
const workflow = JSON.parse(raw);

let touched = 0;
for (const node of workflow.nodes ?? []) {
  if (node.id === '71f201ca-926d-4ce8-bfcd-9b2e7dc709c1' || node.name === 'Code：萃取離職資訊') {
    node.parameters ??= {};
    node.parameters.mode = 'runOnceForEachItem';
    node.parameters.jsCode = RESIGNATION_JS;
    touched += 1;
  }
}

if (workflow.activeVersion?.nodes) {
  for (const node of workflow.activeVersion.nodes) {
    if (node.id === '71f201ca-926d-4ce8-bfcd-9b2e7dc709c1' || node.name === 'Code：萃取離職資訊') {
      node.parameters ??= {};
      node.parameters.mode = 'runOnceForEachItem';
      node.parameters.jsCode = RESIGNATION_JS;
      touched += 1;
    }
  }
}

if (!touched) {
  throw new Error('No resignation parser node found in local workflow export');
}

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ workflowPath, touched }, null, 2));
