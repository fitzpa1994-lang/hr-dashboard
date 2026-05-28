# HR 招募系統 — Vibe Coding 起始 Prompt

版本：1.0 | 日期：2026-05-26

---

## 前置條件（執行前確認）

n8n 實例必須正在運行於 `http://localhost:5678`。

---

## 主 Agent 指令（監督者）

你是監督者 Agent，運行於 Claude Code CLI。你的職責是追蹤整體進度、按序為每個未完成模塊生成子 Agent 來實作。整個過程不需要人工參與。

### 環境資訊

| 項目 | 值 |
|------|-----|
| n8n API 基礎 URL | `http://localhost:5678/api/v1` |
| n8n API Key | `<ROTATED_N8N_API_KEY>` |
| Dashboard API | `http://localhost:5678/webhook/hr-dashboard?token=$N8N_HR_TOKEN` |
| PostgreSQL | 透過 n8n Postgres account（credential ID: `NGdDfE2F1YFXGcmn`）連接 |
| Claude 模型 | `claude-haiku-4-5-20251001` |

### 已知 n8n Workflow ID 對照表

| 模塊 | 檔案 | n8n Workflow ID |
|------|------|----------------|
| B — 面試解析 | `n8n/live_Workflow1_面試解析.json` | `pqnpr72wTiOE2m8I` |
| C — 到職離職 | `n8n/live_Workflow3_到職離職.json` | `zEIwksk6hz9Ri8NA` |
| D — 歷史匯入（近30天） | `n8n/live_Workflow2_歷史匯入_近30天.json` | 執行前先呼叫 API 確認 |
| E — Dashboard API | `n8n/live_Dashboard_API.json` | 執行前先呼叫 API 確認 |

### 已知 Outlook Folder ID（Workflow 3）

| 資料夾 | Folder ID |
|--------|-----------|
| 預計報到人員（到職觸發） | `AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQAuAAAAAAATwHe72s8cTYU6NTzQdTNsAQCddaHEqpeLSJK4gY8M9T9SAAAA-bMBAAA=` |
| 已寄離職人員通知（離職觸發） | `AAMkADA2Y2U5Yzc0LTMwZjgtNGU1MS1hYWU5LTFjMjA5MDFhM2Q1OQAuAAAAAAATwHe72s8cTYU6NTzQdTNsAQDrOyTdalCqR4oTn0wwCObdAEg2qZyLAAA=` |

### 主 Agent 工作流程

**步驟 1 — 讀取進度**

讀取 `doc/tasks/progress.md`，確認各模塊當前狀態。Module A 已完成，跳過。

**步驟 2 — 取得所有 Workflow ID**

呼叫 n8n API 取得完整 workflow 列表，補全上方對照表中缺少的 ID：

```bash
curl -s -H "X-N8N-API-KEY: <ROTATED_N8N_API_KEY>" \
  http://localhost:5678/api/v1/workflows | python -m json.tool
```

**步驟 3 — 按序生成子 Agent**

依以下順序為未完成的模塊生成子 Agent（等待每個子 Agent 完成後再生成下一個）：

```
B（修 bug）→ C（重構）→ D（一次性匯入）→ E（驗證 API）→ F（前端）
```

每個子 Agent 的詳細指令見下方各節。子 Agent 完成後必須更新 `doc/tasks/progress.md`。

**步驟 4 — 最終驗證**

所有模塊完成後，執行整合測試：

```bash
# 呼叫 Dashboard API，確認回應包含所有必要欄位
curl -s "http://localhost:5678/webhook/hr-dashboard?token=$N8N_HR_TOKEN" | python -m json.tool
```

確認回應包含：`schedEvents` / `onboardData` / `resignData` / `candidatesData` / `monthlyTrend` / `stats`。

---

## 子 Agent：Module B — 修復 Workflow 1（面試信件解析）

> 讀取 `doc/tasks/module-b.md` 的完整任務清單。以下為技術規格補充。

### 上下文

- 詳細設計：`doc/detailed-design.md` → Section "Module B"
- 現有 Workflow：`n8n/live_Workflow1_面試解析.json`
- n8n Workflow ID：`pqnpr72wTiOE2m8I`

### 核心問題與修復方式

**問題（B1）**：HTTP Request 節點的 `jsonBody` expression 語法錯誤，導致 Claude API 收到空的 body，`aiResult` 為空物件。

**修復方式**：在 HTTP Request 節點之前插入一個 Code 節點（`Code：組裝 Claude Request Body`），由 Code 節點組裝完整的 request body JSON，再傳給 HTTP Request 節點的 `body` 欄位：

```javascript
// Code 節點：組裝 Claude Request Body
const item = $input.item.json;
return {
  model: "claude-haiku-4-5-20251001",
  max_tokens: 500,
  system: `你是 HR 信件解析助手，從面試信件中萃取結構化資訊，輸出純 JSON 不含多餘文字。
HR 人員：李沛晴（Peggy）、陳清彥（Yen）、黃友為（Evan）

輸出欄位：
- candidate_name: 候選人姓名（優先從主旨取，主旨無法確定才從內文找）
- applied_position: 應徵職位（找不到填「未知職位」）
- department: 部門（找不到填「未分類」）
- interview_date: YYYY-MM-DD（主管「建議約在...」代表未確認填 null；只有已確認才填）
- interview_time: HH:MM（同上規則）
- round: 第幾輪（數字，預設 1）
- location: 面試地點
- hr_owner: 負責 HR 姓名
- status: 狀態描述（待HR邀約 / 面試已安排 / 已推薦 等）
- intent: recommend|request_invite|schedule|update_time|cancel|second_schedule|other
- ai_action_item: HR 待辦一句話（無則 null）`,
  messages: [
    {
      role: "user",
      content: `主旨：${item.email_subject}\n\n${item.body_text}`
    }
  ]
};
```

**Code 節點：萃取基本資訊（B2）** 必須實作以下邏輯：

```javascript
// candidate_name 萃取規則
function extractNameFromSubject(subject) {
  // 格式1：【職位】- 姓名
  let m = subject.match(/】\s*-\s*(.{2,5})$/);
  if (m) return m[1].trim();
  // 格式2：- 姓名先生/女士
  m = subject.match(/-\s*(.{2,5})(先生|女士)/);
  if (m) return m[1].trim();
  // 格式3：】姓名先生/女士
  m = subject.match(/】\s*(.{2,5})(先生|女士)/);
  if (m) return m[1].trim();
  // fallback: 最後一個 - 後 2~5 字，非關鍵字
  const keywords = ['面試','通知','面談','人力','銀行','履歷'];
  const parts = subject.split('-');
  const last = parts[parts.length - 1].trim();
  if (last.length >= 2 && last.length <= 5 && !keywords.some(k => last.includes(k))) {
    return last;
  }
  return null;
}

// interview_date Regex（掃主旨 + body 前 800 字）
function extractDate(text) {
  const patterns = [
    /(\d{4})年(\d{1,2})月(\d{1,2})日/,
    /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
    /(\d{1,2})月(\d{1,2})日/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      if (m.length === 4) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
      const year = new Date().getFullYear();
      return `${year}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
    }
  }
  return null;
}

// interview_time Regex（覆蓋全形冒號）
function extractTime(text) {
  const m = text.match(/(\d{1,2})[：:](\d{2})/);
  return m ? `${m[1].padStart(2,'0')}:${m[2]}` : null;
}
```

**Code 節點：整合輸出（B3）** 合併優先順序 `Regex > AI > 預設值`：

```javascript
const regexResult = $('Code：萃取基本資訊').item.json;
const aiResult = JSON.parse($('HTTP Request').item.json.body?.content?.[0]?.text || '{}');
return {
  ...regexResult,
  candidate_name: regexResult.candidate_name || aiResult.candidate_name || '未知姓名',
  interview_date: regexResult.interview_date || aiResult.interview_date || null,
  interview_time: regexResult.interview_time || aiResult.interview_time || null,
  applied_position: aiResult.applied_position || '未知職位',
  department: aiResult.department || '未分類',
  round: aiResult.round || 1,
  location: aiResult.location || null,
  hr_owner: aiResult.hr_owner || null,
  status: aiResult.status || 'in_progress',
  intent: aiResult.intent || 'other',
  ai_action_item: aiResult.ai_action_item || null,
};
```

### 部署

修改 JSON 後，透過 n8n API 更新 workflow：

```bash
curl -s -X PUT \
  -H "X-N8N-API-KEY: <ROTATED_N8N_API_KEY>" \
  -H "Content-Type: application/json" \
  -d @n8n/live_Workflow1_面試解析.json \
  http://localhost:5678/api/v1/workflows/pqnpr72wTiOE2m8I
```

### 測試流程

在 workflow JSON 中**暫時加入** `manualTrigger` 節點（type: `n8n-nodes-base.manualTrigger`）作為測試入口，連接到主流程開頭，並帶入 mock 輸入資料：

```json
{
  "id": "TEST-MOCK-B-001",
  "subject": "【軟體工程師】- 張小明",
  "from": {"emailAddress": {"address": "104@example.com"}},
  "receivedDateTime": "2026-05-26T08:00:00Z",
  "body": {"content": "<p>通知您面試時間：2026年06月05日 14:00，地點：台北辦公室，HR：陳清彥</p>"},
  "webLink": "https://outlook.office.com/test-b-001"
}
```

執行測試：

```bash
curl -s -X POST \
  -H "X-N8N-API-KEY: <ROTATED_N8N_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"startNodes": ["manualTrigger"], "destinationNode": "PG：寫入 email_logs"}' \
  http://localhost:5678/api/v1/workflows/pqnpr72wTiOE2m8I/run
```

驗證 DB 結果（透過 n8n PG 節點或直接查詢）：

```sql
SELECT c.name, c.status, i.interview_date, i.intent, i.email_msg_id
FROM candidates c JOIN interviews i ON i.candidate_id = c.id
WHERE i.email_msg_id = 'TEST-MOCK-B-001';
-- 預期：name='張小明', interview_date='2026-06-05', intent 非空

SELECT action FROM email_logs WHERE email_msg_id = 'TEST-MOCK-B-001';
-- 預期：action='inserted'
```

清理測試資料：

```sql
DELETE FROM interviews WHERE email_msg_id = 'TEST-MOCK-B-001';
DELETE FROM email_logs WHERE email_msg_id = 'TEST-MOCK-B-001';
DELETE FROM candidates WHERE name = '張小明' AND source = 'Outlook即時';
```

測試通過後，移除 manualTrigger 節點，重新部署，更新 `doc/tasks/progress.md` Module B 為 ✅。

---

## 子 Agent：Module C — 重構 Workflow 3（錄取 / 離職自動匯入）

> 讀取 `doc/tasks/module-c.md` 的完整任務清單。以下為技術規格補充。

### 上下文

- 詳細設計：`doc/detailed-design.md` → Section "Module C"
- 現有 Workflow：`n8n/live_Workflow3_到職離職.json`
- n8n Workflow ID：`zEIwksk6hz9Ri8NA`
- Folder IDs 已在 JSON 中（到職 / 離職各一個觸發器），**不需要修改**

### 錄取段需確認的邏輯（C2-C7）

**Code：萃取 name_from_subject**：

```javascript
// 取主旨最後一個 - 之後的文字
const subject = $input.item.json.subject || '';
const parts = subject.split('-');
const candidate = parts[parts.length - 1].trim();
const keywords = ['錄取','通知','耕興','全球','股份','有限'];
const name_from_subject = (
  candidate.length >= 2 && candidate.length <= 5 &&
  !keywords.some(k => candidate.includes(k))
) ? candidate : null;
```

**Claude AI 系統提示重點（Onboarding）**：

```
你是 HR 信件解析助手，讀取錄取通知信件，輸出純 JSON。
HR 人員：李沛晴（Peggy）、陳清彥（Yen）、黃友為（Evan）

判斷欄位：
- intent: new_onboard | update_date | cancel | skip
- name: 優先主旨最後「-」後取，主旨無法確定才從內文找
- scheduled_onboard_date: 報到日期 YYYY-MM-DD（找「報到日期：」或「預定報到日期：」後的日期）
- department: 部門（找不到填 null）
- position: 職稱（找不到填 null）
- hr_owner: 負責 HR 姓名（找不到填 null）

規則：
1. 主旨以「RE:」開頭 → intent = skip
2. body 有「調整」「延後」「更改報到」→ intent = update_date
3. 即使主旨與第一封相同，仍需讀 body 判斷意圖
```

**離職段 Regex（C8）** 必須使用彈性空白 pattern：

```javascript
const body = rawBody.replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

const deptMatch  = body.match(/單\s*位\s*[：:]\s*([^\r\n□]+)/);
const nameMatch  = body.match(/姓\s*名\s*[：:]\s*([^\r\n□]+)/);
const titleMatch = body.match(/職\s*稱\s*[：:]\s*([^\r\n□]+)/);
const dayMatch   = body.match(/離\s*職\s*生\s*效\s*日\s*[：:]\s*([^\r\n□（(]+)/);

// 清洗日期：去除括號星期
const rawDate = dayMatch?.[1]?.trim() || '';
const parts = rawDate.split('/');
const last_day = (parts.length === 3)
  ? `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`
  : rawDate;
```

> **重要**：`name` 和 `last_day` 皆從 **body** 萃取，不從主旨取。

### 部署

```bash
curl -s -X PUT \
  -H "X-N8N-API-KEY: <ROTATED_N8N_API_KEY>" \
  -H "Content-Type: application/json" \
  -d @n8n/live_Workflow3_到職離職.json \
  http://localhost:5678/api/v1/workflows/zEIwksk6hz9Ri8NA
```

### 測試流程

**測試錄取通知（new_onboard）**：

Mock 輸入：
```json
{
  "id": "TEST-MOCK-C-ONBOARD",
  "subject": "【耕興股份有限公司】錄取通知事宜-陳小明",
  "from": {"emailAddress": {"address": "yen@sporton.com.tw"}},
  "receivedDateTime": "2026-05-26T09:00:00Z",
  "body": {"content": "報到日期：2026/06/10\n軟體部，軟體工程師"},
  "webLink": "https://outlook.office.com/test-c-onboard"
}
```

驗證：
```sql
SELECT name, expected_date, status
FROM onboardings WHERE email_msg_id = 'TEST-MOCK-C-ONBOARD';
-- 預期：name='陳小明', expected_date='2026-06-10', status='pending'
```

**測試離職通知**：

Mock body 內容：
```
□ 單       位：軟體部
□ 姓       名：王大明
□ 職       稱：軟體工程師
□ 離 職 生 效 日：2026/06/30（一）
```

驗證：
```sql
SELECT name, last_day, department
FROM resignations WHERE email_msg_id = 'TEST-MOCK-C-RESIGN';
-- 預期：name='王大明', last_day='2026-06-30', department='軟體部'
```

**測試去重（同人第二封 update_date 不增筆）**：
```sql
SELECT name, COUNT(*) FROM onboardings GROUP BY name HAVING COUNT(*) > 1;
-- 預期：0 筆
```

清理測試資料後，更新 `doc/tasks/progress.md` Module C 為 ✅。

---

## 子 Agent：Module D — 修復並執行 Workflow 2（歷史批次匯入，近30天版）

> 讀取 `doc/tasks/module-d.md` 的完整任務清單。

### 上下文

- 現有 Workflow：`n8n/live_Workflow2_歷史匯入_近30天.json`
- 此為**一次性操作**。執行完成後立即停用，不再執行。
- 預設執行「近30天版」（安全，測試用）。

### D1 — 排查 ALTER TABLE 錯誤

讀取 `n8n/live_Workflow2_歷史匯入_近30天.json`，找到所有包含 `ALTER TABLE DROP CONSTRAINT` 的 SQL 語句。

修復方式：將語法改為加上 `IF EXISTS`：

```sql
-- 原始（可能報錯）
ALTER TABLE tablename DROP CONSTRAINT constraint_name;

-- 修復後（安全）
ALTER TABLE tablename DROP CONSTRAINT IF EXISTS constraint_name;
```

若 PostgreSQL 版本不支援 `IF EXISTS`，改用以下替代方案：

```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'constraint_name'
    AND conrelid = 'tablename'::regclass
  ) THEN
    ALTER TABLE tablename DROP CONSTRAINT constraint_name;
  END IF;
END $$;
```

### D3 — 啟用、執行、停用

取得 Workflow ID：
```bash
curl -s -H "X-N8N-API-KEY: <ROTATED_N8N_API_KEY>" \
  "http://localhost:5678/api/v1/workflows?name=Workflow2" | python -m json.tool
```

啟用：
```bash
curl -s -X PATCH \
  -H "X-N8N-API-KEY: <ROTATED_N8N_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"active": true}' \
  http://localhost:5678/api/v1/workflows/{WORKFLOW_D_ID}
```

等待執行完成（觀察 execution log）：
```bash
curl -s -H "X-N8N-API-KEY: <ROTATED_N8N_API_KEY>" \
  "http://localhost:5678/api/v1/executions?workflowId={WORKFLOW_D_ID}&status=running"
```

確認無 running 執行後立即停用：
```bash
curl -s -X PATCH \
  -H "X-N8N-API-KEY: <ROTATED_N8N_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"active": false}' \
  http://localhost:5678/api/v1/workflows/{WORKFLOW_D_ID}
```

### D4 — 驗證匯入結果

透過 n8n PG 節點或 n8n 的 Execute SQL 功能驗證：

```sql
-- 候選人筆數合理（應有數十至數百筆）
SELECT COUNT(*) AS candidates_count FROM candidates;

-- 面試記錄無過多缺少日期（允許部分無法解析）
SELECT COUNT(*) AS null_date_interviews FROM interviews WHERE interview_date IS NULL;

-- 到職記錄核心欄位完整
SELECT COUNT(*) AS null_onboard_date FROM onboardings WHERE expected_date IS NULL;

-- 離職記錄核心欄位完整
SELECT COUNT(*) AS null_lastday FROM resignations WHERE last_day IS NULL;

-- email_logs error 比例應低於 10%
SELECT action, COUNT(*) FROM email_logs GROUP BY action ORDER BY action;
```

驗收標準：
- `null_onboard_date` = 0
- `null_lastday` = 0
- `error` 比例 < 10%

驗證通過後更新 `doc/tasks/progress.md` Module D 為 ✅。

---

## 子 Agent：Module E — 驗證 Dashboard API

> 讀取 `doc/tasks/module-e.md` 的完整任務清單。

### 上下文

- 現有 Workflow：`n8n/live_Dashboard_API.json`
- API 端點：`GET http://localhost:5678/webhook/hr-dashboard?token=$N8N_HR_TOKEN`

### E1 — 基本連通測試

```bash
# 正常請求，確認 HTTP 200 + JSON 格式正確
curl -s "http://localhost:5678/webhook/hr-dashboard?token=$N8N_HR_TOKEN" | python -m json.tool

# 無效 token 應回傳 403
curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:5678/webhook/hr-dashboard?token=wrong"
# 預期輸出：403
```

### E2-E7 — 欄位驗證腳本

用 Python 腳本自動驗證所有欄位：

```python
import requests
import sys
from datetime import date, timedelta

API_URL = "http://localhost:5678/webhook/hr-dashboard?token=$N8N_HR_TOKEN"
today_str = date.today().isoformat()

res = requests.get(API_URL)
assert res.status_code == 200, f"非 200 回應：{res.status_code}"
data = res.json()

errors = []

# 必要頂層欄位
required_keys = ['today', 'generatedAt', 'schedEvents', 'onboardData',
                 'resignData', 'candidatesData', 'jobsData', 'monthlyTrend', 'stats']
for k in required_keys:
    if k not in data:
        errors.append(f"缺少頂層欄位：{k}")

# schedEvents 結構
if data.get('schedEvents'):
    event = data['schedEvents'][0]
    for field in ['type', 'name', 'pos', 'dept', 'date', 'hr', 'emailLink']:
        if field not in event:
            errors.append(f"schedEvents 缺少欄位：{field}")

# onboardData 結構
if data.get('onboardData'):
    ob = data['onboardData'][0]
    for field in ['name', 'dept', 'pos', 'date', 'hr', 'status', 'emailLink']:
        if field not in ob:
            errors.append(f"onboardData 缺少欄位：{field}")

# candidatesData 含 history
if data.get('candidatesData'):
    cand = data['candidatesData'][0]
    if 'history' not in cand:
        errors.append("candidatesData 缺少 history 欄位")

# stats 8 個欄位
stats_keys = ['activeCount', 'offerCount', 'pendingOnboard', 'pendingResign',
              'monthOnboard', 'monthResign', 'hireRate', 'avgDaysToOffer']
for k in stats_keys:
    if k not in data.get('stats', {}):
        errors.append(f"stats 缺少欄位：{k}")

# monthlyTrend 近 6 個月
if len(data.get('monthlyTrend', [])) < 1:
    errors.append("monthlyTrend 為空")

if errors:
    print("❌ 驗證失敗：")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
else:
    print("✅ Dashboard API 驗證通過")
```

執行：
```bash
python scripts/validate_dashboard_api.py
```

若有欄位缺失，讀取 `n8n/live_Dashboard_API.json`，找到對應的 PostgreSQL 查詢節點，修正 SQL，然後重新部署：

```bash
curl -s -X PUT \
  -H "X-N8N-API-KEY: <ROTATED_N8N_API_KEY>" \
  -H "Content-Type: application/json" \
  -d @n8n/live_Dashboard_API.json \
  http://localhost:5678/api/v1/workflows/{WORKFLOW_E_ID}
```

重複執行驗證腳本直到全部通過，更新 `doc/tasks/progress.md` Module E 為 ✅。

---

## 子 Agent：Module F — Dashboard 前端修改 + Jest 測試

> 讀取 `doc/tasks/module-f.md` 的完整任務清單。以下為技術規格補充。

### 上下文

- 前端檔案：`dashboard/index.html`
- 目標：抽取資料邏輯到獨立 JS 模組，建立 Jest 測試環境，新增今日/未來報到區塊

### 目標目錄結構

```
dashboard/
├── index.html            # 主面板（修改 API 來源，新增報到區塊）
├── package.json          # Jest 設定
├── jest.config.cjs       # Jest 設定
└── js/
    ├── dataUtils.js      # 從 index.html 抽出的純函數資料邏輯
    └── __tests__/
        └── dataUtils.test.js
```

### F-Setup — 建立 Jest 環境

建立 `dashboard/package.json`：

```json
{
  "name": "hr-dashboard",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "node --experimental-vm-modules node_modules/.bin/jest"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "@jest/globals": "^29.7.0"
  }
}
```

建立 `dashboard/jest.config.cjs`：

```javascript
module.exports = {
  testEnvironment: 'node',
  transform: {},
  extensionsToTreatAsEsm: ['.js'],
};
```

安裝：

```bash
cd dashboard && npm install
```

### F1 — 切換 API 資料來源

在 `index.html` 找到靜態假資料區塊，替換為：

```javascript
const API_URL = 'http://localhost:5678/webhook/hr-dashboard?token=$N8N_HR_TOKEN';

async function fetchData() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`API Error: ${res.status}`);
  return res.json();
}

async function init() {
  try {
    const data = await fetchData();
    renderAll(data);
  } catch (e) {
    console.error('資料載入失敗', e);
  }
}
```

### F2-F3 — 抽取資料邏輯到 `dashboard/js/dataUtils.js`

```javascript
// dashboard/js/dataUtils.js

export function getTodayOnboard(onboardData, today) {
  return onboardData.filter(o => o.date === today && o.status !== 'cancelled');
}

export function getFutureOnboard(onboardData, today) {
  return onboardData
    .filter(o => o.date > today && o.status === 'pending')
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getTodayInterviews(schedEvents, today) {
  return schedEvents.filter(e => e.type === 'interview' && e.date === today);
}

export function getWeekResigns(schedEvents, weekStart, weekEnd) {
  return schedEvents.filter(
    e => e.type === 'resign' && e.date >= weekStart && e.date <= weekEnd
  );
}

export function getCalendarDots(schedEvents) {
  const dots = {};
  for (const e of schedEvents) {
    if (!dots[e.date]) dots[e.date] = new Set();
    dots[e.date].add(e.type);
  }
  return dots;
}
```

### F2-F3 — 測試 `dashboard/js/__tests__/dataUtils.test.js`

```javascript
import { describe, test, expect } from '@jest/globals';
import {
  getTodayOnboard,
  getFutureOnboard,
  getTodayInterviews,
  getWeekResigns,
  getCalendarDots,
} from '../dataUtils.js';

const TODAY = '2026-05-26';

describe('getTodayOnboard', () => {
  test('只回傳今天且非 cancelled 的報到', () => {
    const data = [
      { date: TODAY, status: 'pending', name: '張三' },
      { date: '2026-05-27', status: 'pending', name: '李四' },
      { date: TODAY, status: 'cancelled', name: '王五' },
      { date: TODAY, status: 'onboarded', name: '趙六' },
    ];
    const result = getTodayOnboard(data, TODAY);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.name)).toEqual(['張三', '趙六']);
  });

  test('無資料時回傳空陣列', () => {
    expect(getTodayOnboard([], TODAY)).toEqual([]);
  });
});

describe('getFutureOnboard', () => {
  test('回傳未來 pending 報到，按日期排序', () => {
    const data = [
      { date: '2026-06-10', status: 'pending', name: '乙' },
      { date: '2026-06-01', status: 'pending', name: '甲' },
      { date: TODAY, status: 'pending', name: '丙' },
      { date: '2026-06-05', status: 'cancelled', name: '丁' },
    ];
    const result = getFutureOnboard(data, TODAY);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('甲');
    expect(result[1].name).toBe('乙');
  });
});

describe('getTodayInterviews', () => {
  test('只回傳今天的面試事件', () => {
    const events = [
      { type: 'interview', date: TODAY, name: 'A' },
      { type: 'onboard', date: TODAY, name: 'B' },
      { type: 'interview', date: '2026-05-27', name: 'C' },
    ];
    const result = getTodayInterviews(events, TODAY);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('A');
  });
});

describe('getCalendarDots', () => {
  test('同一天多種事件各有對應顏色 key', () => {
    const events = [
      { type: 'interview', date: TODAY },
      { type: 'onboard', date: TODAY },
      { type: 'resign', date: '2026-05-27' },
    ];
    const dots = getCalendarDots(events);
    expect(dots[TODAY]).toContain('interview');
    expect(dots[TODAY]).toContain('onboard');
    expect(dots['2026-05-27']).toContain('resign');
  });
});
```

### F4-F7 — 更新 index.html

按 `doc/tasks/module-f.md` 的任務清單（F4~F7）逐一完成：

- **F4**：Today Bar 改為從 `schedEvents` 讀取
- **F5**：Mini Calendar 三色圓點改為從 `getCalendarDots()` 渲染
- **F6**：各分頁資料綁定改為從 API 回傳值渲染
- **F7**：詳情滑板確認 `emailLink` / `resumeLink` / `history` 正確綁定

新增「今日預計報到」區塊（HTML）：

```html
<section id="today-onboard">
  <h3>📋 今日預計報到</h3>
  <div id="today-onboard-list"></div>
</section>
```

對應 JS（在 `renderAll(data)` 中呼叫）：

```javascript
function renderTodayOnboard(onboardData, today) {
  const list = document.getElementById('today-onboard-list');
  const items = getTodayOnboard(onboardData, today);
  list.innerHTML = items.length
    ? items.map(o => `<div>${o.name} ｜ ${o.dept} ｜ ${o.pos}</div>`).join('')
    : '<div class="empty">今日無報到</div>';
}
```

新增「未來預計報到」區塊（HTML）：

```html
<section id="future-onboard">
  <h3>📅 未來預計報到</h3>
  <div id="future-onboard-list"></div>
</section>
```

對應 JS：

```javascript
function renderFutureOnboard(onboardData, today) {
  const list = document.getElementById('future-onboard-list');
  const items = getFutureOnboard(onboardData, today);
  list.innerHTML = items.length
    ? items.map(o => `<div>${o.date} ｜ ${o.name} ｜ ${o.dept} ｜ ${o.pos}</div>`).join('')
    : '<div class="empty">暫無未來報到資料</div>';
}
```

### 執行測試

```bash
cd dashboard && npm test
```

所有測試必須通過（0 failures）。

完成後更新 `doc/tasks/progress.md` Module F 為 ✅。

---

## 整合測試（所有模塊完成後由主 Agent 執行）

依 `doc/detailed-design.md` → Section "整合測試流程（E2E）" 逐步執行：

1. 呼叫 Dashboard API，確認所有欄位存在且格式正確
2. 手動 trigger Workflow 3 一封錄取通知（日期設為今天）
3. 呼叫 API，確認 `schedEvents` 中今天有 `type=onboard` 事件
4. 再 trigger 一封「調整報到日期」（同人，日期改為明天）
5. 再次呼叫 API，確認 `onboardData` 中該人 date 已更新為明天
6. 確認前端面板「今日到職」消失，「未來預計報到」出現該人

整合測試通過後，在 `doc/tasks/progress.md` 補充最終狀態報告。


