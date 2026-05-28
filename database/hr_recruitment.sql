-- ============================================================
-- HR 招募追蹤系統 — SQLite 資料表結構
-- 版本：1.0  |  設計日期：2026-05-13
-- 說明：以招募為核心，支援面試追蹤、錄取比對、統計分析
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- TABLE 1：candidates（候選人主表）
-- ============================================================
CREATE TABLE IF NOT EXISTS candidates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    email           TEXT,
    phone           TEXT,
    applied_position TEXT NOT NULL,
    department      TEXT NOT NULL,
    source          TEXT DEFAULT '其他',
    status          TEXT DEFAULT 'in_progress'
        CHECK(status IN ('in_progress','hired','rejected','withdrawn')),
    notes           TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- TABLE 2：interviews（面試記錄）
-- ============================================================
CREATE TABLE IF NOT EXISTS interviews (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id    INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    interview_date  TEXT    NOT NULL,
    interview_time  TEXT,
    round           INTEGER DEFAULT 1,
    interviewer     TEXT,
    location        TEXT,
    hr_owner        TEXT,
    status          TEXT DEFAULT 'scheduled'
        CHECK(status IN ('scheduled','completed','cancelled','rescheduled')),
    result          TEXT DEFAULT 'pending'
        CHECK(result IN ('pending','passed','failed','no_show')),
    email_subject   TEXT,
    email_msg_id    TEXT UNIQUE,
    email_web_link  TEXT,                           -- OWA 直接連結（面板點擊跳轉）
    notes           TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- TABLE 3：offers（錄取記錄）
-- ============================================================
CREATE TABLE IF NOT EXISTS offers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id    INTEGER NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
    offer_date      TEXT    NOT NULL,
    expected_start  TEXT,
    actual_start    TEXT,
    salary_band     TEXT,
    hr_owner        TEXT,
    status          TEXT DEFAULT 'pending'
        CHECK(status IN ('pending','accepted','rejected','withdrawn','onboarded')),
    days_to_offer   INTEGER,
    email_msg_id    TEXT UNIQUE,
    email_web_link  TEXT,
    notes           TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- TABLE 4：email_logs（信件處理日誌）
-- ============================================================
CREATE TABLE IF NOT EXISTS email_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email_msg_id    TEXT NOT NULL UNIQUE,
    email_subject   TEXT,
    sender          TEXT,
    received_at     TEXT,
    action          TEXT
        CHECK(action IN ('inserted','updated','skipped','error')),
    candidate_id    INTEGER REFERENCES candidates(id),
    error_msg       TEXT,
    processed_at    TEXT DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- TABLE 5：job_requisitions（職缺需求）
-- ============================================================
CREATE TABLE IF NOT EXISTS job_requisitions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    position_title  TEXT NOT NULL,
    department      TEXT NOT NULL,
    headcount       INTEGER DEFAULT 1,
    filled_count    INTEGER DEFAULT 0,
    open_date       TEXT,
    target_date     TEXT,
    status          TEXT DEFAULT 'open'
        CHECK(status IN ('open','filled','on_hold','cancelled')),
    urgency         INTEGER DEFAULT 3
        CHECK(urgency BETWEEN 1 AND 5),
    notes           TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- TABLE 6：onboardings（到職記錄）
-- ============================================================
CREATE TABLE IF NOT EXISTS onboardings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id    INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
    name            TEXT    NOT NULL,
    department      TEXT    NOT NULL,
    position        TEXT    NOT NULL,
    hr_owner        TEXT,
    expected_date   TEXT    NOT NULL,
    actual_date     TEXT,
    status          TEXT DEFAULT 'pending'
        CHECK(status IN ('pending','onboarded','cancelled')),
    email_subject   TEXT,
    email_msg_id    TEXT UNIQUE,
    email_web_link  TEXT,
    resume_link     TEXT,                           -- SharePoint / OneDrive 履歷連結
    notes           TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- TABLE 7：resignations（離職記錄）
-- ============================================================
CREATE TABLE IF NOT EXISTS resignations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    department      TEXT    NOT NULL,
    position        TEXT    NOT NULL,
    hr_owner        TEXT,
    resign_date     TEXT,
    last_day        TEXT    NOT NULL,
    reason          TEXT,
    status          TEXT DEFAULT 'active'
        CHECK(status IN ('active','done','cancelled')),
    email_subject   TEXT,
    email_msg_id    TEXT UNIQUE,
    email_web_link  TEXT,
    notes           TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_interviews_candidate   ON interviews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_interviews_date        ON interviews(interview_date);
CREATE INDEX IF NOT EXISTS idx_interviews_status      ON interviews(status);
CREATE INDEX IF NOT EXISTS idx_interviews_msg_id      ON interviews(email_msg_id);
CREATE INDEX IF NOT EXISTS idx_offers_candidate       ON offers(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidates_status      ON candidates(status);
CREATE INDEX IF NOT EXISTS idx_candidates_dept        ON candidates(department);
CREATE INDEX IF NOT EXISTS idx_email_logs_msg_id      ON email_logs(email_msg_id);
CREATE INDEX IF NOT EXISTS idx_onboardings_date       ON onboardings(expected_date);
CREATE INDEX IF NOT EXISTS idx_onboardings_status     ON onboardings(status);
CREATE INDEX IF NOT EXISTS idx_resignations_lastday   ON resignations(last_day);
CREATE INDEX IF NOT EXISTS idx_resignations_status    ON resignations(status);

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_candidates_updated
    AFTER UPDATE ON candidates
    BEGIN UPDATE candidates SET updated_at = datetime('now','localtime') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_interviews_updated
    AFTER UPDATE ON interviews
    BEGIN UPDATE interviews SET updated_at = datetime('now','localtime') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_offers_updated
    AFTER UPDATE ON offers
    BEGIN UPDATE offers SET updated_at = datetime('now','localtime') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_onboardings_updated
    AFTER UPDATE ON onboardings
    BEGIN UPDATE onboardings SET updated_at = datetime('now','localtime') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS trg_resignations_updated
    AFTER UPDATE ON resignations
    BEGIN UPDATE resignations SET updated_at = datetime('now','localtime') WHERE id = NEW.id; END;

-- ============================================================
-- VIEWS
-- ============================================================

CREATE VIEW IF NOT EXISTS v_recruitment_funnel AS
SELECT
    c.id, c.name, c.department, c.applied_position, c.source,
    c.status AS candidate_status,
    COUNT(i.id) AS total_interviews,
    MAX(i.interview_date) AS last_interview_date,
    MAX(i.round) AS max_round,
    i_last.status AS last_interview_status,
    i_last.result AS last_interview_result,
    o.offer_date, o.status AS offer_status, o.days_to_offer,
    o.actual_start AS onboard_date, c.created_at
FROM candidates c
LEFT JOIN interviews i      ON i.candidate_id = c.id
LEFT JOIN interviews i_last ON i_last.candidate_id = c.id
    AND i_last.interview_date = (SELECT MAX(interview_date) FROM interviews WHERE candidate_id = c.id)
LEFT JOIN offers o ON o.candidate_id = c.id
GROUP BY c.id;

CREATE VIEW IF NOT EXISTS v_monthly_stats AS
SELECT
    strftime('%Y-%m', i.interview_date) AS month,
    COUNT(DISTINCT i.candidate_id) AS interviews_count,
    COUNT(DISTINCT o.candidate_id) AS offers_count,
    COUNT(DISTINCT CASE WHEN o.status='onboarded' THEN o.candidate_id END) AS onboarded_count,
    ROUND(100.0 * COUNT(DISTINCT o.candidate_id) / NULLIF(COUNT(DISTINCT i.candidate_id),0), 1) AS offer_rate_pct,
    AVG(o.days_to_offer) AS avg_days_to_offer
FROM interviews i
LEFT JOIN offers o ON o.candidate_id = i.candidate_id
WHERE i.interview_date IS NOT NULL
GROUP BY strftime('%Y-%m', i.interview_date)
ORDER BY month DESC;

CREATE VIEW IF NOT EXISTS v_hr_workload AS
SELECT
    hr_owner,
    COUNT(*) AS total_interviews,
    COUNT(DISTINCT candidate_id) AS unique_candidates,
    SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) AS pending_count,
    MIN(interview_date) AS earliest,
    MAX(interview_date) AS latest
FROM interviews
WHERE hr_owner IS NOT NULL
GROUP BY hr_owner
ORDER BY total_interviews DESC;

CREATE VIEW IF NOT EXISTS v_department_progress AS
SELECT
    c.department,
    COUNT(DISTINCT c.id) AS total_candidates,
    COUNT(DISTINCT CASE WHEN c.status='in_progress' THEN c.id END) AS in_progress,
    COUNT(DISTINCT CASE WHEN c.status='hired'       THEN c.id END) AS hired,
    COUNT(DISTINCT CASE WHEN c.status='rejected'    THEN c.id END) AS rejected,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN c.status='hired' THEN c.id END) / NULLIF(COUNT(DISTINCT c.id),0), 1) AS hire_rate_pct,
    AVG(o.days_to_offer) AS avg_days_to_offer
FROM candidates c
LEFT JOIN offers o ON o.candidate_id = c.id
GROUP BY c.department
ORDER BY total_candidates DESC;
