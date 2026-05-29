-- Initial manual seed for the six-department vacancy list.
-- Safe to rerun: inserts only missing (department, position_title) pairs.
-- Current business rule:
--   headcount = current open vacancy count
--   status = 'cancelled' means recruitment closed

WITH seed (
    position_title,
    department,
    headcount,
    filled_count,
    status,
    urgency,
    notes
) AS (
    VALUES
        ('董事長室助理', '汐止/行政', 1, 0, 'open', 3, NULL),
        ('財務部副理/主任', '汐止/行政', 2, 0, 'open', 3, NULL),
        ('軟體工程師', '汐止/行政', 2, 0, 'open', 3, NULL),
        ('MIS工程師', '汐止/行政', 1, 0, 'open', 4, 'HyperV+VMware 建置整個完整網路環境，需回應很多 USER 問題'),
        ('品管工程師', '汐止/行政', 1, 0, 'open', 3, NULL),

        ('PM', '五部', 2, 0, 'open', 3, NULL),
        ('五部業務助理', '五部', 0, 0, 'cancelled', 3, NULL),
        ('五部認證專員', '五部', 1, 0, 'open', 3, NULL),
        ('業務專員', '五部', 2, 0, 'open', 3, NULL),
        ('客服業務', '五部', 1, 0, 'open', 3, NULL),
        ('SAR工程助理', '五部', 0, 0, 'cancelled', 3, NULL),
        ('SAR文件專員', '五部', 1, 0, 'open', 3, NULL),
        ('五部RF PM', '五部', 2, 0, 'open', 3, NULL),
        ('WE1工程助理(理工相關)', '五部', 1, 0, 'open', 3, NULL),
        ('WE1：場測工程師', '五部', 2, 0, 'open', 3, NULL),
        ('RF SAR 測試工程師', '五部', 999, 0, 'open', 4, '數名'),

        ('新竹測試工程師', '新竹', 4, 0, 'open', 3, NULL),

        ('RF SAR 測試工程師', '新華', 999, 0, 'open', 4, '數名'),
        ('PM', '新華', 0, 0, 'cancelled', 3, NULL),

        ('ICC 測試工程師', '全球', 999, 0, 'open', 4, '數名'),
        ('ICC PM', '全球', 2, 0, 'open', 3, NULL),
        ('ICC 客服業務', '全球', 3, 0, 'open', 3, NULL),

        ('業務助理', '安規', 1, 0, 'open', 3, NULL),
        ('助理業務', '安規', 2, 0, 'open', 4, 'Peggy 希望人員具一些電子經驗、女性、會開車'),
        ('電池案件工程師', '安規', 1, 0, 'open', 3, NULL)
)
INSERT INTO job_requisitions (
    position_title,
    department,
    headcount,
    filled_count,
    status,
    urgency,
    notes
)
SELECT
    s.position_title,
    s.department,
    s.headcount,
    s.filled_count,
    s.status,
    s.urgency,
    s.notes
FROM seed s
WHERE NOT EXISTS (
    SELECT 1
    FROM job_requisitions j
    WHERE j.department = s.department
      AND j.position_title = s.position_title
);
