SELECT json_agg(t ORDER BY t.processed_at DESC) AS rows
FROM (
  SELECT email_msg_id, email_subject, sender, received_at::text, action, error_msg, processed_at::text
  FROM email_logs
  WHERE processed_at >= NOW() - INTERVAL '8 hours'
  ORDER BY processed_at DESC
  LIMIT 30
) t;
