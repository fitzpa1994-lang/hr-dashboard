# scripts/maintenance/ — 一次性維運腳本歸檔

這裡存放**已執行過的一次性**維運／修補工具，保留作為審計軌跡與日後範本。
它們不屬於常規部署流程；再次執行前請先確認目標資料／workflow 的現況。

共同慣例：透過環境變數 `N8N_API_BASE_URL`（含 `/api/v1`）＋ `N8N_API_KEY` 呼叫 n8n REST API。

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
