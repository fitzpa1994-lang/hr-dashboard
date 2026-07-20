import { normalizeJobRequisition } from './dataUtils.js';

export const TALENT_NAVIGATOR_STORAGE_KEY = 'sporton.talentSearchNavigator.v1';

export const RECONCILIATION_STATES = Object.freeze({
  IN_SYNC: 'in_sync',
  EXTERNAL_OPEN_INTERNAL_CLOSED: 'external_open_internal_closed',
  EXTERNAL_MISSING_INTERNAL_OPEN: 'external_missing_internal_open',
  EXTERNAL_MISSING_INTERNAL_CLOSED: 'external_missing_internal_closed',
  INTERNAL_UNLINKED: 'internal_unlinked',
  EXTERNAL_UNLINKED: 'external_unlinked',
  NOT_SYNCED: 'not_synced',
});

const STATE_VALUES = Object.freeze(Object.values(RECONCILIATION_STATES));

function identifierKey(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function titleText(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

/**
 * Exact matching key used only for suggestions. It is deliberately not fuzzy:
 * punctuation and wording must still be identical after Unicode/space/case normalization.
 */
export function normalizeReconciliationTitle(value) {
  return titleText(value).toLocaleLowerCase('zh-TW');
}

function internalTitle(job) {
  return titleText(job?.pos ?? job?.positionTitle ?? job?.position_title ?? job?.title);
}

function persistedRequisitionId(job) {
  const rawId = job?.jobRequisitionId ?? job?.job_requisition_id;
  if (!identifierKey(rawId)) return null;
  return typeof rawId === 'string' ? rawId.trim() : rawId;
}

/**
 * Converts both the existing navigator snapshot shape and extension-like 104 rows
 * into one stable UI shape without changing the source object.
 */
export function normalizeExternal104Job(job = {}) {
  const rawId = identifierKey(job?.externalId ?? job?.jobNo ?? job?.jobno ?? job?.id);
  const externalId = rawId.startsWith('104:') ? rawId.slice(4) : rawId;
  const title = titleText(job?.title ?? job?.pos ?? job?.positionTitle ?? job?.position_title);
  const rawStatus = identifierKey(job?.status).toLowerCase();
  const status = !rawStatus || rawStatus === 'open'
    ? 'open'
    : 'pending_confirmation';
  const jobRequisitionId = persistedRequisitionId(job);

  return {
    ...job,
    id: externalId ? `104:${externalId}` : identifierKey(job?.id),
    externalId,
    pos: title,
    title,
    dept: titleText(job?.dept ?? job?.department),
    status,
    source: identifierKey(job?.source) || '104',
    url: identifierKey(job?.url),
    jobRequisitionId,
    isExternalOpen: status === 'open',
  };
}

function emptyStorageSnapshot() {
  return {
    external104Jobs: [],
    lastSyncAt: '',
    hasSuccessfulSync: false,
  };
}

/**
 * Reads the existing Talent Navigator localStorage record. A raw JSON string or
 * already-parsed record may be supplied in tests and non-browser consumers.
 */
export function readTalentNavigatorStorageSnapshot(
  storage,
  storageKey = TALENT_NAVIGATOR_STORAGE_KEY
) {
  try {
    const source = storage === undefined ? globalThis.localStorage : storage;
    let parsed;
    if (typeof source === 'string') {
      parsed = JSON.parse(source || '{}');
    } else if (source && typeof source.getItem === 'function') {
      parsed = JSON.parse(source.getItem(storageKey) || '{}');
    } else if (source && typeof source === 'object') {
      parsed = source;
    } else {
      return emptyStorageSnapshot();
    }

    const lastSyncAt = identifierKey(parsed?.lastSyncAt);
    return {
      external104Jobs: Array.isArray(parsed?.syncedJobs)
        ? parsed.syncedJobs.map(normalizeExternal104Job)
        : [],
      lastSyncAt,
      hasSuccessfulSync: Boolean(lastSyncAt),
    };
  } catch (_) {
    return emptyStorageSnapshot();
  }
}

function emptyStateCounts() {
  return Object.fromEntries(STATE_VALUES.map(state => [state, 0]));
}

function countTitles(items, getTitle) {
  const counts = new Map();
  for (const item of items) {
    const key = normalizeReconciliationTitle(getTitle(item));
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function deriveInternalState(internalJob, links, hasSuccessfulSync) {
  if (!hasSuccessfulSync) return RECONCILIATION_STATES.NOT_SYNCED;
  if (!links.length) return RECONCILIATION_STATES.INTERNAL_UNLINKED;

  const hasOpenExternal = links.some(job => job.status === 'open');
  const internalIsOpen = internalJob.displayStatus === 'open';

  if (hasOpenExternal) {
    return internalIsOpen
      ? RECONCILIATION_STATES.IN_SYNC
      : RECONCILIATION_STATES.EXTERNAL_OPEN_INTERNAL_CLOSED;
  }
  return internalIsOpen
    ? RECONCILIATION_STATES.EXTERNAL_MISSING_INTERNAL_OPEN
    : RECONCILIATION_STATES.EXTERNAL_MISSING_INTERNAL_CLOSED;
}

/**
 * Reconciles legacy internal requisitions with the latest persisted 104 snapshot.
 * A persisted jobRequisitionId is the only confirmed relationship. Exact title
 * matches are returned separately as suggestions and never enter `links`.
 */
export function reconcileJobRequisitions({
  internalRequisitions = [],
  external104Jobs = [],
  hasSuccessfulSync = false,
} = {}) {
  const normalizedInternal = (Array.isArray(internalRequisitions) ? internalRequisitions : [])
    .map(normalizeJobRequisition);
  const normalizedExternal = (Array.isArray(external104Jobs) ? external104Jobs : [])
    .map(normalizeExternal104Job);
  const syncSucceeded = hasSuccessfulSync === true;

  const internalIndexById = new Map();
  normalizedInternal.forEach((job, index) => {
    const key = identifierKey(job?.id);
    if (key && !internalIndexById.has(key)) internalIndexById.set(key, index);
  });

  const linksByInternalIndex = normalizedInternal.map(() => []);
  const externalEntries = normalizedExternal.map(job => {
    const mappingKey = identifierKey(job.jobRequisitionId);
    const linkedInternalIndex = mappingKey && internalIndexById.has(mappingKey)
      ? internalIndexById.get(mappingKey)
      : null;
    if (linkedInternalIndex !== null) linksByInternalIndex[linkedInternalIndex].push(job);
    return { job, mappingKey, linkedInternalIndex };
  });

  const internalTitleCounts = countTitles(normalizedInternal, internalTitle);
  const externalTitleCounts = countTitles(normalizedExternal, job => job.title);
  const uniqueUnlinkedExternalByTitle = new Map();

  if (syncSucceeded) {
    for (const entry of externalEntries) {
      if (entry.mappingKey || entry.job.status !== 'open') continue;
      const key = normalizeReconciliationTitle(entry.job.title);
      if (
        key
        && internalTitleCounts.get(key) === 1
        && externalTitleCounts.get(key) === 1
      ) {
        uniqueUnlinkedExternalByTitle.set(key, entry.job);
      }
    }
  }

  const internalRows = normalizedInternal.map((job, index) => {
    const key = normalizeReconciliationTitle(internalTitle(job));
    const suggestedJob = key && internalTitleCounts.get(key) === 1
      ? uniqueUnlinkedExternalByTitle.get(key)
      : undefined;
    const links = [...linksByInternalIndex[index]];
    return {
      ...job,
      links,
      suggestedLinks: suggestedJob ? [suggestedJob] : [],
      reconciliationState: deriveInternalState(job, links, syncSucceeded),
    };
  });

  const uniqueInternalByTitle = new Map();
  if (syncSucceeded) {
    normalizedInternal.forEach(job => {
      const key = normalizeReconciliationTitle(internalTitle(job));
      if (key && internalTitleCounts.get(key) === 1) uniqueInternalByTitle.set(key, job);
    });
  }

  const unmatchedExternal = externalEntries
    .filter(entry => entry.linkedInternalIndex === null)
    .map(entry => {
      const titleKey = normalizeReconciliationTitle(entry.job.title);
      const suggestedInternal = !entry.mappingKey
        && entry.job.status === 'open'
        && externalTitleCounts.get(titleKey) === 1
        ? uniqueInternalByTitle.get(titleKey)
        : undefined;
      return {
        ...entry.job,
        suggestedJobRequisitionId: suggestedInternal?.id ?? null,
        reconciliationState: syncSucceeded
          ? RECONCILIATION_STATES.EXTERNAL_UNLINKED
          : RECONCILIATION_STATES.NOT_SYNCED,
      };
    });

  const internalByState = emptyStateCounts();
  for (const row of internalRows) internalByState[row.reconciliationState] += 1;
  const externalByState = emptyStateCounts();
  for (const job of unmatchedExternal) externalByState[job.reconciliationState] += 1;
  const byState = emptyStateCounts();
  for (const state of STATE_VALUES) byState[state] = internalByState[state] + externalByState[state];

  const linkedInternalTotal = internalRows.filter(row => row.links.length > 0).length;
  const linkedExternalTotal = internalRows.reduce((sum, row) => sum + row.links.length, 0);
  const suggestionTotal = internalRows.reduce((sum, row) => sum + row.suggestedLinks.length, 0);

  return {
    internalRows,
    unmatchedExternal,
    summary: {
      hasSuccessfulSync: syncSucceeded,
      internalTotal: internalRows.length,
      externalTotal: normalizedExternal.length,
      linkedInternalTotal,
      linkedExternalTotal,
      unmatchedExternalTotal: unmatchedExternal.length,
      suggestionTotal,
      openExternalTotal: normalizedExternal.filter(job => job.status === 'open').length,
      pendingConfirmationExternalTotal: normalizedExternal.filter(job => job.status === 'pending_confirmation').length,
      internalByState,
      externalByState,
      byState,
    },
  };
}
