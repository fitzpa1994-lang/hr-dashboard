import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workflowPath = path.join(root, 'n8n', 'live_Dashboard_API.json');
const original = fs.readFileSync(workflowPath, 'utf8');
const workflow = JSON.parse(original);
const jobsMarker = "  'external104Jobs', COALESCE((";
const syncMarker = "  'external104Sync', COALESCE((";
const anchor = "  'monthlyTrend', COALESCE((";
const externalJobsSql = `  'external104Jobs', COALESCE((
    SELECT json_agg(json_build_object(
      'externalId', source_row.external_id,
      'jobRequisitionId', source_row.job_requisition_id,
      'title', source_row.external_title,
      'url', COALESCE(source_row.url, ''),
      'updatedDate', COALESCE(source_row.source_updated_text, ''),
      'status', source_row.publication_status,
      'firstSeenAt', COALESCE(TO_CHAR(source_row.first_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''),
      'lastSeenAt', COALESCE(TO_CHAR(source_row.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''),
      'lastSyncedAt', COALESCE(TO_CHAR(source_row.last_synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '')
    ) ORDER BY
      CASE source_row.publication_status WHEN 'open' THEN 0 ELSE 1 END,
      source_row.external_title,
      source_row.external_id)
    FROM job_requisition_sources source_row
    WHERE source_row.source = '104'
  ), '[]'::json),

`;
const externalSyncSql = `  'external104Sync', COALESCE((
    SELECT json_build_object(
      'hasSnapshot', TRUE,
      'source', sync_row.source,
      'contractVersion', sync_row.contract_version,
      'sourceTotalCount', sync_row.source_total_count,
      'publishedCount', sync_row.published_count,
      'lastSyncAt', TO_CHAR(sync_row.last_complete_synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
    FROM job_requisition_source_syncs sync_row
    WHERE sync_row.source = '104'
  ), json_build_object(
    'hasSnapshot', FALSE,
    'source', '104',
    'contractVersion', 2,
    'sourceTotalCount', 0,
    'publishedCount', 0,
    'lastSyncAt', ''
  )),

`;

function normalizeLineEndings(value) {
  return String(value || '').replace(/\r\n?/g, '\n');
}

function countOccurrences(value, marker) {
  return value.split(marker).length - 1;
}

function findDashboardQueryNode(nodes, label) {
  if (!Array.isArray(nodes)) throw new Error(`${label} nodes are missing`);
  const matches = nodes.filter(node =>
    node.type === 'n8n-nodes-base.postgres'
    && node.parameters?.operation === 'executeQuery'
    && normalizeLineEndings(node.parameters?.query).includes("  'jobsData', COALESCE((")
  );
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Dashboard query in ${label}, found ${matches.length}`);
  }
  return matches[0];
}

function upsertSection(query, startMarker, endMarker, section, label) {
  const startCount = countOccurrences(query, startMarker);
  const endCount = countOccurrences(query, endMarker);
  if (startCount > 1) throw new Error(`Expected at most one ${label} section, found ${startCount}`);
  if (endCount !== 1) throw new Error(`Expected one ${label} end anchor, found ${endCount}`);

  if (startCount === 0) return query.replace(endMarker, `${section}${endMarker}`);

  const startIndex = query.indexOf(startMarker);
  const endIndex = query.indexOf(endMarker, startIndex + startMarker.length);
  if (endIndex < 0) throw new Error(`${label} section does not precede its end anchor`);
  return `${query.slice(0, startIndex)}${section}${query.slice(endIndex)}`;
}

const rootNode = findDashboardQueryNode(workflow.nodes, 'workflow.nodes');
const activeNode = findDashboardQueryNode(workflow.activeVersion?.nodes, 'workflow.activeVersion.nodes');

// The root workflow query is the canonical saved version. It contains the latest
// Dashboard fixes; activeVersion can lag when a previous export updated only the root.
let canonicalQuery = normalizeLineEndings(rootNode.parameters.query);
canonicalQuery = upsertSection(canonicalQuery, jobsMarker, anchor, externalJobsSql, 'external104Jobs');
canonicalQuery = upsertSection(canonicalQuery, syncMarker, jobsMarker, externalSyncSql, 'external104Sync');

let patchedCount = 0;
for (const node of [rootNode, activeNode]) {
  if (normalizeLineEndings(node.parameters.query) !== canonicalQuery) patchedCount += 1;
  node.parameters.query = canonicalQuery;
}

const rootQuery = normalizeLineEndings(rootNode.parameters.query);
const activeQuery = normalizeLineEndings(activeNode.parameters.query);
if (rootQuery !== activeQuery) {
  throw new Error('Dashboard root and activeVersion queries diverged after patching');
}
for (const [marker, label] of [[jobsMarker, 'external104Jobs'], [syncMarker, 'external104Sync']]) {
  if (countOccurrences(rootQuery, marker) !== 1) {
    throw new Error(`Expected exactly one ${label} section in the canonical Dashboard query`);
  }
}
if (!rootQuery.includes(externalJobsSql) || !rootQuery.includes(externalSyncSql)) {
  throw new Error('Canonical Dashboard query does not contain the expected external 104 SQL');
}

const serialized = `${JSON.stringify(workflow, null, 2)}\n`;
if (serialized !== original) fs.writeFileSync(workflowPath, serialized, 'utf8');
console.log(`Dashboard API root/active queries synchronized (${patchedCount} query copies patched)`);
