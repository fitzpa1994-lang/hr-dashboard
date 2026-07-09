-- 修正 RF/SAR 錯誤分類
-- job_req 23 = WBU / SAR工程部 / 測試工程師
-- job_req 25 = WBU / RF工程一部 / 測試工程師
-- job_req  4 = 新竹 / 工程部 / 測試工程師(RF/EMC)

-- 1. RF測試工程師 → 應在 WBU/RF工程一部 (job_req 25)，被誤分到 SAR (job_req 23)
UPDATE candidates
SET job_requisition_id = 25,
    department        = 'WBU / RF工程一部'
WHERE name IN (
  '楊文俊', '陳佳暉', '鍾小明', '奉婕綾', '黃楷翰',
  '曾昱維', '熊吟芳', '黃子維', '曹晉瑋', '王建翔',
  '蔡正陽', '詹博文', '翁子皓', '吳行元', '王瑋軒',
  '王可莉', '許璨勝', '呂冠佾', '劉宗勳'
)
AND job_requisition_id = 23
AND status NOT IN ('rejected', 'withdrawn');

-- 2. 新竹 RF / EMC → 應在新竹 (job_req 4)，被誤分到 SAR (job_req 23)
UPDATE candidates
SET job_requisition_id = 4,
    department        = '新竹 / 工程部'
WHERE name IN ('徐亦踅', '張若宸')
AND job_requisition_id = 23
AND status NOT IN ('rejected', 'withdrawn');

-- 驗證：看修正後 WBU 子部門分佈
SELECT json_agg(t ORDER BY t.dept, t.cnt DESC) AS rows FROM (
  SELECT
    COALESCE(j.department, c.department) AS dept,
    COUNT(*) AS cnt
  FROM candidates c
  LEFT JOIN job_requisitions j ON j.id = c.job_requisition_id
  WHERE COALESCE(j.department, c.department) LIKE 'WBU%'
    OR COALESCE(j.department, c.department) = '新竹 / 工程部'
  AND c.status NOT IN ('rejected', 'withdrawn')
  GROUP BY COALESCE(j.department, c.department)
) t;
