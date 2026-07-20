# Zeabur 部署與驗證手冊

更新日期：2026-05-28

## 目前線上狀態

`https://sp-hr.zeabur.app/api/health` 目前回傳的是舊版 HTML，不是 Node server 的 JSON health response。

這代表線上服務還沒有跑到本 repo root 的 `npm start`，常見原因是：

- Zeabur 仍部署舊版靜態 HTML。
- Zeabur service 指到錯誤的 Git repo、branch 或 subdirectory。
- Zeabur build/start 設定沒有使用 root `package.json` 與 `zbpack.json`。
- 尚未重新部署最新 commit。

密碼重設後仍登入不了時，先看 `/api/health`。如果它不是 JSON，問題不是密碼，而是部署入口錯了。

## 正確部署來源

Zeabur service 必須從此專案 root 部署：

```text
C:\Users\evanhuang\PycharmProjects\hr-recruitment-system
```

root 必須包含：

```text
package.json
zbpack.json
dashboard/server.js
dashboard/index.html
```

root `package.json` 的啟動指令是：

```json
{
  "scripts": {
    "start": "node dashboard/server.js"
  }
}
```

root `zbpack.json` 必須是：

```json
{
  "build_command": "",
  "start_command": "npm start"
}
```

## Zeabur 必要環境變數

可先用下列指令產生 Zeabur env 設定清單，會自動生成新的 `SESSION_SECRET`：

```powershell
npm run prepare:zeabur-env
```

在 Zeabur dashboard 的服務環境變數設定：

```text
NODE_ENV=production
PORT=8080
HR_DASHBOARD_PASSWORD=<dashboard-login-password>
SESSION_SECRET=<long-random-secret-at-least-32-chars>
N8N_HR_WEBHOOK_URL=<n8n-live-dashboard-api-webhook-url>
N8N_HR_TOKEN=<rotated-n8n-dashboard-token>
N8N_PROXY_TIMEOUT_MS=10000
```

`HR_DASHBOARD_URL` 只給本機驗證腳本使用，不是 Zeabur server 必要變數。

## GitHub / Zeabur 重新部署流程

本機已初始化 Git，並已有 baseline commit：

```powershell
git log --oneline -1
```

第一次推到 GitHub 時：

```powershell
git remote add origin <your-github-repo-url>
git branch -M main
git push -u origin main
```

Zeabur 端確認：

1. Service 連到同一個 GitHub repo。
2. Branch 是 `main`。
3. Root directory 留空或指向 repo root，不要指到 `dashboard/`。
4. Start command 使用 `npm start`。
5. 重新部署最新 commit。

## 無 GitHub remote 時的部署包

若暫時無法設定 GitHub remote，可以先產生乾淨的部署 zip：

```powershell
npm run package:deployment
npm run verify:package
```

輸出位置：

```text
dist/hr-dashboard-zeabur.zip
```

這個 zip 使用 `git archive HEAD` 產生，只包含目前 commit 內的檔案，不會包含：

- `.env`
- `node_modules/`
- log 檔
- `.claude/`
- `tmp_*`
- `dist/`

產生 zip 前工作樹必須是乾淨狀態。若有未提交變更，腳本會停止，避免把尚未驗證的版本拿去部署。

`npm run verify:package` 會把 zip 解到暫存資料夾，確認：

- root `package.json`、`zbpack.json`、`dashboard/server.js` 都在正確位置。
- `.env`、`node_modules`、log/tmp、本機工具設定沒有進包。
- zip 內沒有 JWT 型態的 token。
- 解壓後可通過 server 與 verifier 語法檢查。

完整 runtime HTTP 行為由本機 root `npm test` 覆蓋；部署 zip 驗證聚焦在「包的內容是否可部署且未混入本機/secrets 檔」。

## 部署後驗證

先跑診斷，它會判斷目前是舊靜態站、env 缺漏、登入失敗，或 n8n proxy 失敗：

```powershell
$env:HR_DASHBOARD_URL="https://sp-hr.zeabur.app"
npm run diagnose:deployment
```

若要同時檢查登入和 Dashboard proxy：

```powershell
$env:HR_DASHBOARD_URL="https://sp-hr.zeabur.app"
$env:HR_DASHBOARD_PASSWORD="<dashboard-login-password>"
npm run diagnose:deployment
```

先驗證 health endpoint：

```powershell
Invoke-WebRequest -UseBasicParsing https://sp-hr.zeabur.app/api/health | Select-Object -ExpandProperty Content
```

正確結果應是 JSON，且長得像：

```json
{
  "ok": true,
  "service": "hr-dashboard",
  "env": {
    "HR_DASHBOARD_PASSWORD": true,
    "SESSION_SECRET": true,
    "N8N_HR_WEBHOOK_URL": true,
    "N8N_HR_TOKEN": true
  }
}
```

如果還看到 `<!DOCTYPE html>`，代表 Zeabur 還是在跑舊靜態頁，需回頭檢查 service 來源與 root directory。

完整驗證：

```powershell
$env:HR_DASHBOARD_URL="https://sp-hr.zeabur.app"
$env:HR_DASHBOARD_PASSWORD="<dashboard-login-password>"
npm run verify:deployment
```

通過時應顯示：

```text
Health check passed
Authenticated deployment flow passed
Deployment verification passed
```

## n8n Dashboard API 驗證

Zeabur Node server 正常後，再驗證 n8n webhook 資料契約：

```powershell
$env:N8N_HR_TOKEN="<rotated-n8n-dashboard-token>"
python scripts\validate_dashboard_api.py
```

這一步要確認 live `live_Dashboard_API.json` 回傳：

- `today`
- `schedEvents`
- `onboardData`
- `resignData`
- `candidatesData`
- `jobsData`
- `monthlyTrend`
- `departmentStats`
- `stats.pendingReviewCount`

## 完成標準

只有同時符合以下條件，才能視為線上部署完成：

- `/api/health` 回 JSON 且 `ok: true`。
- `npm run verify:deployment` 通過登入、session、proxy、logout。
- `scripts/validate_dashboard_api.py` 通過 live n8n Dashboard API 契約驗證。
- 用一封測試 Outlook 信件觸發 n8n，PostgreSQL 寫入成功，Dashboard 重新整理後看得到資料。

## Job Requisition Rollout Order

The 104 integration adds tables that both dashboard workflows query. Keep this order; do not publish the Dashboard API before the migration.

1. Run `database/job_requisitions_duplicate_audit.sql` against the live database.
2. If duplicate `(department, position_title)` rows exist, clean them before rollout.
3. Run `database/job_requisitions_seed.sql` to insert only missing requisitions.
4. Run `database/job_requisition_sources_pg.sql` to create the external-posting and provider-sync metadata tables.
5. Publish `n8n/live_Job_Requisition_Write.json`, then verify its active version contains the contract-v2 sync/link SQL.
6. Publish `n8n/live_Dashboard_API.json`, then verify its active version returns `external104Jobs` and `external104Sync`.
7. Publish `n8n/live_Workflow3_到職離職.json` only when that workflow also has changes in the release.
8. Deploy the Node dashboard service with matching environment values.
9. Reload Chrome extension `chrome-extension/104-job-sync` v1.3.2.
10. Verify live behavior:
    - dashboard login and normal dashboard data load
    - one authenticated complete 104 sync
    - one manual 104-to-internal link and unlink
    - successful zero-published snapshot remains authoritative
    - jobs create/update writes to PostgreSQL
    - onboarding email still decrements the exact matching internal requisition

## Job Requisition Database Rollout SQL
Run these SQL files in this order during the live rollout:
1. database/job_requisitions_duplicate_audit.sql
2. database/job_requisitions_seed.sql
3. database/job_requisition_sources_pg.sql
4. database/job_requisitions_post_seed_check.sql
5. database/job_requisitions_add_unique_constraint.sql (only if duplicate audit returns no rows)
