-- ============================================================
-- HR 招募追蹤系統 — PostgreSQL 版本
-- 版本：1.0  |  適用：Zeabur / 任何 PostgreSQL 環境
-- ============================================================

-- ============================================================
-- TABLE 1：candidates（候選人主表）
-- ============================================================
CREATE TABLE IF NOT EXISTS candidates (
    id               SERIAL PRIMARY KEY,
    name             TEXT        NOT NULL,
    email            TEXT,
    phone            TEXT,
    applied_position TEXT        NOT NULL,
    department       TEXT        NOT NULL,
    job_requisition_id INTEGER   REFERENCES job_requisitions(id) ON DELETE SET NULL,
    source           TEXT        DEFAULT '其他',
    status           TEXT        DEFAULT 'in_progress'
                     CHECK(status IN ('in_progress','pending_review','approved_to_invite','hired','rejected','withdrawn')),
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 2：interviews（面試記錄）
-- ============================================================
CREATE TABLE IF NOT EXISTS interviews (
    id              SERIAL PRIMARY KEY,
    candidate_id    INTEGER     NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    interview_date  DATE        NOT NULL,
    interview_time  TEXT,
    round           INTEGER     DEFAULT 1,
    interviewer     TEXT,
    location        TEXT,
    hr_owner        TEXT,
    status          TEXT        DEFAULT 'scheduled'
                    CHECK(status IN ('scheduled','completed','cancelled','rescheduled')),
    result          TEXT        DEFAULT 'pending'
                    CHECK(result IN ('pending','passed','failed','no_show')),
    email_subject   TEXT,
    email_msg_id    TEXT        UNIQUE,
    email_web_link  TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 3：offers（錄取記錄）
-- ============================================================
CREATE TABLE IF NOT EXISTS offers (
    id              SERIAL PRIMARY KEY,
    candidate_id    INTEGER     NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
    offer_date      DATE        NOT NULL,
    expected_start  DATE,
    actual_start    DATE,
    salary_band     TEXT,
    hr_owner        TEXT,
    status          TEXT        DEFAULT 'pending'
                    CHECK(status IN ('pending','accepted','rejected','withdrawn','onboarded')),
    days_to_offer   INTEGER,
    email_msg_id    TEXT        UNIQUE,
    email_web_link  TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 4：email_logs（信件處理日誌）
-- ============================================================
CREATE TABLE IF NOT EXISTS email_logs (
    id              SERIAL PRIMARY KEY,
    email_msg_id    TEXT        NOT NULL UNIQUE,
    email_subject   TEXT,
    sender          TEXT,
    received_at     TIMESTAMPTZ,
    action          TEXT
                    CHECK(action IN ('inserted','updated','skipped','error')),
    candidate_id    INTEGER     REFERENCES candidates(id),
    error_msg       TEXT,
    processed_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 5：job_requisitions（職缺需求）
-- ============================================================
CREATE TABLE IF NOT EXISTS job_requisitions (
    id              SERIAL PRIMARY KEY,
    position_title  TEXT        NOT NULL,
    department      TEXT        NOT NULL,
    headcount       INTEGER     DEFAULT 1,
    filled_count    INTEGER     DEFAULT 0,
    open_date       DATE,
    target_date     DATE,
    status          TEXT        DEFAULT 'open'
                    CHECK(status IN ('open','filled','on_hold','cancelled')),
    urgency         INTEGER     DEFAULT 3
                    CHECK(urgency BETWEEN 1 AND 5),
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 104 等外部刊登資料與內部職缺生命週期分離；外部同步不得改寫缺額或標準職稱。
CREATE TABLE IF NOT EXISTS job_requisition_sources (
    source                  TEXT        NOT NULL,
    external_id             TEXT        NOT NULL,
    job_requisition_id      INTEGER     REFERENCES job_requisitions(id) ON DELETE SET NULL,
    external_title          TEXT        NOT NULL,
    url                     TEXT,
    source_updated_text     TEXT,
    publication_status      TEXT        NOT NULL DEFAULT 'open'
                                        CHECK(publication_status IN ('open','pending_confirmation')),
    priority_level          SMALLINT    NOT NULL DEFAULT 2,
    display_order           INTEGER     NOT NULL DEFAULT 0,
    first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source, external_id),
    CHECK (BTRIM(source) <> ''),
    CHECK (BTRIM(external_id) <> ''),
    CHECK (BTRIM(external_title) <> ''),
    CONSTRAINT job_requisition_sources_priority_level_check
        CHECK (priority_level BETWEEN 1 AND 3),
    CONSTRAINT job_requisition_sources_display_order_check
        CHECK (display_order >= 0)
);

-- Upgrade existing installations without replacing external-job rows.
ALTER TABLE job_requisition_sources
    ADD COLUMN IF NOT EXISTS priority_level SMALLINT NOT NULL DEFAULT 2,
    ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'job_requisition_sources_priority_level_check'
          AND conrelid = 'job_requisition_sources'::regclass
    ) THEN
        ALTER TABLE job_requisition_sources
            ADD CONSTRAINT job_requisition_sources_priority_level_check
            CHECK (priority_level BETWEEN 1 AND 3);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'job_requisition_sources_display_order_check'
          AND conrelid = 'job_requisition_sources'::regclass
    ) THEN
        ALTER TABLE job_requisition_sources
            ADD CONSTRAINT job_requisition_sources_display_order_check
            CHECK (display_order >= 0);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_job_requisition_sources_job_requisition
ON job_requisition_sources(job_requisition_id);

-- Provider-level complete snapshot metadata. Keeping this separate from job
-- rows means a valid snapshot with zero published jobs is still persisted.
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

-- ============================================================
-- TABLE 6：onboardings（到職記錄）
-- ============================================================
CREATE TABLE IF NOT EXISTS onboardings (
    id              SERIAL PRIMARY KEY,
    candidate_id    INTEGER     REFERENCES candidates(id) ON DELETE SET NULL,
    name            TEXT        NOT NULL,
    department      TEXT        NOT NULL,
    position        TEXT        NOT NULL,
    hr_owner        TEXT,
    expected_date   DATE        NOT NULL,
    actual_date     DATE,
    status          TEXT        DEFAULT 'pending'
                    CHECK(status IN ('pending','onboarded','cancelled','no_show')),
    email_subject   TEXT,
    email_msg_id    TEXT        UNIQUE,
    email_web_link  TEXT,
    resume_link     TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 7：resignations（離職記錄）
-- ============================================================
CREATE TABLE IF NOT EXISTS resignations (
    id              SERIAL PRIMARY KEY,
    name            TEXT        NOT NULL,
    department      TEXT        NOT NULL,
    position        TEXT        NOT NULL,
    hr_owner        TEXT,
    resign_date     DATE,
    last_day        DATE        NOT NULL,
    reason          TEXT,
    status          TEXT        DEFAULT 'active'
                    CHECK(status IN ('pending','active','done','cancelled')),
    email_subject   TEXT,
    email_msg_id    TEXT        UNIQUE,
    email_web_link  TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_interviews_candidate  ON interviews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_interviews_date       ON interviews(interview_date);
CREATE INDEX IF NOT EXISTS idx_interviews_status     ON interviews(status);
CREATE INDEX IF NOT EXISTS idx_interviews_msg_id     ON interviews(email_msg_id);
CREATE INDEX IF NOT EXISTS idx_offers_candidate      ON offers(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidates_job_requisition ON candidates(job_requisition_id);
CREATE INDEX IF NOT EXISTS idx_candidates_status     ON candidates(status);
CREATE INDEX IF NOT EXISTS idx_candidates_dept       ON candidates(department);
CREATE INDEX IF NOT EXISTS idx_email_logs_msg_id     ON email_logs(email_msg_id);
CREATE INDEX IF NOT EXISTS idx_onboardings_date      ON onboardings(expected_date);
CREATE INDEX IF NOT EXISTS idx_onboardings_status    ON onboardings(status);
CREATE INDEX IF NOT EXISTS idx_resignations_lastday  ON resignations(last_day);
CREATE INDEX IF NOT EXISTS idx_resignations_status   ON resignations(status);

-- ============================================================
-- TRIGGERS（自動更新 updated_at）
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_candidates_updated
    BEFORE UPDATE ON candidates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_interviews_updated
    BEFORE UPDATE ON interviews
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_offers_updated
    BEFORE UPDATE ON offers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_onboardings_updated
    BEFORE UPDATE ON onboardings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_resignations_updated
    BEFORE UPDATE ON resignations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- VIEWS
-- ============================================================

-- 招募漏斗
CREATE OR REPLACE VIEW v_recruitment_funnel AS
SELECT
    c.id, c.name, c.department, c.applied_position, c.source,
    c.status                    AS candidate_status,
    COUNT(i.id)                 AS total_interviews,
    MAX(i.interview_date)       AS last_interview_date,
    MAX(i.round)                AS max_round,
    i_last.status               AS last_interview_status,
    i_last.result               AS last_interview_result,
    o.offer_date,
    o.status                    AS offer_status,
    o.days_to_offer,
    o.actual_start              AS onboard_date,
    c.created_at
FROM candidates c
LEFT JOIN interviews i      ON i.candidate_id = c.id
LEFT JOIN interviews i_last ON i_last.candidate_id = c.id
    AND i_last.interview_date = (
        SELECT MAX(interview_date) FROM interviews WHERE candidate_id = c.id
    )
LEFT JOIN offers o ON o.candidate_id = c.id
GROUP BY c.id, i_last.status, i_last.result, o.offer_date, o.status, o.days_to_offer, o.actual_start;

-- 月度統計
CREATE OR REPLACE VIEW v_monthly_stats AS
SELECT
    TO_CHAR(i.interview_date, 'YYYY-MM')            AS month,
    COUNT(DISTINCT i.candidate_id)                  AS interviews_count,
    COUNT(DISTINCT o.candidate_id)                  AS offers_count,
    COUNT(DISTINCT CASE WHEN o.status='onboarded' THEN o.candidate_id END) AS onboarded_count,
    ROUND(
        100.0 * COUNT(DISTINCT o.candidate_id)
        / NULLIF(COUNT(DISTINCT i.candidate_id), 0)
    , 1)                                            AS offer_rate_pct,
    AVG(o.days_to_offer)                            AS avg_days_to_offer
FROM interviews i
LEFT JOIN offers o ON o.candidate_id = i.candidate_id
WHERE i.interview_date IS NOT NULL
GROUP BY TO_CHAR(i.interview_date, 'YYYY-MM')
ORDER BY month DESC;

-- HR 工作量
CREATE OR REPLACE VIEW v_hr_workload AS
SELECT
    hr_owner,
    COUNT(*)                    AS total_interviews,
    COUNT(DISTINCT candidate_id) AS unique_candidates,
    SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) AS pending_count,
    MIN(interview_date)         AS earliest,
    MAX(interview_date)         AS latest
FROM interviews
WHERE hr_owner IS NOT NULL
GROUP BY hr_owner
ORDER BY total_interviews DESC;

-- 部門招募進度
CREATE OR REPLACE VIEW v_department_progress AS
SELECT
    c.department,
    COUNT(DISTINCT c.id)        AS total_candidates,
    COUNT(DISTINCT CASE WHEN c.status='in_progress' THEN c.id END) AS in_progress,
    COUNT(DISTINCT CASE WHEN c.status='hired'       THEN c.id END) AS hired,
    COUNT(DISTINCT CASE WHEN c.status='rejected'    THEN c.id END) AS rejected,
    ROUND(
        100.0 * COUNT(DISTINCT CASE WHEN c.status='hired' THEN c.id END)
        / NULLIF(COUNT(DISTINCT c.id), 0)
    , 1)                        AS hire_rate_pct,
    AVG(o.days_to_offer)        AS avg_days_to_offer
FROM candidates c
LEFT JOIN offers o ON o.candidate_id = c.id
GROUP BY c.department
ORDER BY total_candidates DESC;
