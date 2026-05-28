# HR 招募系統 — 總體進度

最後更新：2026-05-26

## 模塊完成狀態

- [x] **Module A** — PostgreSQL 資料庫（[module-a.md](module-a.md)）
- [x] **Module B** — Workflow 1：面試信件解析（[module-b.md](module-b.md)）✅ 程式碼修復完成，待 n8n 部署驗證
- [x] **Module C** — Workflow 3：錄取 / 離職自動匯入（[module-c.md](module-c.md)）✅ 重構完成，待 n8n 部署驗證
- [x] **Module D** — Workflow 2：歷史批次匯入（[module-d.md](module-d.md)）✅ IF EXISTS 已存在；D3/D4 待 n8n 執行
- [x] **Module E** — Dashboard API（[module-e.md](module-e.md)）✅ 驗證腳本建立（scripts/validate_dashboard_api.py）
- [x] **Module F** — Dashboard 前端（[module-f.md](module-f.md)）✅ API URL 修正 + 今日/未來報到區塊 + Jest 環境

## 建議開發順序

```
A（已完成）→ B（修 bug）→ C（重構）→ D（一次性執行）→ E（驗證 API）→ F（前端視覺）
```

## 待辦事項（需 n8n 啟動後執行）

1. 啟動 n8n (`http://localhost:5678`)
2. 部署 Workflow B: `curl -X PUT ... -d @n8n/live_Workflow1_面試解析.json http://localhost:5678/api/v1/workflows/pqnpr72wTiOE2m8I`
3. 部署 Workflow C: `curl -X PUT ... -d @n8n/live_Workflow3_到職離職.json http://localhost:5678/api/v1/workflows/zEIwksk6hz9Ri8NA`
4. 執行 Workflow D (近30天版)：啟用 → 等待完成 → 停用
5. 驗證 Dashboard API: `python scripts/validate_dashboard_api.py`
6. 安裝 Jest 並執行測試: `cd dashboard && npm install && npm test`

## 整合測試流程（E2E）

完成所有模塊後，依序執行：

1. 清空測試資料（或用測試 DB）
2. 手動 trigger WF3 一封 `【耕興股份有限公司】錄取通知事宜-測試人員`，日期設為今天
3. 呼叫 Dashboard API，確認 `schedEvents` 中今天有 `type=onboard` 的事件
4. 開啟 Dashboard 前端，確認 Today Bar 的「今日到職」顯示「測試人員」
5. 手動 trigger 一封「調整報到日期」信件（相同姓名），日期改為明天
6. 再次呼叫 API，確認 `onboardData` 中該人的 date 已更新為明天
7. 確認前端「今日到職」消失，「未來預計報到」出現該人
