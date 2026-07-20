-- External job-board records are kept separate from the internal requisition lifecycle.
-- Applying a source snapshot must never create, close, or otherwise mutate job_requisitions.
CREATE TABLE IF NOT EXISTS job_requisition_sources (
    source                  TEXT        NOT NULL,
    external_id             TEXT        NOT NULL,
    job_requisition_id      INTEGER     REFERENCES job_requisitions(id) ON DELETE SET NULL,
    external_title          TEXT        NOT NULL,
    url                     TEXT,
    source_updated_text     TEXT,
    publication_status      TEXT        NOT NULL DEFAULT 'open'
                                        CHECK (publication_status IN ('open', 'pending_confirmation')),
    first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source, external_id),
    CHECK (BTRIM(source) <> ''),
    CHECK (BTRIM(external_id) <> ''),
    CHECK (BTRIM(external_title) <> '')
);

CREATE INDEX IF NOT EXISTS idx_job_requisition_sources_job_requisition
ON job_requisition_sources(job_requisition_id);

-- One row per provider records the last complete snapshot independently from
-- individual postings. This preserves a successful zero-posting snapshot and
-- provides the database-timed serialization point for concurrent snapshots.
CREATE TABLE IF NOT EXISTS job_requisition_source_syncs (
    source                      TEXT        PRIMARY KEY,
    contract_version            INTEGER     NOT NULL,
    source_total_count          INTEGER     NOT NULL,
    published_count             INTEGER     NOT NULL,
    last_complete_synced_at     TIMESTAMPTZ NOT NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (BTRIM(source) <> ''),
    CHECK (contract_version > 0),
    CHECK (source_total_count >= 0),
    CHECK (published_count >= 0),
    CHECK (published_count <= source_total_count)
);
