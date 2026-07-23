import json
import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
N8N_DIR = ROOT / "n8n"

FORBIDDEN_PATTERNS = {
    "DROP CONSTRAINT": "workflow should not loosen database constraints at runtime",
    "DROP NOT NULL": "workflow should not loosen database constraints at runtime",
    "'imported'": "email_logs.action must use schema value 'inserted'",
    "action='imported'": "check queries must count 'inserted' email_logs",
    "status = '取消面試'": "interviews.status must use schema value 'cancelled'",
}

FORBIDDEN_PATTERN_EXCEPTIONS = {
    "live_temp_db_check.json": {"DROP CONSTRAINT"},
}

ALLOWED_VALUES = {
    "candidates.status": {
        "in_progress",
        "pending_review",
        "approved_to_invite",
        "hired",
        "rejected",
        "withdrawn",
        "dept_scheduling",
    },
    "interviews.status": {"scheduled", "completed", "cancelled", "rescheduled"},
    "interviews.result": {"pending", "passed", "failed", "no_show"},
    "offers.status": {"pending", "accepted", "rejected", "withdrawn", "onboarded"},
    "email_logs.action": {"inserted", "updated", "skipped", "error"},
    "job_requisitions.status": {"open", "filled", "on_hold", "cancelled"},
    "onboardings.status": {"pending", "onboarded", "cancelled", "no_show"},
    "resignations.status": {"pending", "active", "done", "cancelled"},
}

FIELD_NAMES = ("status", "result", "action")

DASHBOARD_API_REQUIRED = (
    "'jobsData'",
    "'id', j.id",
    "'departmentStats'",
    "'pendingReviewCount'",
    "'resumeLink'",
    "'avgDaysToOffer'",
    "latest_email_subject",
    "has_schedule_subject",
    "has_reply_thread_subject",
    "has_recommend_subject",
    "'latestEmailSubject'",
    "'recommendEmailMsgId'",
    "'recommendEmailSubject'",
    "'recommendEmailReceivedAt'",
)

LEGACY_EXPORTS = {
    "live_HR_Portal.json": "legacy static portal must stay archived; production uses Node.js server",
}

WORKFLOW3_REQUIRED = (
    "UPDATE job_requisitions",
    "SET headcount = GREATEST(j.headcount - 1, 0)",
    "i.position = j.position_title",
)

WORKFLOW3_CANONICALIZATION_REQUIRED = (
    "canonicalizeDepartment",
    "canonicalizePosition",
    "raw_department",
)

JOB_WRITE_REQUIRED = (
    "Bearer ' + $env.N8N_HR_TOKEN",
    "INSERT INTO job_requisitions",
    "UPDATE job_requisitions",
    "NOT EXISTS (SELECT 1 FROM existing)",
    "input.action = 'create' AND j.department = input.department AND j.position_title = input.position_title",
    "'action', input.action",
)

WORKFLOW1_ALIAS_REQUIRED = (
    "U&'MIS\\7DB2\\7BA1\\5DE5\\7A0B\\5E2B'",
    "U&'MIS\\7DB2\\7BA1'",
    "U&'SAR\\5DE5\\7A0B\\5E2B'",
    "U&'AI\\8EDF\\9AD4\\5DE5\\7A0B\\5E2B'",
    "j.id = 17",
    "j.id = 23",
    "j.id = 27",
)

TEMP_DB_CHECK_REQUIRED = (
    "$json.body && $json.body.dry_run",
    "AS dry_run",
    "updated_this_run",
    "would_change_count",
)


def iter_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from iter_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_strings(child)


def sql_strings(workflow):
    for text in iter_strings(workflow):
        upper = text.upper()
        if any(keyword in upper for keyword in ("SELECT ", "INSERT ", "UPDATE ", "DELETE ", "ALTER ")):
            yield text


def table_pattern(table):
    return re.compile(rf"\b(?:INSERT\s+INTO|UPDATE)\s+{table}\b", re.IGNORECASE)


def is_sql_template(value):
    return "{{" in value or "}}" in value or "$json" in value


def validate_update_literals(path_name, sql, errors):
    # 逐語句歸屬：多語句查詢中，status/action 字面值只檢查「同一語句內」出現的 UPDATE 目標表，
    # 避免跨語句誤配（例如 upsert 的 WHERE ob.status = 'pending' 被歸給另一句的 job_requisitions）。
    for statement in sql.split(";"):
        for key, allowed in ALLOWED_VALUES.items():
            table, field = key.split(".")
            update_match = re.search(rf"\bUPDATE\s+{table}\b", statement, re.IGNORECASE)
            if not update_match:
                continue

            update_sql = statement[update_match.end():]
            set_match = re.search(
                r"\bSET\b(?P<set_clause>.*?)(?=\b(?:FROM|WHERE|RETURNING)\b|$)",
                update_sql,
                re.IGNORECASE | re.DOTALL,
            )
            if not set_match:
                continue

            set_clause = set_match.group("set_clause")
            for match in re.finditer(rf"\b{field}\s*=\s*'([^']*)'", set_clause, re.IGNORECASE):
                value = match.group(1)
                if is_sql_template(value):
                    continue
                if value not in allowed:
                    errors.append(
                        f"{path_name}: {table}.{field} writes {value!r}, allowed: {sorted(allowed)}"
                    )


def split_csv_preserving_quotes(text):
    parts = []
    current = []
    in_quote = False
    i = 0

    while i < len(text):
        char = text[i]
        if char == "'":
            current.append(char)
            if i + 1 < len(text) and text[i + 1] == "'":
                current.append(text[i + 1])
                i += 2
                continue
            in_quote = not in_quote
        elif char == "," and not in_quote:
            parts.append("".join(current).strip())
            current = []
        else:
            current.append(char)
        i += 1

    if current or text.strip():
        parts.append("".join(current).strip())

    return parts


def validate_insert_literals(path_name, sql, errors):
    for table in {key.split(".")[0] for key in ALLOWED_VALUES}:
        if not table_pattern(table).search(sql):
            continue

        pattern = re.compile(
            rf"INSERT\s+INTO\s+{table}\s*\((?P<columns>.*?)\)\s*"
            rf"(?:VALUES|SELECT)\s*(?P<values>.*?)(?:ON\s+CONFLICT|RETURNING|;|$)",
            re.IGNORECASE | re.DOTALL,
        )

        for match in pattern.finditer(sql):
            columns = [
                column.strip().strip('"').lower()
                for column in split_csv_preserving_quotes(match.group("columns"))
            ]
            values = split_csv_preserving_quotes(match.group("values").strip())

            if len(values) < len(columns):
                continue

            for field in FIELD_NAMES:
                key = f"{table}.{field}"
                if key not in ALLOWED_VALUES or field not in columns:
                    continue

                value_expr = values[columns.index(field)]
                literal = re.fullmatch(r"'([^']*)'", value_expr.strip())
                if not literal:
                    continue

                value = literal.group(1)
                if is_sql_template(value):
                    continue
                if value not in ALLOWED_VALUES[key]:
                    errors.append(
                        f"{path_name}: {table}.{field} inserts {value!r}, "
                        f"allowed: {sorted(ALLOWED_VALUES[key])}"
                    )


def validate_schema_literals(path_name, workflow, errors):
    for sql in sql_strings(workflow):
        validate_update_literals(path_name, sql, errors)
        validate_insert_literals(path_name, sql, errors)


def validate_dashboard_api(path_name, workflow, errors):
    if path_name != "live_Dashboard_API.json":
        return

    queries = [
        text
        for text in sql_strings(workflow)
        if "json_build_object" in text and "'stats'" in text
    ]
    if not queries:
        errors.append(f"{path_name}: dashboard json_build_object query not found")
        return

    query = max(queries, key=len)
    for marker in DASHBOARD_API_REQUIRED:
        if marker not in query:
            errors.append(f"{path_name}: dashboard API query missing {marker}")

    if "'jobsData', '[]'::json" in query:
        errors.append(f"{path_name}: jobsData must query job_requisitions, not return []")
    if "WHERE j.status != 'cancelled'" in query:
        errors.append(f"{path_name}: jobsData must include closed requisitions for dashboard editing")


def validate_legacy_exports(path_name, workflow, errors):
    if path_name not in LEGACY_EXPORTS:
        return

    if workflow.get("active") is not False:
        errors.append(f"{path_name}: {LEGACY_EXPORTS[path_name]} and active must be false")
    if workflow.get("isArchived") is not True:
        errors.append(f"{path_name}: {LEGACY_EXPORTS[path_name]} and isArchived must be true")
    if "LEGACY_DO_NOT_DEPLOY" not in str(workflow.get("name", "")):
        errors.append(f"{path_name}: legacy export name must include LEGACY_DO_NOT_DEPLOY")


def validate_onboarding_decrement(path_name, workflow, errors):
    if path_name != "live_Workflow3_到職離職.json":
        return

    queries = [
        text
        for text in sql_strings(workflow)
        if "INSERT INTO onboardings" in text
    ]
    if not queries:
        errors.append(f"{path_name}: onboarding insert query not found")
        return

    query = max(queries, key=len)
    for marker in WORKFLOW3_REQUIRED:
        if marker not in query:
            errors.append(f"{path_name}: onboarding decrement query missing {marker}")

    content = list(iter_strings(workflow))
    for marker in WORKFLOW3_CANONICALIZATION_REQUIRED:
        if not any(marker in text for text in content):
            errors.append(f"{path_name}: onboarding workflow missing {marker}")


def validate_job_write_workflow(path_name, workflow, errors):
    if path_name != "live_Job_Requisition_Write.json":
        return

    content = list(iter_strings(workflow))
    for marker in JOB_WRITE_REQUIRED:
        if not any(marker in text for text in content):
            errors.append(f"{path_name}: job write workflow missing {marker}")


def validate_workflow1_aliases(path_name, workflow, errors):
    if not path_name.startswith("live_Workflow1_"):
        return

    queries = [
        text
        for text in sql_strings(workflow)
        if "candidate_input AS" in text and "job_requisition_id" in text
    ]
    if not queries:
        errors.append(f"{path_name}: workflow1 candidate linking query not found")
        return

    query = max(queries, key=len)
    for marker in WORKFLOW1_ALIAS_REQUIRED:
        if marker not in query:
            errors.append(f"{path_name}: workflow1 alias rule missing {marker}")


def validate_temp_db_check(path_name, workflow, errors):
    if path_name != "live_temp_db_check.json":
        return

    queries = list(sql_strings(workflow))
    if not queries:
        errors.append(f"{path_name}: temp db check query not found")
        return

    query = max(queries, key=len)
    for marker in TEMP_DB_CHECK_REQUIRED:
        if marker not in query:
            errors.append(f"{path_name}: temp db check missing {marker}")


def main():
    errors = []
    files = sorted(N8N_DIR.glob("*.json"))

    if not files:
        errors.append("No n8n JSON exports found")

    for path in files:
        try:
            raw = path.read_text(encoding="utf-8-sig")
            workflow = json.loads(raw)
        except Exception as exc:
            errors.append(f"{path.name}: invalid JSON: {exc}")
            continue

        allowed_forbidden = FORBIDDEN_PATTERN_EXCEPTIONS.get(path.name, set())
        for text in iter_strings(workflow):
            for pattern, reason in FORBIDDEN_PATTERNS.items():
                if pattern in allowed_forbidden:
                    continue
                if pattern in text:
                    errors.append(f"{path.name}: forbidden pattern {pattern!r}: {reason}")

        validate_schema_literals(path.name, workflow, errors)
        validate_dashboard_api(path.name, workflow, errors)
        validate_legacy_exports(path.name, workflow, errors)
        validate_onboarding_decrement(path.name, workflow, errors)
        validate_job_write_workflow(path.name, workflow, errors)
        validate_workflow1_aliases(path.name, workflow, errors)
        validate_temp_db_check(path.name, workflow, errors)

    if errors:
        print("n8n export validation failed:")
        for error in errors:
            print(f"  - {error}")
        return 1

    print(f"n8n export validation passed: {len(files)} JSON files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
