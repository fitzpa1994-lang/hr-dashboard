# Workflow3 Live Deploy

Last updated: 2026-06-01

## Purpose

This document covers the live import path for the onboarding/resignation workflow export:

- `n8n/live_Workflow3_到職離職.json`

The current local export now canonicalizes onboarding `department` and `position` before writing to `onboardings` and before the decrement query runs against `job_requisitions`.

## Required env

Set these in the shell before importing the workflow:

```powershell
$env:N8N_API_BASE_URL="https://evanhh.zeabur.app/api/v1"
$env:N8N_API_KEY="<current n8n api key>"
```

## Import command

Run:

```powershell
npm run deploy:n8n:workflow3
```

This uses the known live workflow id:

- `zEIwksk6hz9Ri8NA`

## Post-import audit

After the import, measure how many pending onboarding rows could hit the current requisition table:

```powershell
$env:HR_DASHBOARD_PASSWORD="<dashboard password>"
npm run audit:onboarding-matches
```

## Current canonicalization targets

Examples now covered by the local export and audit logic:

- `五部 SAR工程部 / 工程師` -> `五部 / RF SAR 測試工程師`
- `新華 RF工程組 / 工程師` -> `新華 / RF SAR 測試工程師`
- `新竹 工程部 / 工程師(EMC)` -> `新竹 / 新竹測試工程師`
- `五部 RF工程一部 / 實習工程師` -> `五部 / WE1工程助理(理工相關)`

## Expected next proof

Once the updated export is imported into live n8n, the next fresh onboarding email should provide direct evidence that:

1. the workflow writes canonicalized `department` and `position`
2. `job_requisitions.headcount` decrements on the exact matched row
3. the updated vacancy count is visible through `/api/hr-dashboard`
