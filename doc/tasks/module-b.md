# Module B — Workflow 1：面試信件解析

**狀態**：🔧 有 bug，需修復  
**檔案**：`n8n/live_Workflow1_面試解析.json`

## 任務清單

### B1. 修復 Claude API 呼叫節點
- [ ] 找到 `HTTP Request` 節點中的 `jsonBody` 設定
- [ ] 改為 `specifyBody: "json"` 並使用正確的 n8n expression 語法
  - 或改用 `Code` 節點組裝完整 request body，再傳給 HTTP Request
- [ ] 測試：手動 trigger 一封面試信，確認 `aiResult` 不為空

### B2. 修復 Code：萃取基本資訊
- [ ] 確認 `candidate_name` 萃取邏輯（主旨優先 → fallback 主旨最後 `-` 後 2~5 字）
- [ ] 確認 `interview_date` Regex 覆蓋三種格式：`YYYY年MM月DD日` / `YYYY/MM/DD` / `MM月DD日`
- [ ] 確認 `interview_time` Regex 覆蓋全形冒號：`HH：MM`
- [ ] 確認 `body_text` 清洗：HTML tag / `&nbsp;` / 多空白，截前 2000 字

### B3. 修復 Code：整合輸出
- [ ] 實作優先順序：`Regex 結果 > AI 結果 > 預設值`
- [ ] 確認 `applied_position` / `department` fallback 為「未知職位」/「未分類」
- [ ] 確認 `candidate_name` fallback 為「未知姓名」

### B4. 修復 PG：寫入 candidates
- [ ] 確認 `INSERT ... WHERE NOT EXISTS` 邏輯正確（依 name 判斷）
- [ ] 確認 `UPDATE candidates SET status` 每次都執行
- [ ] 確認用 `SELECT id AS candidate_id` 取回 ID 供後續節點使用

### B5. 修復 PG：寫入 interviews
- [ ] 確認 `intent` 分流邏輯覆蓋所有 case：
  - `recommend` / `schedule` / `second_schedule` / `request_invite` / `other` → INSERT ON CONFLICT UPDATE
  - `update_time` → UPDATE 日期時間
  - `cancel` → UPDATE status='取消面試'
- [ ] 確認 `ON CONFLICT (email_msg_id) DO UPDATE SET status = EXCLUDED.status` 語法正確

### B6. 驗證 PG：email_logs 記錄
- [ ] 確認每封信處理後都寫入 `email_logs`（action='inserted' 或 'skipped'）
- [ ] 確認不符合主旨過濾的信件寫入 action='skipped'

### B7. 端對端測試
- [ ] 手動 trigger 一封「面試通知」信件，驗證：
  ```sql
  SELECT c.name, c.status, i.interview_date, i.intent, i.email_msg_id
  FROM candidates c JOIN interviews i ON i.candidate_id = c.id
  ORDER BY i.created_at DESC LIMIT 10;
  ```
- [ ] 確認 email_logs 統計正常：
  ```sql
  SELECT action, COUNT(*) FROM email_logs GROUP BY action;
  ```
- [ ] 重複觸發同一封信，確認不產生重複紀錄（ON CONFLICT DO NOTHING）
