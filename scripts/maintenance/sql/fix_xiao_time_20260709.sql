UPDATE interviews
SET interview_time = '14:00'
WHERE candidate_id = (SELECT id FROM candidates WHERE name = '蕭宏勳' LIMIT 1)
  AND interview_date = '2026-07-09'
  AND (interview_time IS NULL OR interview_time = '03:22');

SELECT c.name, i.interview_date::text, i.interview_time, i.status
FROM candidates c
JOIN interviews i ON i.candidate_id = c.id
WHERE c.name = '蕭宏勳' AND i.interview_date = '2026-07-09';
