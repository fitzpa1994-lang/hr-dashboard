SELECT json_agg(t ORDER BY t.received_at DESC) AS rows
FROM (
  SELECT
    el.email_subject,
    el.sender,
    TO_CHAR(el.received_at AT TIME ZONE 'Asia/Taipei', 'HH24:MI') AS received_tw,
    el.action,
    el.error_msg,
    c.name AS candidate_name
  FROM email_logs el
  LEFT JOIN candidates c ON c.id = el.candidate_id
  WHERE el.received_at >= (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei')
    AND el.received_at < (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei' + INTERVAL '1 day')
  ORDER BY el.received_at DESC
  LIMIT 30
) t;
