-- 修正 許瑞芳：WBU/SAR工程部 → WBU/RF工程一部 (job_requisition_id=25)
-- 原因：信件明確標示 RF工程一部，但 n8n 無該關鍵字規則，tiebreaker 選了 id 較小的 SAR(23)
-- 2026-07-15

BEGIN;

UPDATE candidates
SET department        = j.department,
    applied_position  = j.position_title,
    job_requisition_id = j.id
FROM job_requisitions j
WHERE j.id = 25
  AND candidates.name = '許瑞芳';

-- 確認修改
SELECT
  c.name,
  c.department,
  c.applied_position,
  c.job_requisition_id,
  i.interview_date,
  i.interview_time,
  i.status
FROM candidates c
LEFT JOIN interviews i ON i.candidate_id = c.id AND i.interview_date = CURRENT_DATE
WHERE c.name = '許瑞芳';

COMMIT;
