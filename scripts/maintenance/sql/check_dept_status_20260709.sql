SELECT json_agg(t) AS rows FROM (
  SELECT
    c.name,
    c.department,
    c.applied_position,
    c.status,
    c.source,
    TO_CHAR(c.updated_at AT TIME ZONE 'Asia/Taipei', 'MM/DD HH24:MI') AS updated_tw,
    (SELECT TO_CHAR(MAX(i.interview_date), 'MM/DD') FROM interviews i WHERE i.candidate_id = c.id AND COALESCE(i.status,'') <> 'cancelled') AS latest_intv,
    (SELECT i.interview_time FROM interviews i WHERE i.candidate_id = c.id AND COALESCE(i.status,'') <> 'cancelled' ORDER BY i.interview_date DESC, i.id DESC LIMIT 1) AS intv_time
  FROM candidates c
  WHERE c.status NOT IN ('rejected','withdrawn')
  ORDER BY c.department NULLS LAST, c.name
) t;
