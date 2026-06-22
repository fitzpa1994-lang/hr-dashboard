import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const filePath = path.join(root, 'n8n', 'live_Dashboard_API.json');

const query = `ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS job_requisition_id INTEGER REFERENCES job_requisitions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_job_requisition
ON candidates(job_requisition_id);

WITH candidate_enriched AS (
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
interview_flags AS (
  SELECT
    i.candidate_id,
    MAX(i.interview_date) FILTER (
      WHERE i.interview_date IS NOT NULL
        AND COALESCE(i.status, '') <> 'cancelled'
    ) AS latest_interview_date,
    (ARRAY_AGG(i.hr_owner ORDER BY i.interview_date DESC NULLS LAST, i.id DESC) FILTER (
      WHERE COALESCE(i.hr_owner, '') <> ''
        AND COALESCE(i.status, '') <> 'cancelled'
    ))[1] AS latest_hr_owner,
    (ARRAY_AGG(i.email_web_link ORDER BY i.interview_date DESC NULLS LAST, i.id DESC) FILTER (
      WHERE COALESCE(i.email_web_link, '') <> ''
        AND COALESCE(i.status, '') <> 'cancelled'
    ))[1] AS latest_email_link,
    BOOL_OR(
      i.interview_date IS NOT NULL
      AND COALESCE(i.status, '') <> 'cancelled'
    ) AS has_active_interview,
    BOOL_OR(
      i.interview_date IS NOT NULL
      AND i.interview_date >= CURRENT_DATE
      AND COALESCE(i.status, '') <> 'cancelled'
    ) AS has_upcoming_interview
  FROM interviews i
  GROUP BY i.candidate_id
),
candidate_state AS (
  SELECT
    c.*,
    COALESCE(f.latest_interview_date, NULL) AS latest_interview_date,
    COALESCE(f.latest_hr_owner, '') AS latest_hr_owner,
    COALESCE(f.latest_email_link, '') AS latest_email_link,
    COALESCE(f.has_active_interview, FALSE) AS has_active_interview,
    COALESCE(f.has_upcoming_interview, FALSE) AS has_upcoming_interview,
    CASE
      WHEN c.status = 'hired' THEN 'offer'
      WHEN c.status IN ('rejected', 'withdrawn') THEN 'withdrawn'
      WHEN c.status LIKE '%錄取%' THEN 'offer'
      WHEN c.status LIKE '%到職%' THEN 'onboarded'
      WHEN COALESCE(f.has_active_interview, FALSE) THEN 'interviewing'
      WHEN c.status = 'approved_to_invite' THEN 'approved_to_invite'
      WHEN c.status = 'pending_review' AND c.has_invite_marker THEN 'approved_to_invite'
      WHEN c.status = 'pending_review' THEN 'pending_review'
      ELSE 'interviewing'
    END AS derived_status
  FROM candidate_enriched c
  LEFT JOIN interview_flags f ON f.candidate_id = c.id
)
SELECT json_build_object(
  'today', TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD'),
  'generatedAt', TO_CHAR(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS'),

  'schedEvents', COALESCE((
    SELECT json_agg(e ORDER BY (e->>'date'), (e->>'time'), (e->>'name'))
    FROM (
      SELECT json_build_object(
        'type', 'interview',
        'name', c.name,
        'pos', c.applied_position,
        'dept', c.department,
        'jobRequisitionId', c.job_requisition_id,
        'date', TO_CHAR(i.interview_date, 'YYYY-MM-DD'),
        'time', COALESCE(i.interview_time, ''),
        'hr', COALESCE(i.hr_owner, ''),
        'round', COALESCE(i.round, 1),
        'note', COALESCE(i.notes, ''),
        'emailLink', COALESCE(i.email_web_link, '')
      ) AS e
      FROM interviews i
      JOIN candidates c ON c.id = i.candidate_id
      WHERE i.interview_date IS NOT NULL
        AND i.interview_date >= CURRENT_DATE - 14
        AND i.interview_date <= CURRENT_DATE + 45
        AND COALESCE(i.status, '') <> 'cancelled'
      UNION ALL
      SELECT json_build_object(
        'type', 'onboard',
        'name', o.name,
        'pos', o.position,
        'dept', o.department,
        'date', TO_CHAR(o.expected_date, 'YYYY-MM-DD'),
        'time', '09:00',
        'hr', COALESCE(o.hr_owner, ''),
        'round', 0,
        'note', '',
        'emailLink', COALESCE(o.email_web_link, '')
      ) AS e
      FROM onboardings o
      WHERE o.expected_date IS NOT NULL
        AND o.status <> 'cancelled'
        AND o.expected_date >= CURRENT_DATE - 7
        AND o.expected_date <= CURRENT_DATE + 60
      UNION ALL
      SELECT json_build_object(
        'type', 'resign',
        'name', r.name,
        'pos', r.position,
        'dept', r.department,
        'date', TO_CHAR(r.last_day, 'YYYY-MM-DD'),
        'time', '',
        'hr', COALESCE(r.hr_owner, ''),
        'round', 0,
        'note', COALESCE(r.reason, ''),
        'emailLink', COALESCE(r.email_web_link, '')
      ) AS e
      FROM resignations r
      WHERE r.last_day IS NOT NULL
        AND r.status <> 'cancelled'
        AND r.last_day >= CURRENT_DATE - 7
        AND r.last_day <= CURRENT_DATE + 60
    ) ev
  ), '[]'::json),

  'onboardData', COALESCE((
    SELECT json_agg(json_build_object(
      'name', o.name,
      'dept', o.department,
      'pos', o.position,
      'date', TO_CHAR(o.expected_date, 'YYYY-MM-DD'),
      'hr', COALESCE(o.hr_owner, ''),
      'status', CASE WHEN o.status = 'onboarded' THEN 'onboarded' ELSE 'pending' END,
      'emailLink', COALESCE(o.email_web_link, '')
    ) ORDER BY o.expected_date DESC, o.name)
    FROM onboardings o
    WHERE o.status <> 'cancelled'
      AND o.expected_date >= CURRENT_DATE - 60
  ), '[]'::json),

  'resignData', COALESCE((
    SELECT json_agg(json_build_object(
      'name', r.name,
      'dept', r.department,
      'pos', r.position,
      'lastDay', TO_CHAR(r.last_day, 'YYYY-MM-DD'),
      'hr', COALESCE(r.hr_owner, ''),
      'reason', COALESCE(r.reason, ''),
      'status', r.status,
      'emailLink', COALESCE(r.email_web_link, '')
    ) ORDER BY r.last_day DESC, r.name)
    FROM resignations r
    WHERE r.status <> 'cancelled'
      AND r.last_day >= CURRENT_DATE - 60
  ), '[]'::json),

  'candidatesData', COALESCE((
    SELECT json_agg(json_build_object(
      'name', c.name,
      'pos', c.applied_position,
      'dept', c.department,
      'jobRequisitionId', c.job_requisition_id,
      'date', COALESCE(TO_CHAR(c.latest_interview_date, 'YYYY-MM-DD'), ''),
      'latestDate', COALESCE(TO_CHAR(c.latest_interview_date, 'YYYY-MM-DD'), TO_CHAR(COALESCE(c.updated_at, c.created_at), 'YYYY-MM-DD')),
      'status', c.derived_status,
      'onboard', NULL,
      'hr', COALESCE(c.latest_hr_owner, c.marker_hr, ''),
      'note', COALESCE(c.clean_note, ''),
      'source', COALESCE(c.source, ''),
      'emailLink', COALESCE(c.latest_email_link, ''),
      'resumeLink', COALESCE((
        SELECT MAX(o.resume_link)
        FROM onboardings o
        WHERE (o.candidate_id = c.id OR o.name = c.name)
          AND o.resume_link IS NOT NULL
      ), ''),
      'history', COALESCE((
        SELECT json_agg(json_build_object(
          'date', TO_CHAR(ih.interview_date, 'YYYY-MM-DD'),
          'type', 'interview',
          'title', CONCAT('第', ih.round, '輪面試 - ', COALESCE(ih.status, '')),
          'note', COALESCE(ih.notes, ''),
          'color', CASE ih.result
            WHEN 'passed' THEN 'green'
            WHEN 'failed' THEN 'pink'
            ELSE 'blue'
          END
        ) ORDER BY ih.interview_date, ih.round, ih.id)
        FROM interviews ih
        WHERE ih.candidate_id = c.id
          AND ih.interview_date IS NOT NULL
      ), '[]'::json)
    ) ORDER BY COALESCE(c.latest_interview_date, COALESCE(c.updated_at, c.created_at)::date) DESC, c.name)
    FROM candidate_state c
  ), '[]'::json),

  'unmappedCandidates', COALESCE((
    SELECT json_agg(json_build_object(
      'name', c.name,
      'pos', c.applied_position,
      'dept', c.department,
      'jobRequisitionId', c.job_requisition_id,
      'latestDate', COALESCE(TO_CHAR(c.latest_interview_date, 'YYYY-MM-DD'), TO_CHAR(COALESCE(c.updated_at, c.created_at), 'YYYY-MM-DD')),
      'status', c.derived_status,
      'hr', COALESCE(c.latest_hr_owner, c.marker_hr, ''),
      'note', COALESCE(c.clean_note, ''),
      'source', COALESCE(c.source, ''),
      'emailLink', COALESCE(c.latest_email_link, '')
    ) ORDER BY COALESCE(c.latest_interview_date, COALESCE(c.updated_at, c.created_at)::date) DESC, c.name)
    FROM candidate_state c
    WHERE c.job_requisition_id IS NULL
  ), '[]'::json),

  'jobsData', COALESCE((
    SELECT json_agg(json_build_object(
      'id', j.id,
      'pos', j.position_title,
      'dept', j.department,
      'open', TO_CHAR(j.open_date, 'YYYY-MM-DD'),
      'target', TO_CHAR(j.target_date, 'YYYY-MM-DD'),
      'headcount', COALESCE(j.headcount, 1),
      'filled', COALESCE(j.filled_count, 0),
      'cands', COALESCE(x.cands, 0),
      'hired', COALESCE(x.hired, 0),
      'urgency', COALESCE(j.urgency, 3),
      'status', j.status,
      'note', COALESCE(j.notes, '')
    ) ORDER BY COALESCE(j.urgency, 3) DESC, j.open_date NULLS LAST, j.position_title)
    FROM job_requisitions j
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS cands,
        COUNT(*) FILTER (WHERE c.status IN ('hired')) AS hired
      FROM candidates c
      WHERE c.job_requisition_id = j.id
         OR (
           c.job_requisition_id IS NULL
           AND c.department = j.department
           AND c.applied_position = j.position_title
         )
    ) x ON TRUE
  ), '[]'::json),

  'monthlyTrend', COALESCE((
    SELECT json_agg(json_build_object(
      'month', t.month,
      'interviews', t.interviews,
      'offers', t.offers,
      'onboarded', t.onboarded
    ) ORDER BY t.month)
    FROM (
      SELECT
        TO_CHAR(DATE_TRUNC('month', i.interview_date), 'YYYY-MM') AS month,
        COUNT(*) AS interviews,
        COUNT(CASE WHEN c.status IN ('hired', '錄取') THEN 1 END) AS offers,
        COUNT(CASE WHEN c.status LIKE '%到職%' THEN 1 END) AS onboarded
      FROM interviews i
      JOIN candidates c ON c.id = i.candidate_id
      WHERE i.interview_date >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', i.interview_date)
      ORDER BY 1
      LIMIT 6
    ) t
  ), '[]'::json),

  'departmentStats', COALESCE((
    SELECT json_agg(json_build_object(
      'dept', d.department,
      'candidates', d.total_candidates,
      'hired', d.hired_count,
      'avgDaysToOffer', d.avg_days_to_offer
    ) ORDER BY d.total_candidates DESC, d.department)
    FROM (
      SELECT
        c.department,
        COUNT(DISTINCT c.id) AS total_candidates,
        COUNT(DISTINCT CASE WHEN c.status IN ('hired') THEN c.id END) AS hired_count,
        ROUND(AVG(o.days_to_offer)::numeric, 1) AS avg_days_to_offer
      FROM candidates c
      LEFT JOIN offers o ON o.candidate_id = c.id AND o.days_to_offer IS NOT NULL
      GROUP BY c.department
    ) d
  ), '[]'::json),

  'stats', json_build_object(
    'activeCount', (
      SELECT COUNT(*)
      FROM candidate_state c
      WHERE c.derived_status IN ('pending_review', 'approved_to_invite', 'interviewing')
    ),
    'offerCount', (
      SELECT COUNT(*)
      FROM candidate_state c
      WHERE c.derived_status = 'offer'
    ),
    'pendingOnboard', (SELECT COUNT(*) FROM onboardings WHERE status = 'pending' AND expected_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30),
    'pendingResign', (SELECT COUNT(*) FROM resignations WHERE status = 'active' AND last_day BETWEEN CURRENT_DATE AND CURRENT_DATE + 30),
    'monthOnboard', (SELECT COUNT(*) FROM onboardings WHERE expected_date >= DATE_TRUNC('month', CURRENT_DATE) AND status = 'onboarded'),
    'monthResign', (SELECT COUNT(*) FROM resignations WHERE last_day >= DATE_TRUNC('month', CURRENT_DATE) AND status = 'done'),
    'hireRate', COALESCE((
      SELECT ROUND(
        100.0 * COUNT(DISTINCT CASE WHEN c.status IN ('hired', '錄取') THEN c.id END)
        / NULLIF(COUNT(DISTINCT c.id), 0), 0
      )
      FROM candidates c
      JOIN interviews i ON i.candidate_id = c.id
      WHERE i.interview_date >= DATE_TRUNC('month', CURRENT_DATE)
    ), 0),
    'pendingReviewCount', (
      SELECT COUNT(*)
      FROM candidate_state c
      WHERE c.derived_status = 'pending_review'
        AND COALESCE(c.updated_at, c.created_at) >= CURRENT_DATE - INTERVAL '14 days'
    ),
    'pendingReviewOverdueCount', (
      SELECT COUNT(*)
      FROM candidate_state c
      WHERE c.derived_status = 'pending_review'
        AND COALESCE(c.updated_at, c.created_at) >= CURRENT_DATE - INTERVAL '14 days'
        AND c.created_at < CURRENT_DATE - INTERVAL '2 days'
    ),
    'pendingScheduledReviewCount', (
      SELECT COUNT(*)
      FROM candidate_state c
      WHERE c.status = 'pending_review'
        AND c.has_upcoming_interview
    ),
    'pendingInviteOpenCount', (
      SELECT COUNT(*)
      FROM candidate_state c
      WHERE c.derived_status = 'approved_to_invite'
        AND COALESCE(c.updated_at, c.created_at) >= CURRENT_DATE - INTERVAL '14 days'
    ),
    'pendingInviteOverdueCount', (
      SELECT COUNT(*)
      FROM candidate_state c
      WHERE c.derived_status = 'approved_to_invite'
        AND COALESCE(c.updated_at, c.created_at) >= CURRENT_DATE - INTERVAL '14 days'
        AND c.created_at < CURRENT_DATE - INTERVAL '3 days'
    ),
    'unmappedCandidateCount', (
      SELECT COUNT(*)
      FROM candidate_state c
      WHERE c.job_requisition_id IS NULL
    ),
    'avgDaysToOffer', COALESCE((SELECT ROUND(AVG(days_to_offer)::numeric, 1) FROM offers WHERE days_to_offer IS NOT NULL), 0)
  )
) AS data;`;

const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const patchNode = (node) => {
  if (node.type === 'n8n-nodes-base.postgres' && node.parameters?.operation === 'executeQuery') {
    if (String(node.parameters.query || '').includes("'jobsData'")) {
      node.parameters.query = query;
    }
  }
};

for (const node of workflow.nodes || []) patchNode(node);
if (workflow.activeVersion?.nodes) {
  for (const node of workflow.activeVersion.nodes) patchNode(node);
}

fs.writeFileSync(filePath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ patched: 'live_Dashboard_API.json' }, null, 2));
