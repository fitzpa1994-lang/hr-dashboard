import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const filePath = path.join(root, 'n8n', 'live_Job_Requisition_Write.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, value) {
  fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

// Fails loudly (rather than silently no-op) if the anchor text has drifted,
// since this node's query dispatches every write action in the system.
function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 occurrence of anchor, found ${count}`);
  }
  return source.replace(from, to);
}

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

function patch(query) {
  let updated = query;

  if (!updated.startsWith(BOOTSTRAP)) {
    if (!updated.startsWith('WITH input AS (')) {
      throw new Error('bootstrap: query does not start with the expected WITH input AS ( prefix');
    }
    updated = BOOTSTRAP + updated;
  }

  updated = replaceOnce(
    updated,
    `    NULLIF('{{ ($json.body.candidateDepartment || '').replace(/'/g, "''") }}', '')::TEXT AS candidate_department,\n`,
    `    NULLIF('{{ ($json.body.candidateDepartment || '').replace(/'/g, "''") }}', '')::TEXT AS candidate_department,\n` +
      `    NULLIF('{{ $json.body.routingRule?.id ?? '' }}', '')::INTEGER AS routing_rule_id,\n` +
      `    '{{ ($json.body.routingRule?.matchType || '').replace(/'/g, "''") }}'::TEXT AS routing_rule_match_type,\n` +
      `    '{{ ($json.body.routingRule?.pattern || '').replace(/'/g, "''") }}'::TEXT AS routing_rule_pattern,\n` +
      `    NULLIF('{{ $json.body.routingRule?.jobRequisitionId ?? '' }}', '')::INTEGER AS routing_rule_job_requisition_id,\n` +
      `    NULLIF('{{ ($json.body.routingRule?.departmentHint || '').replace(/'/g, "''") }}', '')::TEXT AS routing_rule_department_hint,\n` +
      `    {{ Number($json.body.routingRule?.priority ?? 10) }}::SMALLINT AS routing_rule_priority,\n` +
      `    {{ $json.body.routingRule?.isActive === false ? 'FALSE' : 'TRUE' }}::BOOLEAN AS routing_rule_is_active,\n` +
      `    NULLIF('{{ ($json.body.routingRule?.notes || '').replace(/'/g, "''") }}', '')::TEXT AS routing_rule_notes,\n`,
    'input CTE: add routing rule fields',
  );

  updated = replaceOnce(
    updated,
    `candidate_updated AS (\n` +
      `  UPDATE candidates\n` +
      `  SET status = CASE WHEN input.action = 'update_candidate_status' THEN input.candidate_status ELSE candidates.status END,\n` +
      `      department = CASE WHEN input.action = 'update_candidate_department' THEN input.candidate_department ELSE candidates.department END,\n` +
      `      updated_at = NOW()\n` +
      `  FROM input\n` +
      `  WHERE candidates.id = input.candidate_id\n` +
      `    AND (\n` +
      `      (input.action = 'update_candidate_status' AND input.candidate_status IN ('withdrawn', 'rejected', 'dept_scheduling'))\n` +
      `      OR (input.action = 'update_candidate_department' AND input.candidate_department IS NOT NULL)\n` +
      `    )\n` +
      `  RETURNING candidates.id, candidates.name, candidates.status, candidates.department\n` +
      `),`,
    `candidate_updated AS (\n` +
      `  UPDATE candidates\n` +
      `  SET status = CASE WHEN input.action = 'update_candidate_status' THEN input.candidate_status ELSE candidates.status END,\n` +
      `      department = CASE WHEN input.action = 'update_candidate_department' THEN input.candidate_department ELSE candidates.department END,\n` +
      `      updated_at = NOW()\n` +
      `  FROM input\n` +
      `  WHERE candidates.id = input.candidate_id\n` +
      `    AND (\n` +
      `      (input.action = 'update_candidate_status' AND input.candidate_status IN ('withdrawn', 'rejected', 'dept_scheduling'))\n` +
      `      OR (input.action = 'update_candidate_department' AND input.candidate_department IS NOT NULL)\n` +
      `    )\n` +
      `  RETURNING candidates.id, candidates.name, candidates.status, candidates.department\n` +
      `),\n` +
      `routing_rule_valid AS (\n` +
      `  SELECT\n` +
      `    input.action,\n` +
      `    input.routing_rule_match_type IN ('recipient_email', 'position_keyword', 'department_keyword')\n` +
      `      AND BTRIM(input.routing_rule_pattern) <> ''\n` +
      `      AND (input.routing_rule_job_requisition_id IS NOT NULL OR input.routing_rule_department_hint IS NOT NULL)\n` +
      `      AS is_valid\n` +
      `  FROM input\n` +
      `),\n` +
      `routing_rule_created AS (\n` +
      `  INSERT INTO position_routing_rules (match_type, pattern, job_requisition_id, department_hint, priority, is_active, notes)\n` +
      `  SELECT input.routing_rule_match_type, input.routing_rule_pattern, input.routing_rule_job_requisition_id, input.routing_rule_department_hint, input.routing_rule_priority, input.routing_rule_is_active, input.routing_rule_notes\n` +
      `  FROM input\n` +
      `  CROSS JOIN routing_rule_valid\n` +
      `  WHERE input.action = 'create_routing_rule'\n` +
      `    AND routing_rule_valid.is_valid\n` +
      `  RETURNING id, match_type, pattern, job_requisition_id, department_hint, priority, is_active, notes\n` +
      `),\n` +
      `routing_rule_updated AS (\n` +
      `  UPDATE position_routing_rules r\n` +
      `  SET match_type = input.routing_rule_match_type,\n` +
      `      pattern = input.routing_rule_pattern,\n` +
      `      job_requisition_id = input.routing_rule_job_requisition_id,\n` +
      `      department_hint = input.routing_rule_department_hint,\n` +
      `      priority = input.routing_rule_priority,\n` +
      `      is_active = input.routing_rule_is_active,\n` +
      `      notes = input.routing_rule_notes,\n` +
      `      updated_at = NOW()\n` +
      `  FROM input\n` +
      `  CROSS JOIN routing_rule_valid\n` +
      `  WHERE input.action = 'update_routing_rule'\n` +
      `    AND r.id = input.routing_rule_id\n` +
      `    AND routing_rule_valid.is_valid\n` +
      `  RETURNING r.id, r.match_type, r.pattern, r.job_requisition_id, r.department_hint, r.priority, r.is_active, r.notes\n` +
      `),`,
    'candidate_updated CTE: add routing_rule_created/routing_rule_updated',
  );

  updated = replaceOnce(
    updated,
    `  'candidate', CASE WHEN input.action IN ('update_candidate_status', 'update_candidate_department') THEN (SELECT json_build_object('id', cu.id, 'name', cu.name, 'status', cu.status, 'department', cu.department) FROM candidate_updated cu LIMIT 1) ELSE NULL END,`,
    `  'candidate', CASE WHEN input.action IN ('update_candidate_status', 'update_candidate_department') THEN (SELECT json_build_object('id', cu.id, 'name', cu.name, 'status', cu.status, 'department', cu.department) FROM candidate_updated cu LIMIT 1) ELSE NULL END,\n` +
      `  'routingRule', CASE WHEN input.action IN ('create_routing_rule', 'update_routing_rule') THEN (\n` +
      `    SELECT json_build_object('id', rr.id, 'matchType', rr.match_type, 'pattern', rr.pattern, 'jobRequisitionId', rr.job_requisition_id, 'departmentHint', rr.department_hint, 'priority', rr.priority, 'isActive', rr.is_active, 'notes', COALESCE(rr.notes, ''))\n` +
      `    FROM (SELECT * FROM routing_rule_created UNION ALL SELECT * FROM routing_rule_updated) rr\n` +
      `    LIMIT 1\n` +
      `  ) ELSE NULL END,`,
    'final SELECT: add routingRule JSON output',
  );

  updated = replaceOnce(
    updated,
    `FROM input\nLEFT JOIN created ON TRUE\nLEFT JOIN updated ON TRUE\nLEFT JOIN onboard_updated ON TRUE\nLEFT JOIN candidate_updated ON TRUE;`,
    `FROM input\nLEFT JOIN created ON TRUE\nLEFT JOIN updated ON TRUE\nLEFT JOIN onboard_updated ON TRUE\nLEFT JOIN candidate_updated ON TRUE\nLEFT JOIN routing_rule_created ON TRUE\nLEFT JOIN routing_rule_updated ON TRUE;`,
    'final FROM/JOIN clause: join routing_rule_created/updated',
  );

  return updated;
}

function main() {
  const workflow = readJson(filePath);
  const targets = [
    ...(workflow.nodes || []),
    ...(workflow.activeVersion?.nodes || []),
  ].filter((n) => n.name === 'PG: Write job requisition');
  if (!targets.length) throw new Error('Node "PG: Write job requisition" not found');
  for (const node of targets) {
    node.parameters.query = patch(node.parameters.query);
  }
  writeJson(filePath, workflow);
  console.log(JSON.stringify({ patched: filePath, nodesUpdated: targets.length }, null, 2));
}

main();
