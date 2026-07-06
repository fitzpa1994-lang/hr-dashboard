-- 修正舊 parser 時區偏移造成的 +1 天（以信件原文日期為準）
UPDATE resignations SET last_day = last_day - 1, updated_at = NOW()
WHERE (name, last_day::text) IN (
  ('陳禹廷', '2026-05-19'),
  ('劉維民', '2026-05-21'),
  ('謝瀧輝', '2026-05-30'),
  ('李鎔丞', '2026-06-18'),
  ('盧政樺', '2026-06-18'),
  ('羅恩',   '2026-06-25'),
  ('劉祐齊', '2026-06-30'),
  ('洪鈺婷', '2026-07-03'),
  ('陳文慧', '2026-07-20')
);

-- 曾佳佩：信件寫 7/6，刪除 7/7 錯誤列
DELETE FROM resignations WHERE name = '曾佳佩' AND last_day = '2026-07-07';

SELECT json_agg(t ORDER BY t.last_day) AS rows FROM (
  SELECT name, last_day::text AS last_day, status
  FROM resignations
  WHERE last_day >= '2026-06-10'
) t;
