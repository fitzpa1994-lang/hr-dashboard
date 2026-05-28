# HR 自動化招募系統 — 專案進度

## 專案目標
自動擷取 Outlook 招募相關信件，整合成共享 HR 戰略面板，
支援面試排程、到職提醒、離職追蹤、趨勢分析。

## 目前完成

### ✅ 資料庫設計（database/hr_recruitment.sql）
- 7 張核心資料表：candidates / interviews / offers / email_logs /
  job_requisitions / onboardings / resignations
- 所有表皆有 email_msg_id UNIQUE 欄位，確保 Outlook 信件去重
- interviews / offers / onboardings 新增 email_web_link 欄位，
  支援面板點擊直接開啟原始 Outlook 信件
- onboardings 新增 resume_link 欄位，連結 SharePoint 履歷
- 4 個 SQLite Views 供面板查詢：
  v_recruitment_funnel / v_monthly_stats / v_hr_workload / v_department_progress

### ✅ 戰略面板 Demo（dashboard/index.html）
- 5 個分頁：面試排程 / 人事動態 / 職缺狀況 / 人選狀況 / 趨勢分析
- Today Bar：今日面試 / 今日到職 / 本週離職
- Mini Calendar：三色圓點標示（藍=面試 / 綠=到職 / 粉=離職）
- 點擊人名 → 右側滑出詳細面板：
  - 開啟 Outlook 信件按鈕（連 OWA webLink）
  - 查看履歷按鈕（連 SharePoint/OneDrive）
  - 面試歷程時間軸
  - HR 備註

## 待完成

### 🔲 n8n 工作流程（n8n/）
- [ ] 安裝 n8n（npm install -g n8n）
- [ ] Workflow 1：面試信件解析 + 寫入 DB
- [ ] Workflow 2：錄取通知解析
- [ ] Workflow 3：到職通知解析
- [ ] Workflow 4：離職通知解析
- [ ] Workflow 5：14天未回應自動標記（每日排程）

### 🔲 後端 API
- [ ] 以 Python Flask 或 Node.js 提供 REST API
- [ ] dashboard/index.html 改成從 API 讀取真實資料

### 🔲 內網部署
- [ ] Python HTTP server 或 nginx 提供 dashboard 存取
- [ ] 確認內網 URL（例：http://192.168.x.x:8080）

### 🔲 AI 自然語言查詢（Phase 2）
- [ ] n8n webhook 作為 AI API proxy
- [ ] 面板加入對話框，支援自然語言查詢歷史資料

## 資料夾結構

```
hr-recruitment-system/
├── database/
│   └── hr_recruitment.sql      # SQLite schema（完成）
├── dashboard/
│   └── index.html              # 戰略面板 Demo（完成）
├── n8n/
│   └── workflow_overview.md    # 工作流程說明
└── docs/
    └── project_status.md       # 本文件
```


