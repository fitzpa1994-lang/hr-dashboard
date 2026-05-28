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

ALLOWED_VALUES = {
    "candidates.status": {"in_progress", "pending_review", "hired", "rejected", "withdrawn"},
    "interviews.status": {"scheduled", "completed", "cancelled", "rescheduled"},
    "interviews.result": {"pending", "passed", "failed", "no_show"},
    "offers.status": {"pending", "accepted", "rejected", "withdrawn", "onboarded"},
    "email_logs.action": {"inserted", "updated", "skipped", "error"},
    "job_requisitions.status": {"open", "filled", "on_hold", "cancelled"},
    "onboardings.status": {"pending", "onboarded", "cancelled"},
    "resignations.status": {"active", "done", "cancelled"},
}

FIELD_NAMES = ("status", "result", "action")

DASHBOARD_API_REQUIRED = (
    "'jobsData'",
    "'departmentStats'",
    "'pendingReviewCount'",
    "'resumeLink'",
    "'avgDaysToOffer'",
)

LEGACY_EXPORTS = {
    "live_HR_Portal.json": "legacy static portal must stay archived; production uses Node.js server",
}


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
    for key, allowed in ALLOWED_VALUES.items():
        table, field = key.split(".")
        if not re.search(rf"\bUPDATE\s+{table}\b", sql, re.IGNORECASE):
            continue

        for match in re.finditer(rf"\b{field}\s*=\s*'([^']*)'", sql, re.IGNORECASE):
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


def validate_legacy_exports(path_name, workflow, errors):
    if path_name not in LEGACY_EXPORTS:
        return

    if workflow.get("active") is not False:
        errors.append(f"{path_name}: {LEGACY_EXPORTS[path_name]} and active must be false")
    if workflow.get("isArchived") is not True:
        errors.append(f"{path_name}: {LEGACY_EXPORTS[path_name]} and isArchived must be true")
    if "LEGACY_DO_NOT_DEPLOY" not in str(workflow.get("name", "")):
        errors.append(f"{path_name}: legacy export name must include LEGACY_DO_NOT_DEPLOY")


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

        for text in iter_strings(workflow):
            for pattern, reason in FORBIDDEN_PATTERNS.items():
                if pattern in text:
                    errors.append(f"{path.name}: forbidden pattern {pattern!r}: {reason}")

        validate_schema_literals(path.name, workflow, errors)
        validate_dashboard_api(path.name, workflow, errors)
        validate_legacy_exports(path.name, workflow, errors)

    if errors:
        print("n8n export validation failed:")
        for error in errors:
            print(f"  - {error}")
        return 1

    print(f"n8n export validation passed: {len(files)} JSON files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
