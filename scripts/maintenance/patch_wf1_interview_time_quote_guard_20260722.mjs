import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const n8nDir = path.join(root, 'n8n');
const workflowFile = fs.readdirSync(n8nDir).find((name) => name.startsWith('live_Workflow1_') && name.endsWith('.json'));

if (!workflowFile) {
  throw new Error('Cannot find live_Workflow1 export');
}

const workflowPath = path.join(n8nDir, workflowFile);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

// --- Patch 1: 萃取基本資訊 — 抓日期/時間前先切掉轉寄/回覆信頭，避免抓到 "Sent: ... 6:48 PM" 這類引用內容 ---
const extractNode = workflow.nodes.find((node) => node.id === 'd265f169-59ed-42a6-a38c-ef5bca944e69');
if (!extractNode) throw new Error('Missing 萃取基本資訊 node');

const extractJs = String(extractNode.parameters?.jsCode || '');
const oldExtractAnchor = 'const searchText = subject + \' \' + body.substring(0, 800);';
if (!extractJs.includes(oldExtractAnchor)) {
  throw new Error('Expected anchor not found in 萃取基本資訊 node (already patched or node changed)');
}

let patchedExtractJs = extractJs;
if (!extractJs.includes('const scheduleSearchText')) {
  patchedExtractJs = extractJs.replace(
    oldExtractAnchor,
    `${oldExtractAnchor}\nconst quoteBoundaryMatch = searchText.match(/(?:^|\\s)(?:From|寄件者|寄件人)\\s*[:：]|-{3,}\\s*Original Message|_{5,}/i);\nconst scheduleSearchText = quoteBoundaryMatch ? searchText.slice(0, quoteBoundaryMatch.index) : searchText;`,
  );
  patchedExtractJs = patchedExtractJs.replace(
    /for \(const entry of datePatterns\) \{\n    const match = searchText\.match\(entry\.re\);/,
    'for (const entry of datePatterns) {\n    const match = scheduleSearchText.match(entry.re);',
  );
  patchedExtractJs = patchedExtractJs.replace(
    "const timeMatch = searchText.match(/(?:上午|下午|AM|PM|am|pm)?\\s*(\\d{1,2})[:：](\\d{2})/);",
    'const timeMatch = scheduleSearchText.match(/(?:上午|下午|AM|PM|am|pm)?\\s*(\\d{1,2})[:：](\\d{2})/);',
  );
}

if (!patchedExtractJs.includes('const scheduleSearchText')) {
  throw new Error('Failed to insert scheduleSearchText guard');
}
if (patchedExtractJs.includes('const match = searchText.match(entry.re);')) {
  throw new Error('Failed to redirect date pattern matching to scheduleSearchText');
}
if (patchedExtractJs.includes('const timeMatch = searchText.match(/(?:上午|下午|AM|PM|am|pm)?')) {
  throw new Error('Failed to redirect time pattern matching to scheduleSearchText');
}

extractNode.parameters.jsCode = patchedExtractJs;

// --- Patch 2: 整合輸出 — Claude AI 判讀結果優先於正則抓取，並加時間合理性防呆（07:00-21:00 外一律視為無效） ---
const mergeNode = workflow.nodes.find((node) => node.id === 'cb35b346-7ff3-42c8-b1ae-80a15dbd35cd');
if (!mergeNode) throw new Error('Missing 整合輸出 node');

const mergeJs = String(mergeNode.parameters?.jsCode || '');
const oldTimeLine = "const extractedTime = ns(base.interview_time || aiResult.interview_time);";
if (!mergeJs.includes(oldTimeLine)) {
  if (mergeJs.includes('const isPlausibleInterviewTime')) {
    console.log(JSON.stringify({ workflowPath, patched: 'merge-already-patched' }, null, 2));
  } else {
    throw new Error('Expected extractedTime line not found in 整合輸出 node');
  }
} else {
  const newTimeBlock = `const isPlausibleInterviewTime = (value) => {
  const match = String(value || '').match(/^(\\d{1,2}):(\\d{2})$/);
  if (!match) return false;
  const hour = Number(match[1]);
  return hour >= 7 && hour <= 21;
};
const rawExtractedTime = ns(aiResult.interview_time || base.interview_time);
const extractedTime = isPlausibleInterviewTime(rawExtractedTime) ? rawExtractedTime : 'null';`;
  mergeNode.parameters.jsCode = mergeJs.replace(oldTimeLine, newTimeBlock);
}

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({ workflowPath, patched: true }, null, 2));
