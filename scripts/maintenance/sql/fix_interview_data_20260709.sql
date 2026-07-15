-- ============================================================
-- 修正 2026-07-09 面試排程異常資料
-- 問題：李桓宇重複、陳柏銓部門錯誤、蕭宏勳部門+時間錯誤
-- ============================================================

BEGIN;

-- ── 1. 李桓宇重複 ──
-- 保留 14:00 那筆（最新），取消 11:05 的舊紀錄
UPDATE interviews
SET status = 'cancelled'
WHERE candidate_id = (SELECT id FROM candidates WHERE name = '李桓宇' LIMIT 1)
  AND interview_date = CURRENT_DATE
  AND interview_time = '11:05'
  AND COALESCE(status, '') <> 'cancelled';

-- ── 2. 陳柏銓：WBU/SAR工程部 → WBU/RF工程一部 (job_requisition_id=25) ──
UPDATE candidates
SET department       = j.department,
    applied_position = j.position_title,
    job_requisition_id = j.id
FROM job_requisitions j
WHERE j.id = 25
  AND candidates.name = '陳柏銓';

-- ── 3. 蕭宏勳：ICC → 新華RF測試工程師 (job_requisition_id=12) + 清除錯誤時間 ──
UPDATE candidates
SET department       = j.department,
    applied_position = j.position_title,
    job_requisition_id = j.id
FROM job_requisitions j
WHERE j.id = 12
  AND candidates.name = '蕭宏勳';

-- 清除 03:22 這個明顯是 email timestamp 的錯誤時間
UPDATE interviews
SET interview_time = NULL
WHERE candidate_id = (SELECT id FROM candidates WHERE name = '蕭宏勳' LIMIT 1)
  AND interview_time = '03:22';

-- 確認修改結果
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
WHERE c.name IN ('李桓宇', '陳柏銓', '蕭宏勳')
ORDER BY c.name, i.interview_time;

COMMIT;
