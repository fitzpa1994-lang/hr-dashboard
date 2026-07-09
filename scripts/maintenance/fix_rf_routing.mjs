import fs from 'fs';

const file = 'n8n/live_Workflow1_面試解析.json';
const content = fs.readFileSync(file, 'utf8');

// Fix 1: RF routing - remove recipient_top_department_hint = 'WBU' requirement
// Old: WHEN lower(raw_position) LIKE '%rf測試工程師%' AND recipient_top_department_hint = 'WBU' THEN 25
// New: WHEN lower(raw_position) LIKE '%rf測試工程師%' THEN 25
// (RF測試工程師 is specific enough; headhunter emails come via ICC routing hence hint=ICC)

const OLD_RF = "WHEN lower(raw_position) LIKE '%rf測試工程師%' AND recipient_top_department_hint = 'WBU' THEN 25";
const NEW_RF = "WHEN lower(raw_position) LIKE '%rf測試工程師%' THEN 25";

// These appear as JSON-escaped strings inside the file
const NL = '\\n';
const oldInFile = OLD_RF;
const newInFile = NEW_RF;

if (!content.includes(oldInFile)) {
  console.error('ERROR: Could not find target string in file.');
  console.error('Looking for:', oldInFile);
  // Try to show context
  const idx = content.indexOf('rf測試工程師');
  if (idx >= 0) {
    console.log('Found rf測試工程師 at index', idx);
    console.log('Context:', JSON.stringify(content.substring(idx - 50, idx + 120)));
  }
  process.exit(1);
}

const count = content.split(oldInFile).length - 1;
console.log(`Found ${count} occurrence(s) of target string.`);

const newContent = content.split(oldInFile).join(newInFile);

// Validate JSON
try {
  JSON.parse(newContent);
  console.log('JSON valid: YES');
} catch (e) {
  console.error('JSON INVALID:', e.message);
  process.exit(1);
}

fs.writeFileSync(file, newContent, 'utf8');
console.log('File written. RF routing fix applied.');
