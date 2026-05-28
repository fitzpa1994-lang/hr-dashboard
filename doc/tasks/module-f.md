# Module F — Dashboard 前端

**狀態**：🔧 待視覺修改  
**檔案**：`dashboard/index.html`

## 任務清單

### F1. 切換 API 資料來源
- [ ] 找到 `index.html` 中的靜態假資料區塊，改為呼叫 Dashboard API：
  ```javascript
  const API_URL = 'http://localhost:5678/webhook/hr-dashboard?token=$N8N_HR_TOKEN';
  async function fetchData() {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error('API Error');
    return res.json();
  }
  ```
- [ ] 確認頁面載入時呼叫 `fetchData()`，並用回傳資料渲染所有分頁

### F2. 新增「今日預計報到」區塊
- [ ] 在「人事動態」分頁或 Today Bar 下方新增區塊
- [ ] 實作資料邏輯：
  ```javascript
  const todayOnboard = onboardData.filter(
    o => o.date === today && o.status !== 'cancelled'
  );
  ```
- [ ] 顯示欄位：姓名 / 部門 / 職稱
- [ ] 無資料時顯示「今日無報到」fallback

### F3. 新增「未來預計報到」區塊
- [ ] 在「人事動態」分頁新增區塊
- [ ] 實作資料邏輯：
  ```javascript
  const futureOnboard = onboardData
    .filter(o => o.date > today && o.status === 'pending')
    .sort((a, b) => a.date.localeCompare(b.date));
  ```
- [ ] 顯示欄位：日期 / 姓名 / 部門 / 職稱

### F4. 更新 Today Bar 資料邏輯
- [ ] 今日面試：`schedEvents` 過濾 `type='interview' AND date=today`
- [ ] 今日到職：`schedEvents` 過濾 `type='onboard' AND date=today`
- [ ] 本週離職：`schedEvents` 過濾 `type='resign' AND date 在本週範圍`

### F5. 更新 Mini Calendar 三色圓點
- [ ] 藍色：`schedEvents` type=interview
- [ ] 綠色：`schedEvents` type=onboard
- [ ] 粉色：`schedEvents` type=resign
- [ ] 確認同一天有多種事件時，多個圓點並排顯示

### F6. 確認各分頁資料綁定
- [ ] 面試排程分頁：綁定 `schedEvents`（type=interview）
- [ ] 人事動態分頁：綁定 `onboardData` + `resignData`
- [ ] 人選狀況分頁：綁定 `candidatesData`，確認點擊人名可滑出詳情面板
- [ ] 趨勢分析分頁：綁定 `monthlyTrend` + `stats`

### F7. 詳情滑板功能確認
- [ ] 點擊人名 → 右側滑出詳情面板
- [ ] 確認「開啟 Outlook 信件」按鈕連結到 `emailLink`（OWA webLink）
- [ ] 確認「查看履歷」按鈕連結到 `resumeLink`（SharePoint）
- [ ] 確認面試歷程時間軸正確顯示 `history` 陣列
- [ ] 確認 HR 備註欄位有顯示 `note`

### F8. 內網部署確認
- [ ] 在內網機器執行：
  ```bash
  cd dashboard
  python -m http.server 8080
  ```
- [ ] 確認內網 URL（`http://{內網IP}:8080`）可被其他機器訪問
- [ ] 確認瀏覽器開啟後 API 請求不被 CORS 阻擋

### F9. 手動測試
- [ ] 確認「今日報到」區塊顯示正確（有資料時顯示人名，無資料時顯示 fallback）
- [ ] 確認「未來報到」排序由近至遠
- [ ] 確認點擊人名後 emailLink 連結可正常開啟 Outlook 信件
- [ ] 確認 Mini Calendar 有面試/到職/離職日期的圓點正確顯示
- [ ] 確認無資料分頁有適當的空白提示

