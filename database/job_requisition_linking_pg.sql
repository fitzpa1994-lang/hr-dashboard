ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS job_requisition_id INTEGER REFERENCES job_requisitions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_job_requisition
ON candidates(job_requisition_id);

WITH matched AS (
  SELECT
    c.id AS candidate_id,
    j.id AS job_requisition_id,
    ROW_NUMBER() OVER (
      PARTITION BY c.id
      ORDER BY
        CASE
          WHEN j.department = c.department THEN 0
          WHEN split_part(j.department, ' / ', 1) = c.department THEN 1
          ELSE 2
        END,
        CASE
          WHEN j.position_title = c.applied_position THEN 0
          ELSE 1
        END,
        j.id
    ) AS rn
  FROM candidates c
  JOIN job_requisitions j
    ON regexp_replace(j.position_title, '\s+', '', 'g') = regexp_replace(c.applied_position, '\s+', '', 'g')
   AND (
     j.department = c.department
     OR split_part(j.department, ' / ', 1) = c.department
   )
)
UPDATE candidates c
SET job_requisition_id = m.job_requisition_id
FROM matched m
WHERE c.id = m.candidate_id
  AND m.rn = 1
  AND c.job_requisition_id IS NULL;
