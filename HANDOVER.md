# HR 招募系統 — 接手文件（HANDOVER）

> 最後更新：2026-07-06（六月資料缺口重播回補完成＋管線加固）
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
| `n8n/live_Error_Logger.json` | `IwBeD1aQaqpBcxFx` | Error Trigger | WF1/WF3 的 errorWorkflow：執行失敗寫入 email_logs（action='error'），失敗不再靜默 | （被動觸發） |
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

## 8. 2026-07-06 六月資料缺口重播回補記錄

- **缺口成因**：編碼災難發生於 6/3–6/4 之間（`f4d5ce7` 的 live 修補推送），此後每封到職通知信在 Workflow3
  都執行到一半拋錯（與 6/25、6/26、7/1 的 error executions 一一對應），且錯誤靜默 — 直到 7/3 修復為止，
  到職信整整漏抓一個月。email_logs 裡的 `skipped/非面試類信件` 是 Workflow1 的正常記號，非 Workflow3 記錄。
- **回補方式（重播）**：以 `scripts/maintenance/replay_*.mjs` 把 5/1 起信箱中到職相關信 89 封＋離職資料夾 33 封，
  逐節點複製線上處理鏈成臨時 workflow 依時間順序重灌 — 等同讓真實管線重新處理歷史信件，同時完成 E2E 驗證。
- **重播揭露並已修正**：①「錄取通知＋新進人員通知」雙插入造成重複列（已清理＋生產加 NOT EXISTS 防重複）；
  ② 信件年份錯字（如「2025年6月15日」）造成錯年列（已清理＋merge jsCode 加 guardOnboardYear）；
  ③ 舊離職 parser 時區偏移使 7/3 前離職日全部 +1 天（9 筆已修正）；
  ④ AI 對回信的 cancel 判讀證實**正確**（胡采穎親自婉拒、劉又福電話取消 — 內文可稽）。
- **最終狀態**：onboardings 5/1 起 48 筆乾淨資料（今日 7/6 = 5 位 pending＋胡采穎 cancelled）、
  resignations 34 筆與信箱一致、六月殭屍 pending 全數標記 onboarded、馬偉豪標記 cancelled、
  馮堿呈報到日待定（暫記 7/27＋註記）。
- **穩定性**：WF1/WF3 掛上 `HR Error Logger`（`IwBeD1aQaqpBcxFx`）— 之後任何執行失敗都會寫入
  email_logs（action='error'），可於 DB／面板查到，不再靜默。

## 9. 已知未完事項

1. **職缺 headcount 對帳**：重播回補的 onboarding 記錄**刻意未做**職缺遞減（避免與 6 月人工調整重複扣），
   需跑 `npm run audit:onboarding-matches` 對帳（需在 .env 填 `HR_DASHBOARD_URL`＋`HR_DASHBOARD_PASSWORD`）。
2. Zeabur watch 分支確認（見第 6 節）。
3. 「已報到／今日報到同仁」確認信目前無自動處理路徑（actual_date/status 靠人工或清理 SQL）—
   候選功能：Workflow3 增加 mark_onboarded 意圖分支。
4. `progress.md`（根目錄）編碼損壞 — 視需要可從 git 歷史＋雙編碼嘗試復原，或就此封存。
5. 馮堿呈實際報到日待 HR 確認後更新（目前暫記 2026-07-27）。
