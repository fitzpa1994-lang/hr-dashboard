# Job Requisitions SDD

Last updated: 2026-05-29

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

1. Department headers become `department`.
2. Title text becomes `position_title`.
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

1. Find `job_requisitions` row by exact match:
   - `department = onboarding.department`
   - `position_title = onboarding.position`
2. Only update rows with `status = 'open'`.
3. If found and `headcount > 0`, set:
   - `headcount = headcount - 1`
4. Never decrement below `0`.

No-match rule:

1. If no exact match exists, do not modify any requisition row.
2. Record the mismatch in workflow logs or a dedicated note path in a later slice.

Over-decrement rule:

1. If `headcount = 0`, do not decrement further.
2. Keep the row unchanged.

### Matching strictness

This slice uses strict exact matching only.

Examples:

- `安規 + 助理業務` matches only that exact row.
- `五部 + RF SAR 測試工程師` does not match `新華 + RF SAR 測試工程師`.
- `業務助理` does not match `助理業務`.

Alias mapping is explicitly out of scope for the first slice.

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
