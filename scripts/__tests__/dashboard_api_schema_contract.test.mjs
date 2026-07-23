import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = JSON.parse(
  fs.readFileSync(path.join(root, 'n8n', 'live_Dashboard_API.json'), 'utf8'),
);
const schema = fs.readFileSync(path.join(root, 'database', 'hr_recruitment_pg.sql'), 'utf8');

function dashboardQuery(nodes) {
  return nodes.find(
    (node) => typeof node.parameters?.query === 'string'
      && node.parameters.query.includes('WITH candidate_enriched AS'),
  )?.parameters.query;
}

test('Dashboard API root and active queries stay read-only and identical', () => {
  const rootQuery = dashboardQuery(workflow.nodes);
  const activeQuery = dashboardQuery(workflow.activeVersion?.nodes ?? []);

  assert.equal(typeof rootQuery, 'string');
  assert.equal(activeQuery, rootQuery);
  assert.match(rootQuery.trimStart(), /^SET LOCAL timezone = 'Asia\/Taipei';/);
  assert.doesNotMatch(rootQuery, /\b(?:ALTER|CREATE|DROP)\s+(?:TABLE|INDEX|CONSTRAINT)\b/i);
});

test('deployment schema owns legacy candidate and onboarding upgrades', () => {
  const columnMigration = schema.indexOf('ADD COLUMN IF NOT EXISTS job_requisition_id INTEGER');
  const candidateIndex = schema.indexOf('CREATE INDEX IF NOT EXISTS idx_candidates_job_requisition');

  assert.notEqual(columnMigration, -1);
  assert.ok(candidateIndex > columnMigration, 'candidate column migration must precede its index');
  assert.match(schema, /candidates_status_check[\s\S]*?dept_scheduling/);
  assert.match(schema, /onboardings_status_check[\s\S]*?no_show/);
  assert.match(schema, /pg_get_constraintdef\(oid\)/);
});
