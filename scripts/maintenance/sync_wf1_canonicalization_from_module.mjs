// 把 dashboard/js/onboardingCanonicalization.js（唯一真相來源）的正規化函式
// 重新轉換並注入本地 Workflow1 快照的「Code：整合輸出」jsCode。
// 對照表改動後執行本腳本 → npm test → deploy → pull:n8n → commit，三邊
// （模組本身、Workflow3、Workflow1）即保持同步。
//
// 假設：WF1「Code：整合輸出」已完成過一次初次移植（2026-07-20 commit bd18a10 起）；
// 本腳本只負責之後重新整理正規化函式本體，不處理「尚未移植過」的初次移植。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'n8n', 'live_Workflow1_面試解析.json');
const wf = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const moduleText = fs.readFileSync(path.join(ROOT, 'dashboard', 'js', 'onboardingCanonicalization.js'), 'utf8');
let fnBlock = moduleText
  .replace(/export function canonicalizeOnboardingMatch[\s\S]*$/, '')
  .replace(/export /g, '')
  .replace(/canonicalizeOnboardingDepartment/g, 'canonicalizeDepartment')
  .replace(/canonicalizeOnboardingPosition/g, 'canonicalizePosition')
  .trim();
if (/export|canonicalizeOnboarding/.test(fnBlock)) throw new Error('模組轉換不完整');

const node = wf.nodes.find((n) => n.name === 'Code：整合輸出');
if (!node) throw new Error('找不到節點 Code：整合輸出');
const code = node.parameters.jsCode;

const start = code.indexOf('function normalizeText(');
const end = code.indexOf(`const base = $('Code：萃取基本資訊').item.json;`);
if (start < 0 || end < 0 || end <= start) throw new Error('找不到正規化區段錨點（可能尚未完成初次移植，見檔頭註解）');

node.parameters.jsCode = code.slice(0, start) + fnBlock + '\n\n' + code.slice(end);
if (/�|\?\?\?/.test(node.parameters.jsCode)) throw new Error('新 jsCode 含亂碼嫌疑字元');
for (const marker of ['canonicalizeDepartment', 'canonicalizePosition', 'match_position']) {
  if (!node.parameters.jsCode.includes(marker)) throw new Error(`新 jsCode 缺少 ${marker}`);
}

fs.writeFileSync(FILE, JSON.stringify(wf, null, 2) + '\n');
console.log(`已同步正規化區段（jsCode 現為 ${node.parameters.jsCode.split('\n').length} 行）`);
