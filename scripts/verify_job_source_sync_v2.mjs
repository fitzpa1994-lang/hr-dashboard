import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const readJson = file => JSON.parse(read(file));
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function queryCopies(workflow, nodeName) {
  return [workflow.nodes, workflow.activeVersion?.nodes]
    .filter(Array.isArray)
    .map(nodes => nodes.find(node => node.name === nodeName)?.parameters?.query || '');
}

function normalizeSql(value) {
  return String(value || '').replace(/\r\n?/g, '\n');
}

function countOccurrences(value, needle) {
  return String(value || '').split(needle).length - 1;
}

const writeWorkflow = readJson('n8n/live_Job_Requisition_Write.json');
const dashboardWorkflow = readJson('n8n/live_Dashboard_API.json');
const sourceSchema = read('database/job_requisition_sources_pg.sql');
const mainSchema = read('database/hr_recruitment_pg.sql');

const writeQueries = queryCopies(writeWorkflow, 'PG: Write job requisition');
expect(writeQueries.length === 2, 'write workflow must contain root and activeVersion SQL');
expect(writeQueries[0] === writeQueries[1], 'write workflow root and activeVersion SQL must be identical');

for (const [index, query] of writeQueries.entries()) {
  const label = `write SQL copy ${index + 1}`;
  const required = [
    'sync_request AS (',
    'input.snapshot_complete',
    'input.contract_version = 2',
    'input.external_jobs_is_array',
    'jsonb_array_length(input.external_jobs) <= 500',
    'input.client_synced_at_valid',
    'TO_TIMESTAMP({{ typeof $json.body.syncedAt',
    "input.external_synced_at <= NOW() + INTERVAL '5 minutes'",
    'input.scanned_count = input.source_total_count',
    'input.published_count = jsonb_array_length(input.external_jobs)',
    'input.published_count = (SELECT COUNT(*)::INTEGER FROM incoming_104)',
    'sync_claimed AS (',
    'INSERT INTO job_requisition_source_syncs',
    'clock_timestamp()',
    'job_requisition_source_syncs.last_complete_synced_at < EXCLUDED.last_complete_synced_at',
    'CROSS JOIN sync_claimed',
    "jsonb_typeof(job_value->'externalId') = 'string'",
    "jsonb_typeof(job_value->'title') = 'string'",
    "jsonb_typeof(job_value->'url') = 'string'",
    "jsonb_typeof(job_value->'updatedDate') = 'string'",
    "jsonb_typeof(job_value->'status') = 'string'",
    "job_value->>'status' = 'open'",
    "POSITION('/job/jobmaster?' IN url) > 0",
    "IN ('https://vip.104.com.tw', 'https://vip.104.com.tw:443')",
    "split_part(parameter.value, '=', 1) = 'jobno'",
    "SELECT TO_CHAR(sync_claimed.last_complete_synced_at AT TIME ZONE 'UTC'",
    '104 snapshot provider claim was not applied',
  ];
  for (const marker of required) expect(query.includes(marker), `${label} missing ${marker}`);
  expect(
    !query.includes("COALESCE(NULLIF(BTRIM(job.value->>'status'), ''), 'open')"),
    `${label} must not default a missing job status to open`,
  );
  expect(
    !query.includes("TO_CHAR(input.external_synced_at AT TIME ZONE 'UTC'"),
    `${label} must return the claimed timestamp instead of the raw client timestamp`,
  );
  expect(
    !query.includes('LEAST(sync_request.external_synced_at, NOW())'),
    `${label} must order provider claims by database time instead of the client clock`,
  );
  expect(query.includes('$json.body.scannedCount <= 2147483647'), `${label} must int32-bound scannedCount`);
  expect(query.includes('$json.body.sourceTotalCount <= 2147483647'), `${label} must int32-bound sourceTotalCount`);
  expect(query.includes('$json.body.publishedCount <= 2147483647'), `${label} must int32-bound publishedCount`);

  const upsertStart = query.indexOf('sync_upserted AS (');
  const pendingStart = query.indexOf('sync_pending AS (');
  const linkStart = query.indexOf('link_request AS (');
  expect(upsertStart >= 0 && pendingStart > upsertStart && linkStart > pendingStart, `${label} has invalid CTE ordering`);
  const upsert = query.slice(upsertStart, pendingStart);
  const pending = query.slice(pendingStart, linkStart);
  expect(upsert.includes('CROSS JOIN sync_claimed'), `${label} upsert is not gated by the provider claim`);
  expect(!upsert.includes('input.external_synced_at'), `${label} upsert bypasses the claimed timestamp`);
  expect(pending.includes('CROSS JOIN sync_claimed'), `${label} pending transition is not gated by the provider claim`);
}

const dashboardQueries = queryCopies(dashboardWorkflow, 'PG：查詢所有儀表板資料');
expect(dashboardQueries.length === 2, 'dashboard workflow must contain root and activeVersion SQL');
expect(
  normalizeSql(dashboardQueries[0]) === normalizeSql(dashboardQueries[1]),
  'dashboard workflow root and activeVersion SQL must be identical',
);
for (const [index, query] of dashboardQueries.entries()) {
  expect(query.includes("'external104Sync'"), `dashboard SQL copy ${index + 1} missing external104Sync`);
  expect(query.includes('FROM job_requisition_source_syncs'), `dashboard SQL copy ${index + 1} missing provider metadata query`);
  expect(query.includes("'hasSnapshot', FALSE"), `dashboard SQL copy ${index + 1} missing never-synced fallback`);
  expect(query.includes("'lastSyncAt'"), `dashboard SQL copy ${index + 1} missing lastSyncAt`);
  expect(countOccurrences(query, "'external104Sync'") === 1, `dashboard SQL copy ${index + 1} must contain one external104Sync section`);
  expect(countOccurrences(query, "'external104Jobs'") === 1, `dashboard SQL copy ${index + 1} must contain one external104Jobs section`);
}

for (const [name, schema] of [['migration', sourceSchema], ['main schema', mainSchema]]) {
  expect(schema.includes('CREATE TABLE IF NOT EXISTS job_requisition_sources'), `${name} missing external job source table`);
  expect(schema.includes("CHECK (BTRIM(external_id) <> '')"), `${name} missing non-empty external id constraint`);
  expect(schema.includes("CHECK (BTRIM(external_title) <> '')"), `${name} missing non-empty external title constraint`);
  expect(schema.includes('CREATE TABLE IF NOT EXISTS job_requisition_source_syncs'), `${name} missing provider sync table`);
  expect(schema.includes('last_complete_synced_at'), `${name} missing complete snapshot timestamp`);
  expect(schema.includes('CHECK (published_count <= source_total_count)'), `${name} missing sync count constraint`);
}

if (failures.length) {
  console.error('104 sync v2 verification failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('104 sync v2 verification passed: schema + root/active write gate + dashboard metadata');
