-- 查今天 email_logs 裡含「履歷推薦」的所有信件，確認張芷瑋那封的實際主旨
SELECT
  el.email_subject,
  el.action,
  el.sender,
  TO_CHAR(el.received_at AT TIME ZONE 'Asia/Taipei', 'HH24:MI') AS rcv_time,
  c.name AS candidate_name
FROM email_logs el
LEFT JOIN candidates c ON c.id = el.candidate_id
WHERE el.received_at >= (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei')
  AND el.received_at < (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei' + INTERVAL '1 day')
  AND el.email_subject ~ '履歷推薦'
ORDER BY el.received_at;
