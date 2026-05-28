import os
import requests
import sys
from datetime import date

WEBHOOK_URL = os.environ.get("N8N_HR_WEBHOOK_URL", "https://evanhh.zeabur.app/webhook/hr-dashboard")
TOKEN = os.environ.get("N8N_HR_TOKEN")

if not TOKEN:
    print("❌ Missing N8N_HR_TOKEN environment variable")
    sys.exit(1)

API_URL = WEBHOOK_URL
headers = {"Authorization": f"Bearer {TOKEN}"}
today_str = date.today().isoformat()

print(f"Validating Dashboard API at {API_URL}")
print(f"Today: {today_str}\n")

try:
    res = requests.get(API_URL, headers=headers, timeout=10)
except Exception as e:
    print(f"❌ 連線失敗：{e}")
    sys.exit(1)

assert res.status_code == 200, f"非 200 回應：{res.status_code}\n{res.text[:200]}"

try:
    data = res.json()
except Exception as e:
    print(f"❌ 回應不是 JSON：{e}")
    sys.exit(1)

errors = []

# E1: Top-level fields
required_keys = ['today', 'generatedAt', 'schedEvents', 'onboardData',
                 'resignData', 'candidatesData', 'jobsData', 'monthlyTrend',
                 'departmentStats', 'stats']
for k in required_keys:
    if k not in data:
        errors.append(f"缺少頂層欄位：{k}")

# E2: schedEvents structure
if data.get('schedEvents'):
    event = data['schedEvents'][0]
    for field in ['type', 'name', 'pos', 'dept', 'date', 'hr', 'emailLink']:
        if field not in event:
            errors.append(f"schedEvents 缺少欄位：{field}")

# E3: onboardData structure
if data.get('onboardData'):
    ob = data['onboardData'][0]
    for field in ['name', 'dept', 'pos', 'date', 'hr', 'status', 'emailLink']:
        if field not in ob:
            errors.append(f"onboardData 缺少欄位：{field}")

# E4: resignData structure
if data.get('resignData'):
    r = data['resignData'][0]
    for field in ['name', 'dept', 'pos', 'lastDay', 'hr', 'status', 'emailLink']:
        if field not in r:
            errors.append(f"resignData 缺少欄位：{field}")

# E5: candidatesData contains history
if data.get('candidatesData'):
    cand = data['candidatesData'][0]
    for field in ['name', 'pos', 'dept', 'status', 'emailLink', 'resumeLink']:
        if field not in cand:
            errors.append(f"candidatesData 缺少欄位：{field}")
    if 'history' not in cand:
        errors.append("candidatesData 缺少 history 欄位")
    elif cand['history']:
        h = cand['history'][0]
        for field in ['date', 'type', 'title']:
            if field not in h:
                errors.append(f"candidatesData.history 缺少欄位：{field}")

# E6: jobsData structure
if data.get('jobsData'):
    job = data['jobsData'][0]
    for field in ['pos', 'dept', 'open', 'cands', 'hired', 'urgency', 'status']:
        if field not in job:
            errors.append(f"jobsData 缺少欄位：{field}")

# E7: monthlyTrend near 6 months
if len(data.get('monthlyTrend', [])) < 1:
    errors.append("monthlyTrend 為空")
elif data['monthlyTrend']:
    mt = data['monthlyTrend'][0]
    for field in ['month', 'interviews', 'offers', 'onboarded']:
        if field not in mt:
            errors.append(f"monthlyTrend 缺少欄位：{field}")

# E8: stats fields
if data.get('departmentStats'):
    dept = data['departmentStats'][0]
    for field in ['dept', 'candidates', 'hired', 'avgDaysToOffer']:
        if field not in dept:
            errors.append(f"departmentStats 缺少欄位：{field}")

# E9: stats fields
stats_keys = ['activeCount', 'offerCount', 'pendingOnboard', 'pendingResign',
              'monthOnboard', 'monthResign', 'hireRate', 'pendingReviewCount',
              'avgDaysToOffer']
for k in stats_keys:
    if k not in data.get('stats', {}):
        errors.append(f"stats 缺少欄位：{k}")

# E10: invalid auth should return 403/401
try:
    bad_res = requests.get(API_URL, headers={"Authorization": "Bearer wrong"}, timeout=5)
    if bad_res.status_code not in (401, 403):
        errors.append(f"無效 token 應回傳 401/403，實際：{bad_res.status_code}")
except Exception:
    pass

if errors:
    print("❌ 驗證失敗：")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
else:
    print("✅ Dashboard API 驗證通過")
    print(f"  schedEvents: {len(data.get('schedEvents', []))} 筆")
    print(f"  onboardData: {len(data.get('onboardData', []))} 筆")
    print(f"  resignData: {len(data.get('resignData', []))} 筆")
    print(f"  candidatesData: {len(data.get('candidatesData', []))} 筆")
    print(f"  monthlyTrend: {len(data.get('monthlyTrend', []))} 個月")
    print(f"  departmentStats: {len(data.get('departmentStats', []))} 個部門")
    stats = data.get('stats', {})
    print(f"  stats.activeCount: {stats.get('activeCount')}")
    print(f"  stats.pendingOnboard: {stats.get('pendingOnboard')}")
