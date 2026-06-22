ALTER TABLE candidates
ADD COLUMN job_requisition_id INTEGER REFERENCES job_requisitions(id) ON DELETE SET NULL;

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
          WHEN substr(j.department, 1, instr(j.department || ' / ', ' / ') - 1) = c.department THEN 1
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
    ON replace(j.position_title, ' ', '') = replace(c.applied_position, ' ', '')
   AND (
     j.department = c.department
     OR substr(j.department, 1, instr(j.department || ' / ', ' / ') - 1) = c.department
   )
)
UPDATE candidates
SET job_requisition_id = (
  SELECT matched.job_requisition_id
  FROM matched
  WHERE matched.candidate_id = candidates.id
    AND matched.rn = 1
)
WHERE job_requisition_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM matched
    WHERE matched.candidate_id = candidates.id
      AND matched.rn = 1
  );
