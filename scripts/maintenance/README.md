# scripts/maintenance/ — 一次性維運腳本歸檔

這裡存放**已執行過的一次性**維運／修補工具，保留作為審計軌跡與日後範本。
它們不屬於常規部署流程；再次執行前請先確認目標資料／workflow 的現況。

共同慣例：透過環境變數 `N8N_API_BASE_URL`（含 `/api/v1`）＋ `N8N_API_KEY` 呼叫 n8n REST API
（2026-07-06 起新腳本亦自動讀取專案根目錄 `.env`）。

## 2026-07-06 六月缺口重播回補系列（可重複使用的復原工具）

| 腳本 | 用途 |
| --- | --- |
| `replay_onboarding_emails.mjs` | **重播器**：抓信箱中到職相關信件（新進人員通知/錄取通知事宜），逐節點複製線上 Workflow3 到職鏈成臨時 workflow，依時間順序重新處理。email_msg_id 去重、不做職缺遞減。dry-run 預設，`--apply` 執行 |
| `replay_resignation_emails.mjs` | 同上，離職資料夾 → 離職鏈（純 regex，無 AI） |
| `read_outlook_bodies.mjs` | 調閱指定主旨關鍵字的信件內文（驗證 AI 判讀用），如 `node ... "胡采穎"` |
| `create_error_logger.mjs` | 建立 HR Error Logger workflow（Error Trigger → email_logs action='error'）並掛為 WF1/WF3 的 errorWorkflow（已執行，logger id `IwBeD1aQaqpBcxFx`） |
| `harden_workflow3_20260706.mjs` | 對本地 Workflow3 快照注入年份防呆＋防重複插入（已套用並部署） |
| `sql/cleanup_onboarding_replay_dedupe_20260706.sql` | 重播後清理：刪 2025 錯字列、每人去重、馮堿呈待定日、過期 pending 標 onboarded |
| `sql/fix_resignation_offbyone_dates_20260706.sql` | 修正舊 parser 時區偏移造成的離職日 +1 天（9 筆）＋曾佳佩重複列 |

## 2026-06 ~ 2026-07 到職/離職資料修復系列

| 腳本 | 用途 |
| --- | --- |
| `backfill_onboarding_via_temp_workflow.mjs` | 以臨時 webhook workflow 手動補建 onboarding 記錄（漏信補登） |
| `backfill_resignation_via_temp_workflow.mjs` | 同上，補建 resignation 記錄 |
| `fix_live_interview_record.mjs` | 修正一筆特定面試記錄（email_msg_id 鎖定）的日期為 2026-07-06 11:00 |
| `inspect_candidate_history.mjs` | 稽查 4 位特定候選人的 candidates / interviews / email_logs 資料沿革 |
| `inspect_live_workflow3_nodes.mjs` | 拉取線上 workflow 節點摘要（修補前診斷用；常規比對請改用 `npm run audit:n8n`） |
| `patch_dashboard_api_interview_years.mjs` | 對本地 Dashboard API JSON 注入 `normalized_interviews` CTE（面試年份正規化） |
| `patch_workflow1_interview_year_guard.mjs` | 對本地 Workflow1 JSON 注入 `normalizeInterviewDateYear()`（防舊信年份污染） |
| `patch_live_workflow3_ingestion_paths.mjs` | 經 API 修補線上 Workflow3：到職過濾條件、離職 parser、觸發接線 |
| `patch_live_workflow3_via_api.mjs` | 同上的強化版（節點以 ID/位置解析，確保離職 parseDate fallback） |
| `patch_workflow3_resignation_fallback.mjs` | 對本地 Workflow3 JSON 重接離職觸發 → IF → 離職 parser 的 fallback 路徑 |
| `sync_workflow3_resignation_parser_local.mjs` | 把強化版離職 parser jsCode 同步回本地 Workflow3 JSON 快照 |
| `run_temp_sql_via_workflow.mjs` | 通用工具：讀取 SQL 檔，經臨時 n8n webhook workflow 執行（ad-hoc 資料維護） |

## sql/

| 檔案 | 用途 |
| --- | --- |
| `check_recent_onboarding_resignation.sql` | 查核 2026-06-01 起的 onboardings / resignations 入庫狀況 |
| `cleanup_resignation_duplicates_20260703.sql` | 將重複離職記錄（同名/部門/職位/最後日）標記 cancelled，保留最新一筆 |
| `cleanup_resignation_duplicates_safe_20260703.sql` | 同上的保守版，僅針對特定人員，避免誤刪 |
