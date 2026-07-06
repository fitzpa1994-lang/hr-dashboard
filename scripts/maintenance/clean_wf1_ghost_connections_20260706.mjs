// 清除 Workflow1 connections 中 7/2 事故遺留的幽靈鍵：
// 來源鍵或目標名稱不存在於節點清單者（latin-1 亂碼殘骸，n8n 會忽略但屬垃圾）。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'n8n', 'live_Workflow1_面試解析.json');
const wf = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const names = new Set(wf.nodes.map((n) => n.name));

const cleaned = {};
let removedKeys = 0;
let removedTargets = 0;
for (const [src, outputs] of Object.entries(wf.connections || {})) {
  if (!names.has(src)) {
    removedKeys += 1;
    console.log(`移除幽靈來源鍵: ${JSON.stringify(src).slice(0, 80)}`);
    continue;
  }
  const kept = {};
  for (const [type, groups] of Object.entries(outputs || {})) {
    kept[type] = groups.map((g) => (g || []).filter((c) => {
      if (names.has(c.node)) return true;
      removedTargets += 1;
      console.log(`移除幽靈目標: ${src} → ${JSON.stringify(c.node).slice(0, 60)}`);
      return false;
    }));
  }
  cleaned[src] = kept;
}
wf.connections = cleaned;
fs.writeFileSync(FILE, JSON.stringify(wf, null, 2) + '\n');
console.log(`完成：移除 ${removedKeys} 個幽靈來源鍵、${removedTargets} 個幽靈目標`);
