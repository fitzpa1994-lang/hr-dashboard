-- WBU 底下所有人，看 dept 欄位實際值
SELECT json_agg(t ORDER BY t.dept, t.name) AS rows FROM (
  SELECT
    c.name,
    c.department AS c_dept,
    j.department AS j_dept,
    COALESCE(j.department, c.department) AS dept,
    j.position_title AS j_pos,
    c.applied_position AS c_pos,
    c.status,
    c.source,
    c.job_requisition_id AS jrid
  FROM candidates c
  LEFT JOIN job_requisitions j ON j.id = c.job_requisition_id
  WHERE COALESCE(j.department, c.department) LIKE 'WBU%'
    AND c.status NOT IN ('rejected', 'withdrawn')
  ORDER BY COALESCE(j.department, c.department), c.name
) t;
