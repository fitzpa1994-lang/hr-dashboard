# Module D — Workflow 2：歷史批次匯入

**狀態**：📋 一次性，啟用後停用  
**檔案**：`n8n/live_Workflow2_歷史匯入.json` / `n8n/live_Workflow2_歷史匯入_近30天.json`

> ⚠️ 此模組為一次性操作。執行完成後，立即在 n8n 停用 Workflow，不再執行。

## 任務清單

### D1. 排查現有 bug
- [ ] 確認 `ALTER TABLE DROP CONSTRAINT` 報錯的 constraint 名稱
  - 執行 `\d tablename` 確認 constraint 是否存在
- [ ] 若 constraint 名稱不符，改用以下方案：
  - 建立暫時表 → INSERT SELECT → DROP 原表 → RENAME 暫時表
- [ ] 修復後確認 Workflow 可正常執行

### D2. 決定匯入範圍
- [ ] 確認是否先執行「近 30 天」版本測試
- [ ] 測試無誤後，決定是否執行「全量」版本
- [ ] 全量匯入預計信件數：
  - 104人力銀行：2967 封
  - 1111人力銀行：640 封
  - 預計報到人員：75 封
  - 已寄離職人員通知：56 封

### D3. 執行歷史匯入
- [ ] 在 n8n 啟用 Workflow 2（近 30 天版或全量版）
- [ ] 執行一次，觀察執行 log 是否有大量 error
- [ ] 執行完成後，立即在 n8n 停用 Workflow 2

### D4. 驗證匯入結果
- [ ] 確認 `candidates` 筆數合理：
  ```sql
  SELECT COUNT(*) FROM candidates;
  ```
- [ ] 確認 `interviews` 無缺少日期的紀錄：
  ```sql
  SELECT COUNT(*) FROM interviews WHERE interview_date IS NULL;
  ```
- [ ] 確認 `onboardings` 無缺少 expected_date 的紀錄：
  ```sql
  SELECT COUNT(*) FROM onboardings WHERE expected_date IS NULL;
  ```
- [ ] 確認 `resignations` 無缺少 last_day 的紀錄：
  ```sql
  SELECT COUNT(*) FROM resignations WHERE last_day IS NULL;
  ```
- [ ] 確認 `email_logs` 無大量 error：
  ```sql
  SELECT action, COUNT(*) FROM email_logs GROUP BY action;
  ```
