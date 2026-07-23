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

function patch(query) {
  let updated = query;

  updated = replaceOnce(
    updated,
    `    '{{ ($json.body.candidateStatus || "").replace(/'/g, "''") }}'::TEXT AS candidate_status,\n`,
    `    '{{ ($json.body.candidateStatus || "").replace(/'/g, "''") }}'::TEXT AS candidate_status,\n` +
      `    NULLIF('{{ ($json.body.candidateDepartment || '').replace(/'/g, "''") }}', '')::TEXT AS candidate_department,\n`,
    'input CTE: add candidate_department field',
  );

  updated = replaceOnce(
    updated,
    `candidate_updated AS (\n` +
      `  UPDATE candidates\n` +
      `  SET status = input.candidate_status,\n` +
      `      updated_at = NOW()\n` +
      `  FROM input\n` +
      `  WHERE candidates.id = input.candidate_id\n` +
      `    AND input.action = 'update_candidate_status'\n` +
      `    AND input.candidate_status IN ('withdrawn', 'rejected', 'dept_scheduling')\n` +
      `  RETURNING candidates.id, candidates.name, candidates.status\n` +
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
      `),`,
    'candidate_updated CTE: support update_candidate_department',
  );

  updated = replaceOnce(
    updated,
    `  'candidate', CASE WHEN input.action = 'update_candidate_status' THEN (SELECT json_build_object('id', cu.id, 'name', cu.name, 'status', cu.status) FROM candidate_updated cu LIMIT 1) ELSE NULL END,`,
    `  'candidate', CASE WHEN input.action IN ('update_candidate_status', 'update_candidate_department') THEN (SELECT json_build_object('id', cu.id, 'name', cu.name, 'status', cu.status, 'department', cu.department) FROM candidate_updated cu LIMIT 1) ELSE NULL END,`,
    'final SELECT: return department in candidate JSON',
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
