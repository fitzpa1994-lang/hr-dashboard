import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const filePath = path.join(root, 'n8n', 'live_Workflow1_面試解析.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, value) {
  fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 occurrence of anchor, found ${count}`);
  }
  return source.replace(from, to);
}

// Mirrors scripts/patch_position_routing_rules.mjs's table definition exactly.
const BOOTSTRAP = `CREATE TABLE IF NOT EXISTS position_routing_rules (
    id                  SERIAL PRIMARY KEY,
    match_type          TEXT NOT NULL CHECK (match_type IN ('recipient_email', 'position_keyword', 'department_keyword')),
    pattern             TEXT NOT NULL CHECK (BTRIM(pattern) <> ''),
    job_requisition_id  INTEGER REFERENCES job_requisitions(id) ON DELETE SET NULL,
    department_hint     TEXT,
    priority            SMALLINT NOT NULL DEFAULT 10,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (job_requisition_id IS NOT NULL OR department_hint IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_position_routing_rules_active
ON position_routing_rules(match_type) WHERE is_active;

`;

// This is a strictly ADDITIVE change: two new CTEs consulting
// position_routing_rules, added as extra UNION ALL branches tied at the SAME
// priority number as the existing hardcoded pri-0 (recipient override) and
// pri-4 (keyword safety net) branches they mirror. The migrated table rows
// (as of 2026-07-24) are identical to what the old hardcoded branches already
// produce, so a tie always resolves to the same job_requisition_id either way
// — today's candidate routing is unchanged. The old JS array and SQL literals
// are deliberately left in place; removing them is a separate, later change
// once this has run in production and stayed consistent.
function patch(query) {
  let updated = query;

  if (!updated.startsWith(BOOTSTRAP)) {
    if (!updated.startsWith('ALTER TABLE candidates\n')) {
      throw new Error('bootstrap: query does not start with the expected ALTER TABLE candidates prefix');
    }
    updated = BOOTSTRAP + updated;
  }

  updated = replaceOnce(
    updated,
    `candidate_norm AS (\n`,
    `routing_rule_recipient_match AS (\n` +
      `  -- 新增：來自 position_routing_rules 的收件人規則。目前資料庫裡的規則內容跟下面\n` +
      `  -- candidate_norm/matched_requisition 用到的 JS 硬寫 recipientRoutingRules 完全一致，\n` +
      `  -- 這條現在不會改變任何結果；HR 之後自己在「系統設定」畫面新增/修改收件人規則時，\n` +
      `  -- 才會透過這裡生效，不用再等工程改 Code 節點。\n` +
      `  SELECT j.id, j.department, j.position_title\n` +
      `  FROM position_routing_rules rr\n` +
      `  JOIN job_requisitions j ON j.id = rr.job_requisition_id\n` +
      `  WHERE rr.is_active\n` +
      `    AND rr.match_type = 'recipient_email'\n` +
      `    AND rr.job_requisition_id IS NOT NULL\n` +
      `    AND lower(rr.pattern) = ANY(\n` +
      `      string_to_array(\n` +
      `        lower(NULLIF(trim('{{ ($json.recipient_emails_csv || '').replace(/'/g, "''") }}'), '')),\n` +
      `        ','\n` +
      `      )\n` +
      `    )\n` +
      `),\n` +
      `candidate_norm AS (\n`,
    'add routing_rule_recipient_match CTE before candidate_norm',
  );

  updated = replaceOnce(
    updated,
    `matched_requisition AS (\n`,
    `routing_rule_keyword_match AS (\n` +
      `  -- 新增：來自 position_routing_rules 的職稱關鍵字規則。目前資料庫裡的規則內容跟\n` +
      `  -- pri-4 SQL 安全網完全一致，這條現在不會改變任何結果；HR 之後自己維護規則，\n` +
      `  -- 不用再等工程改這段寫死的 SQL。\n` +
      `  SELECT j.id, j.department, j.position_title\n` +
      `  FROM position_routing_rules rr\n` +
      `  JOIN job_requisitions j ON j.id = rr.job_requisition_id\n` +
      `  CROSS JOIN candidate_norm c\n` +
      `  WHERE rr.is_active\n` +
      `    AND rr.match_type = 'position_keyword'\n` +
      `    AND rr.job_requisition_id IS NOT NULL\n` +
      `    AND c.raw_position LIKE '%' || rr.pattern || '%'\n` +
      `),\n` +
      `matched_requisition AS (\n`,
    'add routing_rule_keyword_match CTE before matched_requisition',
  );

  updated = replaceOnce(
    updated,
    `    WHERE c.recipient_preferred_requisition_id IS NOT NULL\n` +
      `      AND j.id = c.recipient_preferred_requisition_id\n` +
      `\n` +
      `    UNION ALL\n` +
      `\n` +
      `    -- 優先序 1：`,
    `    WHERE c.recipient_preferred_requisition_id IS NOT NULL\n` +
      `      AND j.id = c.recipient_preferred_requisition_id\n` +
      `\n` +
      `    UNION ALL\n` +
      `\n` +
      `    -- 優先序 0（新增，資料表版本，見上方 routing_rule_recipient_match 說明）\n` +
      `    SELECT id, department, position_title, 0 AS pri\n` +
      `    FROM routing_rule_recipient_match\n` +
      `\n` +
      `    UNION ALL\n` +
      `\n` +
      `    -- 優先序 1：`,
    'add pri-0 UNION ALL branch for routing_rule_recipient_match',
  );

  updated = replaceOnce(
    updated,
    `    WHERE (c.raw_position LIKE '%' || U&'MIS\\7DB2\\7BA1\\5DE5\\7A0B\\5E2B' || '%' AND j.id = 17)\n` +
      `       OR (c.raw_position LIKE '%' || U&'MIS\\7DB2\\7BA1' || '%' AND j.id = 17)\n` +
      `       OR (c.raw_position LIKE '%' || U&'SAR\\5DE5\\7A0B\\5E2B' || '%' AND j.id = 23)\n` +
      `       OR (c.raw_position LIKE '%' || U&'AI\\8EDF\\9AD4\\5DE5\\7A0B\\5E2B' || '%' AND j.id = 27)\n` +
      `  ) ranked\n`,
    `    WHERE (c.raw_position LIKE '%' || U&'MIS\\7DB2\\7BA1\\5DE5\\7A0B\\5E2B' || '%' AND j.id = 17)\n` +
      `       OR (c.raw_position LIKE '%' || U&'MIS\\7DB2\\7BA1' || '%' AND j.id = 17)\n` +
      `       OR (c.raw_position LIKE '%' || U&'SAR\\5DE5\\7A0B\\5E2B' || '%' AND j.id = 23)\n` +
      `       OR (c.raw_position LIKE '%' || U&'AI\\8EDF\\9AD4\\5DE5\\7A0B\\5E2B' || '%' AND j.id = 27)\n` +
      `\n` +
      `    UNION ALL\n` +
      `\n` +
      `    -- 優先序 4（新增，資料表版本，見上方 routing_rule_keyword_match 說明）\n` +
      `    SELECT id, department, position_title, 4 AS pri\n` +
      `    FROM routing_rule_keyword_match\n` +
      `  ) ranked\n`,
    'add pri-4 UNION ALL branch for routing_rule_keyword_match',
  );

  return updated;
}

function main() {
  const workflow = readJson(filePath);
  const targets = [
    ...(workflow.nodes || []),
    ...(workflow.activeVersion?.nodes || []),
  ].filter((n) => n.name === 'PG：寫入 candidates');
  if (!targets.length) throw new Error('Node "PG：寫入 candidates" not found');
  for (const node of targets) {
    node.parameters.query = patch(node.parameters.query);
  }
  writeJson(filePath, workflow);
  console.log(JSON.stringify({ patched: filePath, nodesUpdated: targets.length }, null, 2));
}

main();
