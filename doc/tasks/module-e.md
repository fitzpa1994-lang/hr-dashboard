# Module E — Dashboard API

**狀態**：🔧 需驗證資料正確性  
**檔案**：`n8n/live_Dashboard_API.json`

## 任務清單

### E1. 確認 API Webhook 設定
- [ ] 確認端點路徑為 `GET /webhook/hr-dashboard`
- [ ] 確認 token 驗證邏輯：`?token=$N8N_HR_TOKEN`，無效回傳 HTTP 403
- [ ] 確認回應 header 包含 `Content-Type: application/json; charset=utf-8`
- [ ] 確認 CORS header：`Access-Control-Allow-Origin: *`

### E2. 驗證 schedEvents 查詢
- [ ] 確認 interview 範圍：今天 -14 天 ~ 今天 +45 天
- [ ] 確認 onboard / resign 範圍：今天 -7 天 ~ 今天 +60 天
- [ ] 確認每筆事件包含欄位：`type` / `name` / `pos` / `dept` / `date` / `time` / `hr` / `round` / `note` / `emailLink`

### E3. 驗證 onboardData 查詢
- [ ] 確認查詢條件：`expected_date >= 今天 -60天` 且 `status != 'cancelled'`
- [ ] 確認欄位對應：`expected_date` → `date`，`email_web_link` → `emailLink`

### E4. 驗證 resignData 查詢
- [ ] 確認查詢條件：`last_day >= 今天 -60天` 且 `status != 'cancelled'`
- [ ] 確認欄位對應：`last_day` → `lastDay`，`email_web_link` → `emailLink`

### E5. 驗證 candidatesData 查詢
- [ ] 確認每位候選人包含 `history` 陣列（面試歷程時間軸）
- [ ] 確認 `history` 每筆包含：`date` / `type` / `title` / `note` / `color`
- [ ] 確認 `resumeLink` 欄位存在（可為 null）

### E6. 驗證 monthlyTrend 查詢
- [ ] 確認回傳近 6 個月統計
- [ ] 確認每月包含：`month` / `interviews` / `offers` / `onboarded`

### E7. 驗證 stats 統計
- [ ] 確認回傳欄位：`activeCount` / `offerCount` / `pendingOnboard` / `pendingResign` / `monthOnboard` / `monthResign` / `hireRate` / `avgDaysToOffer`

### E8. API 測試
- [ ] 正常請求：
  ```bash
  curl "http://localhost:5678/webhook/hr-dashboard?token=$N8N_HR_TOKEN" | python -m json.tool
  ```
- [ ] 確認回應 JSON 包含所有必要欄位（schedEvents / onboardData / resignData / candidatesData / monthlyTrend / stats）
- [ ] 無效 token 回傳 403：
  ```bash
  curl "http://localhost:5678/webhook/hr-dashboard?token=wrong" -v
  ```
- [ ] 確認 `schedEvents` 和 `onboardData` 資料一致（今日報到同時出現在兩個陣列）

