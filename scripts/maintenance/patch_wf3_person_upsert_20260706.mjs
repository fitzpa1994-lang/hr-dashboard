// 對本地 Workflow3 快照的「PG：寫入 onboardings」加入人員層級 upsert：
// 同名 pending 記錄若收到帶新日期的【新進人員通知】，自動更新報到日/部門/職位
// （情境：馮堿呈類「報到日待定」佔位列，正式通知信到達時自動補正日期）。
// 與既有 NOT EXISTS 防重複、ON CONFLICT 去重並存；重播同一封信為 no-op。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'n8n', 'live_Workflow3_到職離職.json');
const wf = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const pg = wf.nodes.find((n) => n.name === 'PG：寫入 onboardings');
let q = pg.parameters.query;
if (q.includes('-- person-upsert')) throw new Error('query 已含人員 upsert');
if (!q.startsWith('=')) {
  // n8n expression 字串以 = 開頭；若無則直接於最前插入
}
const marker = 'WITH inserted AS (';
const idx = q.indexOf(marker);
if (idx < 0) throw new Error('找不到 WITH inserted 錨點');

const dateExpr = `NULLIF('{{ $json.scheduled_onboard_date || '' }}', '')::DATE`;
const upsert = `-- person-upsert：同名 pending 收到帶新日期的新進人員通知時更新既有列
UPDATE onboardings ob SET
  expected_date = ${dateExpr},
  department = COALESCE(NULLIF('{{ ($json.department || '').replace(/'/g, "''") }}', ''), ob.department),
  position = COALESCE(NULLIF('{{ ($json.position || '').replace(/'/g, "''") }}', ''), ob.position),
  updated_at = NOW()
WHERE '{{ ($json.email_subject || '').replace(/'/g, "''") }}' LIKE '%新進人員通知%'
  AND NULLIF('{{ $json.scheduled_onboard_date || '' }}', '') IS NOT NULL
  AND ob.name = '{{ ($json.name || '').replace(/'/g, "''") }}'
  AND ob.status = 'pending'
  AND ob.email_msg_id <> '{{ $json.email_msg_id || '' }}'
  AND ob.expected_date IS DISTINCT FROM ${dateExpr}
  AND ob.expected_date BETWEEN ${dateExpr} - 60 AND ${dateExpr} + 60;

`;
q = q.slice(0, idx) + upsert + q.slice(idx);
pg.parameters.query = q;

fs.writeFileSync(FILE, JSON.stringify(wf, null, 2) + '\n');
console.log(`已加入人員 upsert（query 現為 ${q.split('\n').length} 行）`);
