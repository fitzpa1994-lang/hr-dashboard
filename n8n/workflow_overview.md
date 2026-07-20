# n8n Workflow Overview

Updated: 2026-07-20

## Production Architecture

The dashboard frontend and login/session layer are served by the Node.js app in `dashboard/server.js`.
n8n is responsible for Outlook ingestion and for the JSON Dashboard API consumed by the Node proxy.

Production dashboard path:

```text
Browser
  -> Zeabur Node.js dashboard server
  -> /api/hr-dashboard proxy
  -> n8n live_Dashboard_API.json webhook
  -> PostgreSQL
```

Planned job requisition write path:

```text
Browser
  -> Zeabur Node.js dashboard server
  -> /api/job-requisitions (POST/PATCH)
  -> n8n live_Job_Requisition_Write.json webhook
  -> PostgreSQL
```

Do not deploy `live_HR_Portal.json` as the production dashboard. It is a legacy static n8n portal retained for reference only and must remain archived/inactive.

## Active Exports

| File | n8n name | Purpose |
| --- | --- | --- |
| `live_Workflow1_面試解析.json` | HR Workflow 1：面試信件解析 | Parses Outlook interview/recommendation email and writes candidates/interviews/email logs. |
| `live_Workflow3_到職離職.json` | HR Workflow：到職離職信件自動匯入 | Parses onboarding and resignation email and writes onboardings/resignations/email logs. |
| `live_Dashboard_API.json` | HR Dashboard API | Returns dashboard JSON, including internal requisitions and persisted 104 posting links, for the Node.js proxy. |
| `live_Job_Requisition_Write.json` | HR Job Requisition Write | Receives authenticated requisition create/update, complete 104 snapshot sync, and 104 posting link/unlink requests. |

## Inactive / Utility Exports

| File | Purpose |
| --- | --- |
| `live_Workflow2_歷史匯入.json` | Historical import workflow retained for manual/backfill use. |
| `live_Workflow2_歷史匯入_近30天.json` | 30-day historical import workflow retained for manual/backfill use. |
| `live_temp_db_check.json` | Temporary DB count check. |
| `live_tmp_check.json` | Temporary DB check. |
| `live_tmp_check2.json` | Temporary DB check. |
| `live_HR_Portal.json` | Legacy static portal. Must stay `active: false`, `isArchived: true`, and named `LEGACY_DO_NOT_DEPLOY...`. |

## Data Contracts

PostgreSQL constrained values must be respected by every workflow:

| Table field | Allowed values |
| --- | --- |
| `candidates.status` | `in_progress`, `pending_review`, `approved_to_invite`, `hired`, `rejected`, `withdrawn` |
| `interviews.status` | `scheduled`, `completed`, `cancelled`, `rescheduled` |
| `interviews.result` | `pending`, `passed`, `failed`, `no_show` |
| `offers.status` | `pending`, `accepted`, `rejected`, `withdrawn`, `onboarded` |
| `email_logs.action` | `inserted`, `updated`, `skipped`, `error` |
| `job_requisitions.status` | `open`, `filled`, `on_hold`, `cancelled` |
| `job_requisition_sources.publication_status` | `open`, `pending_confirmation` |
| `onboardings.status` | `pending`, `onboarded`, `cancelled` |
| `resignations.status` | `active`, `done`, `cancelled` |

104 complete snapshots use contract version `2`. The write workflow accepts a
snapshot only when `jobs` is an explicit array of at most 500 strict records,
`complete=true`, count fields are internally consistent, every URL identifies
the matching `vip.104.com.tw/job/jobmaster` job number, all published rows carry
`status='open'`, and `syncedAt` is valid and no more than five minutes ahead of
the database clock. Browser time is validation metadata only; the atomic
provider claim uses PostgreSQL `clock_timestamp()` for ordering. The claim,
posting upserts, and missing-posting transitions are one PostgreSQL statement,
so an invalid or failed claim performs zero source-row mutations. The Dashboard
API returns this provider row as `external104Sync`, including successful
zero-job snapshots.

Production rollout order is mandatory:

1. Apply `database/job_requisition_sources_pg.sql`.
2. Deploy and publish `live_Job_Requisition_Write.json`.
3. Deploy and publish `live_Dashboard_API.json`.
4. Deploy the Node/dashboard app.
5. Run authenticated zero/non-zero sync, malformed-request, link, and unlink smoke tests.

## Validation

Run before importing or deploying workflow changes:

```powershell
npm test
```

This includes:

- Dashboard static verifier
- Dashboard Jest tests
- Runtime HTTP verification for the Node server
- Visual fixture syntax checks
- n8n export validation
- Python verifier compilation

For live Dashboard API validation, set a current token and run:

```powershell
$env:N8N_HR_TOKEN="..."
python scripts\validate_dashboard_api.py
```
