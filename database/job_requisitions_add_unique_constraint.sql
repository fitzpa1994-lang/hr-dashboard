-- Run only after job_requisitions_duplicate_audit.sql returns no rows.
-- This makes the business key explicit in PostgreSQL.

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_requisitions_department_position_unique
ON job_requisitions (department, position_title);
