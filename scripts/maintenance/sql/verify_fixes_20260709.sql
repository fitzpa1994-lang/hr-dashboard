SELECT c.name, c.department, c.applied_position, c.job_requisition_id,
       i.interview_date::text, i.interview_time, i.status
FROM candidates c
LEFT JOIN interviews i ON i.candidate_id = c.id
WHERE c.name IN ('李桓宇', '陳柏銓', '蕭宏勳')
  AND (i.id IS NULL OR i.interview_date >= CURRENT_DATE - 3)
ORDER BY c.name, i.interview_date DESC, i.interview_time;
