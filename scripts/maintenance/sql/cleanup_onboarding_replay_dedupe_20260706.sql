-- 1) 刪除年份錯字列（來源信件寫 2025，正確 2026 列已存在）
DELETE FROM onboardings WHERE expected_date < '2026-01-01';

-- 2) 每人去重：優先保留「新進人員通知」主旨、職位非未知、部門已正規化、最新建立的那一列
DELETE FROM onboardings o
USING (
  SELECT id, row_number() OVER (
    PARTITION BY name
    ORDER BY (email_subject LIKE '%新進人員通知%') DESC,
             (position IS NOT NULL AND position <> '未知職位') DESC,
             (department LIKE '% / %') DESC,
             created_at DESC, id DESC
  ) AS rn
  FROM onboardings
  WHERE (expected_date >= '2026-05-01' OR created_at >= '2026-05-01')
    AND name <> '未知姓名'
) d
WHERE o.id = d.id AND d.rn > 1;

-- 3) 馮堿呈：錄取通知寫「報到日期待定（預計7月下旬）」，修正 CURRENT_DATE fallback 假象
UPDATE onboardings
SET expected_date = '2026-07-27',
    notes = COALESCE(notes, '') || ' 報到日待定（外籍生延長居留辦理中，錄取通知註明預計2026/7下旬）',
    updated_at = NOW()
WHERE name = '馮堿呈';

-- 4) 過期仍 pending 者標記已到職（僵屍 pending 歸正）
UPDATE onboardings
SET status = 'onboarded', actual_date = expected_date, updated_at = NOW()
WHERE status = 'pending' AND expected_date < CURRENT_DATE;

-- 5) 清除離職表垃圾列
DELETE FROM resignations WHERE name = '未知姓名';

-- 回傳今日名單驗證
SELECT json_agg(t ORDER BY t.name) AS rows FROM (
  SELECT name, department, position, status
  FROM onboardings WHERE expected_date = '2026-07-06'
) t;
