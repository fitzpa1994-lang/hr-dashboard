export const SYNC_104_CONTRACT_VERSION = 2;
export const POSTGRES_INTEGER_MAX = 2_147_483_647;
export const SYNC_104_MAX_PUBLISHED_JOBS = 500;

function isPostgresCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= POSTGRES_INTEGER_MAX;
}

function isIsoDateTime(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return Boolean(
    text
    && text.length <= 64
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
    && Number.isFinite(Date.parse(text))
  );
}

/**
 * Validates the completeness envelope shared by the Chrome extension, dashboard,
 * Node proxy and n8n workflow. It deliberately does not infer missing counts.
 */
export function validateComplete104SyncPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '104 sync payload must be an object' };
  }
  if (raw.contractVersion !== SYNC_104_CONTRACT_VERSION) {
    return { ok: false, error: `104 sync contractVersion must be ${SYNC_104_CONTRACT_VERSION}` };
  }
  if (raw.complete !== true) {
    return { ok: false, error: 'complete must be true for a full 104 job sync' };
  }
  if (!isIsoDateTime(raw.syncedAt)) {
    return { ok: false, error: 'syncedAt must be a valid ISO date-time string' };
  }
  for (const field of ['sourceTotalCount', 'publishedCount', 'scannedCount']) {
    if (!isPostgresCount(raw[field])) {
      return { ok: false, error: `${field} must be a PostgreSQL non-negative integer` };
    }
  }
  if (raw.scannedCount !== raw.sourceTotalCount) {
    return { ok: false, error: 'scannedCount must equal sourceTotalCount' };
  }
  if (raw.publishedCount > raw.sourceTotalCount) {
    return { ok: false, error: 'publishedCount cannot exceed sourceTotalCount' };
  }
  if (!Array.isArray(raw.jobs)) {
    return { ok: false, error: 'jobs must be an array' };
  }
  if (raw.jobs.length > SYNC_104_MAX_PUBLISHED_JOBS) {
    return { ok: false, error: `jobs must contain at most ${SYNC_104_MAX_PUBLISHED_JOBS} items` };
  }
  if (raw.publishedCount !== raw.jobs.length) {
    return { ok: false, error: 'publishedCount must equal the number of jobs' };
  }

  const externalIds = new Set();
  for (let index = 0; index < raw.jobs.length; index += 1) {
    const job = raw.jobs[index];
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      return { ok: false, error: `jobs[${index}] must be an object` };
    }
    if (job.status !== 'open') {
      return { ok: false, error: `jobs[${index}].status must be open` };
    }
    const externalId = typeof job.externalId === 'string' ? job.externalId.trim() : '';
    if (!/^\d{1,32}$/.test(externalId)) {
      return { ok: false, error: `jobs[${index}].externalId must contain digits only` };
    }
    if (externalIds.has(externalId)) {
      return { ok: false, error: `jobs contains duplicate externalId ${externalId}` };
    }
    externalIds.add(externalId);
  }
  if (raw.publishedCount !== externalIds.size) {
    return { ok: false, error: 'publishedCount must equal the number of unique jobs' };
  }

  return {
    ok: true,
    value: {
      contractVersion: SYNC_104_CONTRACT_VERSION,
      complete: true,
      sourceTotalCount: raw.sourceTotalCount,
      publishedCount: raw.publishedCount,
      scannedCount: raw.scannedCount,
      syncedAt: raw.syncedAt.trim(),
      jobs: raw.jobs,
    },
  };
}

/**
 * Normalizes the durable server-side sync marker. `hasSnapshot` is authoritative,
 * so a valid snapshot with publishedCount 0 remains a successful snapshot.
 */
export function normalizeExternal104SyncMetadata(raw) {
  const empty = {
    hasSnapshot: false,
    source: '104',
    contractVersion: SYNC_104_CONTRACT_VERSION,
    sourceTotalCount: 0,
    publishedCount: 0,
    lastSyncAt: '',
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.hasSnapshot !== true) {
    return empty;
  }
  if (
    raw.contractVersion !== SYNC_104_CONTRACT_VERSION
    || !isPostgresCount(raw.sourceTotalCount)
    || !isPostgresCount(raw.publishedCount)
    || raw.publishedCount > raw.sourceTotalCount
    || !isIsoDateTime(raw.lastSyncAt)
  ) {
    return empty;
  }
  return {
    hasSnapshot: true,
    source: '104',
    contractVersion: SYNC_104_CONTRACT_VERSION,
    sourceTotalCount: raw.sourceTotalCount,
    publishedCount: raw.publishedCount,
    lastSyncAt: raw.lastSyncAt.trim(),
  };
}
