SELECT json_agg(t) AS rows FROM (
  SELECT email_subject, COUNT(*) AS cnt
  FROM email_logs
  WHERE candidate_id IN (
    SELECT id FROM candidates WHERE job_requisition_id IN (23, 25)
    AND status NOT IN ('rejected', 'withdrawn')
  )
  AND email_subject IS NOT NULL
  GROUP BY email_subject
  ORDER BY cnt DESC
  LIMIT 60
) t;
