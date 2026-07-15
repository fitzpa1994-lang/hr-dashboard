/**
 * Patch live_Workflow1_面試解析.json with:
 * 1. Claude prompt gets To/CC recipients for department context
 * 2. Code:整合輸出 forwards recipient_emails_csv
 * 3. PG:寫入candidates adds auto-create job_requisition CTE when no match found
 * 4. New PG:更新收件人映射 node that UPSERTs recipient→department after processing
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.resolve(__dirname, '../n8n/live_Workflow1_面試解析.json');

const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

// ── helper ──────────────────────────────────────────────────────────────────
function findNode(nameOrId) {
  return wf.nodes.find(n => n.name === nameOrId || n.id === nameOrId);
}

// ── 1. Code:組裝 Claude Request Body ────────────────────────────────────────
// Add recipient list to user message so Claude can use it for department inference
const claudeBodyNode = findNode('Code：組裝 Claude Request Body');
if (!claudeBodyNode) throw new Error('Node not found: Code：組裝 Claude Request Body');

claudeBodyNode.parameters.jsCode = `const item = $input.item.json;
const recipientList = (item.recipient_emails || []).join(', ');

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
    "收件人(To/CC)是判斷部門的重要依據：收件人通常就是該部門主管，可從中推斷 department。",
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
      content: "主旨：" + (item.email_subject || "") + "\\n收件人(To/CC)：" + (recipientList || "未知") + "\\n\\n內文：" + (item.body_text || "")
    }
  ]
};`;

// ── 2. Code:整合輸出 ─────────────────────────────────────────────────────────
// Add recipient_emails_csv to output so downstream nodes can update the map
const integrationNode = findNode('Code：整合輸出');
if (!integrationNode) throw new Error('Node not found: Code：整合輸出');

// Append recipient_emails_csv to the return object
integrationNode.parameters.jsCode = integrationNode.parameters.jsCode.replace(
  /preferred_requisition_id: base\.preferred_requisition_id \?\? null,?\s*\n(\};)/,
  `preferred_requisition_id: base.preferred_requisition_id ?? null,
  recipient_emails_csv: (base.recipient_emails || []).join(','),
$1`
);

if (!integrationNode.parameters.jsCode.includes('recipient_emails_csv')) {
  throw new Error('Failed to patch Code：整合輸出 — pattern not found');
}

// ── 3. PG:寫入 candidates ────────────────────────────────────────────────────
// a) Add auto_req CTE after matched_requisition
// b) Update resolved to use auto_req fallback
// c) Add recipient_emails_csv to final SELECT
const pgCandidatesNode = findNode('PG：寫入 candidates');
if (!pgCandidatesNode) throw new Error('Node not found: PG：寫入 candidates');

let pgSql = pgCandidatesNode.parameters.query;

// a) Add auto_req CTE — insert after matched_requisition CTE closing paren before "resolved AS"
const AUTO_REQ_CTE = `auto_req AS (
  INSERT INTO job_requisitions (position_title, department, headcount, filled_count, status, urgency, notes)
  SELECT
    (SELECT raw_position FROM candidate_norm),
    COALESCE(
      NULLIF((SELECT top_department FROM candidate_norm), ''),
      CASE WHEN (SELECT raw_department FROM candidate_norm) NOT IN ('未分類','未知部門','未知職位','測試','人力資源部','')
        THEN (SELECT raw_department FROM candidate_norm) END,
      '未分類'
    ),
    1, 0, 'open', 3, 'auto-created'
  WHERE NOT EXISTS (SELECT 1 FROM matched_requisition)
    AND (SELECT raw_position FROM candidate_norm) NOT IN ('未知職位','未分類','','null','未知','未知的職位')
  RETURNING id, position_title, department
),\n`;

pgSql = pgSql.replace(
  /(\),\s*\n)(resolved AS \()/,
  `$1${AUTO_REQ_CTE}$2`
);

if (!pgSql.includes('auto_req')) {
  throw new Error('Failed to insert auto_req CTE — pattern not found');
}

// b) Update resolved CTE to include auto_req fallback
pgSql = pgSql.replace(
  /resolved AS \(\s*\n\s*SELECT\s*\n\s*COALESCE\(\(SELECT department FROM matched_requisition\), \(SELECT raw_department FROM candidate_norm\)\) AS department,\s*\n\s*COALESCE\(\(SELECT position_title FROM matched_requisition\), \(SELECT raw_position FROM candidate_norm\)\) AS position_title,\s*\n\s*\(SELECT id FROM matched_requisition\) AS job_requisition_id\s*\)/,
  `resolved AS (
  SELECT
    COALESCE(
      (SELECT department FROM matched_requisition),
      (SELECT department FROM auto_req),
      (SELECT raw_department FROM candidate_norm)
    ) AS department,
    COALESCE(
      (SELECT position_title FROM matched_requisition),
      (SELECT position_title FROM auto_req),
      (SELECT raw_position FROM candidate_norm)
    ) AS position_title,
    COALESCE(
      (SELECT id FROM matched_requisition),
      (SELECT id FROM auto_req)
    ) AS job_requisition_id,
    (SELECT id FROM auto_req) IS NOT NULL AS was_auto_created
  FROM (SELECT 1) _dummy
)`
);

if (!pgSql.includes('was_auto_created')) {
  throw new Error('Failed to patch resolved CTE — pattern not found');
}

// c) Add recipient_emails_csv + was_auto_created to final SELECT
pgSql = pgSql.replace(
  /(COALESCE\(j\.department, c\.department\) AS department\s*\nFROM candidates c)/,
  `COALESCE(j.department, c.department) AS department,
  '{{ ($json.recipient_emails_csv || '').replace(/'/g, "''") }}' AS recipient_emails_csv,
  (SELECT was_auto_created FROM resolved) AS was_auto_created
FROM candidates c`
);

if (!pgSql.includes('recipient_emails_csv')) {
  throw new Error('Failed to add recipient_emails_csv to SELECT');
}

pgCandidatesNode.parameters.query = pgSql;

// ── 4. New node: PG：更新收件人映射 ─────────────────────────────────────────
const NEW_NODE_ID = 'pg-update-recipient-map-001';
const pgEmailLogsNode = findNode('PG：寫入 email_logs');
const emailLogsPos = pgEmailLogsNode?.position || [3168, 320];

const recipientMapNode = {
  parameters: {
    operation: 'executeQuery',
    query: `INSERT INTO recipient_department_map (email, department, source)
SELECT
  trim(email_addr),
  '{{ ($json.department || '').replace(/'/g, "''") }}',
  CASE WHEN '{{ $json.was_auto_created }}' = 'true' THEN 'auto-created' ELSE 'email_confirmed' END
FROM unnest(string_to_array(
  '{{ ($json.recipient_emails_csv || '').replace(/'/g, "''") }}',
  ','
)) AS email_addr
WHERE trim(email_addr) <> ''
  AND '{{ ($json.department || '') }}' NOT IN ('未分類', '未知部門', '', 'null')
ON CONFLICT (email) DO UPDATE SET
  department = EXCLUDED.department,
  source     = EXCLUDED.source,
  updated_at = NOW()
WHERE recipient_department_map.department IS DISTINCT FROM EXCLUDED.department;

SELECT '{{ $json.email_msg_id }}' AS email_msg_id, 'map_updated' AS map_action;`,
    options: {},
  },
  id: NEW_NODE_ID,
  name: 'PG：更新收件人映射',
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.5,
  position: [emailLogsPos[0] + 224, emailLogsPos[1]],
  credentials: { postgres: { id: 'NGdDfE2F1YFXGcmn', name: 'Postgres account' } },
};

wf.nodes.push(recipientMapNode);

// ── 5. Update connections ────────────────────────────────────────────────────
// PG：寫入 email_logs → PG：更新收件人映射
if (!wf.connections['PG：寫入 email_logs']) {
  wf.connections['PG：寫入 email_logs'] = { main: [[]] };
}
const emailLogsMain = wf.connections['PG：寫入 email_logs'].main;
if (!emailLogsMain[0]) emailLogsMain[0] = [];
const alreadyLinked = emailLogsMain[0].some(c => c.node === 'PG：更新收件人映射');
if (!alreadyLinked) {
  emailLogsMain[0].push({ node: 'PG：更新收件人映射', type: 'main', index: 0 });
}

// ── Write ────────────────────────────────────────────────────────────────────
fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2), 'utf8');
console.log('Workflow patched successfully.');
console.log('  ✓ Claude prompt: recipients added');
console.log('  ✓ Code:整合輸出: recipient_emails_csv forwarded');
console.log('  ✓ PG:寫入candidates: auto_req CTE + resolved updated + csv in SELECT');
console.log('  ✓ New node: PG：更新收件人映射 added');
console.log('  ✓ Connection: email_logs → 更新收件人映射 linked');
