# Job Requisitions SDD

Last updated: 2026-06-01

## Scope

This document defines the first implementation slice for job requisition management.

Current target:

1. Normalize the six-department vacancy list into structured data.
2. Keep vacancy maintenance manual for now.
3. When an onboarding email is accepted and written into `onboardings`, decrement the matching vacancy count by `1`.

Out of scope for this slice:

1. Full historical audit log for job edits.
2. Complex fuzzy matching.
3. Automatic vacancy creation from email.
4. Live Zeabur changes during local design and implementation.

## Domain

### Business key

Every job requisition is uniquely identified by:

- `department`
- `position_title`

For the current rollout, `department` stores the canonical org path used by HR,
for example:

- `行政 / 財務部`
- `WBU / RF工程一部`
- `新華 / 工程 / 文件部 / 文件組`

This is the only matching key for automatic decrement.

### Current storage decision

To minimize schema churn in the first slice, the current table stays in place:

- table: `job_requisitions`
- current count field: `headcount`

For this slice, `job_requisitions.headcount` is treated as:

- current open vacancy count

This matches the user's notebook meaning:

- title with a number -> open vacancy count
- title without a number -> recruitment closed
- `數名` -> store as `999`

`filled_count` remains in the table but is not the primary business field for this slice.

### Status mapping

- `open`: requisition is active and can be decremented
- `cancelled`: requisition is closed and should not be decremented
- `on_hold` and `filled`: reserved existing values, not used as primary notebook imports

## Behavior

### Import normalization

Rules for converting the notebook list into structured rows:

1. Preserve the notebook vacancy counts unless the user explicitly splits one row.
2. Rename notebook rows to the closest formal org path + title used by HR.
3. Keep roles that are not yet in the formal sheet as business titles, and
   match them later through keyword aliases.
3. Trailing integer becomes `headcount`.
4. Missing trailing integer means:
   - `headcount = 0`
   - `status = 'cancelled'`
5. `數名` becomes:
   - `headcount = 999`
   - `status = 'open'`
6. Free-text comments become `notes`.

### Automatic decrement on onboarding

Trigger condition:

1. An onboarding event is accepted into `onboardings`.
2. Parsed onboarding data contains both:
   - `department`
   - `position`

Update rule:

1. Canonicalize the onboarding email into:
   - canonical org path
   - canonical title
2. Find `job_requisitions` row by exact match:
   - `department = canonical onboarding department`
   - `position_title = canonical onboarding position`
3. Only update rows with `status = 'open'`.
4. If found and `headcount > 0`, set:
   - `headcount = headcount - 1`
5. Never decrement below `0`.

No-match rule:

1. If no exact match exists, do not modify any requisition row.
2. Record the mismatch in workflow logs or a dedicated note path in a later slice.

Over-decrement rule:

1. If `headcount = 0`, do not decrement further.
2. Keep the row unchanged.

### Matching strictness

The database update still uses strict exact matching only.

Before the exact match, onboarding parsing canonicalizes department/title aliases
into the seeded requisition keys.

Examples:

- `全球檢測股份有限公司 + 技術支援部 + 案件專員`
  -> `ICC / 技術支援部 + 案件專員`
- `國際標準認證事業五部 + RF工程一部 + 實習工程師`
  -> `WBU / RF工程一部 + 測試工程師`
- `安規 + 電池 + 工程師`
  -> `安規 + 電池案件工程師`
- `業務助理` does not match `助理業務/業務`.

Current canonicalization examples:

- `全球檢測股份有限公司 + 技術支援部 + 案件專員`
  -> `ICC / 技術支援部 + 案件專員`
- `新華營運處 + 業務三部 + 客服業務`
  -> `新華 / 業務三部 + 客服業務`
- `國際標準認證事業五部 + RF工程一部 + 實習工程師`
  -> `WBU / RF工程一部 + 測試工程師`
- `財務部 + 財務主任`
  -> `行政 / 財務部 + 主任`

## Interface

### Seed import

Initial seed source:

- `database/job_requisitions_seed.sql`
- `database/job_requisitions_duplicate_audit.sql`

Seed import rule:

- rerunning the seed should only insert missing `(department, position_title)` pairs
- rerunning the seed must not overwrite existing live edits

### Dashboard data shape

The existing dashboard API already returns `jobsData`.

The write path chosen for the first editable implementation is:

- browser -> `dashboard/server.js`
- Node API -> authenticated n8n write webhook
- n8n -> PostgreSQL `job_requisitions`

Backend write endpoints:

- `GET /api/job-requisitions`
- `POST /api/job-requisitions`
- `PATCH /api/job-requisitions/:id`

The current code slice implements both the write endpoints and the dashboard jobs editing UI.

### Manual editing requirements for the dashboard

First editable version should support:

1. Create a requisition
2. Edit department
3. Edit title
4. Edit vacancy count
5. Open/close a requisition
6. Edit notes

Delete can wait until a later slice.

## Open follow-ups

1. Add a unique constraint on `(department, position_title)` after existing live data is checked.
2. Decide whether `filled_count` should later represent cumulative hires or be removed from the UI model.
3. Add a visible mismatch queue for onboarding records that fail exact vacancy matching.
4. Keep a bounded live verification path for onboarding-driven decrement, because the SQL is live but still depends on a fresh onboarding event to prove the whole chain.
5. If onboarding delay/update emails can exist only in `寄件備份` and not in `預計報到人員`, add a second Outlook trigger for that folder. The current live workflow only monitors `預計報到人員` for onboarding updates.
