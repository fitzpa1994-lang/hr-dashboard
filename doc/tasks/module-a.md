# Module A — PostgreSQL 資料庫

**狀態**：✅ 完成  
**檔案**：`database/hr_recruitment_pg.sql`

## 任務清單

### A1. 建立資料庫 Schema
- [x] 建立 `candidates` 資料表（含 status / source / notes 欄位）
- [x] 建立 `interviews` 資料表（含 email_msg_id UNIQUE / email_web_link 欄位）
- [x] 建立 `offers` 資料表（含 candidate_id UNIQUE）
- [x] 建立 `email_logs` 資料表（含 action / error_msg 欄位）
- [x] 建立 `job_requisitions` 資料表（保留，供未來手動維護）
- [x] 建立 `onboardings` 資料表（含 expected_date / email_web_link / resume_link）
- [x] 建立 `resignations` 資料表（含 last_day 核心欄位）

### A2. 建立 Views
- [x] 建立 `v_recruitment_funnel`（候選人漏斗）
- [x] 建立 `v_monthly_stats`（月統計）
- [x] 建立 `v_hr_workload`（HR 工作量）
- [x] 建立 `v_department_progress`（各部門招募進度）

### A3. 驗證
- [x] 執行 `hr_recruitment_pg.sql`，確認所有 table / view / index 建立無誤
- [x] 驗證 `email_msg_id` UNIQUE 去重（INSERT 同一筆第二次 → ON CONFLICT DO NOTHING）
- [x] 驗證 `onboardings.expected_date` 不為 null
- [x] 驗證 `resignations.last_day` 不為 null
