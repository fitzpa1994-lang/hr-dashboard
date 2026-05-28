import json
import sys

FILE_PATH = r"C:\Users\evanhuang\PycharmProjects\hr-recruitment-system\n8n\live_Workflow1_面試解析.json"

# Load the workflow JSON (utf-8-sig handles files with or without BOM)
with open(FILE_PATH, "r", encoding="utf-8-sig") as f:
    workflow = json.load(f)

# ── 1. Define the new Code node ──────────────────────────────────────────────

NEW_NODE_NAME = "Code：組裝 Claude Request Body"
NEW_NODE_ID   = "code-assemble-claude-body-001"

# jsCode uses regular string concatenation (no backticks) so it is valid JSON
JS_CODE = (
    'const item = $input.item.json;\n'
    'return {\n'
    '  model: "claude-haiku-4-5-20251001",\n'
    '  max_tokens: 500,\n'
    '  system: "你是 HR 信件解析助手，從面試信件中萃取結構化資訊，輸出純 JSON 不含多餘文字。\\n'
    'HR 人員：李沛晴（Peggy）、陳清彥（Yen）、黃友為（Evan）\\n\\n'
    '輸出欄位：\\n'
    '- candidate_name: 候選人姓名（優先從主旨取，主旨無法確定才從內文找）\\n'
    '- applied_position: 應徵職位（找不到填「未知職位」）\\n'
    '- department: 部門（找不到填「未分類」）\\n'
    '- interview_date: YYYY-MM-DD（主管「建議約在...」代表未確認填 null；只有已確認才填）\\n'
    '- interview_time: HH:MM（同上規則）\\n'
    '- round: 第幾輪（數字，預設 1）\\n'
    '- location: 面試地點\\n'
    '- hr_owner: 負責 HR 姓名\\n'
    '- status: 狀態描述（待HR邀約 / 面試已安排 / 已推薦 等）\\n'
    '- intent: recommend|request_invite|schedule|update_time|cancel|second_schedule|other\\n'
    '- ai_action_item: HR 待辦一句話（無則 null）",\n'
    '  messages: [\n'
    '    {\n'
    '      role: "user",\n'
    '      content: "主旨：" + item.email_subject + "\\n\\n" + item.body_text\n'
    '    }\n'
    '  ]\n'
    '};'
)

new_code_node = {
    "parameters": {
        "mode": "runOnceForEachItem",
        "jsCode": JS_CODE
    },
    "id": NEW_NODE_ID,
    "name": NEW_NODE_NAME,
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [2048, 320]
}

# ── 2. Position shifts for downstream nodes ──────────────────────────────────

POSITION_SHIFTS = {
    "Claude：AI 解析意圖":   [2272, 320],
    "Code：整合輸出":        [2496, 320],
    "PG：寫入 candidates":   [2720, 320],
    "PG：寫入 interviews":   [2944, 320],
    "PG：寫入 email_logs":   [3168, 320],
}

# ── 3. Helper: apply changes to a nodes+connections pair ─────────────────────

def apply_fixes(nodes, connections):
    # --- 3a. Insert new node after "Code：萃取基本資訊" ---
    source_name = "Code：萃取基本資訊"
    insert_idx = None
    for i, node in enumerate(nodes):
        if node["name"] == source_name:
            insert_idx = i + 1
            break

    if insert_idx is None:
        print(f"ERROR: Could not find node '{source_name}'", file=sys.stderr)
        sys.exit(1)

    # Only insert if not already present
    already_present = any(n["name"] == NEW_NODE_NAME for n in nodes)
    if not already_present:
        nodes.insert(insert_idx, new_code_node)

    # --- 3b. Update positions and jsonBody for downstream nodes ---
    for node in nodes:
        name = node["name"]
        if name in POSITION_SHIFTS:
            node["position"] = POSITION_SHIFTS[name]
        if name == "Claude：AI 解析意圖":
            node["parameters"]["jsonBody"] = "={{ $json }}"

    # --- 3c. Update connections ---
    # "Code：萃取基本資訊" → now points to new node
    connections[source_name] = {
        "main": [
            [
                {
                    "node": NEW_NODE_NAME,
                    "type": "main",
                    "index": 0
                }
            ]
        ]
    }

    # New node → "Claude：AI 解析意圖"
    connections[NEW_NODE_NAME] = {
        "main": [
            [
                {
                    "node": "Claude：AI 解析意圖",
                    "type": "main",
                    "index": 0
                }
            ]
        ]
    }

# ── 4. Apply to top-level nodes/connections ───────────────────────────────────
apply_fixes(workflow["nodes"], workflow["connections"])

# ── 5. Apply to activeVersion.nodes/connections ───────────────────────────────
if "activeVersion" in workflow:
    av = workflow["activeVersion"]
    apply_fixes(av["nodes"], av["connections"])

# ── 6. Write back ─────────────────────────────────────────────────────────────
with open(FILE_PATH, "w", encoding="utf-8") as f:
    json.dump(workflow, f, ensure_ascii=False, indent=4)

# ── 7. Verify the file is valid JSON ─────────────────────────────────────────
with open(FILE_PATH, "r", encoding="utf-8") as f:
    verify = json.load(f)

# Sanity checks
top_names    = [n["name"] for n in verify["nodes"]]
av_names     = [n["name"] for n in verify["activeVersion"]["nodes"]]
top_conns    = verify["connections"]
av_conns     = verify["activeVersion"]["connections"]

assert NEW_NODE_NAME in top_names,  f"New node missing from top-level nodes: {top_names}"
assert NEW_NODE_NAME in av_names,   f"New node missing from activeVersion nodes: {av_names}"
assert NEW_NODE_NAME in top_conns,  f"New node connection missing from top-level connections"
assert NEW_NODE_NAME in av_conns,   f"New node connection missing from activeVersion connections"

# Check "Code：萃取基本資訊" now points to new node (top-level)
src_conn_top = top_conns["Code：萃取基本資訊"]["main"][0][0]["node"]
assert src_conn_top == NEW_NODE_NAME, f"Source still points to: {src_conn_top}"

# Check new node points to Claude (top-level)
new_conn_top = top_conns[NEW_NODE_NAME]["main"][0][0]["node"]
assert new_conn_top == "Claude：AI 解析意圖", f"New node points to: {new_conn_top}"

# Check Claude jsonBody is simplified (top-level)
for node in verify["nodes"]:
    if node["name"] == "Claude：AI 解析意圖":
        body = node["parameters"]["jsonBody"]
        assert body == "={{ $json }}", f"jsonBody not simplified, got: {body!r}"
        assert node["position"] == [2272, 320], f"Claude position wrong: {node['position']}"

# Check positions of downstream nodes (top-level)
for node in verify["nodes"]:
    if node["name"] in POSITION_SHIFTS:
        assert node["position"] == POSITION_SHIFTS[node["name"]], \
            f"{node['name']} position wrong: {node['position']}"

print("Module B fix complete")
