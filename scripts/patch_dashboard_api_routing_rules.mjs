import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const filePath = path.join(root, 'n8n', 'live_Dashboard_API.json');

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

// Mirrors scripts/patch_position_routing_rules.mjs's table definition exactly
// (both files must agree, since either may run first against a fresh DB).
const BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS position_routing_rules (
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

  updated = replaceOnce(
    updated,
    `\nSET LOCAL timezone = 'Asia/Taipei';\n`,
    `\nSET LOCAL timezone = 'Asia/Taipei';\n${BOOTSTRAP}`,
    'bootstrap: add position_routing_rules table',
  );

  updated = replaceOnce(
    updated,
    `    JOIN job_requisitions j ON j.id = f.job_requisition_id\n  ), '[]'::json),\n`,
    `    JOIN job_requisitions j ON j.id = f.job_requisition_id\n  ), '[]'::json),\n\n` +
      `  'positionRoutingRules', COALESCE((\n` +
      `    SELECT json_agg(json_build_object(\n` +
      `      'id', r.id,\n` +
      `      'matchType', r.match_type,\n` +
      `      'pattern', r.pattern,\n` +
      `      'jobRequisitionId', r.job_requisition_id,\n` +
      `      'departmentHint', r.department_hint,\n` +
      `      'priority', r.priority,\n` +
      `      'isActive', r.is_active,\n` +
      `      'notes', COALESCE(r.notes, '')\n` +
      `    ) ORDER BY r.priority, r.id)\n` +
      `    FROM position_routing_rules r\n` +
      `  ), '[]'::json),\n`,
    'main SELECT: add positionRoutingRules key',
  );

  return updated;
}

function main() {
  const workflow = readJson(filePath);
  const targets = [
    ...(workflow.nodes || []),
    ...(workflow.activeVersion?.nodes || []),
  ].filter((n) => JSON.stringify(n).includes('monthlyFunnelByDepartment'));
  if (!targets.length) throw new Error('Dashboard API query node not found');
  for (const node of targets) {
    node.parameters.query = patch(node.parameters.query);
  }
  writeJson(filePath, workflow);
  console.log(JSON.stringify({ patched: filePath, nodesUpdated: targets.length }, null, 2));
}

main();
