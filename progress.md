# Sporton HR ???啁?Ｘ?脣漲

?湔?交?嚗?026-05-28

## ?桀??嗆?

| 撅斤? | ?銵?| ???|
| --- | --- | --- |
| 鞈?靘? | Outlook ?萎辣 | ??n8n workflow 霈?閰艾?瑯?琿隞?|
| ?芸???| n8n on Zeabur | workflow export 撌脫?蒂???祆? JSON/schema 撽? |
| 鞈?摨?| PostgreSQL on Zeabur | schema 雿輻 constrained status/action ??|
| 敺垢 | Node.js HTTP server | ??撖Ⅳ?餃?? 撠? session??箝ashboard API proxy |
| ?垢 | 蝝?HTML/CSS/JS SPA | 鈭?Tab?oday Bar?rawer??撠?摨?銵函征??歇撖虫? |
| ?函蔡 | Zeabur | root `package.json` + `zbpack.json` ?? `npm start`嚗?◤?園????函蔡 |
| ?啣?閮剖? | `.env.example` | 閮? Zeabur 敹? env key嚗???祕撖Ⅳ/token |
| ?靽? | Git + `.gitignore` | 撌脣?憪??祆? Git嚗???`node_modules`?.env`?ogs?ocal DB/cache?璈極?瑁身摰??怠?瑼?|

## 撌脣???
- ?垢????嚗?  - 撌脣?雿輻??? `hr (5).html` ?乩??暹? Node auth/session/API 瘚?
  - `dashboard/index.html` ?曉隞?`hr (5).html` ??UI ?箏?嚗?雿輻 `/api/session`?/api/login`?/api/logout`?/api/hr-dashboard`
  - 撌脩宏??`no_response` ???????鈭箇祟?豢撠??桀? schema
  - 撌脰????唳??箝?敺?啜??撠鈭箸?撠?閮?蝻箸亥翰摨行?
- Zeabur root ??閮剖?嚗?  - `package.json`嚗npm start` ?瑁? `node dashboard/server.js`
  - `zbpack.json`嚗start_command` ??`npm start`
  - `.env.example`嚗???`HR_DASHBOARD_PASSWORD`?SESSION_SECRET`?N8N_HR_WEBHOOK_URL`?N8N_HR_TOKEN`
  - `.gitignore`嚗??鈭?secrets??鞈氬og?ocal DB 瑼?- ?靽?嚗?  - 撌脣銵?`git init`
  - `.gitignore` 撌脣???`.claude/` ??`tmp_*`
  - `doc/prompt.md` ?扯? n8n API Key 撌脫? `<ROTATED_N8N_API_KEY>`
- ?函蔡???辣嚗?  - `doc/zeabur-deployment.md` 閮? Zeabur 甇?Ⅱ root?tart command??閬?env?ealth check???湧蝵脤?霅? n8n Dashboard API 撽?瘚?
  - `npm run diagnose:deployment` ?臬?瑞?銝??????nv 蝻箸???亙仃????n8n proxy / API contract 憭望?
  - `npm run prepare:zeabur-env` ?舐??Zeabur env 皜???`SESSION_SECRET`
  - `npm run package:deployment` ?舐??`dist/hr-dashboard-zeabur.zip`嚗??GitHub remote 撠閮剖???銋暹楊?函蔡??  - `npm run verify:package` ?航圾憯蝵脣?銝阡?霅?root 瑼?雿蔭????secrets/local files?銵?server/verifier 隤?瑼Ｘ嚗untime HTTP 銵??root `npm test` 閬?
- ?餃??session嚗?  - `/api/health`
  - `/api/login`
  - `/api/session`
  - `/api/logout`
  - `/api/hr-dashboard`
  - `/api/health` ?臬??餃瑼Ｘ Node server ?臬????閬?env ?臬摮嚗? boolean嚗?瘣拇?撖Ⅳ/token
  - cookie 雿輻 `HttpOnly`?SameSite=Lax`??閮?8 撠???
  - 撌脫? integration test 閬? `SESSION_TTL_MS` ?唳?敺?`/api/session` ?? 401
  - ?垢? 401 / session ?????啁?仿蝵抬???餃敺??頛???  - `/api/hr-dashboard` 隞?? n8n ?? server-side timeout嚗?閮?10 蝘??暹???504嚗??Zeabur 隢??∩?
- ?垢 UX嚗?  - 蝘駁?內????  - Header 憿舐內?交???敺?唳????唳??箝??撠?  - ?餃隢???timeout ?隤斗?蝷?  - Today Bar 憿舐內隞?Ｚ岫???亙?瑯?梢?瑯???撅交風鈭箏? chip
  - ???交??航?祟?豢?蝔?  - ???∠??舫? Drawer??憪縑隞塚??＊蝷箸?蝣?fallback
  - 鈭粹?”?舀????摨??祟?詻?閮餅??  - 撌脩宏?支?蝚血? DB schema ??`no_response` ?????  - ?啗餈質馱??敺??/ 撌脣??  - ?”?∟???憿舐內蝛箇???  - Drawer 撠撩撠?Outlook / 撅交風?????蝣箄牧??  - Tab ????甇?URL hash
  - ?瑞撩銵典歇? `urgency`
- n8n / DB 銝?湔改?
  - workflow 銝???runtime `DROP CONSTRAINT` ?曉祝鞈?摨?  - `email_logs.action` ?寧 schema ?迂??  - candidate / interview / onboarding / resignation 撖怠??歇撠? PostgreSQL schema
  - Dashboard API export ? `jobsData`?departmentStats`?pendingReviewCount`?resumeLink`?avgDaysToOffer`
  - `live_HR_Portal.json` 撌脫?閮 legacy / do-not-deploy嚗雁??inactive + archived嚗迤撘?? Node server + `live_Dashboard_API.json`
- 撽?嚗?  - `dashboard/scripts/verify-dashboard-static.mjs`
  - `dashboard/js/__tests__/server.integration.test.js`
  - `dashboard/js/__tests__/dataUtils.test.js`
  - `scripts/verify_runtime.mjs`
  - `scripts/verify_deployment.mjs`
  - `scripts/serve_visual_fixture.mjs`
  - `scripts/serve_visual_ui_fixture.mjs`
  - `scripts/validate_n8n_exports.py`
  - `scripts/verify_project.mjs`

## ?餈?霅???
```text
npm test
Dashboard static verification passed
Runtime HTTP verification passed
Deployment diagnosis syntax check
Deployment verifier syntax check
Zeabur env preparation syntax check
Visual fixture syntax check passed
Visual UI fixture syntax check passed
n8n export validation passed: 9 JSON files
Project verification passed
Test Suites: 2 passed, 2 total
Tests: 10 passed, 10 total
```

```text
npm run diagnose:deployment
PASS GET / UI version - current SPA shell detected
PASS /api/health service - status=200
PASS Zeabur env - all required keys reported true
SKIP Authenticated flow - set HR_DASHBOARD_PASSWORD to diagnose login and proxy
```

```text
npm run verify:deployment
Health check passed
No HR_DASHBOARD_PASSWORD provided; skipping authenticated flow.
```

## 撠摰? / 撠鋡怠?????
- 2026-05-28 撌脣? Zeabur `hr-dashboard` service source 敺?GitHub `main` ? `node-dashboard-deploy` ?嚗蒂??函蔡??- 2026-05-28 撌脣祕皜?`https://sp-hr.zeabur.app/api/health`嚗????Node health JSON嚗service=hr-dashboard`嚗???閬?env key ?賣 `true`??- 撌脩?祆??函? Node 摮?蝔?霅?root runtime HTTP 瘚?嚗eabur 蝺?撌脤? health/env 瑼Ｘ嚗?撠???祆? `HR_DASHBOARD_PASSWORD` ?瑁? authenticated deployment flow嚗?  - `/api/login`
  - `/api/session`
  - `/api/hr-dashboard`
  - `/api/logout`
- 撠?冽???Zeabur n8n token ?瑁? `scripts/validate_dashboard_api.py` 撽? live Dashboard webhook??- 撠?函?撖?Outlook ?唬縑隞嗅??渲粥摰?
  - Outlook trigger
  - n8n parse
  - PostgreSQL 撖怠
  - Dashboard refresh 憿舐內
- 撌脰身摰?GitHub remote `https://github.com/fitzpa1994-lang/hr-dashboard.git`嚗蒂撠璈耨甇???典 `node-dashboard-deploy` ?嚗eabur ?桀???甇文??胯?
## Zeabur 敹??啣?霈

| Key | ?券?|
| --- | --- |
| `HR_DASHBOARD_PASSWORD` | Dashboard ?餃撖Ⅳ |
| `HR_DASHBOARD_URL` | ?函蔡撽??單雿輻??Dashboard URL嚗?憒?`https://sp-hr.zeabur.app` |
| `SESSION_SECRET` | 蝪賜蔡 session cookie嚗?雿輻?琿璈?銝?|
| `N8N_HR_WEBHOOK_URL` | n8n `live_Dashboard_API.json` webhook URL |
| `N8N_HR_TOKEN` | n8n Dashboard API token |
| `N8N_PROXY_TIMEOUT_MS` | ?舫嚗ode proxy 蝑?n8n ??timeout嚗?閮?10000 |

蝺??函蔡敺?炎?伐?

```powershell
Invoke-WebRequest -UseBasicParsing https://sp-hr.zeabur.app/api/health
```

?? `ok: true`嚗???閬?env key ?賣 `true`?迨蝡舫?銝??撖阡?撖Ⅳ??token??
摰蝺??函蔡瑼Ｘ嚗?
```powershell
$env:HR_DASHBOARD_URL="https://sp-hr.zeabur.app"
$env:HR_DASHBOARD_PASSWORD="<dashboard password>"
npm run verify:deployment
```

?亙閮剖? `HR_DASHBOARD_URL`嚗?祆??芣炎??`/api/health`嚗??身摰?`HR_DASHBOARD_PASSWORD` ????撽??餃?ession?ashboard proxy ??箝?
## n8n Export 瘜冽?鈭?

- 甇??雿輻嚗?  - `live_Workflow1_?Ｚ岫閫??.json`
  - `live_Workflow3_?啗?Ｚ.json`
  - `live_Dashboard_API.json`
- `live_HR_Portal.json` ?航?????portal嚗?恍???UI ?摩嚗?靽???蝳迫雿甇?? Dashboard ?亙??- `scripts/validate_n8n_exports.py` ?炎??legacy portal 敹?靽? `active: false`?isArchived: true`??蝔勗???`LEGACY_DO_NOT_DEPLOY`??
## Browser 撽?蝝??
- 雿輻?祆? UI fixture 撽?獢銝餌?Ｗ頛 mock Dashboard API 鞈???- 撌脩Ⅱ隤?Today Bar 憿舐內隞?Ｚ岫???亙?瑯???撅交風??- Browser 撽??潛??梢?瘀??喲望嚗??祆??望鞈?嚗歇靽格迤?望閮??摩?粹望蝯?嚗蒂?踹? `toISOString()` ???宏??- 撌脩Ⅱ隤???Drawer ?舐???∠???嚗?蝻箏? Outlook / 撅交風?????隤芣?????- 撌脩 390px ??撖砍漲瑼Ｘ銝餉? Header / Today Bar / ?? / ?????航?嚗??Ｘ???銝餉??批捆???湧?璈怠?皞Ｗ??- ?芸? API ?函??Browser 憭??啣??暹?嚗活隞?DOM snapshot ??layout bounding box 雿閬死撽?霅???
## 銝?甇亙遣霅?
1. ?冽璈身摰?`HR_DASHBOARD_PASSWORD` 敺?摰 authenticated deployment flow嚗?
```powershell
$env:HR_DASHBOARD_URL="https://sp-hr.zeabur.app"
$env:HR_DASHBOARD_PASSWORD="<dashboard password>"
npm run diagnose:deployment
npm run verify:deployment
```

2. ?冽??? `N8N_HR_TOKEN` 頝?

```powershell
$env:N8N_HR_TOKEN="..."
python scripts\validate_dashboard_api.py
```

3. ?其?撠葫閰?Outlook ?Ｚ岫靽⊿?霅?????PostgreSQL 敺??垢????渡??舐??唳鞈???4. authenticated flow ??n8n/Outlook E2E ?賡?敺??捱摰?血? `node-dashboard-deploy` ?蔥??甇亙 GitHub `main`??## 2026-05-29 Job Requisition Update
- Dashboard jobs editing path is now wired end-to-end in local code:
  - POST /api/job-requisitions
  - PATCH /api/job-requisitions/:id
  - n8n/live_Job_Requisition_Write.json
- n8n/live_Dashboard_API.json now includes requisition id in jobsData.
- jobsData no longer excludes status = 'cancelled', so closed requisitions remain visible for dashboard editing.
- scripts/validate_n8n_exports.py now fails if the dashboard export drops requisition ids or reintroduces the cancelled filter.
- Local verification status:
  - python scripts\\validate_n8n_exports.py passed
  - npm test passed (16 passed)
- Remaining work:
  - deploy updated dashboard server + n8n exports to Zeabur
  - import database/job_requisitions_seed.sql
  - verify live jobs tab create/update flow against PostgreSQL

## 2026-06-01 Deployment Verification Update
- `scripts/verify_deployment.mjs` now defaults to `https://sp-hr.zeabur.app`, matching `diagnose:deployment` and `.env.example`.
- `npm run verify:deployment` now works without passing the dashboard URL explicitly.
- Re-verified current live deployment with:
  - `npm test`
  - `npm run diagnose:deployment`
  - `npm run verify:deployment` with `HR_DASHBOARD_PASSWORD`
- Verified live job requisition rollout status:
  - dashboard jobs editor route is live
  - `jobsData` contains 25 requisitions across 6 departments
  - live create/update writes round-trip through PostgreSQL and back into `/api/hr-dashboard`
  - initial seed rollout is considered verified
- Remaining high-signal follow-up:
  - prove a fresh live onboarding event decrements the matching requisition headcount through the full Outlook -> n8n -> PostgreSQL chain

## 2026-06-01 Onboarding Match Audit
- Added `npm run audit:onboarding-matches` via `scripts/audit_onboarding_matches.mjs`.
- The audit authenticates against `https://sp-hr.zeabur.app`, reads `/api/hr-dashboard`, and compares pending `onboardData` rows against `jobsData` by exact `dept + pos`.
- Current live result:
  - `pendingOnboardCount = 29`
  - `matchedCount = 0`
  - `decrementableMatchCount = 0`
- Representative unmatched live rows:
  - `張洛圖 / 五部 SAR工程部 / 工程師 / 2026-06-01`
  - `楊芝萱 / 新華 RF工程組 / 工程師 / 2026-06-01`
  - `翁如慧 / ICC 技術支援部 / 案件專員 / 2026-06-15`
- Conclusion:
  - the live onboarding ingestion path is writing rows into `onboardings`
  - but the current exact-match decrement rule does not hit any current requisition rows
  - automatic vacancy decrement is therefore not yet proven in real live data

## 2026-06-01 Canonical Match Layer
- Added `dashboard/js/onboardingCanonicalization.js` and tests for canonical department/title mapping.
- `npm run audit:onboarding-matches` now applies the same canonicalization rules before checking exact requisition keys.
- Current audit result after canonicalization:
  - `pendingOnboardCount = 29`
  - `matchedCount = 19`
  - `decrementableMatchCount = 15`
- Representative canonicalized live matches:
  - `五部 SAR工程部 / 工程師` -> `五部 / RF SAR 測試工程師`
  - `新華 RF工程組 / 工程師` -> `新華 / RF SAR 測試工程師`
  - `新竹 工程部 / 工程師(EMC)` -> `新竹 / 新竹測試工程師`
  - `五部 RF工程一部 / 實習工程師` -> `五部 / WE1工程助理(理工相關)`
- Local `live_Workflow3_*.json` export now rewrites onboarding `department` and `position` through the same canonicalization rules before the `INSERT INTO onboardings` / decrement query.

## 2026-06-01 Live Wrap-up
- Deployed updated `live_Workflow3_到職離職.json` to live n8n so reply threads are no longer skipped just because the subject starts with `RE:`.
- Workflow3 now prioritizes body-based `update_date` detection and can extract revised onboarding dates from wording such as:
  - `改為`
  - `改到`
  - `延後到`
  - `延至`
  - `更改報到`
  - `調整報到`
- Added and executed one-off cleanup script:
  - `scripts/fix_chentianyi_onboarding_history.mjs`
- Cleanup result:
  - cancelled `4` bad historical onboarding rows (`未知姓名 / 未分類 / 未知職位`)
  - upserted `1` corrected row for `陳天怡 / 行政 / 財務部 / 主任 / 2026-06-01`
- Latest live onboarding audit:
  - `pendingOnboardCount = 26`
  - `matchedCount = 26`
  - `unmatchedCount = 0`
  - `decrementableMatchCount = 21`
- Current functional status:
  - live onboarding vacancy matching is fully reconciled for current pending rows
  - delayed onboarding reply emails in `預計報到人員` now update the expected onboard date correctly
- Remaining non-blocking follow-up:
  - none on the current live path

## 2026-06-01 Sent Backup Trigger
- Added a second live onboarding Outlook trigger for `寄件備份`.
- Purpose:
  - capture self-sent onboarding delay/update emails that may never re-enter `預計報到人員`
  - send them through the same Workflow3 onboarding intent path
- Live workflow redeployed after the trigger update.
- This removes the previous known gap where HR-originated update threads could be missed if they only existed in Sent Backup.

## 2026-07-20 104 Job Requisition Integration

- Unified Job Management into two subviews:
  - internal requisition overview and reconciliation
  - 104 search strategy
- Kept the existing business logic intact:
  - internal `department + position_title` remains the onboarding decrement key
  - `status='open' && headcount>0` remains the effective open-vacancy rule
  - 104 titles and publication state never overwrite internal keys or vacancy counts
- Added persistent external posting model:
  - `database/job_requisition_sources_pg.sql`
  - stable `(source='104', external_id)` identity
  - optional FK to `job_requisitions.id`
  - `open` / `pending_confirmation` publication state
- Added authenticated dashboard APIs:
  - `POST /api/job-requisitions/sync-104`
  - `PATCH /api/job-requisition-sources/104/:externalId`
- Added complete-snapshot safety:
  - contract v2 validates request size, job count, IDs, titles, timestamps, 104 URLs, explicit open status, and exact source/published counts
  - direct n8n requests reject missing arrays/timestamps, more than 500 jobs, malformed field types, mismatched 104 URLs, and client clocks over five minutes ahead before any source-row mutation
  - provider ordering uses PostgreSQL receipt time; browser clock differences cannot make a new sync appear stale
  - provider-level `job_requisition_source_syncs` persists successful snapshots even when the result contains zero published jobs
  - an atomic database-timed provider claim serializes concurrent snapshots before any source rows change
  - incomplete or inconsistent direct webhook requests perform zero source-row mutations
  - missing postings become `pending_confirmation`
  - no automatic delete or internal cancellation
- Added dashboard reconciliation UI:
  - internal and 104 status shown on separate axes
  - exact-title suggestions require manual confirmation
  - create-from-104, link, unlink, and search-strategy navigation
  - multiple 104 postings may map to one internal requisition
- Added pure reconciliation logic and tests for all state combinations, duplicate titles, title changes, local-storage fallback, and non-mutation.
- Local verification:
  - dashboard static verification passed
  - dashboard Jest: 11 suites / 94 tests passed
  - runtime HTTP verification passed
  - 104 sync v2 schema/workflow verifier passed
  - n8n deployment helper mock tests: 7 passed without network access
  - Job Requisition Write contract tests: 3 passed
  - job requisition asset validation passed (28 rows / 6 departments)
  - both updated n8n exports parse as JSON; their root and embedded active-version SQL copies are exact and contain the required integration markers
  - the full `npm test` wrapper still reports the existing validator findings for Dashboard runtime `DROP CONSTRAINT` and the unchanged Workflow3 resignation `pending` value; the same two Dashboard SQL copies already contained runtime `DROP CONSTRAINT` in `HEAD`
- Updated the 104 extension to v1.3.2 / contract v2; it accepts the live 104 direct-`TH` header layout, the verified empty-filter pagination query, and an authoritative zero-job page, while rejecting non-empty or ambiguous filters, table layouts, unknown statuses, duplicate IDs, incomplete pagination, and inconsistent counts without changing the saved snapshot.
- Sync, link/unlink, and requisition saves now require explicit successful response bodies with matching IDs/counts instead of trusting HTTP 2xx alone.
- Rollout status:
  - PostgreSQL source/sync tables and requisition unique index applied; live requisitions preserved (37 rows at final verification)
  - Write workflow, Dashboard API workflow, and dashboard app deployed and verified
  - Chrome extension `chrome-extension/104-job-sync` v1.3.2 reloaded and verified against the authenticated live 104 account
  - authenticated complete sync passed on 2026-07-21: contract v2, 103 total 104 jobs, 49 published/stored, 0 duplicate external IDs, 0 broken links
  - reversible link smoke passed: 104 #4789153 linked to internal requisition #4, then unlinked back to `NULL`; the internal requisition fields remained unchanged
  - rollout complete
