-- ============================================================
-- HR DB 全面資料修正 2026-07-09
-- ============================================================

-- 1. 今日部門辨識錯誤：劉文仁、吳璨宏 → 新竹 (job_req 4)
UPDATE candidates
SET job_requisition_id = 4, department = '新竹 / 工程部'
WHERE name IN ('劉文仁', '吳璨宏')
  AND status NOT IN ('rejected', 'withdrawn');

-- 2. 今日部門辨識錯誤：曾瑜庭 → 新華 文件專員 (無對應 job_req，直接改欄位)
UPDATE candidates
SET job_requisition_id = NULL,
    department        = '新華',
    applied_position  = '文件專員'
WHERE name = '曾瑜庭'
  AND status NOT IN ('rejected', 'withdrawn');

-- 3. 五部 → 新華 業務本部 (黃佩綺、黃珮綺)
UPDATE candidates
SET department = '新華 / 業務本部'
WHERE name IN ('黃佩綺', '黃珮綺')
  AND department = '五部';

-- 4. 汐止總公司 → 行政 / 資訊部 (楊建昌 MIS)
UPDATE candidates
SET job_requisition_id = 17, department = '行政 / 資訊部'
WHERE name = '楊建昌'
  AND department = '汐止總公司';

-- 5. 張家豪重複 → 保留 Outlook即時，移除其他來源
UPDATE candidates
SET status = 'rejected'
WHERE name = '張家豪'
  AND source NOT IN ('Outlook即時')
  AND status NOT IN ('rejected', 'withdrawn');

-- 6. 清除測試假資料
UPDATE candidates
SET status = 'withdrawn'
WHERE name IN (
  '測試張小明', '測試李小明', '測試王小明', '測試陳小明', '測試黃小明',
  '黃小狗', '劉彥廷30', '未知姓名', '蔡先生'
)
AND status NOT IN ('rejected', 'withdrawn');

-- 7. 驗證：查看所有修正後的狀況 + 仍待確認的未分類
SELECT json_agg(t ORDER BY t.status, t.dept, t.name) AS rows FROM (
  SELECT
    c.name,
    COALESCE(j.department, c.department) AS dept,
    COALESCE(j.position_title, c.applied_position) AS pos,
    c.status,
    c.source,
    TO_CHAR(c.updated_at AT TIME ZONE 'Asia/Taipei', 'MM/DD HH24:MI') AS updated_tw
  FROM candidates c
  LEFT JOIN job_requisitions j ON j.id = c.job_requisition_id
  WHERE c.name IN (
    -- 今日修正
    '劉文仁', '吳璨宏', '曾瑜庭', '黃佩綺', '黃珮綺', '楊建昌', '張家豪',
    -- 測試資料
    '測試張小明', '測試李小明', '測試王小明', '測試陳小明', '測試黃小明',
    '黃小狗', '劉彥廷30', '未知姓名', '蔡先生',
    -- 仍未分類的
    '李品萱', '金一權', '金仁星', '陳家弘', '陳翰林', '陳苡晴', '馮堿呈', '魏苡真',
    '黃彥翔', '林坤億'
  )
) t;
