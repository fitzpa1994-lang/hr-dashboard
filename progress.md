# Sporton HR 招募戰略面板進度

更新日期：2026-05-28

## 目前架構

| 層級 | 技術 | 狀態 |
| --- | --- | --- |
| 資料來源 | Outlook 郵件 | 由 n8n workflow 讀取面試、到職、離職郵件 |
| 自動化 | n8n on Zeabur | workflow export 已整理並通過本機 JSON/schema 驗證 |
| 資料庫 | PostgreSQL on Zeabur | schema 使用 constrained status/action 值 |
| 後端 | Node.js HTTP server | 提供密碼登入、8 小時 session、登出、Dashboard API proxy |
| 前端 | 純 HTML/CSS/JS SPA | 五個 Tab、Today Bar、Drawer、搜尋、排序、圖表空狀態已實作 |
| 部署 | Zeabur | root `package.json` + `zbpack.json` 指向 `npm start`，避免被當靜態站部署 |
| 環境設定 | `.env.example` | 記錄 Zeabur 必要 env key，不包含真實密碼/token |
| 版本保存 | Git + `.gitignore` | 已初始化本機 Git；排除 `node_modules`、`.env`、logs、local DB/cache、本機工具設定與暫存檔 |

## 已完成

- Zeabur root 啟動設定：
  - `package.json`：`npm start` 執行 `node dashboard/server.js`
  - `zbpack.json`：`start_command` 為 `npm start`
  - `.env.example`：列出 `HR_DASHBOARD_PASSWORD`、`SESSION_SECRET`、`N8N_HR_WEBHOOK_URL`、`N8N_HR_TOKEN`
  - `.gitignore`：避免提交 secrets、依賴、log、local DB 檔
- 版本保存：
  - 已執行 `git init`
  - `.gitignore` 已加入 `.claude/` 與 `tmp_*`
  - `doc/prompt.md` 內舊 n8n API Key 已替換為 `<ROTATED_N8N_API_KEY>`
- 部署操作文件：
  - `doc/zeabur-deployment.md` 記錄 Zeabur 正確 root、start command、必要 env、health check、完整部署驗證與 n8n Dashboard API 驗證流程
  - `npm run package:deployment` 可產生 `dist/hr-dashboard-zeabur.zip`，用於 GitHub remote 尚未設定時的乾淨部署包
  - `npm run verify:package` 可解壓部署包並驗證 root 檔案位置、排除 secrets/local files、執行 runtime HTTP verification
- 登入與 session：
  - `/api/health`
  - `/api/login`
  - `/api/session`
  - `/api/logout`
  - `/api/hr-dashboard`
  - `/api/health` 可免登入檢查 Node server 是否啟動、必要 env 是否存在；只回傳 boolean，不洩漏密碼/token
  - cookie 使用 `HttpOnly`、`SameSite=Lax`、預設 8 小時有效
  - 已有 integration test 覆蓋 `SESSION_TTL_MS` 到期後 `/api/session` 會回 401
  - 前端遇到 401 / session 過期會回到登入遮罩，重新登入後自動重載資料
  - `/api/hr-dashboard` 代理 n8n 時有 server-side timeout，預設 10 秒；逾時回 504，避免 Zeabur 請求卡住
- 前端 UX：
  - 移除「示意版」
  - Header 顯示日期、最後更新時間、重新整理、登出、全域搜尋
  - 登入請求有 timeout 與錯誤提示
  - Today Bar 顯示今日面試、今日到職、本週離職、待回應履歷人名 chip
  - 月曆日期可聯動篩選排程
  - 排程卡片可開 Drawer、原始信件，或顯示明確 fallback
  - 人選列表支援搜尋、排序、狀態篩選、備註截斷
  - 已移除不符合 DB schema 的 `no_response` 狀態殘留
  - 到職追蹤拆成待到職 / 已到職
  - 圖表無資料時顯示空狀態
  - Drawer 對缺少 Outlook / 履歷連結有明確說明
  - Tab 切換會同步 URL hash
  - 職缺表已呈現 `urgency`
- n8n / DB 一致性：
  - workflow 不再靠 runtime `DROP CONSTRAINT` 放寬資料庫
  - `email_logs.action` 改用 schema 允許值
  - candidate / interview / onboarding / resignation 寫入狀態已對齊 PostgreSQL schema
  - Dashboard API export 包含 `jobsData`、`departmentStats`、`pendingReviewCount`、`resumeLink`、`avgDaysToOffer`
  - `live_HR_Portal.json` 已標記為 legacy / do-not-deploy，維持 inactive + archived；正式入口是 Node server + `live_Dashboard_API.json`
- 驗證：
  - `dashboard/scripts/verify-dashboard-static.mjs`
  - `dashboard/js/__tests__/server.integration.test.js`
  - `dashboard/js/__tests__/dataUtils.test.js`
  - `scripts/verify_runtime.mjs`
  - `scripts/verify_deployment.mjs`
  - `scripts/serve_visual_fixture.mjs`
  - `scripts/serve_visual_ui_fixture.mjs`
  - `scripts/validate_n8n_exports.py`
  - `scripts/verify_project.mjs`

## 最近驗證結果

```text
npm test
Dashboard static verification passed
Runtime HTTP verification passed
Visual fixture syntax check passed
Visual UI fixture syntax check passed
n8n export validation passed: 9 JSON files
Project verification passed
Test Suites: 2 passed, 2 total
Tests: 10 passed, 10 total
```

## 尚未完成 / 尚未被充分證明

- 2026-05-28 已實測 `https://sp-hr.zeabur.app/api/health`：目前回傳舊版 HTML，不是 Node `/api/health` JSON；線上入口仍未跑到 root `npm start` 的 Node dashboard server。
- 已用本機獨立 Node 子行程驗證 root runtime HTTP 流程；尚未用 Zeabur 線上環境實測：
  - `HR_DASHBOARD_PASSWORD`
  - `SESSION_SECRET`
  - `N8N_HR_WEBHOOK_URL`
  - `N8N_HR_TOKEN`
- 尚未用有效 Zeabur n8n token 執行 `scripts/validate_dashboard_api.py` 驗證 live Dashboard webhook。
- 尚未用真實 Outlook 新信件完整走完：
  - Outlook trigger
  - n8n parse
  - PostgreSQL 寫入
  - Dashboard refresh 顯示
- 尚未設定 GitHub remote，因此目前只能保存本機 Git commit，尚不能 push 到 GitHub / 讓 Zeabur 從 GitHub 重新拉取。

## Zeabur 必要環境變數

| Key | 用途 |
| --- | --- |
| `HR_DASHBOARD_PASSWORD` | Dashboard 登入密碼 |
| `HR_DASHBOARD_URL` | 部署驗證腳本使用的 Dashboard URL，例如 `https://sp-hr.zeabur.app` |
| `SESSION_SECRET` | 簽署 session cookie，請使用長隨機字串 |
| `N8N_HR_WEBHOOK_URL` | n8n `live_Dashboard_API.json` webhook URL |
| `N8N_HR_TOKEN` | n8n Dashboard API token |
| `N8N_PROXY_TIMEOUT_MS` | 可選；Node proxy 等 n8n 的 timeout，預設 10000 |

線上部署後可先檢查：

```powershell
Invoke-WebRequest -UseBasicParsing https://sp-hr.zeabur.app/api/health
```

預期 `ok: true`，且四個必要 env key 都是 `true`。此端點不會回傳實際密碼或 token。

完整線上部署檢查：

```powershell
$env:HR_DASHBOARD_URL="https://sp-hr.zeabur.app"
$env:HR_DASHBOARD_PASSWORD="<dashboard password>"
npm run verify:deployment
```

若只設定 `HR_DASHBOARD_URL`，腳本會只檢查 `/api/health`；同時設定 `HR_DASHBOARD_PASSWORD` 時，會再驗證登入、session、Dashboard proxy 與登出。

## n8n Export 注意事項

- 正式使用：
  - `live_Workflow1_面試解析.json`
  - `live_Workflow3_到職離職.json`
  - `live_Dashboard_API.json`
- `live_HR_Portal.json` 是舊版靜態 portal，內含過期 UI 邏輯，僅保留參考，禁止作為正式 Dashboard 入口。
- `scripts/validate_n8n_exports.py` 會檢查 legacy portal 必須保持 `active: false`、`isArchived: true`、名稱包含 `LEGACY_DO_NOT_DEPLOY`。

## Browser 驗證紀錄

- 使用本機 UI fixture 驗證桌面主畫面可載入 mock Dashboard API 資料。
- 已確認 Today Bar 顯示今日面試、今日到職、待回應履歷。
- Browser 驗證發現「本週離職（至週日）」原本漏掉週日資料；已修正週末計算邏輯為週日結束，並避免 `toISOString()` 時區偏移。
- 已確認桌面 Drawer 可由排程卡片開啟，且缺少 Outlook / 履歷連結時有說明文字。
- 已用 390px 手機寬度檢查主要 Header / Today Bar / 搜尋 / 操作按鈕可見，頁面沒有因主要內容造成整體橫向溢出。
- 截圖 API 在目前 Browser 外掛環境逾時，這次以 DOM snapshot 與 layout bounding box 作為視覺驗證證據。

## 下一步建議

1. 在 Zeabur 確認服務是從此專案 root 部署，並使用 root `npm start` 啟動，而不是 Caddy 靜態站或舊版 `dashboard/index.html`。
2. 依照 `doc/zeabur-deployment.md` 在 Zeabur 設定並重新部署四個必要環境變數。
3. 用有效的 `N8N_HR_TOKEN` 跑：

```powershell
$env:N8N_HR_TOKEN="..."
python scripts\validate_dashboard_api.py
```

4. 用一封測試 Outlook 面試信驗證資料流入 PostgreSQL 後，前端手動重新整理可看到新資料。
5. 提供 GitHub repo URL 後設定 remote，push 目前通過驗證的版本，讓 Zeabur 重新從正確 repo 部署。
6. 若暫時不走 GitHub，可先執行 `npm run package:deployment` 與 `npm run verify:package`，再用 Zeabur 可接受的手動匯入方式部署 zip。
