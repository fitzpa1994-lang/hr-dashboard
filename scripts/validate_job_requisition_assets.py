import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SEED_PATH = ROOT / "database" / "job_requisitions_seed.sql"
DUPLICATE_AUDIT_PATH = ROOT / "database" / "job_requisitions_duplicate_audit.sql"
POST_SEED_CHECK_PATH = ROOT / "database" / "job_requisitions_post_seed_check.sql"
UNIQUE_CONSTRAINT_PATH = ROOT / "database" / "job_requisitions_add_unique_constraint.sql"

EXPECTED_TOP_LEVEL_DEPARTMENTS = {
    "行政",
    "安規",
    "WBU",
    "新竹",
    "新華",
    "ICC",
}

EXPECTED_ROW_COUNT = 28
EXPECTED_OPEN_ENDED_COUNT = 3

ROW_PATTERN = re.compile(
    r"\(\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'(open|cancelled|filled|on_hold)'\s*,\s*(\d+)\s*,\s*(NULL|'(?:''|[^'])*')\s*\)",
    re.MULTILINE,
)


def unescape_sql_text(value: str) -> str:
    return value.replace("''", "'")


def main() -> int:
    errors = []

    if not SEED_PATH.exists():
        errors.append(f"missing seed SQL: {SEED_PATH.name}")
    if not DUPLICATE_AUDIT_PATH.exists():
        errors.append(f"missing duplicate audit SQL: {DUPLICATE_AUDIT_PATH.name}")
    if not POST_SEED_CHECK_PATH.exists():
        errors.append(f"missing post-seed check SQL: {POST_SEED_CHECK_PATH.name}")
    if not UNIQUE_CONSTRAINT_PATH.exists():
        errors.append(f"missing unique constraint SQL: {UNIQUE_CONSTRAINT_PATH.name}")

    if errors:
        print("job requisition asset validation failed:")
        for error in errors:
            print(f"  - {error}")
        return 1

    seed_sql = SEED_PATH.read_text(encoding="utf-8-sig")
    duplicate_audit_sql = DUPLICATE_AUDIT_PATH.read_text(encoding="utf-8-sig")
    post_seed_check_sql = POST_SEED_CHECK_PATH.read_text(encoding="utf-8-sig")
    unique_constraint_sql = UNIQUE_CONSTRAINT_PATH.read_text(encoding="utf-8-sig")

    rows = []
    for match in ROW_PATTERN.finditer(seed_sql):
        position_title = unescape_sql_text(match.group(1))
        department = unescape_sql_text(match.group(2))
        headcount = int(match.group(3))
        filled_count = int(match.group(4))
        status = match.group(5)
        urgency = int(match.group(6))
        notes = match.group(7)
        rows.append(
            {
                "position_title": position_title,
                "department": department,
                "headcount": headcount,
                "filled_count": filled_count,
                "status": status,
                "urgency": urgency,
                "notes": None if notes == "NULL" else unescape_sql_text(notes[1:-1]),
            }
        )

    if len(rows) != EXPECTED_ROW_COUNT:
        errors.append(f"expected {EXPECTED_ROW_COUNT} seed rows, found {len(rows)}")

    departments = {row["department"] for row in rows}
    top_level_departments = {row["department"].split(" / ", 1)[0] for row in rows}
    if top_level_departments != EXPECTED_TOP_LEVEL_DEPARTMENTS:
        errors.append(
            "top-level department set mismatch: "
            f"expected {sorted(EXPECTED_TOP_LEVEL_DEPARTMENTS)}, got {sorted(top_level_departments)}"
        )

    seen = set()
    duplicates = []
    for row in rows:
        key = (row["department"], row["position_title"])
        if key in seen:
            duplicates.append(key)
        seen.add(key)
    if duplicates:
        errors.append(f"duplicate department + position_title pairs in seed: {duplicates}")

    for row in rows:
        if row["status"] == "cancelled" and row["headcount"] != 0:
            errors.append(
                f"cancelled requisition must have headcount 0: {row['department']} / {row['position_title']}"
            )
        if row["status"] == "open" and row["headcount"] <= 0:
            errors.append(
                f"open requisition must have positive headcount: {row['department']} / {row['position_title']}"
            )
        if not 1 <= row["urgency"] <= 5:
            errors.append(
                f"urgency must be between 1 and 5: {row['department']} / {row['position_title']}"
            )

    open_ended_rows = [row for row in rows if row["headcount"] == 999]
    if len(open_ended_rows) != EXPECTED_OPEN_ENDED_COUNT:
        errors.append(
            f"expected {EXPECTED_OPEN_ENDED_COUNT} open-ended requisitions with headcount 999, found {len(open_ended_rows)}"
        )

    required_titles = {
        ("行政 / 資訊部", "MIS工程師"),
        ("WBU / PM", "PM"),
        ("ICC / 技術支援部", "案件專員"),
        ("安規 / 安規業務部", "助理業務/業務"),
        ("行政 / 財務部", "出納短期職代"),
        ("新華 / 業務三部", "客服業務"),
    }
    actual_titles = {(row["department"], row["position_title"]) for row in rows}
    missing_titles = sorted(required_titles - actual_titles)
    if missing_titles:
        errors.append(f"seed is missing required requisitions: {missing_titles}")

    if "HAVING COUNT(*) > 1" not in duplicate_audit_sql:
        errors.append("duplicate audit SQL must filter to duplicated requisitions")
    if "GROUP BY department, position_title" not in duplicate_audit_sql:
        errors.append("duplicate audit SQL must group by department + position_title")
    if "'expectedTotalRows', 28" not in post_seed_check_sql:
        errors.append("post-seed check SQL must assert expected total rows")
    if "'expectedTopLevelDepartmentCount', 6" not in post_seed_check_sql:
        errors.append("post-seed check SQL must assert expected top-level department count")
    if "'expectedOpenEndedCount', 3" not in post_seed_check_sql:
        errors.append("post-seed check SQL must assert expected open-ended count")
    if "HAVING COUNT(*) > 1" not in post_seed_check_sql:
        errors.append("post-seed check SQL must count duplicate requisitions")
    if "CREATE UNIQUE INDEX IF NOT EXISTS" not in unique_constraint_sql:
        errors.append("unique constraint SQL must create a unique index")
    if "ON job_requisitions (department, position_title)" not in unique_constraint_sql:
        errors.append("unique constraint SQL must target department + position_title")

    if errors:
        print("job requisition asset validation failed:")
        for error in errors:
            print(f"  - {error}")
        return 1

    print(
        "job requisition asset validation passed: "
        f"{len(rows)} seed rows across {len(top_level_departments)} top-level departments"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
