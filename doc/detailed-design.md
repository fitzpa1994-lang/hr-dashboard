# HR 招募系統 — 詳細設計文件

版本：1.0 | 日期：2026-05-25 | 作者：黃友為 Evan

---

## 目錄

1. [系統概覽](#1-系統概覽)
2. [Module A：PostgreSQL 資料庫](#module-a-postgresql-資料庫)
3. [Module B：Workflow 1 — 面試信件解析](#module-b-workflow-1--面試信件解析)
4. [Module C：Workflow 3 — 錄取/離職自動匯入](#module-c-workflow-3--錄取離職自動匯入)
5. [Module D：Workflow 2 — 歷史批次匯入](#module-d-workflow-2--歷史批次匯入)
6. [Module E：Dashboard API](#module-e-dashboard-api)
7. [Module F：Dashboard 前端](#module-f-dashboard-前端)
8. [模組間介面契約](#模組間介面契約)
9. [測試策略](#測試策略)

---

## 1. 系統概覽

### 1.1 架構圖

```
Outlook 資料夾
  ├─ 預計報到人員 (75封)     ──→ Workflow 3（錄取段）
  ├─ 已寄離職人員通知 (56封)  ──→ Workflow 3（離職段）
  └─ 104/1111人力銀行        ──→ Workflow 1（面試解析）
          │
          ▼ n8n Workflow
          │
          ▼ PostgreSQL DB（via n8n Postgres account）
          │
          ▼ Dashboard API（n8n Webhook: GET /hr-dashboard）
          │
          ▼ dashboard/index.html（內網部署）
```

### 1.2 模組清單

| 模組 | 檔案位置 | 狀態 |
|------|---------|------|
| A — PostgreSQL DB | `database/hr_recruitment_pg.sql` | ✅ 完成 |
| B — Workflow 1 面試解析 | `n8n/live_Workflow1_面試解析.json` | 🔧 有 bug，需修復 |
| C — Workflow 3 錄取/離職 | `n8n/live_Workflow3_到職離職.json` | 🔧 需重構 |
| D — Workflow 2 歷史匯入 | `n8n/live_Workflow2_*.json` | 📋 一次性，啟用後停用 |
| E — Dashboard API | `n8n/live_Dashboard_API.json` | 🔧 需驗證資料正確性 |
| F — Dashboard 前端 | `dashboard/index.html` | 🔧 待視覺修改 |

### 1.3 技術棧

| 元件 | 版本/說明 |
|------|---------|
| n8n | 本機安裝，自動化引擎 |
| PostgreSQL | 透過 n8n `Postgres account` 連接 |
| Claude API | claude-haiku-4-5-20251001，信件解析 |
| Microsoft Outlook | OAuth2，郵件讀取觸發器 |
| Python HTTP Server | 內網部署 Dashboard |

### 1.4 模組獨立原則

- 每個模組只透過 **PostgreSQL DB** 互相溝通，不直接呼叫對方
- 每個模組可以單獨啟用/停用/測試
- Workflow 1、C、D 皆有 `ON CONFLICT (email_msg_id) DO NOTHING` 防重複

---

## Module A: PostgreSQL 資料庫

### A.1 職責

儲存所有 HR 招募資料，提供其他模組的讀寫介面。

### A.2 資料表設計

#### TABLE 1: `candidates`（候選人主表）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | SERIAL PK | 自動遞增 |
| name | TEXT NOT NULL | 候選人姓名 |
| email | TEXT | 電子郵件（可空） |
| phone | TEXT | 電話（可空） |
| applied_position | TEXT NOT NULL | 應徵職位 |
| department | TEXT NOT NULL | 部門 |
| source | TEXT DEFAULT '其他' | 來源（例：104人力銀行、Outlook即時） |
| status | TEXT | `in_progress` / `hired` / `rejected` / `withdrawn` |
| notes | TEXT | HR 備註 |
| created_at / updated_at | TIMESTAMPTZ | 建立/更新時間 |

#### TABLE 2: `interviews`（面試記錄）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | SERIAL PK | |
| candidate_id | INTEGER FK → candidates.id | |
| interview_date | DATE NOT NULL | 面試日期 |
| interview_time | TEXT | 面試時間（HH:MM） |
| round | INTEGER DEFAULT 1 | 第幾輪 |
| interviewer | TEXT | 面試官 |
| location | TEXT | 地點 |
| hr_owner | TEXT | 負責 HR |
| status | TEXT | `scheduled` / `completed` / `cancelled` / `rescheduled` |
| result | TEXT | `pending` / `passed` / `failed` / `no_show` |
| email_msg_id | TEXT UNIQUE | Outlook 信件 ID，防重複 |
| email_web_link | TEXT | OWA 原始信件連結 |

#### TABLE 3: `offers`（錄取記錄）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | SERIAL PK | |
| candidate_id | INTEGER FK UNIQUE | 一人只有一筆 offer |
| offer_date | DATE NOT NULL | Offer 日期 |
| expected_start | DATE | 預計到職日 |
| actual_start | DATE | 實際到職日 |
| status | TEXT | `pending` / `accepted` / `rejected` / `withdrawn` / `onboarded` |
| days_to_offer | INTEGER | 從面試到 offer 的天數 |
| email_msg_id | TEXT UNIQUE | |

#### TABLE 4: `email_logs`（信件處理日誌）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | SERIAL PK | |
| email_msg_id | TEXT UNIQUE NOT NULL | |
| email_subject | TEXT | 信件主旨 |
| sender | TEXT | 寄件人 email |
| received_at | TIMESTAMPTZ | 收信時間 |
| action | TEXT | `inserted` / `updated` / `skipped` / `error` |
| candidate_id | INTEGER FK | 關聯候選人（可空） |
| error_msg | TEXT | 錯誤訊息（可空） |
| processed_at | TIMESTAMPTZ DEFAULT NOW() | 處理時間 |

#### TABLE 5: `job_requisitions`（職缺需求）

> 目前 Dashboard API 回傳 `jobsData: []`，此表暫不由 Workflow 填入，保留供未來手動維護。

#### TABLE 6: `onboardings`（到職記錄）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | SERIAL PK | |
| candidate_id | INTEGER FK 可空 | 可關聯 candidates（可空） |
| name | TEXT NOT NULL | 姓名 |
| department | TEXT NOT NULL | 部門 |
| position | TEXT NOT NULL | 職稱 |
| hr_owner | TEXT | 負責 HR |
| expected_date | DATE NOT NULL | **預計報到日（核心欄位）** |
| actual_date | DATE | 實際報到日（目前不追蹤） |
| status | TEXT | `pending` / `onboarded` / `cancelled` |
| email_msg_id | TEXT UNIQUE | 原始錄取通知信件 ID |
| email_web_link | TEXT | OWA 連結 |
| resume_link | TEXT | SharePoint 履歷連結 |

#### TABLE 7: `resignations`（離職記錄）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | SERIAL PK | |
| name | TEXT NOT NULL | 姓名（從 body 萃取） |
| department | TEXT NOT NULL | 部門（從 body 萃取） |
| position | TEXT NOT NULL | 職稱（從 body 萃取） |
| hr_owner | TEXT | 發信 HR |
| resign_date | DATE | 離職申請日（可空） |
| last_day | DATE NOT NULL | **離職生效日（核心欄位）** |
| reason | TEXT | 離職原因（可空） |
| status | TEXT | `active` / `done` / `cancelled` |
| email_msg_id | TEXT UNIQUE | |

### A.3 Views

| View | 用途 |
|------|------|
| `v_recruitment_funnel` | 候選人漏斗（面試→offer→到職） |
| `v_monthly_stats` | 月統計（面試數、offer 數、到職數、轉化率） |
| `v_hr_workload` | HR 工作量（每人負責幾個候選人） |
| `v_department_progress` | 各部門招募進度 |

### A.4 測試

```sql
-- 驗證 email_msg_id 去重
INSERT INTO email_logs (email_msg_id, email_subject, action)
VALUES ('test-001', '測試', 'inserted');
INSERT INTO email_logs (email_msg_id, email_subject, action)
VALUES ('test-001', '測試', 'inserted');
-- 預期：第二筆 INSERT 引發 UNIQUE 衝突，workflow 用 ON CONFLICT DO NOTHING 處理

-- 驗證 onboardings 核心欄位
SELECT name, expected_date, status FROM onboardings WHERE status = 'pending' ORDER BY expected_date;

-- 驗證 resignations 核心欄位
SELECT name, last_day, status FROM resignations WHERE status = 'active' ORDER BY last_day;
```

---

## Module B: Workflow 1 — 面試信件解析

**檔案**：`n8n/live_Workflow1_面試解析.json`

### B.1 職責

從 104 / 1111 人力銀行 Outlook 資料夾自動讀取信件，解析面試資訊後寫入 DB。

### B.2 觸發條件

| 項目 | 設定 |
|------|------|
| 觸發類型 | Outlook Trigger（輪詢模式） |
| 輪詢頻率 | 每分鐘 |
| 監控資料夾 | 104人力銀行（2個資料夾）、1111人力銀行（2個資料夾），共 4 個 folder ID |

### B.3 處理流程

```
Outlook 收信
    │
    ▼
IF：主旨過濾
    │ 主旨包含「面試|面談|初試|複試|面試通知|面談通知|interview|履歷推薦」
    │
    ├── [符合] → Code：萃取基本資訊
    │                │
    │                ▼
    │           Claude AI：解析意圖
    │                │
    │                ▼
    │           Code：整合輸出（合併 Regex + AI 結果）
    │                │
    │                ▼
    │           PG：寫入 candidates（INSERT or UPDATE status）
    │                │
    │                ▼
    │           PG：寫入 interviews（根據 intent 決定 INSERT/UPDATE/取消）
    │                │
    │                ▼
    │           PG：寫入 email_logs（action='inserted'）
    │
    └── [不符合] → Code：非面試信件略過
                        │
                        ▼
                   PG：記錄略過信件（action='skipped'）
```

### B.4 Code：萃取基本資訊

**輸入**：Outlook 原始信件 JSON

**輸出**：
```json
{
  "email_msg_id": "AAMk...",
  "email_subject": "信件主旨",
  "email_web_link": "https://outlook.office.com/...",
  "sender": "sender@example.com",
  "received_at": "2026-05-25T08:00:00Z",
  "candidate_name": "張三",
  "interview_date": "2026-05-28",
  "interview_time": "14:00",
  "body_text": "清洗後的純文字（前2000字）"
}
```

**萃取規則**：

| 欄位 | 規則 |
|------|------|
| `candidate_name` | 主旨優先：`【職位】- 姓名`、`- 姓名（結尾）`、`】姓名先生/女士`；fallback：主旨最後一個 `-` 後的文字（長度 2~5，非關鍵字） |
| `interview_date` | Regex 掃主旨 + body 前800字：`YYYY年MM月DD日`、`YYYY/MM/DD`、`MM月DD日` |
| `interview_time` | Regex：`HH:MM` 或 `HH：MM` |
| `body_text` | HTML tag 去除、`&nbsp;` 替換、多空白壓縮，截前 2000 字 |

### B.5 Claude AI 解析意圖

**模型**：`claude-haiku-4-5-20251001`，max_tokens: 500

**輸出欄位（JSON）**：

| 欄位 | 說明 |
|------|------|
| `candidate_name` | 優先從主旨取，主旨有名就不用內文 |
| `applied_position` | 應徵職位，找不到填「未知職位」 |
| `department` | 部門，找不到填「未分類」 |
| `interview_date` | YYYY-MM-DD。**規則**：若內容是主管「建議約在...」代表尚未確認，填 null；只有「已與候選人確認」才填日期 |
| `interview_time` | HH:MM，規則同上 |
| `round` | 第幾輪（數字，預設 1） |
| `location` | 面試地點 |
| `hr_owner` | 負責 HR（李沛晴/陳清彥/黃友為） |
| `status` | 繁中狀態描述，例：待HR邀約 / 面試已安排 / 已推薦 |
| `intent` | `recommend` / `request_invite` / `schedule` / `update_time` / `cancel` / `second_schedule` / `other` |
| `ai_action_item` | HR 待辦事項一句話（無則 null） |

### B.6 Code：整合輸出

優先順序：`Regex 結果 > AI 結果 > 預設值`

```
candidate_name = Regex結果 || AI結果 || '未知姓名'
interview_date = Regex日期 || AI日期
interview_time = Regex時間 || AI時間
applied_position = AI結果 || '未知職位'
department = AI結果 || '未分類'
```

### B.7 PG：寫入 candidates

```sql
-- 不存在時 INSERT
INSERT INTO candidates (name, applied_position, department, source, status)
SELECT {name}, {applied_position}, {department}, 'Outlook即時', {status}
WHERE NOT EXISTS (SELECT 1 FROM candidates WHERE name = {name});

-- 始終更新 status
UPDATE candidates SET status = {status} WHERE name = {name};

-- 取回 candidate_id 供後續節點使用
SELECT id AS candidate_id, ... FROM candidates WHERE name = {name} ORDER BY created_at DESC LIMIT 1;
```

### B.8 PG：寫入 interviews

| `intent` 值 | DB 動作 |
|------------|---------|
| `recommend` / `schedule` / `second_schedule` / `request_invite` / `other` | `INSERT ... ON CONFLICT (email_msg_id) DO UPDATE SET status = EXCLUDED.status` |
| `update_time` | `UPDATE interviews SET interview_date=?, interview_time=? WHERE candidate_id=? AND round=?` |
| `cancel` | `UPDATE interviews SET status='取消面試' WHERE candidate_id=? AND round=?` |

### B.9 已知問題與修復項目

| 問題 | 原因 | 修復方式 |
|------|------|---------|
| Claude jsonBody 表達式錯誤 | n8n expression 語法問題 | 改用 `specifyBody: "json"` + 正確 expression 語法，或改用 Code 節點組裝 request body |
| AI 欄位無法正確寫入 | jsonBody 解析失敗導致 aiResult 為空 | 修復 jsonBody 後重新測試，確認 `Code：整合輸出` 中 AI 欄位非空 |

### B.10 測試

```sql
-- 測試後驗證
SELECT c.name, c.status, i.interview_date, i.intent, i.email_msg_id
FROM candidates c JOIN interviews i ON i.candidate_id = c.id
ORDER BY i.created_at DESC LIMIT 10;

-- 驗證 email_logs 記錄是否完整
SELECT action, COUNT(*) FROM email_logs GROUP BY action;
```

---

## Module C: Workflow 3 — 錄取/離職自動匯入

**檔案**：`n8n/live_Workflow3_到職離職.json`（需重構）

### C.1 職責

從兩個固定 Outlook 資料夾讀取信件，解析錄取/離職資訊後寫入 DB。

### C.2 觸發條件

| 分流 | 監控資料夾 | 說明 |
|------|-----------|------|
| 錄取段 | **預計報到人員** | 耕興/全球檢測錄取通知 |
| 離職段 | **已寄離職人員通知** | 離職通知發出後的存檔 |

> ⚠️ 需在 n8n 中確認並更新 Outlook Trigger 的 folder ID，確保對應到正確資料夾。

### C.3 錄取段（Onboarding）流程

```
Outlook 收信：預計報到人員資料夾
    │
    ▼
Code：標記 source_type='onboarding'
    │
    ▼
Code：萃取基本欄位（Regex）
    │
    ▼
Claude AI：解析意圖與欄位
    │
    ▼
IF：intent 分流
    │
    ├── [new_onboard] → PG：INSERT onboardings
    ├── [update_date] → PG：UPDATE onboardings（依 name 比對）
    ├── [cancel]      → PG：UPDATE onboardings SET status='cancelled'
    └── [skip]        → PG：email_logs action='skipped'
    │
    ▼（new_onboard / update_date）
PG：寫入 email_logs（action='inserted' or 'updated'）
```

#### C.3.1 Code：萃取基本欄位（Regex）

**輸入**：Outlook 原始信件 JSON

**輸出**：
```json
{
  "email_msg_id": "AAMk...",
  "email_subject": "【耕興股份有限公司】錄取通知事宜-張三",
  "email_web_link": "...",
  "sender": "yen@sporton.com.tw",
  "received_at": "2026-05-25T09:00:00Z",
  "name_from_subject": "張三",
  "body_text": "清洗後的純文字（前2000字）"
}
```

**`name_from_subject` 萃取規則**：

主旨格式：`【耕興股份有限公司】錄取通知事宜-{姓名}` 或 `【耕興子公司-全球檢測】錄取通知事宜-{姓名}`

```javascript
// 取主旨最後一個 - 之後的文字
const parts = subject.split('-');
const name = parts[parts.length - 1].trim();
// 長度 2~5，非關鍵字則採用
```

#### C.3.2 Claude AI：解析意圖（Onboarding）

**模型**：`claude-haiku-4-5-20251001`，max_tokens: 400

**系統提示重點**：
```
你是 HR 信件解析助手。讀取錄取通知信件，輸出純 JSON。

HR 人員：李沛晴（Peggy）、陳清彥（Yen）、黃友為（Evan）

請判斷以下欄位：
- intent: new_onboard（全新錄取）| update_date（調整/延後報到日期）
         | cancel（取消錄取）| skip（RE: 回覆信或無關信件）
- name: 候選人姓名（優先從主旨最後一個「-」後取，主旨無法確定才從內文找）
- scheduled_onboard_date: 報到日期 YYYY-MM-DD
  （從 body 找「報到日期：」或「預定報到日期：」後的日期）
- department: 部門（找不到填 null）
- position: 職稱（找不到填 null）
- hr_owner: 負責 HR 姓名（找不到填 null）

注意：
1. 主旨以「RE:」開頭通常是回覆信 → intent 填 skip
2. body 出現「調整」「延後」「更改報到」→ intent 填 update_date
3. 即使主旨與第一封相同，仍需讀取 body 判斷意圖
```

**輸出範例（new_onboard）**：
```json
{
  "intent": "new_onboard",
  "name": "張三",
  "scheduled_onboard_date": "2026-06-02",
  "department": "軟體部",
  "position": "軟體工程師",
  "hr_owner": "陳清彥"
}
```

**輸出範例（update_date）**：
```json
{
  "intent": "update_date",
  "name": "張三",
  "scheduled_onboard_date": "2026-06-16",
  "department": null,
  "position": null,
  "hr_owner": null
}
```

#### C.3.3 PG：INSERT onboardings（new_onboard）

```sql
INSERT INTO onboardings (name, department, position, hr_owner, expected_date, status, email_subject, email_msg_id, email_web_link)
SELECT
  {name},
  COALESCE({department}, '未分類'),
  COALESCE({position}, '未知職位'),
  {hr_owner},
  {scheduled_onboard_date}::DATE,
  'pending',
  {email_subject},
  {email_msg_id},
  {email_web_link}
ON CONFLICT (email_msg_id) DO NOTHING;
```

#### C.3.4 PG：UPDATE onboardings（update_date）

```sql
UPDATE onboardings
SET
  expected_date = {scheduled_onboard_date}::DATE,
  notes = CONCAT(COALESCE(notes, ''), ' | 報到日期更新：', {email_subject}),
  updated_at = NOW()
WHERE name = {name}
  AND status = 'pending'
  AND id = (
    SELECT id FROM onboardings
    WHERE name = {name} AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  );
```

> **邊界情況**：若依 name 找不到既有 pending 紀錄（例如歷史資料尚未匯入），改 fallback 為 INSERT，並在 notes 標記 `[date-update fallback]`。

#### C.3.5 PG：UPDATE onboardings（cancel）

```sql
UPDATE onboardings
SET status = 'cancelled', updated_at = NOW()
WHERE name = {name} AND status = 'pending'
ORDER BY created_at DESC
LIMIT 1;
```

---

### C.4 離職段（Resignation）流程

```
Outlook 收信：已寄離職人員通知資料夾
    │
    ▼
Code：標記 source_type='resignation'
    │
    ▼
Code：萃取離職欄位（Regex + 固定格式）
    │
    ▼
PG：INSERT resignations（ON CONFLICT DO NOTHING）
    │
    ▼
PG：寫入 email_logs
```

#### C.4.1 離職信件格式（固定）

```
□ 單       位：{部門}
□ 姓       名：{姓名}
□ 職       稱：{職稱}
□ 離 職 生 效 日：{日期（星期）}
```

#### C.4.2 Code：萃取離職欄位（Regex）

```javascript
// 去除 HTML 並壓縮空白
const body = rawBody.replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

// 萃取欄位（使用彈性空白的 Regex）
const deptMatch  = body.match(/單\s*位\s*[：:]\s*([^\r\n□]+)/);
const nameMatch  = body.match(/姓\s*名\s*[：:]\s*([^\r\n□]+)/);
const titleMatch = body.match(/職\s*稱\s*[：:]\s*([^\r\n□]+)/);
const dayMatch   = body.match(/離\s*職\s*生\s*效\s*日\s*[：:]\s*([^\r\n□（(]+)/);

// 去除括號星期：「2026/06/01（日）」→「2026-06-01」
const rawDate = dayMatch?.[1]?.trim() || '';
const parts = rawDate.split('/');
const last_day = parts.length === 3
  ? `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`
  : rawDate;
```

**輸出**：
```json
{
  "email_msg_id": "AAMk...",
  "email_subject": "【離職人員通知】軟體部：張三，於2026/06/01離職",
  "email_web_link": "...",
  "sender": "peggy@sporton.com.tw",
  "received_at": "...",
  "name": "張三",
  "department": "軟體部",
  "position": "軟體工程師",
  "last_day": "2026-06-01"
}
```

> **重要**：`name` 和 `last_day` 皆從 **body** 萃取，不從主旨取。主旨中的日期與 body 的生效日不同，**以 body 為準**。

#### C.4.3 PG：INSERT resignations

```sql
INSERT INTO resignations (name, department, position, hr_owner, last_day, status, email_subject, email_msg_id, email_web_link)
SELECT
  {name},
  {department},
  {position},
  {hr_owner},     -- 從 sender 推算（李沛晴的 email）
  {last_day}::DATE,
  'active',
  {email_subject},
  {email_msg_id},
  {email_web_link}
ON CONFLICT (email_msg_id) DO NOTHING;
```

---

### C.5 測試

```sql
-- 驗證 onboarding 資料正確性
SELECT name, expected_date, status, email_subject
FROM onboardings ORDER BY expected_date;

-- 驗證今日報到與未來報到
SELECT name, expected_date FROM onboardings
WHERE status = 'pending' AND expected_date >= CURRENT_DATE
ORDER BY expected_date;

-- 驗證離職 last_day 萃取正確性（應為無星期的純日期）
SELECT name, last_day, department FROM resignations
WHERE status = 'active' ORDER BY last_day;

-- 驗證沒有重複的 name（同人可能有多封 update email）
SELECT name, COUNT(*) FROM onboardings GROUP BY name HAVING COUNT(*) > 1;
```

---

## Module D: Workflow 2 — 歷史批次匯入

**檔案**：`n8n/live_Workflow2_歷史匯入.json`、`n8n/live_Workflow2_歷史匯入_近30天.json`

### D.1 職責

**一次性操作**：把 Outlook 歷史信件批次匯入 DB。完成後停用 workflow，不再執行。

### D.2 設計原則

- 使用 `ON CONFLICT (email_msg_id) DO NOTHING` 防止重複匯入
- 可多次執行（冪等），重複執行不影響資料
- 匯入範圍：近 30 天版本 vs 全量版本，視需求啟用不同版本

### D.3 修復事項

目前 Workflow 2 有使用 `ALTER TABLE DROP CONSTRAINT` 語法，此為 PostgreSQL 支援的語法（非 SQLite），但需確認實際執行錯誤原因：

| 問題描述 | 排查步驟 |
|---------|---------|
| `ALTER TABLE DROP CONSTRAINT` 報錯 | 確認 constraint 名稱是否存在於 DB；用 `\d tablename` 查看 |
| 改用 CREATE TABLE + INSERT SELECT | 若無法 ALTER，改為：建立暫時表 → INSERT SELECT → DROP 原表 → RENAME |

### D.4 匯入來源

| 資料夾 | 信件數量 | Workflow |
|-------|---------|---------|
| 104人力銀行 | 2967 封 | Workflow 2（面試） |
| 1111人力銀行 | 640 封 | Workflow 2（面試） |
| 預計報到人員 | 75 封 | Workflow 2（錄取） |
| 已寄離職人員通知 | 56 封 | Workflow 2（離職） |

### D.5 完成確認清單

| 項目 | 驗證 SQL |
|------|---------|
| candidates 筆數合理 | `SELECT COUNT(*) FROM candidates;` |
| interviews 有完整日期 | `SELECT COUNT(*) FROM interviews WHERE interview_date IS NULL;` |
| onboardings 有正確 expected_date | `SELECT COUNT(*) FROM onboardings WHERE expected_date IS NULL;` |
| resignations 有正確 last_day | `SELECT COUNT(*) FROM resignations WHERE last_day IS NULL;` |
| email_logs 無大量 error | `SELECT action, COUNT(*) FROM email_logs GROUP BY action;` |

---

## Module E: Dashboard API

**檔案**：`n8n/live_Dashboard_API.json`

### E.1 職責

提供 Dashboard 前端所需的所有資料，單一 GET 請求回傳完整 JSON。

### E.2 API 規格

| 項目 | 設定 |
|------|------|
| 端點 | `GET /webhook/hr-dashboard` |
| 認證 | Query parameter: `?token=$N8N_HR_TOKEN` |
| 回應格式 | `application/json; charset=utf-8` |
| CORS | `Access-Control-Allow-Origin: *` |
| 無效 token | HTTP 403 `{"error":"Unauthorized"}` |

### E.3 回應 JSON 結構

```json
{
  "today": "2026-05-25",
  "generatedAt": "2026-05-25T10:30:00",

  "schedEvents": [
    {
      "type": "interview" | "onboard" | "resign",
      "name": "張三",
      "pos": "軟體工程師",
      "dept": "軟體部",
      "date": "2026-05-28",
      "time": "14:00",
      "hr": "陳清彥",
      "round": 1,
      "note": "",
      "emailLink": "https://outlook.office.com/..."
    }
  ],
  // 範圍：interview = 今天-14天 ~ 今天+45天
  //       onboard/resign = 今天-7天 ~ 今天+60天

  "onboardData": [
    {
      "name": "李四",
      "dept": "財務部",
      "pos": "財務專員",
      "date": "2026-06-02",
      "hr": "李沛晴",
      "status": "pending" | "onboarded",
      "emailLink": "..."
    }
  ],
  // 範圍：expected_date >= 今天-60天，status != 'cancelled'

  "resignData": [
    {
      "name": "王五",
      "dept": "行政部",
      "pos": "行政專員",
      "lastDay": "2026-06-01",
      "hr": "李沛晴",
      "reason": "",
      "status": "active",
      "emailLink": "..."
    }
  ],
  // 範圍：last_day >= 今天-60天，status != 'cancelled'

  "candidatesData": [
    {
      "name": "張三",
      "pos": "軟體工程師",
      "dept": "軟體部",
      "date": "2026-05-20",
      "latestDate": "2026-05-20",
      "status": "interviewing" | "offer" | "withdrawn" | "onboarded",
      "hr": "陳清彥",
      "note": "",
      "source": "104人力銀行",
      "emailLink": "...",
      "resumeLink": null,
      "history": [
        {
          "date": "2026-05-20",
          "type": "interview",
          "title": "第1輪面試 — 面試已安排",
          "note": "",
          "color": "blue" | "green" | "pink"
        }
      ]
    }
  ],

  "jobsData": [],

  "monthlyTrend": [
    {
      "month": "2026-04",
      "interviews": 15,
      "offers": 3,
      "onboarded": 2
    }
  ],
  // 範圍：近 6 個月

  "stats": {
    "activeCount": 12,
    "offerCount": 3,
    "pendingOnboard": 5,
    "pendingResign": 2,
    "monthOnboard": 2,
    "monthResign": 1,
    "hireRate": 25,
    "avgDaysToOffer": 0
  }
}
```

### E.4 今日報到 / 未來報到的資料來源

Dashboard 前端需要的「今日報到」和「未來報到」，資料已包含在 `schedEvents` 和 `onboardData` 中：

| 前端需求 | 資料來源 |
|---------|---------|
| 今日預計報到 | `schedEvents` 過濾 `type='onboard' AND date=today` |
| 未來預計報到 | `onboardData` 過濾 `date > today AND status='pending'` |

### E.5 測試

```bash
# 正常請求
curl "http://localhost:5678/webhook/hr-dashboard?token=$N8N_HR_TOKEN"

# 驗證回應包含必要欄位
curl "http://localhost:5678/webhook/hr-dashboard?token=$N8N_HR_TOKEN" | python -m json.tool

# 無效 token 應返回 403
curl "http://localhost:5678/webhook/hr-dashboard?token=wrong" -v
```

---

## Module F: Dashboard 前端

**檔案**：`dashboard/index.html`

### F.1 職責

內網 HR 戰略面板，以視覺化方式呈現 Dashboard API 回傳的資料。

### F.2 啟動方式

```bash
# 內網部署（Python HTTP Server）
cd dashboard
python -m http.server 8080
# 訪問：http://{內網IP}:8080
```

### F.3 頁面結構

| 分頁 | 資料來源 | 說明 |
|------|---------|------|
| 面試排程 | `schedEvents` (type=interview) | 面試時程表 |
| 人事動態 | `onboardData` + `resignData` | 到職/離職紀錄 |
| 職缺狀況 | `jobsData`（目前空） | 職缺管理（未來） |
| 人選狀況 | `candidatesData` | 候選人列表＋詳情滑板 |
| 趨勢分析 | `monthlyTrend` + `stats` | 月統計圖表 |

### F.4 Today Bar 規格

| 區塊 | 資料邏輯 |
|------|---------|
| 今日面試 | `schedEvents` 中 `type='interview' AND date=today` |
| 今日到職 | `schedEvents` 中 `type='onboard' AND date=today` |
| 本週離職 | `schedEvents` 中 `type='resign' AND date 在本週範圍` |

### F.5 待新增的 Dashboard 視覺區塊

#### F.5.1 今日預計報到區塊

```
┌─────────────────────────────┐
│  📋 今日預計報到              │
│  ─────────────────────────  │
│  張三  軟體部  軟體工程師      │
│  李四  財務部  財務專員        │
│  （無資料時顯示「今日無報到」）  │
└─────────────────────────────┘
```

**資料邏輯**：
```javascript
const todayOnboard = onboardData.filter(
  o => o.date === today && o.status !== 'cancelled'
);
```

#### F.5.2 未來預計報到區塊

```
┌─────────────────────────────────────┐
│  📅 未來預計報到                      │
│  ──────────────────────────────── │
│  2026-06-02  王五  業務部  業務專員    │
│  2026-06-10  趙六  研發部  研發工程師  │
└─────────────────────────────────────┘
```

**資料邏輯**：
```javascript
const futureOnboard = onboardData
  .filter(o => o.date > today && o.status === 'pending')
  .sort((a, b) => a.date.localeCompare(b.date));
```

### F.6 API 呼叫設定

```javascript
// 放在 index.html 的 <script> 中
const API_URL = 'http://localhost:5678/webhook/hr-dashboard?token=$N8N_HR_TOKEN';

async function fetchData() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error('API Error');
  return res.json();
}
```

### F.7 Mini Calendar 三色圓點邏輯

| 顏色 | 代表 | 資料來源 |
|------|------|---------|
| 藍色 | 面試 | `schedEvents` type=interview |
| 綠色 | 到職 | `schedEvents` type=onboard |
| 粉色 | 離職 | `schedEvents` type=resign |

### F.8 測試（手動）

| 測試項目 | 驗證方式 |
|---------|---------|
| 今日報到區塊顯示 | 確認 `onboardData` 中有今日日期的資料，面板有對應顯示 |
| 未來報到排序正確 | 確認日期由近至遠排列 |
| 無資料顯示 fallback | 清空測試資料後確認顯示「今日無報到」 |
| 點擊人名滑出詳情 | 確認 emailLink 連結正確 |
| Mini Calendar 顏色 | 確認有面試/到職/離職的日期有對應圓點 |

---

## 模組間介面契約

### 資料流向

```
Module B / C / D
     └── 寫入 PostgreSQL
          └── Module E (Dashboard API) 查詢
               └── Module F (前端) 呈現
```

### 關鍵欄位命名統一

| 語義 | DB 欄位 | API 欄位 | 前端變數 |
|------|---------|---------|---------|
| 預計報到日 | `onboardings.expected_date` | `onboardData[].date` | `o.date` |
| 離職生效日 | `resignations.last_day` | `resignData[].lastDay` | `r.lastDay` |
| Outlook 信件連結 | `*.email_web_link` | `*.emailLink` | `item.emailLink` |

---

## 測試策略

### 各模組獨立測試方法

| 模組 | 測試方法 | 測試完成標準 |
|------|---------|------------|
| A (DB) | 執行 `hr_recruitment_pg.sql`，用 `\d` 確認 schema | 所有 table/view/index 建立無誤 |
| B (WF1) | 在 n8n 手動 trigger 一封面試信 | DB 出現對應 candidates + interviews 紀錄，email_logs 記為 inserted |
| C (WF3) | 手動 trigger 一封錄取通知、一封離職通知 | onboardings 有正確 expected_date；resignations 有正確 last_day |
| D (WF2) | 啟用 Workflow 2，執行一次後停用 | 用驗證 SQL 確認各表筆數正確，無 null 關鍵欄位 |
| E (API) | `curl` 呼叫 API，檢查 JSON 欄位 | schedEvents / onboardData / resignData 有資料且格式正確 |
| F (前端) | 瀏覽器開啟 index.html | 今日報到區塊、未來報到區塊顯示正確 |

### 整合測試流程（完整 E2E）

1. 清空測試資料（或用測試 DB）
2. 手動 trigger WF3 一封 `【耕興股份有限公司】錄取通知事宜-測試人員`，日期設為今天
3. 呼叫 Dashboard API，確認 `schedEvents` 中今天有 `type=onboard` 的事件
4. 開啟 Dashboard 前端，確認 Today Bar 的「今日到職」顯示「測試人員」
5. 再手動 trigger 一封「調整報到日期」信件（相同姓名），日期改為明天
6. 再次呼叫 API，確認 `onboardData` 中該人的 date 已更新為明天
7. 確認前端「今日到職」消失，「未來預計報到」出現該人

---

*最後更新：2026-05-25*

