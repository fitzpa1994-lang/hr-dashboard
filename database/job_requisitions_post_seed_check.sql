-- Verify the live database after running job_requisitions_seed.sql.
-- Expected current state for the initial rollout:
--   - 28 requisitions
--   - 6 top-level departments
--   - 3 open-ended requisitions with headcount = 999
--   - no duplicate (department, position_title) pairs

WITH summary AS (
    SELECT
        COUNT(*) AS total_rows,
        COUNT(DISTINCT SPLIT_PART(department, ' / ', 1)) AS department_count,
        COUNT(*) FILTER (WHERE headcount = 999) AS open_ended_count
    FROM job_requisitions
),
duplicates AS (
    SELECT department, position_title, COUNT(*) AS duplicate_count
    FROM job_requisitions
    GROUP BY department, position_title
    HAVING COUNT(*) > 1
)
SELECT json_build_object(
    'totalRows', summary.total_rows,
    'topLevelDepartmentCount', summary.department_count,
    'openEndedCount', summary.open_ended_count,
    'duplicateCount', (SELECT COUNT(*) FROM duplicates),
    'expectedTotalRows', 28,
    'expectedTopLevelDepartmentCount', 6,
    'expectedOpenEndedCount', 3
) AS rollout_check
FROM summary;
