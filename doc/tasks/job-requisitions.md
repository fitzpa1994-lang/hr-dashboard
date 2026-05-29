# Job Requisitions Module

Last updated: 2026-05-29

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
- [ ] Verify live import procedure for the initial seed

## Current decision

- Reuse `job_requisitions.headcount` as the current open vacancy count in the first slice.
- Match onboarding records to requisitions by exact `department + position_title`.
- Missing count in the notebook source becomes `status='cancelled'` and `headcount=0`.
- `數名` becomes `headcount=999`.
- Repeated create/import paths should avoid duplicate rows for the same `department + position_title`.
