-- 修正 3 筆未分類候選人部門

-- 金仁星：同業業務 → WBU / 業務部（被錯誤對應到 job_req 17 MIS，需修正）
UPDATE candidates
SET job_requisition_id = 9,
    department        = 'WBU / 業務部',
    applied_position  = '業務專員'
WHERE name = '金仁星';

-- 陳翰林：總務專員 → 行政（無對應 job_req，直接改欄位）
UPDATE candidates
SET job_requisition_id = NULL,
    department        = '行政',
    applied_position  = '總務專員'
WHERE name = '陳翰林'
  AND status NOT IN ('rejected', 'withdrawn');

-- 魏苡真：採購助理 → ICC（面試通知由 Yen/ICC 主管處理）
UPDATE candidates
SET department       = 'ICC',
    applied_position = '採購助理'
WHERE name = '魏苡真'
  AND status NOT IN ('rejected', 'withdrawn');

-- 驗證
SELECT json_agg(t ORDER BY t.dept, t.name) AS rows FROM (
  SELECT
    c.name,
    COALESCE(j.department, c.department) AS dept,
    COALESCE(j.position_title, c.applied_position) AS pos,
    c.status
  FROM candidates c
  LEFT JOIN job_requisitions j ON j.id = c.job_requisition_id
  WHERE c.name IN ('金仁星', '陳翰林', '魏苡真')
) t;
