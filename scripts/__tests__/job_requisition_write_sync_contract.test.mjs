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

function countOccurrences(value, needle) {
  return String(value || '').split(needle).length - 1;
}

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

test('104 priority updates are atomic, bounded, and return the stable response contract', () => {
  for (const query of queries) {
    for (const marker of [
      "input.action = 'update_104_job_priorities'",
      'priority_updates_raw AS (',
      'priority_updates AS (',
      'priority_request AS (',
      'priority_updated AS (',
      'jsonb_array_length(input.external_jobs) <= 500',
      'COUNT(DISTINCT external_id)',
      "priority_level_text ~ '^[1-3]$'",
      "display_order_text ~ '^(0|[1-9][0-9]{0,9})$'",
      "source_row.source = '104'",
      'WHERE priority_request.is_valid',
      "'priorityUpdate', json_build_object(",
      "'updated', (SELECT COUNT(*)::INTEGER FROM priority_updated)",
    ]) {
      assert.ok(query.includes(marker), `missing priority update marker: ${marker}`);
    }

    for (const marker of [
      'priority_updates_raw AS (',
      'priority_updates AS (',
      'priority_request AS (',
      'priority_updated AS (',
      'link_request AS (',
      'validated_link AS (',
      'external_linked AS (',
      'END AS data',
    ]) {
      assert.equal(countOccurrences(query, marker), 1, `${marker} must occur exactly once`);
    }
    assert.ok(query.length > 20_000 && query.length < 26_000, `unexpected write SQL length: ${query.length}`);
    const externalIdRegexLines = query.split('\n').filter(line => line.includes("external_id ~ '"));
    assert.equal(externalIdRegexLines.length, 2);
    assert.ok(externalIdRegexLines.every(line => line.trimEnd().endsWith("$'")), 'external id regex must be complete');

    const syncPendingStart = query.indexOf('sync_pending AS (');
    const priorityStart = query.indexOf('priority_updates_raw AS (');
    const linkStart = query.indexOf('link_request AS (');
    assert.ok(syncPendingStart < priorityStart && priorityStart < linkStart, 'priority CTEs must sit between sync and link CTEs');

    const upsert = query.slice(
      query.indexOf('sync_upserted AS ('),
      query.indexOf('sync_pending AS ('),
    );
    assert.ok(!upsert.includes('priority_level'), '104 sync must preserve saved priority_level');
    assert.ok(!upsert.includes('display_order'), '104 sync must preserve saved display_order');
  }
});
