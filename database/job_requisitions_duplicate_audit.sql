-- Review duplicate requisitions before adding a unique constraint on
-- (department, position_title) in the live database.

SELECT
    department,
    position_title,
    COUNT(*) AS duplicate_count,
    ARRAY_AGG(id ORDER BY id) AS requisition_ids,
    ARRAY_AGG(status ORDER BY id) AS statuses,
    ARRAY_AGG(headcount ORDER BY id) AS headcounts
FROM job_requisitions
GROUP BY department, position_title
HAVING COUNT(*) > 1
ORDER BY department, position_title;
