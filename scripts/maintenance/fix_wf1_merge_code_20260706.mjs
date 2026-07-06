// 修復 Workflow1「Code：整合輸出」：以 git fa1314f 的乾淨 111 行版本取代
// 損壞的 221 行版（整段重複＋regex 反斜線被剝除 → 每封面試信 SyntaxError）。
// 同時為 WF1/WF3 的 Claude HTTP 節點加上 retryOnFail（治 Anthropic Overloaded 暫時性失敗）。
// 用法：先 `git show fa1314f:n8n/live_Workflow1_面試解析.json > tmp_wf1_old.json` 再執行本腳本。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

// --- 1) WF1 整合輸出還原 ---
const clean = JSON.parse(fs.readFileSync(path.join(ROOT, 'tmp_wf1_old.json'), 'utf8'));
const cleanCode = clean.nodes.find((n) => n.name === 'Code：整合輸出').parameters.jsCode;
if ((cleanCode.match(/const base/g) || []).length !== 1) throw new Error('乾淨版驗證失敗：const base 應恰一次');
if (!cleanCode.includes('[\\s\\S]')) throw new Error('乾淨版驗證失敗：regex 反斜線不完整');

const wf1Path = path.join(ROOT, 'n8n', 'live_Workflow1_面試解析.json');
const wf1 = JSON.parse(fs.readFileSync(wf1Path, 'utf8'));
const merge = wf1.nodes.find((n) => n.name === 'Code：整合輸出');
const before = merge.parameters.jsCode.split('\n').length;
merge.parameters.jsCode = cleanCode;
console.log(`WF1 整合輸出：${before} 行 → ${cleanCode.split('\n').length} 行（乾淨版）`);

// --- 2) Claude 節點 retryOnFail ---
function addRetry(wf, nodeName, label) {
  const node = wf.nodes.find((n) => n.name === nodeName);
  if (!node) throw new Error(`${label} 找不到節點：${nodeName}`);
  node.retryOnFail = true;
  node.maxTries = 3;
  node.waitBetweenTries = 5000;
  console.log(`${label}「${nodeName}」已設 retryOnFail=true, maxTries=3, wait=5s`);
}
addRetry(wf1, 'Claude：AI 解析意圖', 'WF1');
fs.writeFileSync(wf1Path, JSON.stringify(wf1, null, 2) + '\n');

const wf3Path = path.join(ROOT, 'n8n', 'live_Workflow3_到職離職.json');
const wf3 = JSON.parse(fs.readFileSync(wf3Path, 'utf8'));
addRetry(wf3, 'Claude：解析 Onboarding 意圖', 'WF3');
fs.writeFileSync(wf3Path, JSON.stringify(wf3, null, 2) + '\n');

console.log('本地快照已更新，請接著 validate → deploy → pull → test');
