# Module C — Workflow 3：錄取 / 離職自動匯入

**狀態**：🔧 需重構  
**檔案**：`n8n/live_Workflow3_到職離職.json`

## 任務清單

### C1. 確認 Outlook Trigger folder ID
- [ ] 在 n8n 中開啟 Workflow 3
- [ ] 確認「錄取段」Trigger 對應到「預計報到人員」資料夾的正確 folder ID
- [ ] 確認「離職段」Trigger 對應到「已寄離職人員通知」資料夾的正確 folder ID
- [ ] 儲存並啟用 Workflow 3

### C2. 錄取段 — Code：萃取基本欄位
- [ ] 實作 `source_type = 'onboarding'` 標記節點
- [ ] 實作 `name_from_subject` 萃取：
  ```javascript
  const parts = subject.split('-');
  const name = parts[parts.length - 1].trim();
  // 長度 2~5 且非關鍵字才採用
  ```
- [ ] 確認輸出包含：`email_msg_id` / `email_subject` / `email_web_link` / `sender` / `received_at` / `name_from_subject` / `body_text`（前 2000 字）

### C3. 錄取段 — Claude AI：解析意圖（Onboarding）
- [ ] 確認模型設定：`claude-haiku-4-5-20251001`，max_tokens: 400
- [ ] 確認系統提示包含四種 intent 規則：
  - `new_onboard` / `update_date` / `cancel` / `skip`
- [ ] 確認 `RE:` 開頭信件 → `intent = skip`
- [ ] 確認 body 有「調整/延後/更改報到」→ `intent = update_date`
- [ ] 測試輸出格式符合規格（純 JSON，無多餘文字）

### C4. 錄取段 — IF intent 分流
- [ ] 建立 IF 節點，依 `intent` 分成四條路徑：
  - `new_onboard` → PG INSERT onboardings
  - `update_date` → PG UPDATE onboardings
  - `cancel` → PG UPDATE status='cancelled'
  - `skip` → PG email_logs action='skipped'

### C5. 錄取段 — PG：INSERT onboardings（new_onboard）
- [ ] 實作 INSERT SQL，COALESCE department/position 預設值
- [ ] 確認 `ON CONFLICT (email_msg_id) DO NOTHING`
- [ ] 確認寫入後記錄 email_logs action='inserted'

### C6. 錄取段 — PG：UPDATE onboardings（update_date）
- [ ] 實作依 name + status='pending' 查找最新紀錄並更新 expected_date
- [ ] 實作 fallback：找不到 pending 紀錄時改 INSERT（notes 標記 `[date-update fallback]`）
- [ ] 確認寫入後記錄 email_logs action='updated'

### C7. 錄取段 — PG：UPDATE onboardings（cancel）
- [ ] 實作依 name + status='pending' 更新 status='cancelled'
- [ ] 確認寫入後記錄 email_logs action='updated'

### C8. 離職段 — Code：萃取離職欄位
- [ ] 實作 `source_type = 'resignation'` 標記節點
- [ ] 實作 Regex 萃取四個欄位（使用彈性空白 pattern）：
  - `單\s*位\s*[：:]` → `department`
  - `姓\s*名\s*[：:]` → `name`
  - `職\s*稱\s*[：:]` → `position`
  - `離\s*職\s*生\s*效\s*日\s*[：:]` → `last_day`
- [ ] 實作日期清洗：`2026/06/01（日）` → `2026-06-01`
- [ ] 注意：`name` 和 `last_day` 皆從 **body** 萃取，不從主旨取

### C9. 離職段 — PG：INSERT resignations
- [ ] 實作 INSERT SQL，`ON CONFLICT (email_msg_id) DO NOTHING`
- [ ] 確認 `hr_owner` 從 sender email 推算
- [ ] 確認 status 預設 `'active'`
- [ ] 確認寫入後記錄 email_logs action='inserted'

### C10. 測試
- [ ] 手動 trigger 一封錄取通知，驗證：
  ```sql
  SELECT name, expected_date, status, email_subject
  FROM onboardings ORDER BY expected_date;
  ```
- [ ] 手動 trigger 一封「更新報到日期」信件，確認 expected_date 已更新
- [ ] 手動 trigger 一封離職通知，驗證：
  ```sql
  SELECT name, last_day, department FROM resignations
  WHERE status = 'active' ORDER BY last_day;
  ```
- [ ] 確認沒有重複 name 的 onboarding 紀錄（同人多封 update 不增筆）：
  ```sql
  SELECT name, COUNT(*) FROM onboardings GROUP BY name HAVING COUNT(*) > 1;
  ```
