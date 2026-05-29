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