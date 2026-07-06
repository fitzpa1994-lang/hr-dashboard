// 把 dashboard/js/onboardingCanonicalization.js（唯一真相來源）的正規化函式
// 重新轉換並注入本地 Workflow3 快照的「Code：整合 Onboarding 輸出」jsCode。
// 對照表改動後執行本腳本 → npm test → deploy → pull:n8n → commit，兩邊即保持同步。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'n8n', 'live_Workflow3_到職離職.json');
const wf = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const moduleText = fs.readFileSync(path.join(ROOT, 'dashboard', 'js', 'onboardingCanonicalization.js'), 'utf8');
let fnBlock = moduleText
  .replace(/export function canonicalizeOnboardingMatch[\s\S]*$/, '')
  .replace(/export /g, '')
  .replace(/canonicalizeOnboardingDepartment/g, 'canonicalizeDepartment')
  .replace(/canonicalizeOnboardingPosition/g, 'canonicalizePosition')
  .trim();
if (/export|canonicalizeOnboarding/.test(fnBlock)) throw new Error('模組轉換不完整');

const merge = wf.nodes.find((n) => n.name === 'Code：整合 Onboarding 輸出');
const code = merge.parameters.jsCode;
const start = code.indexOf('function normalizeText(');
const end = code.indexOf('const rawDepartment = aiResult.department');
if (start < 0 || end < 0 || end <= start) throw new Error('找不到正規化區段錨點');

merge.parameters.jsCode = code.slice(0, start) + fnBlock + '\n\n' + code.slice(end);
if (/�|\?\?\?/.test(merge.parameters.jsCode)) throw new Error('新 jsCode 含亂碼嫌疑字元');
for (const marker of ['canonicalizeDepartment', 'canonicalizePosition', 'raw_department']) {
  if (!merge.parameters.jsCode.includes(marker)) throw new Error(`新 jsCode 缺少 ${marker}`);
}

fs.writeFileSync(FILE, JSON.stringify(wf, null, 2) + '\n');
console.log(`已同步正規化區段（jsCode 現為 ${merge.parameters.jsCode.split('\n').length} 行）`);
