import process from 'node:process';

const workflowId = process.argv[2] || 'zEIwksk6hz9Ri8NA';

const n8nBaseUrl = String(process.env.N8N_API_BASE_URL || process.env.N8N_API_URL || '').trim().replace(/\/+$/, '');
const n8nApiKey = String(process.env.N8N_API_KEY || '').trim();

if (!n8nBaseUrl || !n8nApiKey) {
  console.error('Missing N8N_API_BASE_URL or N8N_API_KEY');
  process.exit(1);
}

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

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-N8N-API-KEY': n8nApiKey,
  };
}

async function parseJson(response) {
  const text = await response.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const parsed = await parseJson(response);
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${url} failed: status=${response.status}; body=${parsed.text.slice(0, 500)}`);
  }
  return parsed.json;
}

function findNode(nodes, predicate, errorMessage) {
  const node = nodes.find(predicate);
  if (!node) throw new Error(errorMessage);
  return node;
}

function mainConnection(targetName) {
  return [{ node: targetName, type: 'main', index: 0 }];
}

async function main() {
  const url = `${n8nBaseUrl}/workflows/${workflowId}`;
  const workflow = await request(url, { headers: headers() });

  const nodes = workflow.nodes ?? [];
  const connections = workflow.connections ?? {};

  const onboardingTrigger = findNode(
    nodes,
    (node) => (node?.parameters?.filters?.foldersToInclude ?? []).includes('AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQAuAAAAAAATwHe72s8cTYU6NTzQdTNsAQCddaHEqpeLSJK4gY8M9T9SAAAA-bMBAAA='),
    'Onboarding trigger not found',
  );
  const resignationTrigger = findNode(
    nodes,
    (node) => (node?.parameters?.filters?.foldersToInclude ?? []).includes('AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQAuAAAAAAATwHe72s8cTYU6NTzQdTNsAQDrOyTdalCqR4oTn0wwCObdAEg2qZyLAAA='),
    'Resignation trigger not found',
  );
  const onboardingFilter = findNode(
    nodes,
    (node) => node.id === '171db4fe-05c0-4f30-b480-eed017148f65',
    'Onboarding filter node not found',
  );
  const onboardingCode = findNode(
    nodes,
    (node) => node.id === 'code-name-from-subject-001',
    'Onboarding code node not found',
  );
  const resignationCode = findNode(
    nodes,
    (node) => node.id === '71f201ca-926d-4ce8-bfcd-9b2e7dc709c1' || node.name === 'Code：整理離職欄位',
    'Resignation code node not found',
  );

  onboardingFilter.parameters.conditions = {
    options: {
      caseSensitive: true,
      leftValue: '',
      typeValidation: 'strict',
      version: 1,
    },
    conditions: [
      {
        id: 'subject-new-onboard',
        leftValue: '={{ $json.subject }}',
        rightValue: '新進人員通知',
        operator: { type: 'string', operation: 'contains' },
      },
      {
        id: 'subject-offer-notice',
        leftValue: '={{ $json.subject }}',
        rightValue: '錄取通知事宜',
        operator: { type: 'string', operation: 'contains' },
      },
    ],
    combinator: 'or',
  };

  resignationCode.parameters ??= {};
  resignationCode.parameters.mode = 'runOnceForEachItem';
  resignationCode.parameters.jsCode = RESIGNATION_JS;

  connections[onboardingTrigger.name] = { main: [mainConnection(onboardingFilter.name)] };
  connections[onboardingFilter.name] = { main: [mainConnection(onboardingCode.name), []] };
  connections[resignationTrigger.name] = { main: [mainConnection(resignationCode.name)] };

  const payload = {
    name: workflow.name,
    nodes,
    connections,
  };
  if (workflow.settings?.executionOrder) {
    payload.settings = { executionOrder: workflow.settings.executionOrder };
  }

  const updated = await request(url, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(payload),
  });

  console.log(JSON.stringify({
    workflowId,
    updatedAt: updated.updatedAt || null,
    onboardingTrigger: onboardingTrigger.name,
    resignationTrigger: resignationTrigger.name,
    onboardingFilter: onboardingFilter.name,
    onboardingCode: onboardingCode.name,
    resignationCode: resignationCode.name,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
