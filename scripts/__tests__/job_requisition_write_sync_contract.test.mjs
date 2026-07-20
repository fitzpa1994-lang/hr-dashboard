import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const workflow = JSON.parse(
  fs.readFileSync(path.join(root, 'n8n', 'live_Job_Requisition_Write.json'), 'utf8'),
);
const nodeName = 'PG: Write job requisition';
const queries = [workflow.nodes, workflow.activeVersion?.nodes]
  .filter(Array.isArray)
  .map(nodes => nodes.find(node => node.name === nodeName)?.parameters?.query || '');

test('root and activeVersion use the same Job Requisition Write SQL', () => {
  assert.equal(queries.length, 2);
  assert.ok(queries[0]);
  assert.equal(queries[0], queries[1]);
});

test('direct 104 sync rejects incomplete envelopes and uses database claim ordering', () => {
  for (const query of queries) {
    for (const marker of [
      'external_jobs_is_array',
      'client_synced_at_valid',
      'TO_TIMESTAMP({{ typeof $json.body.syncedAt',
      'jsonb_array_length(input.external_jobs) <= 500',
      "input.external_synced_at <= NOW() + INTERVAL '5 minutes'",
      'clock_timestamp()',
      'input.scanned_count = input.source_total_count',
      'input.published_count = jsonb_array_length(input.external_jobs)',
      'input.published_count = (SELECT COUNT(*)::INTEGER FROM incoming_104)',
    ]) {
      assert.ok(query.includes(marker), `missing sync envelope marker: ${marker}`);
    }
    assert.ok(!query.includes("COALESCE(\n      NULLIF('{{ String($json.body.syncedAt"));
    assert.ok(!query.includes('LEAST(sync_request.external_synced_at, NOW())'));
  }
});

test('every accepted 104 job matches the server contract and response uses claim time', () => {
  for (const query of queries) {
    for (const field of ['externalId', 'title', 'url', 'updatedDate', 'status']) {
      assert.ok(
        query.includes(`jsonb_typeof(job_value->'${field}') = 'string'`),
        `missing JSON string validation for ${field}`,
      );
    }
    for (const marker of [
      "job_value->>'status' = 'open'",
      "external_id ~ '^[0-9]{1,32}$'",
      'CHAR_LENGTH(external_title) <= 200',
      'CHAR_LENGTH(url) <= 2048',
      "POSITION('/job/jobmaster?' IN url) > 0",
      "GREATEST(POSITION('/job/jobmaster?' IN url) - 1, 0)",
      "IN ('https://vip.104.com.tw', 'https://vip.104.com.tw:443')",
      "SUBSTRING(url FROM POSITION('?' IN url) + 1)",
      "split_part(parameter.value, '=', 1) = 'jobno'",
      'CHAR_LENGTH(source_updated_text) <= 64',
      "SELECT TO_CHAR(sync_claimed.last_complete_synced_at AT TIME ZONE 'UTC'",
    ]) {
      assert.ok(query.includes(marker), `missing per-job/response marker: ${marker}`);
    }
    assert.ok(!query.includes("TO_CHAR(input.external_synced_at AT TIME ZONE 'UTC'"));
    assert.ok(!query.includes("COALESCE(NULLIF(BTRIM(job.value->>'status'), ''), 'open')"));
  }
});
