import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowPath = path.join(root, 'n8n', 'live_Dashboard_API.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const queryNode = workflow.nodes.find((node) => node.id === 'f45aee9a-bcf3-4669-9835-89ade10ee311');
if (!queryNode) {
  throw new Error('Dashboard API query node not found');
}

const sql = String(queryNode.parameters?.query || '');
if (!sql.includes('WITH candidate_enriched AS (')) {
  throw new Error('Expected candidate_enriched CTE not found');
}
if (sql.includes('normalized_interviews AS (')) {
  console.log(JSON.stringify({ workflowPath, patched: false, reason: 'already-patched' }, null, 2));
  process.exit(0);
}

let updated = sql.replace(
  'WITH candidate_enriched AS (\n',
  `WITH candidate_enriched AS (
  SELECT
    c.id,
    c.name,
    c.applied_position,
    c.department,
    c.job_requisition_id,
    c.status,
    c.source,
    c.created_at,
    c.updated_at,
    c.notes,
    (COALESCE(c.notes, '') LIKE '%[SYS_STAGE:approved_to_invite%') AS has_invite_marker,
    NULLIF(SUBSTRING(COALESCE(c.notes, '') FROM '\\\\|HR:([^\\\\]]*)\\\\]'), '') AS marker_hr,
    NULLIF(
      TRIM(BOTH ' ' FROM REGEXP_REPLACE(COALESCE(c.notes, ''), '\\\\s*\\\\[SYS_STAGE:[^\\\\]]+\\\\]', '', 'g')),
      ''
    ) AS clean_note
  FROM candidates c
),
normalized_interviews AS (
  SELECT
    i.*,
    CASE
      WHEN i.interview_date IS NULL THEN NULL
      WHEN EXTRACT(YEAR FROM i.interview_date)::INT >= EXTRACT(YEAR FROM COALESCE(e.received_at, c.created_at, NOW()))::INT - 1
        THEN i.interview_date
      ELSE make_date(
        EXTRACT(YEAR FROM COALESCE(e.received_at, c.created_at, NOW()))::INT,
        EXTRACT(MONTH FROM i.interview_date)::INT,
        EXTRACT(DAY FROM i.interview_date)::INT
      )
    END AS normalized_interview_date
  FROM interviews i
  LEFT JOIN candidates c ON c.id = i.candidate_id
  LEFT JOIN email_logs e ON e.email_msg_id = i.email_msg_id
),
candidate_enriched_legacy_guard AS (
`,
);

updated = updated.replace(
  /WITH candidate_enriched AS \(\n[\s\S]*?\n\),\ninterview_flags AS \(/,
  `WITH candidate_enriched AS (
  SELECT
    c.id,
    c.name,
    c.applied_position,
    c.department,
    c.job_requisition_id,
    c.status,
    c.source,
    c.created_at,
    c.updated_at,
    c.notes,
    (COALESCE(c.notes, '') LIKE '%[SYS_STAGE:approved_to_invite%') AS has_invite_marker,
    NULLIF(SUBSTRING(COALESCE(c.notes, '') FROM '\\\\|HR:([^\\\\]]*)\\\\]'), '') AS marker_hr,
    NULLIF(
      TRIM(BOTH ' ' FROM REGEXP_REPLACE(COALESCE(c.notes, ''), '\\\\s*\\\\[SYS_STAGE:[^\\\\]]+\\\\]', '', 'g')),
      ''
    ) AS clean_note
  FROM candidates c
),
normalized_interviews AS (
  SELECT
    i.*,
    CASE
      WHEN i.interview_date IS NULL THEN NULL
      WHEN EXTRACT(YEAR FROM i.interview_date)::INT >= EXTRACT(YEAR FROM COALESCE(e.received_at, c.created_at, NOW()))::INT - 1
        THEN i.interview_date
      ELSE make_date(
        EXTRACT(YEAR FROM COALESCE(e.received_at, c.created_at, NOW()))::INT,
        EXTRACT(MONTH FROM i.interview_date)::INT,
        EXTRACT(DAY FROM i.interview_date)::INT
      )
    END AS normalized_interview_date
  FROM interviews i
  LEFT JOIN candidates c ON c.id = i.candidate_id
  LEFT JOIN email_logs e ON e.email_msg_id = i.email_msg_id
),
interview_flags AS (`
);

updated = updated.replace(/FROM interviews i\n  GROUP BY i\.candidate_id/, 'FROM normalized_interviews i\n  GROUP BY i.candidate_id');
updated = updated.replace(/MAX\(i\.interview_date\)/g, 'MAX(i.normalized_interview_date)');
updated = updated.replace(/ORDER BY i\.interview_date DESC NULLS LAST/g, 'ORDER BY i.normalized_interview_date DESC NULLS LAST');
updated = updated.replace(/i\.interview_date IS NOT NULL/g, 'i.normalized_interview_date IS NOT NULL');
updated = updated.replace(/i\.interview_date >= CURRENT_DATE/g, 'i.normalized_interview_date >= CURRENT_DATE');
updated = updated.replace(/COALESCE\(f\.latest_interview_date::timestamptz/g, 'COALESCE(f.latest_interview_date::timestamptz');
updated = updated.replace(/FROM interviews i\n      JOIN candidates c ON c\.id = i\.candidate_id/g, 'FROM normalized_interviews i\n      JOIN candidates c ON c.id = i.candidate_id');
updated = updated.replace(/TO_CHAR\(i\.interview_date, 'YYYY-MM-DD'\)/g, "TO_CHAR(i.normalized_interview_date, 'YYYY-MM-DD')");
updated = updated.replace(/WHERE i\.interview_date IS NOT NULL\n        AND i\.interview_date >= CURRENT_DATE - 14\n        AND i\.interview_date <= CURRENT_DATE \+ 45/g, `WHERE i.normalized_interview_date IS NOT NULL
        AND i.normalized_interview_date >= CURRENT_DATE - 14
        AND i.normalized_interview_date <= CURRENT_DATE + 45`);
updated = updated.replace(/i\.interview_date <= CURRENT_DATE \+ 45/g, 'i.normalized_interview_date <= CURRENT_DATE + 45');
updated = updated.replace(/'date', COALESCE\(TO_CHAR\(c\.latest_interview_date, 'YYYY-MM-DD'\), ''\)/g, "'date', COALESCE(TO_CHAR(c.latest_interview_date, 'YYYY-MM-DD'), '')");
updated = updated.replace(/FROM interviews ih\n        WHERE ih\.candidate_id = c\.id\n          AND ih\.interview_date IS NOT NULL/g, `FROM normalized_interviews ih
        WHERE ih.candidate_id = c.id
          AND ih.normalized_interview_date IS NOT NULL`);
updated = updated.replace(/'date', TO_CHAR\(ih\.interview_date, 'YYYY-MM-DD'\)/g, "'date', TO_CHAR(ih.normalized_interview_date, 'YYYY-MM-DD')");
updated = updated.replace(/ORDER BY ih\.interview_date, ih\.round, ih\.id/g, 'ORDER BY ih.normalized_interview_date, ih.round, ih.id');
updated = updated.replace(/FROM interviews i\n      JOIN candidates c ON c\.id = i\.candidate_id\n      WHERE i\.interview_date >= CURRENT_DATE - INTERVAL '6 months'/g, `FROM normalized_interviews i
      JOIN candidates c ON c.id = i.candidate_id
      WHERE i.normalized_interview_date >= CURRENT_DATE - INTERVAL '6 months'`);
updated = updated.replace(/TO_CHAR\(DATE_TRUNC\('month', i\.interview_date\), 'YYYY-MM'\)/g, "TO_CHAR(DATE_TRUNC('month', i.normalized_interview_date), 'YYYY-MM')");
updated = updated.replace(/GROUP BY DATE_TRUNC\('month', i\.interview_date\)/g, "GROUP BY DATE_TRUNC('month', i.normalized_interview_date)");
updated = updated.replace(/JOIN interviews i ON i\.candidate_id = c\.id\n      WHERE i\.interview_date >= DATE_TRUNC\('month', CURRENT_DATE\)/g, `JOIN normalized_interviews i ON i.candidate_id = c.id
      WHERE i.normalized_interview_date >= DATE_TRUNC('month', CURRENT_DATE)`);

if (!updated.includes('normalized_interviews AS (')) {
  throw new Error('Failed to insert normalized_interviews CTE');
}

queryNode.parameters.query = updated;
fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({ workflowPath, patched: true }, null, 2));
