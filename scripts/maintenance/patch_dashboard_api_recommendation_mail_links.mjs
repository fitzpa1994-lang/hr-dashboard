import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowPath = path.join(root, 'n8n', 'live_Dashboard_API.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8').replace(/^\uFEFF/, ''));

const emailActivityNeedle = `    (ARRAY_AGG(e.sender ORDER BY e.received_at DESC NULLS LAST, e.id DESC) FILTER (
      WHERE COALESCE(e.sender, '') <> ''
    ))[1] AS latest_email_sender,
`;

const emailActivityReplacement = `${emailActivityNeedle}    (ARRAY_AGG(regexp_replace(e.email_msg_id, '#[0-9]+$', '') ORDER BY e.received_at ASC NULLS LAST, e.id ASC) FILTER (
      WHERE COALESCE(e.email_subject, '') ~ '履歷推薦'
        AND COALESCE(e.email_msg_id, '') <> ''
    ))[1] AS recommend_email_msg_id,
    (ARRAY_AGG(e.email_subject ORDER BY e.received_at ASC NULLS LAST, e.id ASC) FILTER (
      WHERE COALESCE(e.email_subject, '') ~ '履歷推薦'
        AND COALESCE(e.email_subject, '') <> ''
    ))[1] AS recommend_email_subject,
    MIN(e.received_at) FILTER (
      WHERE COALESCE(e.email_subject, '') ~ '履歷推薦'
        AND e.received_at IS NOT NULL
    ) AS recommend_email_received_at,
`;

const candidateStateNeedle = `    COALESCE(a.latest_email_sender, '') AS latest_email_sender,
`;

const candidateStateReplacement = `${candidateStateNeedle}    COALESCE(a.recommend_email_msg_id, '') AS recommend_email_msg_id,
    COALESCE(a.recommend_email_subject, '') AS recommend_email_subject,
    a.recommend_email_received_at,
`;

const candidateJsonNeedle = `      'latestEmailSubject', COALESCE(c.latest_email_subject, ''),
`;

const candidateJsonReplacement = `${candidateJsonNeedle}      'recommendEmailMsgId', COALESCE(c.recommend_email_msg_id, ''),
      'recommendEmailSubject', COALESCE(c.recommend_email_subject, ''),
      'recommendEmailReceivedAt', COALESCE(TO_CHAR(c.recommend_email_received_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD"T"HH24:MI:SS'), ''),
`;

function patchSql(sql) {
  if (sql.includes('recommend_email_msg_id')) return { sql, changed: false };
  let updated = sql;
  for (const [needle, replacement] of [
    [emailActivityNeedle, emailActivityReplacement],
    [candidateStateNeedle, candidateStateReplacement],
    [candidateJsonNeedle, candidateJsonReplacement],
  ]) {
    if (!updated.includes(needle)) {
      throw new Error(`Dashboard API SQL patch anchor not found:\n${needle}`);
    }
    updated = updated.split(needle).join(replacement);
  }
  return { sql: updated, changed: true };
}

let changed = false;

function patchNode(node) {
  if (node.type !== 'n8n-nodes-base.postgres') return;
  const sql = String(node.parameters?.query || '');
  if (!sql.includes("'candidatesData'") || !sql.includes("'stats'")) return;
  const result = patchSql(sql);
  if (!result.changed) return;
  node.parameters.query = result.sql;
  changed = true;
}

for (const node of workflow.nodes || []) patchNode(node);
if (workflow.activeVersion?.nodes) {
  for (const node of workflow.activeVersion.nodes) patchNode(node);
}

if (changed) {
  fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({ workflowPath, patched: changed }, null, 2));
