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

const mergeNodes = workflow.nodes.filter((node) => node.id === 'cb35b346-7ff3-42c8-b1ae-80a15dbd35cd');
if (!mergeNodes.length) {
  throw new Error('Missing merge node in Workflow1 export');
}

const replacement = String.raw`const extractedDate = ns(base.interview_date || aiResult.interview_date);
const extractedTime = ns(base.interview_time || aiResult.interview_time);
const receivedYear = Number(String(base.received_at || '').slice(0, 4)) || null;
const normalizeInterviewDateYear = (value) => {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !receivedYear) return value;
  const parsedYear = Number(text.slice(0, 4));
  if (!Number.isFinite(parsedYear)) return value;
  if (parsedYear >= receivedYear - 1) return value;
  return String(receivedYear) + text.slice(4);
};
const normalizedExtractedDate = normalizeInterviewDateYear(extractedDate);
const hasConcreteSchedule = normalizedExtractedDate !== 'null' && extractedTime !== 'null' && !base.has_tentative_scheduling;`;

let patchedCount = 0;
for (const mergeNode of mergeNodes) {
  const js = String(mergeNode.parameters?.jsCode || '');
  if (!js.includes('const extractedDate = ns(base.interview_date || aiResult.interview_date);')) {
    throw new Error(`Expected merge snippet not found in node ${mergeNode.id}`);
  }
  if (js.includes('const normalizeInterviewDateYear =')) {
    continue;
  }

  let updated = js.replace(
    /const extractedDate = ns\(base\.interview_date \|\| aiResult\.interview_date\);\nconst extractedTime = ns\(base\.interview_time \|\| aiResult\.interview_time\);\nconst hasConcreteSchedule = extractedDate !== 'null' && extractedTime !== 'null' && !base\.has_tentative_scheduling;/,
    replacement,
  );

  updated = updated.replace(
    /: extractedDate;/g,
    ': normalizedExtractedDate;'
  );

  mergeNode.parameters.jsCode = updated;
  patchedCount += 1;
}

if (!patchedCount) {
  console.log(JSON.stringify({ workflowPath, patched: false, reason: 'already-patched' }, null, 2));
  process.exit(0);
}

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({ workflowPath, patched: true, patchedCount }, null, 2));
