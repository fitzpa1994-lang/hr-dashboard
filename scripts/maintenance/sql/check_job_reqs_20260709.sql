SELECT json_agg(t ORDER BY t.id) AS rows FROM (
  SELECT id, department, position_title, status, headcount, filled_count
  FROM job_requisitions
  WHERE status NOT IN ('cancelled')
  ORDER BY id
) t;
