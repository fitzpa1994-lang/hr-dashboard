import os
import sys
from datetime import date
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import requests


DEFAULT_DASHBOARD_URL = "https://sp-hr.zeabur.app"
DEFAULT_WEBHOOK_URL = "https://evanhh.zeabur.app/webhook/hr-dashboard"


def with_token(url: str, token: str) -> str:
    parsed = urlparse(url)
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    params.setdefault("token", token)
    return urlunparse(parsed._replace(query=urlencode(params)))


def validate_payload(data: dict) -> list[str]:
    errors = []

    required_keys = [
        "today",
        "generatedAt",
        "schedEvents",
        "onboardData",
        "resignData",
        "candidatesData",
        "jobsData",
        "monthlyTrend",
        "departmentStats",
        "stats",
    ]
    for key in required_keys:
        if key not in data:
            errors.append(f"缺少頂層欄位：{key}")

    if data.get("schedEvents"):
        event = data["schedEvents"][0]
        for field in ["type", "name", "pos", "dept", "date", "hr", "emailLink"]:
            if field not in event:
                errors.append(f"schedEvents 缺少欄位：{field}")

    if data.get("onboardData"):
        onboard = data["onboardData"][0]
        for field in ["name", "dept", "pos", "date", "hr", "status", "emailLink"]:
            if field not in onboard:
                errors.append(f"onboardData 缺少欄位：{field}")

    if data.get("resignData"):
        resign = data["resignData"][0]
        for field in ["name", "dept", "pos", "lastDay", "hr", "status", "emailLink"]:
            if field not in resign:
                errors.append(f"resignData 缺少欄位：{field}")

    if data.get("candidatesData"):
        candidate = data["candidatesData"][0]
        for field in [
            "name",
            "pos",
            "dept",
            "status",
            "emailLink",
            "resumeLink",
            "recommendEmailMsgId",
            "recommendEmailSubject",
            "recommendEmailReceivedAt",
        ]:
            if field not in candidate:
                errors.append(f"candidatesData 缺少欄位：{field}")
        if "history" not in candidate:
            errors.append("candidatesData 缺少 history 欄位")
        elif candidate["history"]:
            history = candidate["history"][0]
            for field in ["date", "type", "title"]:
                if field not in history:
                    errors.append(f"candidatesData.history 缺少欄位：{field}")

    if data.get("jobsData"):
        job = data["jobsData"][0]
        for field in ["pos", "dept", "open", "cands", "hired", "urgency", "status"]:
            if field not in job:
                errors.append(f"jobsData 缺少欄位：{field}")

    if len(data.get("monthlyTrend", [])) < 1:
        errors.append("monthlyTrend 為空")
    elif data["monthlyTrend"]:
        trend = data["monthlyTrend"][0]
        for field in ["month", "interviews", "offers", "onboarded"]:
            if field not in trend:
                errors.append(f"monthlyTrend 缺少欄位：{field}")

    if data.get("departmentStats"):
        dept = data["departmentStats"][0]
        for field in ["dept", "candidates", "hired", "avgDaysToOffer"]:
            if field not in dept:
                errors.append(f"departmentStats 缺少欄位：{field}")

    stats_keys = [
        "activeCount",
        "offerCount",
        "pendingOnboard",
        "pendingResign",
        "monthOnboard",
        "monthResign",
        "hireRate",
        "pendingReviewCount",
        "avgDaysToOffer",
    ]
    for key in stats_keys:
        if key not in data.get("stats", {}):
            errors.append(f"stats 缺少欄位：{key}")

    return errors


def fetch_via_dashboard() -> tuple[dict, str]:
    dashboard_url = os.environ.get("HR_DASHBOARD_URL", DEFAULT_DASHBOARD_URL).rstrip("/")
    password = os.environ.get("HR_DASHBOARD_PASSWORD")
    if not password:
        raise RuntimeError("missing HR_DASHBOARD_PASSWORD")

    session = requests.Session()
    login = session.post(
        f"{dashboard_url}/api/login",
        json={"password": password},
        timeout=10,
    )
    if login.status_code != 200:
        raise RuntimeError(f"dashboard login failed: {login.status_code} {login.text[:200]}")

    response = session.get(f"{dashboard_url}/api/hr-dashboard", timeout=15)
    if response.status_code != 200:
        raise RuntimeError(f"dashboard proxy failed: {response.status_code} {response.text[:200]}")

    try:
        data = response.json()
    except Exception as exc:
        raise RuntimeError(f"dashboard proxy did not return JSON: {exc}") from exc

    return data, f"{dashboard_url}/api/hr-dashboard"


def fetch_via_webhook() -> tuple[dict, str]:
    webhook_url = os.environ.get("N8N_HR_WEBHOOK_URL", DEFAULT_WEBHOOK_URL)
    token = os.environ.get("N8N_HR_TOKEN")
    if not token:
        raise RuntimeError("missing N8N_HR_TOKEN")

    api_url = with_token(webhook_url, token)
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(api_url, headers=headers, timeout=10)
    if response.status_code != 200:
        raise RuntimeError(f"dashboard webhook failed: {response.status_code} {response.text[:200]}")

    try:
        data = response.json()
    except Exception as exc:
        raise RuntimeError(f"dashboard webhook did not return JSON: {exc}") from exc

    bad_response = requests.get(api_url, headers={"Authorization": "Bearer wrong"}, timeout=5)
    if bad_response.status_code not in (401, 403):
        raise RuntimeError(f"無效 token 應回傳 401/403，實際：{bad_response.status_code}")

    return data, api_url


def main() -> int:
    today_str = date.today().isoformat()
    mode = None

    try:
        if os.environ.get("HR_DASHBOARD_PASSWORD"):
            data, source = fetch_via_dashboard()
            mode = "dashboard"
        else:
            data, source = fetch_via_webhook()
            mode = "webhook"
    except Exception as first_error:
        if os.environ.get("HR_DASHBOARD_PASSWORD") and os.environ.get("N8N_HR_TOKEN"):
            try:
                data, source = fetch_via_webhook()
                mode = "webhook"
            except Exception as second_error:
                print(f"ERROR: dashboard 驗證失敗：{first_error}")
                print(f"ERROR: webhook 驗證也失敗：{second_error}")
                return 1
        else:
            print(f"ERROR: 驗證失敗：{first_error}")
            return 1

    print(f"Validating Dashboard API at {source}")
    print(f"Today: {today_str}")
    print(f"Mode: {mode}\n")

    errors = validate_payload(data)

    if errors:
        print("ERROR: 驗證失敗：")
        for error in errors:
            print(f"  - {error}")
        return 1

    print("OK: Dashboard API 驗證通過")
    print(f"  schedEvents: {len(data.get('schedEvents', []))} 筆")
    print(f"  onboardData: {len(data.get('onboardData', []))} 筆")
    print(f"  resignData: {len(data.get('resignData', []))} 筆")
    print(f"  candidatesData: {len(data.get('candidatesData', []))} 筆")
    print(f"  jobsData: {len(data.get('jobsData', []))} 筆")
    print(f"  monthlyTrend: {len(data.get('monthlyTrend', []))} 個月")
    print(f"  departmentStats: {len(data.get('departmentStats', []))} 個部門")
    stats = data.get("stats", {})
    print(f"  stats.activeCount: {stats.get('activeCount')}")
    print(f"  stats.pendingReviewCount: {stats.get('pendingReviewCount')}")
    print(f"  stats.pendingInviteOpenCount: {stats.get('pendingInviteOpenCount')}")
    print(f"  stats.pendingOnboard: {stats.get('pendingOnboard')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
