/**
 * Patch 2: 在 Claude 之前插入 PG:查詢收件人映射 節點
 * 讓 Claude 知道「這個收件人歷史上是哪個部門主管」
 *
 * 新流程：
 *   Code:萃取基本資訊 → PG:查詢收件人映射 → Code:組裝Claude → Claude → ...
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.resolve(__dirname, '../n8n/live_Workflow1_面試解析.json');

const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

function findNode(name) {
  return wf.nodes.find(n => n.name === name);
}

const extractNode = findNode('Code：萃取基本資訊');
const claudeBodyNode = findNode('Code：組裝 Claude Request Body');

if (!extractNode) throw new Error('Node not found: Code：萃取基本資訊');
if (!claudeBodyNode) throw new Error('Node not found: Code：組裝 Claude Request Body');

// ── 1. 新增 PG:查詢收件人映射 節點 ──────────────────────────────────────────
// 查詢已知的 email → department 對應
// 用 json_agg 確保永遠回傳一列（即使沒有匹配也回 []）
const LOOKUP_NODE_ID = 'pg-recipient-lookup-001';
const extractPos = extractNode.position || [1824, 320];

const lookupNode = {
  parameters: {
    operation: 'executeQuery',
    query: `SELECT
  COALESCE(
    json_agg(json_build_object('email', r.email, 'department', r.department) ORDER BY r.updated_at DESC),
    '[]'::json
  ) AS known_recipient_departments
FROM recipient_department_map r
WHERE r.email = ANY(
  string_to_array(
    NULLIF(trim('{{ ($json.recipient_emails || []).join(",") }}'), ''),
    ','
  )
);`,
    options: {},
  },
  id: LOOKUP_NODE_ID,
  name: 'PG：查詢收件人映射',
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.5,
  position: [extractPos[0] + 224, extractPos[1]],
  credentials: { postgres: { id: 'NGdDfE2F1YFXGcmn', name: 'Postgres account' } },
};

wf.nodes.push(lookupNode);

// ── 2. 更新 Code:組裝 Claude Request Body ────────────────────────────────────
// 現在 $input.item.json 是 PG lookup 結果（known_recipient_departments）
// 用 $('Code：萃取基本資訊').item.json 取原始信件資料
claudeBodyNode.parameters.jsCode = `const base = $('Code：萃取基本資訊').item.json;
const recipientList = (base.recipient_emails || []).join(', ');

// PG lookup 結果: [{email, department}, ...]
let knownDepts = [];
try {
  const pgResult = $input.item.json.known_recipient_departments;
  if (Array.isArray(pgResult)) {
    knownDepts = pgResult;
  } else if (typeof pgResult === 'string') {
    knownDepts = JSON.parse(pgResult);
  }
} catch (e) {}

const deptHintLines = knownDepts.length > 0
  ? knownDepts.map(r => \`  \${r.email} → \${r.department}\`).join('\\n')
  : '  （無歷史記錄）';

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
    "收件人(To/CC)是判斷部門的重要依據：To 通常是該部門主管。若歷史映射有記錄，請優先參考。",
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
      content: [
        "主旨：" + (base.email_subject || ""),
        "收件人(To/CC)：" + (recipientList || "未知"),
        "歷史收件人部門映射：",
        deptHintLines,
        "",
        "內文：" + (base.body_text || "")
      ].join("\\n")
    }
  ]
};`;

// ── 3. 更新 connections ──────────────────────────────────────────────────────
// 原本：Code:萃取基本資訊 → Code:組裝Claude
// 新的：Code:萃取基本資訊 → PG:查詢收件人映射 → Code:組裝Claude

// A) Code:萃取基本資訊 → PG:查詢收件人映射（原本連到 Claude Body，改成連到 PG lookup）
const extractConns = wf.connections['Code：萃取基本資訊'];
if (!extractConns || !extractConns.main) throw new Error('No connections from Code：萃取基本資訊');

const wasConnectedToClaudeBody = extractConns.main[0]?.some(c => c.node === 'Code：組裝 Claude Request Body');
if (wasConnectedToClaudeBody) {
  // Replace the direct link with PG lookup
  extractConns.main[0] = extractConns.main[0].filter(c => c.node !== 'Code：組裝 Claude Request Body');
  extractConns.main[0].push({ node: 'PG：查詢收件人映射', type: 'main', index: 0 });
} else {
  // Just add if not already there
  if (!extractConns.main[0]) extractConns.main[0] = [];
  const alreadyHasLookup = extractConns.main[0].some(c => c.node === 'PG：查詢收件人映射');
  if (!alreadyHasLookup) {
    extractConns.main[0].push({ node: 'PG：查詢收件人映射', type: 'main', index: 0 });
  }
}

// B) PG:查詢收件人映射 → Code:組裝 Claude Request Body
if (!wf.connections['PG：查詢收件人映射']) {
  wf.connections['PG：查詢收件人映射'] = { main: [[]] };
}
const lookupConns = wf.connections['PG：查詢收件人映射'].main;
if (!lookupConns[0]) lookupConns[0] = [];
const alreadyLinkedToBody = lookupConns[0].some(c => c.node === 'Code：組裝 Claude Request Body');
if (!alreadyLinkedToBody) {
  lookupConns[0].push({ node: 'Code：組裝 Claude Request Body', type: 'main', index: 0 });
}

// ── Write ────────────────────────────────────────────────────────────────────
fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2), 'utf8');
console.log('Patch 2 applied:');
console.log('  ✓ New node: PG：查詢收件人映射 (before Claude)');
console.log('  ✓ Code:組裝Claude now reads known_recipient_departments from PG');
console.log('  ✓ Connections: 萃取 → PG查詢 → 組裝Claude');

// Verify connections
const ec = wf.connections['Code：萃取基本資訊']?.main?.[0] || [];
const lc = wf.connections['PG：查詢收件人映射']?.main?.[0] || [];
console.log('  Connections from 萃取:', ec.map(c => c.node).join(', '));
console.log('  Connections from PG查詢:', lc.map(c => c.node).join(', '));
