# HR 招募系統 — 接手文件（HANDOVER）

> 最後更新：2026-07-03（Claude 接手盤點＋線上修復完成）
> 本文件為權威接手/維運文件。根目錄 `progress.md` 為歷史文件且**編碼已損壞**（混合 Big5/UTF-8），僅供考古，勿再更新它。

## 1. 系統總覽

```
Outlook 信件（面試信／新進人員通知／離職通知）
   ↓ 每分鐘輪詢（Microsoft Outlook trigger）
n8n workflows（https://evanhh.zeabur.app，Claude Haiku 解析信件意圖）
   ↓
PostgreSQL（Zeabur，7 張表，email_msg_id UNIQUE 去重）
   ↓ webhook（Bearer N8N_HR_TOKEN）
Node.js dashboard server（dashboard/server.js，session＋proxy）
   ↓
瀏覽器 SPA（dashboard/index.html：Tailwind＋Chart.js，https://sp-hr.zeabur.app）
```

## 2. Workflow 對照表（線上 ID 也硬編碼於 scripts/deploy_n8n_export.mjs）

| 本地快照 | 線上 ID | 觸發 | 用途 | active |
| --- | --- | --- | --- | --- |
| `n8n/live_Workflow1_面試解析.json` | `pqnpr72wTiOE2m8I` | Outlook 輪詢 | 面試信 → Claude 解析 → candidates/interviews/email_logs | ✅ |
| `n8n/live_Workflow3_到職離職.json` | `zEIwksk6hz9Ri8NA` | Outlook 輪詢 ×3（收件匣＋寄件備份＋離職資料夾） | 到職/離職信 → onboardings/resignations＋職缺 headcount 遞減 | ✅ |
| `n8n/live_Dashboard_API.json` | `x4Olor5YtMfthzWp` | Webhook `/hr-dashboard` | 儀表板全量資料查詢（含面試年份正規化 CTE） | ✅ |
| `n8n/live_Job_Requisition_Write.json` | `3aaTC9KMPXTZ1tP6` | Webhook `/hr-dashboard-write` | 職缺建立/更新 | ✅ |
| `n8n/live_temp_db_check.json` | `uyDXjECy9kPFaFUy` | Webhook | 候選人↔職缺 relink 維運工具（支援 dry_run） | ✅ |
| `n8n/live_HR_Portal.json` | — | — | Legacy，勿部署 | ❌ |

## 3. 資料庫（PostgreSQL，schema 見 database/hr_recruitment_pg.sql）

`candidates`（↔job_requisitions）、`interviews`、`offers`、`email_logs`（每封信的處理稽核）、
`job_requisitions`（headcount 於到職時遞減）、`onboardings`、`resignations`。
所有信件入庫表皆以 `email_msg_id UNIQUE` 去重 — 觸發器重抓舊信不會造成重複資料。

## 4. 憑證與連線

- 專案根目錄 `.env`（**gitignored，勿提交**）：
  - `N8N_API_BASE_URL=https://evanhh.zeabur.app/api/v1`（含 /api/v1，scripts 直接拼 `/workflows/{id}`）
  - `N8N_API_KEY=`（n8n 頁面 Settings → n8n API 產生；輪替後更新此檔即可）
  - 選填：`HR_DASHBOARD_URL` / `HR_DASHBOARD_PASSWORD`（跑 verify:deployment / audit:onboarding-matches 用）
- **n8n MCP**：`.mcp.json` 註冊 `n8n` server → `scripts/n8n_mcp_launcher.mjs` 讀 `.env` 啟動 `n8n-mcp`（devDependency）。
  Claude Code 重啟 session 後即可直接查詢/更新 n8n。
- Dashboard（Zeabur 服務 sp-hr）環境變數見 `.env.example` 與 `doc/zeabur-deployment.md`。

## 5. 日常維運 Runbook

```bash
npm run audit:n8n        # 比對本地快照 vs 線上（節點 id 配對、亂碼偵測）→ 應全部 IN_SYNC
npm run pull:n8n         # 線上 → 本地：回抓 export 覆蓋快照（在 n8n UI 改過之後執行，再 commit）
npm run deploy:n8n:workflow3   # 本地 → 線上：部署 Workflow3（其他檔案用 node scripts/deploy_n8n_export.mjs <path>）
npm test                 # 靜態驗證＋Jest＋n8n export schema 驗證（含正規化標記檢查）
npm run verify:deployment      # Zeabur dashboard 健康檢查
```

**鐵則**：
1. 在 n8n UI 改完 → 立刻 `pull:n8n` ＋ commit；用腳本改線上 → 一樣要 pull＋commit。快照與線上不同步是所有災難的起點。
2. **絕不**讓 workflow JSON 經過 PowerShell 管線或預設編碼的檔案讀寫（`>`、`Out-File` 未指定 utf8、cp950 console）— 2026-07 的亂碼災難即源於此。一律用 node 腳本（`fs.readFileSync(..., 'utf8')`）處理。
3. 部門/職位正規化的唯一真相來源是 `dashboard/js/onboardingCanonicalization.js`（有 Jest 測試）。
   Workflow3「Code：整合 Onboarding 輸出」的 jsCode 正規化段落是由它程式化轉換而來 — 改對照表時兩邊要一起更新（可參考 2026-07-03 的作法：轉換腳本自動去 export、改函式名）。

## 6. 部署

- Dashboard：push GitHub → Zeabur 自動部署 `hr-dashboard` 服務（https://sp-hr.zeabur.app）。
- ⚠ **待確認**：本地開發分支為 `node-dashboard-deploy`（與遠端同步）；`origin/main` 落後 50+ commits。
  `doc/zeabur-deployment.md` 寫 Zeabur watch `main` — 請至 Zeabur 後台確認實際 watch 的分支：
  - 若 watch `node-dashboard-deploy` → 更新文件，`main` 標記棄用（或定期同步）。
  - 若 watch `main` → 線上 dashboard 已嚴重過時，需要合併。

## 7. 2026-07-03 接手盤點與修復記錄

- 建立 n8n API/MCP 連線能力（`.env`＋`.mcp.json`＋`audit:n8n`/`pull:n8n` 工具）。
- 盤點發現線上 Workflow3 遭 Big5 轉碼損壞（某次 API 修補時的編碼事故）：全部中文節點名稱亂碼、
  到職 INSERT 的 `'未分類'/'未知職位'` 變亂碼、merge 節點的節點引用損壞（到職信一進來就會失敗）、
  兩個 email_logs 節點名稱位元組撞名導致接線模糊。
- 修復（有 dry-run＋零亂碼驗證＋修復前備份）：還原全部名稱、SQL、接線；保留線上較新的
  「錄取通知事宜」OR 過濾與離職直連接線。
- 進一步發現部門/職位正規化 jsCode 從第一次部署起就是壞的（關鍵字全是 `??`，從未正確運作）→
  由 dashboard 模組程式化重建，現在到職入庫時即寫入正規化部門/職位（含 raw_department/raw_position 保留原值），
  職缺 headcount 遞減的配對因此真正生效。
- 12 支已執行的一次性維運腳本歸檔至 `scripts/maintenance/`（含索引 README）。
- 五個 workflow 快照與線上全部 IN_SYNC；`npm test` 全綠。
- 相關 commits：`22962f2`（工具鏈＋歸檔）、`d6255e5`（線上修復＋快照同步）。

## 8. 已知未完事項

1. **E2E 驗證到職路徑**（修復後尚未有真實到職信通過全程）：寄一封主旨含「新進人員通知」的測試信到觸發信箱，
   確認 execution success、onboardings 有正規化部門/職位、對應職缺 headcount 遞減，然後清除測試資料。
2. Zeabur watch 分支確認（見第 6 節）。
3. 既有待辦（源自舊 progress 記錄）：到職→缺額遞減的 live E2E 實證 — 與第 1 項為同一件事。
4. `progress.md`（根目錄）編碼損壞 — 視需要可從 git 歷史＋雙編碼嘗試復原，或就此封存。
5. 離職重複資料清理 SQL（`scripts/maintenance/sql/cleanup_resignation_duplicates_*.sql`）：
   保守版只處理了特定人員；若重複情況再現，考慮把去重邏輯做進 Workflow3 的 INSERT。
