// 加固本地 Workflow3 快照：
// 1) merge jsCode 加 guardOnboardYear()（信件年份錯字校正）
// 2) PG 寫入 onboardings 加 NOT EXISTS 防重複插入（同名 ±60 天內已有非取消記錄）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'n8n', 'live_Workflow3_到職離職.json');
const wf = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// --- 1) 年份防呆 ---
const merge = wf.nodes.find((n) => n.name === 'Code：整合 Onboarding 輸出');
let code = merge.parameters.jsCode;
if (code.includes('guardOnboardYear')) throw new Error('jsCode 已含年份防呆');
const guardFn = `function guardOnboardYear(dateStr, receivedAt) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  if (!m) return dateStr;
  const receivedYear = new Date(receivedAt || Date.now()).getFullYear();
  let year = Number(m[1]);
  if (year < receivedYear) year = receivedYear;
  if (year > receivedYear + 1) year = receivedYear + 1;
  return year + '-' + m[2] + '-' + m[3];
}

return {`;
if (!code.includes('return {')) throw new Error('找不到 return 區塊');
code = code.replace('return {', guardFn);
const oldField = 'scheduled_onboard_date: regexDate || aiResult.scheduled_onboard_date || null,';
if (!code.includes(oldField)) throw new Error('找不到 scheduled_onboard_date 欄位');
code = code.replace(oldField,
  'scheduled_onboard_date: guardOnboardYear(regexDate || aiResult.scheduled_onboard_date || null, base.received_at),');
merge.parameters.jsCode = code;

// --- 2) 防重複插入 ---
const pg = wf.nodes.find((n) => n.name === 'PG：寫入 onboardings');
let q = pg.parameters.query;
if (q.includes('NOT EXISTS')) throw new Error('query 已含防重複');
const anchor = '\n  ON CONFLICT (email_msg_id) DO NOTHING';
if (!q.includes(anchor)) throw new Error('找不到 ON CONFLICT 錨點');
const guardSql = `
  WHERE NOT EXISTS (
    SELECT 1 FROM onboardings ob
    WHERE ob.name = '{{ ($json.name || '').replace(/'/g, "''") }}'
      AND ob.status <> 'cancelled'
      AND ob.expected_date BETWEEN COALESCE(NULLIF('{{ $json.scheduled_onboard_date || '' }}', '')::DATE, CURRENT_DATE) - 60
                               AND COALESCE(NULLIF('{{ $json.scheduled_onboard_date || '' }}', '')::DATE, CURRENT_DATE) + 60
  )`;
q = q.replace(anchor, `${guardSql}${anchor}`);
pg.parameters.query = q;

fs.writeFileSync(FILE, JSON.stringify(wf, null, 2) + '\n');
console.log('本地快照已加固：');
console.log('  • merge jsCode：' + merge.parameters.jsCode.split('\n').length + ' 行（含 guardOnboardYear）');
console.log('  • PG query：' + q.split('\n').length + ' 行（含 NOT EXISTS 防重複）');
