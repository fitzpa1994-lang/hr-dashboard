# Job Requisitions Module

Last updated: 2026-07-20

## Checklist

- [x] Normalize the six-department vacancy list into structured seed SQL
- [x] Make the initial seed safe to rerun without duplicating existing requisitions
- [x] Define first-slice business rules for vacancy decrement
- [x] Decide local write path for dashboard editing (`server.js` -> n8n write webhook)
- [x] Update dashboard jobs data model to expose vacancy count clearly
- [x] Implement automatic decrement on successful onboarding insert
- [x] Implement authenticated server endpoints for create/update job requisitions
- [x] Deduplicate create requests by exact `department + position_title`
- [x] Add focused tests/validators for vacancy decrement logic
- [x] Add manual editing UI for requisitions in the dashboard
- [x] Verify live import procedure for the initial seed
- [x] Define separate authority for internal requisitions and 104 publication data
- [x] Add persistent `104 external_id -> job_requisition_id` source mapping
- [x] Add authenticated complete-snapshot sync and manual link/unlink APIs
- [x] Add reconciliation state matrix without changing onboarding decrement rules
- [x] Integrate job overview and 104 search strategy into one workspace
- [x] Add pending-link suggestions that require explicit confirmation
- [x] Preserve 104 search profiles when a posting is linked or unlinked
- [x] Add unit and server integration tests for sync, validation, and reconciliation
- [x] Add provider-level complete-snapshot metadata, including zero-job snapshots
- [x] Serialize concurrent snapshots with a database-timed claim before upsert or pending transitions
- [x] Enforce contract-v2 counts and explicit published status in the n8n/PostgreSQL boundary
- [x] Accept a verified authoritative zero-job page while rejecting ambiguous empty pages
- [x] Require explicit successful response shapes for sync, link, and requisition writes
- [x] Use database receipt time for ordering and reject client timestamps over five minutes ahead
- [x] Keep root and active-version SQL copies byte-equivalent after patching
- [ ] Apply `database/job_requisition_sources_pg.sql` to live PostgreSQL
- [ ] Deploy and publish the updated Job Requisition Write workflow
- [ ] Deploy and publish the updated Dashboard API workflow
- [ ] Deploy the dashboard and complete a live 104 sync/link smoke test

## Current decision

- Reuse `job_requisitions.headcount` as the current open vacancy count in the first slice.
- Match onboarding records to requisitions by exact `department + position_title`.
- Missing count in the notebook source becomes `status='cancelled'` and `headcount=0`.
- `數名` becomes `headcount=999`.
- Repeated create/import paths should avoid duplicate rows for the same `department + position_title`.
- Deployment order is strict: PostgreSQL migration -> publish Write workflow -> publish Dashboard workflow -> dashboard app -> live smoke test.
