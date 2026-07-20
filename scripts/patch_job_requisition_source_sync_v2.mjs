import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workflowPath = path.join(root, 'n8n', 'live_Job_Requisition_Write.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const nodeName = 'PG: Write job requisition';

function replaceOnce(text, needle, replacement, label) {
  const count = text.split(needle).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  // Use a function replacement so SQL regex fragments ending in `$'` are not
  // interpreted as JavaScript String.replace substitution tokens.
  return text.replace(needle, () => replacement);
}

function useClaimTimestamp(query) {
  const oldSelect = `    incoming_104.source_updated_text,
    'open',
    input.external_synced_at,
    input.external_synced_at,
    input.external_synced_at,
`;
  if (!query.includes(oldSelect)) return query;
  return replaceOnce(
    query,
    oldSelect,
    `    incoming_104.source_updated_text,
    'open',
    sync_claimed.last_complete_synced_at,
    sync_claimed.last_complete_synced_at,
    sync_claimed.last_complete_synced_at,
`,
    'use claimed snapshot timestamp',
  );
}

function hardenLinkRange(query) {
  const unsafe = `    CASE
      WHEN input.link_job_requisition_id_raw ~ '^[1-9][0-9]*$'
        AND CHAR_LENGTH(input.link_job_requisition_id_raw) <= 10
        AND input.link_job_requisition_id_raw::BIGINT <= 2147483647
        THEN input.link_job_requisition_id_raw::INTEGER
      ELSE NULL
    END AS requested_job_requisition_id,
    CASE
      WHEN input.link_job_requisition_id_raw IS NULL THEN TRUE
      WHEN input.link_job_requisition_id_raw ~ '^[1-9][0-9]*$'
        AND CHAR_LENGTH(input.link_job_requisition_id_raw) <= 10
        AND input.link_job_requisition_id_raw::BIGINT <= 2147483647
        THEN TRUE
      ELSE FALSE
    END AS valid_job_requisition_id
`;
  const safe = `    CASE
      WHEN input.link_job_requisition_id_raw ~ '^[1-9][0-9]*$'
        AND CHAR_LENGTH(input.link_job_requisition_id_raw) <= 10
        THEN CASE
          WHEN input.link_job_requisition_id_raw::BIGINT <= 2147483647
            THEN input.link_job_requisition_id_raw::INTEGER
          ELSE NULL
        END
      ELSE NULL
    END AS requested_job_requisition_id,
    CASE
      WHEN input.link_job_requisition_id_raw IS NULL THEN TRUE
      WHEN input.link_job_requisition_id_raw ~ '^[1-9][0-9]*$'
        AND CHAR_LENGTH(input.link_job_requisition_id_raw) <= 10
        THEN input.link_job_requisition_id_raw::BIGINT <= 2147483647
      ELSE FALSE
    END AS valid_job_requisition_id
`;
  if (!query.includes(unsafe)) return query;
  return replaceOnce(query, unsafe, safe, 'safe PostgreSQL integer link evaluation');
}

function hardenCountExpressions(query) {
  const oldInput = `    {{ Number.isFinite(Number($json.body.scannedCount)) ? Math.max(0, Math.trunc(Number($json.body.scannedCount))) : 0 }}::INTEGER AS scanned_count,
    {{ Number.isInteger($json.body.contractVersion) ? $json.body.contractVersion : 0 }}::INTEGER AS contract_version,
    {{ Number.isInteger($json.body.sourceTotalCount) ? $json.body.sourceTotalCount : -1 }}::INTEGER AS source_total_count,
    {{ Number.isInteger($json.body.publishedCount) ? $json.body.publishedCount : -1 }}::INTEGER AS published_count,
`;
  const strictInput = `    {{ Number.isInteger($json.body.scannedCount) && $json.body.scannedCount >= 0 && $json.body.scannedCount <= 2147483647 ? $json.body.scannedCount : -1 }}::INTEGER AS scanned_count,
    {{ Number.isInteger($json.body.contractVersion) && $json.body.contractVersion > 0 && $json.body.contractVersion <= 2147483647 ? $json.body.contractVersion : 0 }}::INTEGER AS contract_version,
    {{ Number.isInteger($json.body.sourceTotalCount) && $json.body.sourceTotalCount >= 0 && $json.body.sourceTotalCount <= 2147483647 ? $json.body.sourceTotalCount : -1 }}::INTEGER AS source_total_count,
    {{ Number.isInteger($json.body.publishedCount) && $json.body.publishedCount >= 0 && $json.body.publishedCount <= 2147483647 ? $json.body.publishedCount : -1 }}::INTEGER AS published_count,
`;
  if (!query.includes(oldInput)) return query;
  return replaceOnce(query, oldInput, strictInput, 'strict sync count expressions');
}

function hardenSyncEnvelope(query) {
  const start = query.indexOf(`    '{{ JSON.stringify(Array.isArray($json.body.jobs) ? $json.body.jobs : []).replace(/'/g, "''") }}'::JSONB AS external_jobs,`);
  const end = query.indexOf(`    {{ $json.body.complete === true ? 'TRUE' : 'FALSE' }}::BOOLEAN AS snapshot_complete,`, start);
  if (start < 0 || end < 0) {
    throw new Error('strict sync envelope: input anchors not found');
  }

  const strict = `    '{{ JSON.stringify(Array.isArray($json.body.jobs) ? $json.body.jobs : []).replace(/'/g, "''") }}'::JSONB AS external_jobs,
    {{ Array.isArray($json.body.jobs) ? 'TRUE' : 'FALSE' }}::BOOLEAN AS external_jobs_is_array,
    {{ typeof $json.body.syncedAt === 'string' && $json.body.syncedAt.trim().length > 0 && $json.body.syncedAt.trim().length <= 64 && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$/.test($json.body.syncedAt.trim()) && Number.isFinite(Date.parse($json.body.syncedAt.trim())) ? 'TRUE' : 'FALSE' }}::BOOLEAN AS client_synced_at_valid,
    TO_TIMESTAMP({{ typeof $json.body.syncedAt === 'string' && $json.body.syncedAt.trim().length > 0 && $json.body.syncedAt.trim().length <= 64 && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$/.test($json.body.syncedAt.trim()) && Number.isFinite(Date.parse($json.body.syncedAt.trim())) ? Date.parse($json.body.syncedAt.trim()) / 1000 : 0 }}) AS external_synced_at,
`;
  const current = query.slice(start, end);
  if (current === strict) return query;
  return `${query.slice(0, start)}${strict}${query.slice(end)}`;
}

function hardenIncomingJobContract(query) {
  const start = query.indexOf('incoming_104_raw AS (');
  const end = query.indexOf('sync_request AS (', start);
  if (start < 0 || end < 0) {
    throw new Error('strict 104 job contract: CTE anchors not found');
  }

  const strictCtes = `incoming_104_raw AS (
  SELECT
    job.value AS job_value,
    BTRIM(COALESCE(job.value->>'externalId', '')) AS external_id,
    BTRIM(COALESCE(job.value->>'title', '')) AS external_title,
    NULLIF(BTRIM(COALESCE(job.value->>'url', '')), '') AS url,
    NULLIF(BTRIM(COALESCE(job.value->>'updatedDate', '')), '') AS source_updated_text
  FROM input
  CROSS JOIN LATERAL jsonb_array_elements(input.external_jobs) AS job(value)
  WHERE input.action = 'sync_104_jobs'
),
incoming_104 AS (
  SELECT DISTINCT ON (external_id)
    external_id,
    external_title,
    url,
    source_updated_text
  FROM incoming_104_raw
  WHERE jsonb_typeof(job_value) = 'object'
    AND jsonb_typeof(job_value->'externalId') = 'string'
    AND jsonb_typeof(job_value->'title') = 'string'
    AND jsonb_typeof(job_value->'url') = 'string'
    AND jsonb_typeof(job_value->'updatedDate') = 'string'
    AND jsonb_typeof(job_value->'status') = 'string'
    AND job_value->>'status' = 'open'
    AND external_id ~ '^[0-9]{1,32}$'
    AND external_title <> ''
    AND CHAR_LENGTH(external_title) <= 200
    AND url IS NOT NULL
    AND CHAR_LENGTH(url) <= 2048
    AND POSITION('/job/jobmaster?' IN url) > 0
    AND LOWER(SUBSTRING(
      url FROM 1 FOR GREATEST(POSITION('/job/jobmaster?' IN url) - 1, 0)
    ))
      IN ('https://vip.104.com.tw', 'https://vip.104.com.tw:443')
    AND COALESCE((
      SELECT SUBSTRING(parameter.value FROM POSITION('=' IN parameter.value) + 1)
      FROM unnest(
        string_to_array(
          split_part(SUBSTRING(url FROM POSITION('?' IN url) + 1), '#', 1),
          '&'
        )
      ) WITH ORDINALITY AS parameter(value, ordinal)
      WHERE split_part(parameter.value, '=', 1) = 'jobno'
      ORDER BY parameter.ordinal
      LIMIT 1
    ), '') = external_id
    AND (source_updated_text IS NULL OR CHAR_LENGTH(source_updated_text) <= 64)
  ORDER BY external_id
),
`;
  const current = query.slice(start, end);
  if (current === strictCtes) return query;
  return `${query.slice(0, start)}${strictCtes}${query.slice(end)}`;
}

function hardenSyncGate(query) {
  const start = query.indexOf('sync_request AS (');
  const end = query.indexOf('sync_claimed AS (', start);
  if (start < 0 || end < 0) {
    throw new Error('strict 104 sync gate: CTE anchors not found');
  }

  const strictGate = `sync_request AS (
  SELECT
    input.*,
    (
      input.action = 'sync_104_jobs'
      AND input.snapshot_complete
      AND input.contract_version = 2
      AND input.external_jobs_is_array
      AND jsonb_array_length(input.external_jobs) <= 500
      AND input.client_synced_at_valid
      AND input.external_synced_at <= NOW() + INTERVAL '5 minutes'
      AND input.source_total_count >= 0
      AND input.published_count >= 0
      AND input.published_count <= input.source_total_count
      AND input.scanned_count = input.source_total_count
      AND input.published_count = jsonb_array_length(input.external_jobs)
      AND input.published_count = (SELECT COUNT(*)::INTEGER FROM incoming_104)
    ) AS is_valid
  FROM input
),
`;
  const current = query.slice(start, end);
  if (current === strictGate) return query;
  return `${query.slice(0, start)}${strictGate}${query.slice(end)}`;
}

function useDatabaseClaimTimestamp(query) {
  const databaseTimestamp = `    clock_timestamp(),
`;
  if (query.includes(databaseTimestamp)) return query;
  for (const clientTimestamp of [
    `    LEAST(sync_request.external_synced_at, NOW()),
`,
    `    sync_request.external_synced_at,
`,
  ]) {
    if (query.includes(clientTimestamp)) {
      return replaceOnce(
        query,
        clientTimestamp,
        databaseTimestamp,
        'use database receipt time for the provider claim',
      );
    }
  }
  throw new Error('database claim timestamp: input anchor not found');
}

function useClaimTimestampForPending(query) {
  const permissive = `  SET publication_status = 'pending_confirmation',
      last_synced_at = input.external_synced_at,
`;
  if (!query.includes(permissive)) return query;
  return replaceOnce(
    query,
    permissive,
    `  SET publication_status = 'pending_confirmation',
      last_synced_at = sync_claimed.last_complete_synced_at,
`,
    'use claimed timestamp for pending transitions',
  );
}

function hardenSyncErrors(query) {
  const start = query.indexOf("    WHEN input.action = 'sync_104_jobs' AND NOT input.snapshot_complete");
  const end = query.indexOf("    WHEN input.action <> 'link_external_job' THEN NULL", start);
  if (start < 0 || end < 0) {
    throw new Error('strict 104 sync errors: CASE anchors not found');
  }

  const strictErrors = `    WHEN input.action = 'sync_104_jobs' AND NOT input.snapshot_complete
      THEN 'complete must be true for a full 104 job sync'
    WHEN input.action = 'sync_104_jobs' AND input.contract_version <> 2
      THEN 'Unsupported 104 sync contractVersion'
    WHEN input.action = 'sync_104_jobs' AND NOT input.external_jobs_is_array
      THEN 'jobs must be an array'
    WHEN input.action = 'sync_104_jobs' AND NOT input.client_synced_at_valid
      THEN 'syncedAt must be a valid ISO date-time string'
    WHEN input.action = 'sync_104_jobs'
      AND input.external_synced_at > NOW() + INTERVAL '5 minutes'
      THEN 'syncedAt cannot be more than 5 minutes in the future'
    WHEN input.action = 'sync_104_jobs' AND jsonb_array_length(input.external_jobs) > 500
      THEN 'jobs must contain at most 500 items'
    WHEN input.action = 'sync_104_jobs'
      AND (
        input.source_total_count < 0
        OR input.published_count < 0
        OR input.published_count > input.source_total_count
        OR input.scanned_count <> input.source_total_count
        OR input.published_count <> jsonb_array_length(input.external_jobs)
        OR input.published_count <> (SELECT COUNT(*)::INTEGER FROM incoming_104)
      ) THEN '104 sync counts or jobs are inconsistent'
    WHEN input.action = 'sync_104_jobs' AND NOT EXISTS (SELECT 1 FROM sync_claimed)
      THEN '104 snapshot provider claim was not applied'
`;
  const current = query.slice(start, end);
  if (current === strictErrors) return query;
  return `${query.slice(0, start)}${strictErrors}${query.slice(end)}`;
}

function useClaimTimestampInResponse(query) {
  const strict = `      'syncedAt', (
        SELECT TO_CHAR(sync_claimed.last_complete_synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        FROM sync_claimed
        LIMIT 1
      )
`;
  if (query.includes(strict)) return query;
  return replaceOnce(
    query,
    `      'syncedAt', TO_CHAR(input.external_synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
`,
    strict,
    'return authoritative claimed sync timestamp',
  );
}

function requireExplicitOpenStatus(query) {
  const permissive = `    AND LOWER(COALESCE(NULLIF(BTRIM(job.value->>'status'), ''), 'open')) = 'open'
`;
  if (!query.includes(permissive)) return query;
  return replaceOnce(
    query,
    permissive,
    `    AND LOWER(BTRIM(COALESCE(job.value->>'status', ''))) = 'open'
`,
    'explicit open status',
  );
}

function finishQuery(query) {
  return useClaimTimestampInResponse(
    hardenSyncErrors(
      useClaimTimestampForPending(
        useDatabaseClaimTimestamp(
          hardenSyncGate(
            hardenIncomingJobContract(
              hardenSyncEnvelope(
                requireExplicitOpenStatus(hardenCountExpressions(hardenLinkRange(useClaimTimestamp(query)))),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function patchQuery(original) {
  if (original.includes('sync_claimed AS (') && original.includes('contract_version')) {
    return finishQuery(original);
  }

  let query = replaceOnce(
    original,
    `    {{ Number.isFinite(Number($json.body.scannedCount)) ? Math.max(0, Math.trunc(Number($json.body.scannedCount))) : 0 }}::INTEGER AS scanned_count,
`,
    `    {{ Number.isInteger($json.body.scannedCount) && $json.body.scannedCount >= 0 && $json.body.scannedCount <= 2147483647 ? $json.body.scannedCount : -1 }}::INTEGER AS scanned_count,
    {{ Number.isInteger($json.body.contractVersion) && $json.body.contractVersion > 0 && $json.body.contractVersion <= 2147483647 ? $json.body.contractVersion : 0 }}::INTEGER AS contract_version,
    {{ Number.isInteger($json.body.sourceTotalCount) && $json.body.sourceTotalCount >= 0 && $json.body.sourceTotalCount <= 2147483647 ? $json.body.sourceTotalCount : -1 }}::INTEGER AS source_total_count,
    {{ Number.isInteger($json.body.publishedCount) && $json.body.publishedCount >= 0 && $json.body.publishedCount <= 2147483647 ? $json.body.publishedCount : -1 }}::INTEGER AS published_count,
`,
    'sync contract input',
  );

  query = replaceOnce(
    query,
    `  WHERE external_id ~ '^[0-9]+$'
    AND external_title <> ''
  ORDER BY external_id
),
sync_upserted AS (
`,
    `  WHERE external_id ~ '^[0-9]{1,32}$'
    AND external_title <> ''
    AND CHAR_LENGTH(external_title) <= 200
    AND url IS NOT NULL
    AND CHAR_LENGTH(url) <= 2048
    AND url ~ '^https://vip[.]104[.]com[.]tw/'
    AND (source_updated_text IS NULL OR CHAR_LENGTH(source_updated_text) <= 64)
  ORDER BY external_id
),
sync_request AS (
  SELECT
    input.*,
    (
      input.action = 'sync_104_jobs'
      AND input.snapshot_complete
      AND input.contract_version = 2
      AND input.source_total_count >= 0
      AND input.published_count >= 0
      AND input.published_count <= input.source_total_count
      AND input.scanned_count = input.source_total_count
      AND input.published_count = jsonb_array_length(input.external_jobs)
      AND input.published_count = (SELECT COUNT(*)::INTEGER FROM incoming_104)
    ) AS is_valid
  FROM input
),
sync_claimed AS (
  INSERT INTO job_requisition_source_syncs (
    source,
    contract_version,
    source_total_count,
    published_count,
    last_complete_synced_at,
    created_at,
    updated_at
  )
  SELECT
    '104',
    sync_request.contract_version,
    sync_request.source_total_count,
    sync_request.published_count,
    sync_request.external_synced_at,
    NOW(),
    NOW()
  FROM sync_request
  WHERE sync_request.is_valid
  ON CONFLICT (source) DO UPDATE
  SET contract_version = EXCLUDED.contract_version,
      source_total_count = EXCLUDED.source_total_count,
      published_count = EXCLUDED.published_count,
      last_complete_synced_at = EXCLUDED.last_complete_synced_at,
      updated_at = NOW()
  WHERE job_requisition_source_syncs.last_complete_synced_at < EXCLUDED.last_complete_synced_at
  RETURNING source, contract_version, source_total_count, published_count, last_complete_synced_at
),
sync_upserted AS (
`,
    'validated sync and provider claim',
  );

  const upsertGateAnchor = `  FROM incoming_104
  CROSS JOIN input
  WHERE input.action = 'sync_104_jobs'
`;
  query = replaceOnce(
    query,
    upsertGateAnchor,
    `  FROM incoming_104
  CROSS JOIN sync_claimed
`,
    'gate source upsert on sync claim',
  );

  query = replaceOnce(
    query,
    `  FROM input
  WHERE input.action = 'sync_104_jobs'
    AND input.snapshot_complete
    AND source_row.source = '104'
`,
    `  FROM input
  CROSS JOIN sync_claimed
  WHERE source_row.source = sync_claimed.source
`,
    'gate pending transition on sync claim',
  );

  query = replaceOnce(
    query,
    `    CASE
      WHEN input.link_job_requisition_id_raw ~ '^[1-9][0-9]*$'
        THEN input.link_job_requisition_id_raw::INTEGER
      ELSE NULL
    END AS requested_job_requisition_id,
    (
      input.link_job_requisition_id_raw IS NULL
      OR input.link_job_requisition_id_raw ~ '^[1-9][0-9]*$'
    ) AS valid_job_requisition_id
`,
    `    CASE
      WHEN input.link_job_requisition_id_raw ~ '^[1-9][0-9]*$'
        AND CHAR_LENGTH(input.link_job_requisition_id_raw) <= 10
        THEN CASE
          WHEN input.link_job_requisition_id_raw::BIGINT <= 2147483647
            THEN input.link_job_requisition_id_raw::INTEGER
          ELSE NULL
        END
      ELSE NULL
    END AS requested_job_requisition_id,
    CASE
      WHEN input.link_job_requisition_id_raw IS NULL THEN TRUE
      WHEN input.link_job_requisition_id_raw ~ '^[1-9][0-9]*$'
        AND CHAR_LENGTH(input.link_job_requisition_id_raw) <= 10
        THEN input.link_job_requisition_id_raw::BIGINT <= 2147483647
      ELSE FALSE
    END AS valid_job_requisition_id
`,
    'safe PostgreSQL integer link validation',
  );

  query = replaceOnce(
    query,
    `  'ok', CASE
    WHEN input.action = 'link_external_job' THEN EXISTS (SELECT 1 FROM external_linked)
    ELSE true
  END,
  'error', CASE
    WHEN input.action <> 'link_external_job' THEN NULL
`,
    `  'ok', CASE
    WHEN input.action = 'link_external_job' THEN EXISTS (SELECT 1 FROM external_linked)
    WHEN input.action = 'sync_104_jobs' THEN EXISTS (SELECT 1 FROM sync_claimed)
    ELSE true
  END,
  'error', CASE
    WHEN input.action = 'sync_104_jobs' AND NOT input.snapshot_complete
      THEN 'complete must be true for a full 104 job sync'
    WHEN input.action = 'sync_104_jobs' AND input.contract_version <> 2
      THEN 'Unsupported 104 sync contractVersion'
    WHEN input.action = 'sync_104_jobs'
      AND (
        input.source_total_count < 0
        OR input.published_count < 0
        OR input.published_count > input.source_total_count
        OR input.scanned_count <> input.source_total_count
        OR input.published_count <> jsonb_array_length(input.external_jobs)
        OR input.published_count <> (SELECT COUNT(*)::INTEGER FROM incoming_104)
      ) THEN '104 sync counts or jobs are inconsistent'
    WHEN input.action = 'sync_104_jobs' AND NOT EXISTS (SELECT 1 FROM sync_claimed)
      THEN '104 snapshot provider claim was not applied'
    WHEN input.action <> 'link_external_job' THEN NULL
`,
    'sync success and error response',
  );

  query = replaceOnce(
    query,
    `    WHEN input.link_job_requisition_id_raw IS NOT NULL
      AND input.link_job_requisition_id_raw !~ '^[1-9][0-9]*$'
      THEN 'jobRequisitionId must be a positive integer or null'
`,
    `    WHEN input.link_job_requisition_id_raw IS NOT NULL
      AND NOT COALESCE((SELECT link_request.valid_job_requisition_id FROM link_request LIMIT 1), FALSE)
      THEN 'jobRequisitionId must be a PostgreSQL positive integer or null'
`,
    'link range error',
  );

  query = replaceOnce(
    query,
    `        WHERE requisition.id = input.link_job_requisition_id_raw::INTEGER
`,
    `        WHERE requisition.id = (
          SELECT link_request.requested_job_requisition_id
          FROM link_request
          LIMIT 1
        )
`,
    'safe link lookup',
  );

  query = replaceOnce(
    query,
    `      'received', jsonb_array_length(input.external_jobs),
      'accepted', (SELECT COUNT(*) FROM incoming_104),
      'upserted', (SELECT COUNT(*) FROM sync_upserted),
      'pendingConfirmation', (SELECT COUNT(*) FROM sync_pending),
      'complete', input.snapshot_complete,
      'scannedCount', input.scanned_count,
`,
    `      'received', jsonb_array_length(input.external_jobs),
      'accepted', (SELECT COUNT(*) FROM incoming_104),
      'upserted', (SELECT COUNT(*) FROM sync_upserted),
      'pendingConfirmation', (SELECT COUNT(*) FROM sync_pending),
      'applied', EXISTS (SELECT 1 FROM sync_claimed),
      'complete', input.snapshot_complete,
      'contractVersion', input.contract_version,
      'sourceTotalCount', input.source_total_count,
      'publishedCount', input.published_count,
      'scannedCount', input.scanned_count,
`,
    'sync response metadata',
  );

  return finishQuery(query);
}

let patchedCount = 0;
for (const nodes of [workflow.nodes, workflow.activeVersion?.nodes]) {
  if (!Array.isArray(nodes)) continue;
  const queryNode = nodes.find(node => node.name === nodeName);
  if (!queryNode?.parameters?.query) throw new Error(`${nodeName} query not found`);
  const patched = patchQuery(queryNode.parameters.query);
  if (patched !== queryNode.parameters.query) {
    queryNode.parameters.query = patched;
    patchedCount += 1;
  }
}

const queries = [workflow.nodes, workflow.activeVersion?.nodes]
  .filter(Array.isArray)
  .map(nodes => nodes.find(node => node.name === nodeName)?.parameters?.query || '');
const requiredMarkers = [
  'contract_version',
  'sync_claimed AS (',
  'job_requisition_source_syncs',
  '104 snapshot provider claim was not applied',
  'input.link_job_requisition_id_raw::BIGINT <= 2147483647',
  'Number.isInteger($json.body.scannedCount)',
  '$json.body.sourceTotalCount <= 2147483647',
  '$json.body.publishedCount <= 2147483647',
  'external_jobs_is_array',
  'client_synced_at_valid',
  'TO_TIMESTAMP({{ typeof $json.body.syncedAt',
  "input.external_synced_at <= NOW() + INTERVAL '5 minutes'",
  'clock_timestamp()',
  'jsonb_array_length(input.external_jobs) <= 500',
  "jsonb_typeof(job_value->'externalId') = 'string'",
  "jsonb_typeof(job_value->'title') = 'string'",
  "jsonb_typeof(job_value->'url') = 'string'",
  "jsonb_typeof(job_value->'updatedDate') = 'string'",
  "jsonb_typeof(job_value->'status') = 'string'",
  "job_value->>'status' = 'open'",
  "GREATEST(POSITION('/job/jobmaster?' IN url) - 1, 0)",
  "IN ('https://vip.104.com.tw', 'https://vip.104.com.tw:443')",
  "SUBSTRING(url FROM POSITION('?' IN url) + 1)",
  "split_part(parameter.value, '=', 1) = 'jobno'",
  "SELECT TO_CHAR(sync_claimed.last_complete_synced_at AT TIME ZONE 'UTC'",
];
if (!queries.length || queries.some(query => requiredMarkers.some(marker => !query.includes(marker)))) {
  throw new Error('104 sync v2 was not applied to every Job Requisition Write query copy');
}
if (queries.some(query => query.includes("COALESCE(NULLIF(BTRIM(job.value->>'status'), ''), 'open')"))) {
  throw new Error('104 sync v2 must reject jobs without an explicit open status');
}
if (queries.some(query => query.includes("TO_CHAR(input.external_synced_at AT TIME ZONE 'UTC'"))) {
  throw new Error('104 sync v2 response must not expose a client-derived timestamp');
}
if (queries.some(query => query.includes('LEAST(sync_request.external_synced_at, NOW())'))) {
  throw new Error('104 sync v2 must not order provider claims by the client clock');
}
if (new Set(queries).size !== 1) {
  throw new Error('Root and activeVersion Job Requisition Write SQL differ');
}

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
console.log(`Job Requisition Write sync v2 ready (${patchedCount} query copies patched)`);
