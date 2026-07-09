import fs from 'fs';

const file = 'n8n/live_Workflow1_面試解析.json';
const content = fs.readFileSync(file, 'utf8');

// Extract OLD by finding its exact boundaries in the file
const i1 = content.indexOf('const aiDepartment = ns(aiResult.department)');
const i2 = content.indexOf('const forcePendingScheduling');
const OLD = content.substring(i1, i2);

console.log('OLD length:', OLD.length);
console.log('OLD (JSON):', JSON.stringify(OLD));

// Build NEW: same aiDepartment line, then deptFromSubject, then department
// Using \\n in the string to produce literal \n (two chars) in the file,
// matching the existing format where \n = JSON escape for actual newline in JS code
const NL = '\\n'; // This string is: backslash + n (two chars = what's in the file)
const NEW = [
  "const aiDepartment = ns(aiResult.department) !== 'null' ? aiResult.department : null;",
  NL + "// Subject is the highest priority signal for department",
  NL + "const deptFromSubject =",
  NL + "  /新竹/.test(subjectText) ? '新竹' :",
  NL + "  /新華/.test(subjectText) ? '新華' :",
  NL + "  /安規|電池/.test(subjectText) ? '安規' :",
  NL + "  /ICC/.test(subjectText) ? 'ICC' :",
  NL + "  /WBU|SAR/.test(subjectText) ? 'WBU' :",
  NL + "  /行政|董事長室|財務|資訊部|MIS/.test(subjectText) ? '行政' :",
  NL + "  null;",
  NL + "const department =",
  NL + "  deptFromSubject",
  NL + "  || (!isWeakDepartment(aiDepartment) ? aiDepartment : null)",
  NL + "  || inferredDepartment",
  NL + "  || '未分類';",
  NL + NL,
].join('');

console.log('\nNEW (JSON):', JSON.stringify(NEW));
console.log('\nVerify OLD exists:', content.includes(OLD));

const newContent = content.split(OLD).join(NEW);
const replaceCount = content.split(OLD).length - 1;
console.log('Replacements made:', replaceCount);

// Verify JSON still valid
try {
  JSON.parse(newContent);
  console.log('JSON valid: YES');
} catch (e) {
  console.error('JSON INVALID:', e.message);
  process.exit(1);
}

fs.writeFileSync(file, newContent, 'utf8');
console.log('File written successfully.');
