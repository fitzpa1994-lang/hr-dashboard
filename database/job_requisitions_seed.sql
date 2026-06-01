-- Initial manual seed for the requisition rollout.
-- Safe to rerun: inserts only missing (department, position_title) pairs.
-- Current business rule:
--   headcount = current open vacancy count
--   status = 'cancelled' means recruitment closed
-- Naming rule:
--   preserve notebook vacancy counts
--   rename requisitions to the closest formal org path + title used by HR
--   for roles not yet in the formal sheet, keep the business title and
--   rely on onboarding keyword mapping instead of exact mail text matching

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
        ('行政專員', '行政 / 董事長室', 1, 0, 'open', 3, NULL),
        ('副理', '行政 / 財務部', 1, 0, 'open', 3, NULL),
        ('主任', '行政 / 財務部', 1, 0, 'open', 3, NULL),
        ('出納短期職代', '行政 / 財務部', 0, 0, 'cancelled', 3, NULL),
        ('軟體工程師(ERP開發維運)', '行政 / 資訊部', 1, 0, 'open', 3, NULL),
        ('軟體工程師(AI開發)', '行政 / 資訊部', 1, 0, 'open', 3, NULL),
        ('MIS工程師', '行政 / 資訊部', 1, 0, 'open', 4, 'HyperV+VMware 建置整個完整網路環境，需回應很多 USER 問題'),
        ('品管人員', '行政 / 品管部', 1, 0, 'open', 3, NULL),
        ('驗證人員', '行政 / 品管部', 1, 0, 'open', 3, NULL),

        ('業務助理(David)', '安規 / 安規業務部', 1, 0, 'open', 3, NULL),
        ('助理業務/業務', '安規 / 安規業務部', 2, 0, 'open', 4, 'Peggy 希望人員具一些電子經驗、女性、會開車'),
        ('電池案件工程師', '安規', 1, 0, 'open', 3, NULL),

        ('PM', 'WBU / PM', 2, 0, 'open', 3, '筆記中的 PM 與 五部RF PM 視為同一個職缺'),
        ('業務助理', 'WBU / 業務部', 0, 0, 'cancelled', 3, NULL),
        ('認證專員', 'WBU / 國際認證一部', 1, 0, 'open', 3, NULL),
        ('業務專員', 'WBU / 業務部', 2, 0, 'open', 3, NULL),
        ('工程助理', 'WBU / SAR工程部', 0, 0, 'cancelled', 3, NULL),
        ('文件專員', 'WBU / SAR工程部', 1, 0, 'open', 3, NULL),
        ('工程助理', 'WBU / RF工程一部', 1, 0, 'open', 3, NULL),
        ('測試工程師', 'WBU / 場測工程部', 2, 0, 'open', 3, NULL),
        ('測試工程師', 'WBU / SAR工程部', 999, 0, 'open', 4, '數名'),

        ('測試工程師(RF/EMC)', '新竹 / 工程部', 4, 0, 'open', 3, NULL),

        ('客服業務', '新華 / 業務三部', 2, 0, 'open', 3, NULL),
        ('測試工程師', '新華 / RF工程組', 999, 0, 'open', 4, '數名'),
        ('PM', '新華 / PM', 0, 0, 'cancelled', 3, '郵件中的新華案件專員視為 PM'),

        ('測試工程師', 'ICC / 工程部', 999, 0, 'open', 4, '數名'),
        ('案件專員', 'ICC / 技術支援部', 2, 0, 'open', 3, '筆記中的 ICC PM 以正式錄取通知名稱案件專員管理'),
        ('客服業務', 'ICC / 業務部', 3, 0, 'open', 3, NULL)
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
