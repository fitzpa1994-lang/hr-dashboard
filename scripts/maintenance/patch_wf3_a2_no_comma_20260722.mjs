// 修正「Code：萃取單位離職預通知」節點的 Pattern A2 正則：
// 舊版要求姓名後一定要有「，」才能接「(預計)於{date}」，
// 但「【離職人員通知】五部 SAR 工程部：{姓名}  於{date}離職」這類無逗號的主旨會整段比對失敗，
// 導致 fallback 抓不到姓名/職稱，最終把整封信原文寫入 name/position（見 resignations id=167,168）。
// 新正則讓「，」變成可選，姓名改用非貪婪擷取，同時相容有逗號／無逗號兩種主旨格式。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workflowPath = process.argv[2] || path.join(process.cwd(), 'n8n', 'live_Workflow3_到職離職.json');

const OLD_LINE = "  const sm = subject.match(/【離職人員通知】(.*?)[：:]\\s*([^，,]+)，.*?(?:預計於|於)\\s*([0-9/]+)/);";
const NEW_LINE = "  const sm = subject.match(/【離職人員通知】(.*?)[：:]\\s*([^，,]+?)\\s*[，,]?\\s*(?:預計)?於\\s*([0-9]{2,4}\\/[0-9]{1,2}\\/[0-9]{1,2})/);";

const raw = fs.readFileSync(workflowPath, 'utf8');
const workflow = JSON.parse(raw);

function patchNodeList(nodes, label) {
  let touched = 0;
  for (const node of nodes ?? []) {
    if (node.name !== 'Code：萃取單位離職預通知') continue;
    const code = node.parameters?.jsCode;
    if (typeof code !== 'string') continue;
    if (!code.includes(OLD_LINE)) {
      if (code.includes(NEW_LINE)) { touched += 1; continue; }
      throw new Error(`${label}: OLD_LINE not found verbatim in node jsCode — aborting to avoid corrupting the script`);
    }
    node.parameters.jsCode = code.replace(OLD_LINE, NEW_LINE);
    touched += 1;
  }
  return touched;
}

let touched = patchNodeList(workflow.nodes, 'nodes');
if (workflow.activeVersion?.nodes) {
  touched += patchNodeList(workflow.activeVersion.nodes, 'activeVersion.nodes');
}

if (!touched) {
  throw new Error('No matching node/jsCode found in local workflow export');
}

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ workflowPath, touched }, null, 2));
