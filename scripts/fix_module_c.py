"""
fix_module_c.py  –  Refactor n8n/live_Workflow3_到職離職.json

Splits the single merged pipeline into two independent pipelines:
  1. ONBOARDING: Outlook trigger → filter → name extract → Claude AI intent →
     4-way intent branch (new_onboard / update_date / cancel / skip)
  2. RESIGNATION: Outlook trigger → extract info → PG writes

Removes: Merge：合併信件, Code：標記到職, Code：萃取到職與離職資訊, IF：到職 or 離職？
"""

import json
import pathlib

WORKFLOW_PATH = pathlib.Path(
    r"C:\Users\evanhuang\PycharmProjects\hr-recruitment-system\n8n\live_Workflow3_到職離職.json"
)

# ──────────────────────────────────────────────────────────────────────────────
# Helper: deep-copy a node dict (used to sync top-level nodes → activeVersion)
# ──────────────────────────────────────────────────────────────────────────────

def _mk_conn(node_name: str, index: int = 0) -> dict:
    return {"node": node_name, "type": "main", "index": index}


# ══════════════════════════════════════════════════════════════════════════════
# JAVASCRIPT / SQL STRINGS
# ══════════════════════════════════════════════════════════════════════════════

JS_NAME_FROM_SUBJECT = r"""const item = $input.item.json;
const subject = item.subject || '';
const rawBody = item.body?.content || item.bodyPreview || '';
const body = rawBody
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&#\d+;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const parts = subject.split('-');
const candidate = parts[parts.length - 1].trim();
const name_from_subject = (candidate.length >= 2 && candidate.length <= 5) ? candidate : null;

return {
  email_msg_id: item.id,
  email_subject: subject,
  email_web_link: item.webLink || null,
  sender: item.from?.emailAddress?.address || null,
  received_at: item.receivedDateTime,
  source_type: 'onboarding',
  name_from_subject,
  body_text: body.substring(0, 2000),
};"""

JS_ASSEMBLE_ONBOARD_AI = r"""const item = $input.item.json;
return {
  model: "claude-haiku-4-5-20251001",
  max_tokens: 400,
  system: "You are an HR email parser for onboarding notices. Return pure JSON only.\nHR owners: Peggy, Yen, Evan.\n\nOutput fields:\n- intent: new_onboard | update_date | cancel | skip\n- name: candidate name. Prefer the last segment after '-' in subject when it is clearly a person name; otherwise infer from body.\n- scheduled_onboard_date: onboarding date in YYYY-MM-DD\n- department: department text from the email, or null\n- position: title text from the email, or null\n- hr_owner: HR owner name, or null\n\nRules:\n1. Do not skip a message only because the subject starts with RE:. Read the body first.\n2. If the body says the onboarding date/time was adjusted, delayed, changed, moved, postponed, or contains wording like \u6539\u70ba, \u6539\u5230, \u5ef6\u5f8c, \u5ef6\u81f3, \u66f4\u6539\u5831\u5230, \u8abf\u6574\u5831\u5230, then intent = update_date.\n3. If the message is only an acknowledgement, attachment submission, receipt confirmation, or generic reply without a new onboarding date, then intent = skip.\n4. If the message is a fresh offer/onboarding notice, intent = new_onboard.\n5. Even for reply threads, if the latest body contains a new onboarding date, return update_date and that newest date.",
  messages: [
    {
      role: "user",
      content: "Subject: " + item.email_subject + "\n\n" + item.body_text
    }
  ]
};"""

JS_INTEGRATE_ONBOARD = r"""const base = $('Code?????name_from_subject').item.json;
let aiResult = {};
try {
  const raw = $input.item.json.content;
  const text = Array.isArray(raw) ? (raw[0]?.text || '') : (typeof raw === 'string' ? raw : '');
  const match = text.match(/\{[\s\S]*\}/);
  if (match) aiResult = JSON.parse(match[0]);
} catch (e) {}

let regexDate = null;
const bodyText = base.body_text || '';
const fallbackYear = String(new Date(base.received_at || Date.now()).getFullYear());
const datePatterns = [
  { re: /(?:\u6539\u70ba|\u6539\u5230|\u5ef6\u5f8c\u5230|\u5ef6\u81f3|\u9806\u5ef6\u81f3|\u66f4\u6539\u5831\u5230(?:\u65e5\u671f|\u6642\u9593)?\u70ba?|\u8abf\u6574\u5831\u5230(?:\u65e5\u671f|\u6642\u9593)?\u70ba?)\s*(\d{4})[\/\-\u5e74](\d{1,2})[\/\-\u6708](\d{1,2})/, fn: m => m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0') },
  { re: /(?:\u6539\u70ba|\u6539\u5230|\u5ef6\u5f8c\u5230|\u5ef6\u81f3|\u9806\u5ef6\u81f3|\u66f4\u6539\u5831\u5230(?:\u65e5\u671f|\u6642\u9593)?\u70ba?|\u8abf\u6574\u5831\u5230(?:\u65e5\u671f|\u6642\u9593)?\u70ba?)\s*(\d{1,2})[\/\-\u6708](\d{1,2})/, fn: m => fallbackYear+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0') },
  { re: /\u5831\u5230\u65e5\u671f[\uff1a:]\s*(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/, fn: m => m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0') },
  { re: /\u9810\u5b9a\u5831\u5230\u65e5\u671f[\uff1a:]\s*(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/, fn: m => m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0') },
  { re: /\u5831\u5230\u65e5\u671f[\uff1a:]\s*(\d{4})\u5e74(\d{1,2})\u6708(\d{1,2})\u65e5/, fn: m => m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0') },
  { re: /\u9810\u5b9a\u5831\u5230\u65e5\u671f[\uff1a:]\s*(\d{4})\u5e74(\d{1,2})\u6708(\d{1,2})\u65e5/, fn: m => m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0') },
];
for (const { re, fn } of datePatterns) {
  const m = bodyText.match(re);
  if (m) {
    regexDate = fn(m);
    break;
  }
}

return {
  email_msg_id: base.email_msg_id,
  email_subject: base.email_subject,
  email_web_link: base.email_web_link,
  sender: base.sender,
  received_at: base.received_at,
  source_type: 'onboarding',
  name: base.name_from_subject || aiResult.name || '\u672a\u77e5\u59d3\u540d',
  scheduled_onboard_date: regexDate || aiResult.scheduled_onboard_date || null,
  department: aiResult.department || null,
  position: aiResult.position || null,
  hr_owner: aiResult.hr_owner || null,
  intent: aiResult.intent || 'new_onboard',
};"""

JS_RESIGNATION = r"""const item = $input.item.json;
const rawBody = item.body?.content || item.bodyPreview || '';
const body = rawBody
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&#\d+;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const deptMatch  = body.match(/單\s*位\s*[：:]\s*([^\r\n□]+)/);
const nameMatch  = body.match(/姓\s*名\s*[：:]\s*([^\r\n□]+)/);
const titleMatch = body.match(/職\s*稱\s*[：:]\s*([^\r\n□]+)/);
const dayMatch   = body.match(/離\s*職\s*生\s*效\s*日\s*[：:]\s*([^\r\n□（(]+)/);

const rawDate = dayMatch?.[1]?.trim() || '';
const parts = rawDate.split('/');
const last_day = (parts.length === 3)
  ? parts[0] + '-' + parts[1].padStart(2,'0') + '-' + parts[2].padStart(2,'0')
  : rawDate || null;

return {
  email_msg_id: item.id,
  email_subject: item.subject || '',
  email_web_link: item.webLink || null,
  sender: item.from?.emailAddress?.address || null,
  received_at: item.receivedDateTime,
  source_type: 'resignation',
  name: nameMatch?.[1]?.trim() || '未知姓名',
  department: deptMatch?.[1]?.trim() || '未分類',
  position: titleMatch?.[1]?.trim() || '未知職位',
  last_day: last_day,
};"""

SQL_INSERT_ONBOARDINGS = (
    "INSERT INTO onboardings (name, department, position, expected_date, status, email_subject, email_msg_id, email_web_link)\n"
    "SELECT\n"
    "  '{{ ($json.name || '').replace(/'/g, \"''\") }}',\n"
    "  COALESCE(NULLIF('{{ ($json.department || '').replace(/'/g, \"''\") }}', ''), '未分類'),\n"
    "  COALESCE(NULLIF('{{ ($json.position || '').replace(/'/g, \"''\") }}', ''), '未知職位'),\n"
    "  COALESCE(NULLIF('{{ $json.scheduled_onboard_date || '' }}', '')::DATE, CURRENT_DATE),\n"
    "  'pending',\n"
    "  '{{ ($json.email_subject || '').replace(/'/g, \"''\") }}',\n"
    "  '{{ $json.email_msg_id || '' }}',\n"
    "  NULLIF('{{ $json.email_web_link || '' }}', '')\n"
    "ON CONFLICT (email_msg_id) DO NOTHING;\n\n"
    "SELECT '{{ $json.email_msg_id || '' }}' AS email_msg_id, 'inserted' AS action, NULL::INTEGER AS candidate_id,\n"
    "  '{{ ($json.email_subject || '').replace(/'/g, \"''\") }}' AS email_subject,\n"
    "  NULLIF('{{ $json.sender || '' }}', '') AS sender,\n"
    "  '{{ $json.received_at || '' }}' AS received_at;"
)

SQL_UPDATE_ONBOARD_DATE = (
    "UPDATE onboardings\n"
    "SET expected_date = COALESCE(NULLIF('{{ $json.scheduled_onboard_date || '' }}', '')::DATE, expected_date),\n"
    "    updated_at = NOW()\n"
    "WHERE name = '{{ ($json.name || '').replace(/'/g, \"''\") }}'\n"
    "  AND status = 'pending';\n\n"
    "SELECT '{{ $json.email_msg_id || '' }}' AS email_msg_id, 'updated' AS action, NULL::INTEGER AS candidate_id,\n"
    "  '{{ ($json.email_subject || '').replace(/'/g, \"''\") }}' AS email_subject,\n"
    "  NULLIF('{{ $json.sender || '' }}', '') AS sender,\n"
    "  '{{ $json.received_at || '' }}' AS received_at;"
)

SQL_CANCEL_ONBOARD = (
    "UPDATE onboardings\n"
    "SET status = 'cancelled', updated_at = NOW()\n"
    "WHERE name = '{{ ($json.name || '').replace(/'/g, \"''\") }}'\n"
    "  AND status = 'pending';\n\n"
    "SELECT '{{ $json.email_msg_id || '' }}' AS email_msg_id, 'updated' AS action, NULL::INTEGER AS candidate_id,\n"
    "  '{{ ($json.email_subject || '').replace(/'/g, \"''\") }}' AS email_subject,\n"
    "  NULLIF('{{ $json.sender || '' }}', '') AS sender,\n"
    "  '{{ $json.received_at || '' }}' AS received_at;"
)

SQL_EMAIL_LOGS = (
    "INSERT INTO email_logs (email_msg_id, email_subject, sender, received_at, action, candidate_id)\n"
    "SELECT\n"
    "  '{{ $json.email_msg_id || '' }}',\n"
    "  '{{ ($json.email_subject || '').replace(/'/g, \"''\") }}',\n"
    "  NULLIF('{{ $json.sender || '' }}', ''),\n"
    "  COALESCE(NULLIF('{{ $json.received_at || '' }}', '')::TIMESTAMPTZ, NOW()),\n"
    "  '{{ $json.action || 'inserted' }}',\n"
    "  NULL\n"
    "ON CONFLICT (email_msg_id) DO UPDATE SET\n"
    "  action = EXCLUDED.action, processed_at = NOW();\n\n"
    "SELECT '{{ $json.email_msg_id || '' }}' AS email_msg_id, 'log_inserted' AS status;"
)

SQL_EMAIL_LOGS_SKIP = (
    "INSERT INTO email_logs (email_msg_id, email_subject, sender, received_at, action, candidate_id)\n"
    "SELECT\n"
    "  '{{ $json.email_msg_id || '' }}',\n"
    "  '{{ ($json.email_subject || '').replace(/'/g, \"''\") }}',\n"
    "  NULLIF('{{ $json.sender || '' }}', ''),\n"
    "  COALESCE(NULLIF('{{ $json.received_at || '' }}', '')::TIMESTAMPTZ, NOW()),\n"
    "  'skipped',\n"
    "  NULL\n"
    "ON CONFLICT (email_msg_id) DO UPDATE SET\n"
    "  action = 'skipped', processed_at = NOW();\n\n"
    "SELECT '{{ $json.email_msg_id || '' }}' AS email_msg_id, 'log_inserted' AS status;"
)

SQL_INSERT_RESIGNATIONS = (
    "INSERT INTO resignations (name, department, position, resign_date, last_day, status, email_subject, email_msg_id, email_web_link)\n"
    "SELECT\n"
    "  '{{ ($json.name || '').replace(/'/g, \"''\") }}',\n"
    "  '{{ ($json.department || '').replace(/'/g, \"''\") }}',\n"
    "  '{{ ($json.position || '').replace(/'/g, \"''\") }}',\n"
    "  COALESCE(NULLIF('{{ $json.last_day || '' }}', '')::DATE, CURRENT_DATE),\n"
    "  COALESCE(NULLIF('{{ $json.last_day || '' }}', '')::DATE, CURRENT_DATE),\n"
    "  'active',\n"
    "  '{{ ($json.email_subject || '').replace(/'/g, \"''\") }}',\n"
    "  '{{ $json.email_msg_id || '' }}',\n"
    "  NULLIF('{{ $json.email_web_link || '' }}', '')\n"
    "ON CONFLICT (email_msg_id) DO NOTHING;\n\n"
    "SELECT '{{ $json.email_msg_id || '' }}' AS email_msg_id, 'inserted' AS action, NULL::INTEGER AS candidate_id,\n"
    "  '{{ ($json.email_subject || '').replace(/'/g, \"''\") }}' AS email_subject,\n"
    "  NULLIF('{{ $json.sender || '' }}', '') AS sender,\n"
    "  '{{ $json.received_at || '' }}' AS received_at;"
)

PG_CREDS = {"postgres": {"id": "NGdDfE2F1YFXGcmn", "name": "Postgres account"}}


# ══════════════════════════════════════════════════════════════════════════════
# NODE DEFINITIONS
# ══════════════════════════════════════════════════════════════════════════════

def _pg_node(node_id, name, sql, position):
    return {
        "parameters": {
            "operation": "executeQuery",
            "query": sql,
            "options": {}
        },
        "id": node_id,
        "name": name,
        "type": "n8n-nodes-base.postgres",
        "typeVersion": 2.5,
        "position": position,
        "credentials": PG_CREDS,
    }


def _if_intent_node(node_id, name, intent_value, position):
    return {
        "parameters": {
            "conditions": {
                "options": {
                    "caseSensitive": True,
                    "leftValue": "",
                    "typeValidation": "strict",
                    "version": 1
                },
                "conditions": [
                    {
                        "id": "intent-check",
                        "leftValue": "={{ $json.intent }}",
                        "rightValue": intent_value,
                        "operator": {
                            "type": "string",
                            "operation": "equals"
                        }
                    }
                ],
                "combinator": "and"
            },
            "options": {}
        },
        "id": node_id,
        "name": name,
        "type": "n8n-nodes-base.if",
        "typeVersion": 2,
        "position": position,
    }


NEW_NODES = [
    # ── Onboarding: Code：萃取 name_from_subject ──────────────────────────────
    {
        "parameters": {
            "mode": "runOnceForEachItem",
            "jsCode": JS_NAME_FROM_SUBJECT,
        },
        "id": "code-name-from-subject-001",
        "name": "Code：萃取 name_from_subject",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [2640, -128],
    },
    # ── Onboarding: Code：組裝 Onboarding AI Body ────────────────────────────
    {
        "parameters": {
            "mode": "runOnceForEachItem",
            "jsCode": JS_ASSEMBLE_ONBOARD_AI,
        },
        "id": "code-assemble-onboard-ai-001",
        "name": "Code：組裝 Onboarding AI Body",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [2864, -128],
    },
    # ── Onboarding: HTTP Request (Claude) ────────────────────────────────────
    {
        "parameters": {
            "method": "POST",
            "url": "https://api.anthropic.com/v1/messages",
            "authentication": "predefinedCredentialType",
            "nodeCredentialType": "anthropicApi",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "anthropic-version", "value": "2023-06-01"}
                ]
            },
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": "={{ $json }}",
            "options": {
                "batching": {
                    "batch": {
                        "batchSize": 1,
                        "batchInterval": 1500
                    }
                }
            }
        },
        "id": "http-onboard-claude-001",
        "name": "Claude：解析 Onboarding 意圖",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [3088, -128],
        "credentials": {
            "anthropicApi": {
                "id": "y6zxdCqqBzmwq5bi",
                "name": "Anthropic account"
            }
        },
    },
    # ── Onboarding: Code：整合 Onboarding 輸出 ───────────────────────────────
    {
        "parameters": {
            "mode": "runOnceForEachItem",
            "jsCode": JS_INTEGRATE_ONBOARD,
        },
        "id": "code-integrate-onboard-001",
        "name": "Code：整合 Onboarding 輸出",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [3312, -128],
    },
    # ── IF：intent=new_onboard? ───────────────────────────────────────────────
    _if_intent_node("if-intent-new-onboard-001", "IF：intent=new_onboard?", "new_onboard", [3536, -128]),
    # ── IF：intent=update_date? ──────────────────────────────────────────────
    _if_intent_node("if-intent-update-date-001", "IF：intent=update_date?", "update_date", [3536, -32]),
    # ── IF：intent=cancel? ───────────────────────────────────────────────────
    _if_intent_node("if-intent-cancel-001", "IF：intent=cancel?", "cancel", [3536, 64]),
    # ── PG：UPDATE onboarding date ───────────────────────────────────────────
    _pg_node("pg-update-onboard-date-001", "PG：UPDATE onboarding date", SQL_UPDATE_ONBOARD_DATE, [3760, -32]),
    # ── PG：UPDATE onboarding cancel ─────────────────────────────────────────
    _pg_node("pg-cancel-onboard-001", "PG：UPDATE onboarding cancel", SQL_CANCEL_ONBOARD, [3760, 64]),
    # ── PG：到職 email_logs skip ─────────────────────────────────────────────
    _pg_node("pg-onboard-logs-skip-001", "PG：到職 email_logs skip", SQL_EMAIL_LOGS_SKIP, [3760, 160]),
    # ── PG：到職 email_logs_update ───────────────────────────────────────────
    _pg_node("pg-onboard-logs-update-001", "PG：到職 email_logs_update", SQL_EMAIL_LOGS, [3984, -32]),
    # ── PG：到職 email_logs_cancel ───────────────────────────────────────────
    _pg_node("pg-onboard-logs-cancel-001", "PG：到職 email_logs_cancel", SQL_EMAIL_LOGS, [3984, 64]),
]

# ── IDs to REMOVE from both nodes arrays ──────────────────────────────────────
REMOVE_IDS = {
    "80a93f69-79db-4560-8afc-c2015656931f",   # Code：標記到職
    "cf165a7f-6d2f-4b11-bc07-445a387bbac6",   # Merge：合併信件
    "d55b5664-8d46-4a60-bc7f-266f7e9b724c",   # Code：萃取到職與離職資訊
    "a3f3f478-3268-4c76-b2de-e757c95d42a5",   # IF：到職 or 離職？
}

# ── Names to REMOVE from connections ─────────────────────────────────────────
REMOVE_CONN_KEYS = {
    "Code：標記到職",
    "Code：標記離職",
    "Merge：合併信件",
    "Code：萃取到職與離職資訊",
    "IF：到職 or 離職？",
}


# ══════════════════════════════════════════════════════════════════════════════
# NEW CONNECTIONS
# ══════════════════════════════════════════════════════════════════════════════

def build_new_connections() -> dict:
    return {
        # ── ONBOARDING PIPELINE ──────────────────────────────────────────────
        "Outlook 收信觸發：到職 (收件匣)": {
            "main": [[_mk_conn("IF：過濾新進人員通知")]]
        },
        "IF：過濾新進人員通知": {
            "main": [
                [_mk_conn("Code：萃取 name_from_subject")],  # true (index 0)
                [],                                            # false (index 1) – no action
            ]
        },
        "Code：萃取 name_from_subject": {
            "main": [[_mk_conn("Code：組裝 Onboarding AI Body")]]
        },
        "Code：組裝 Onboarding AI Body": {
            "main": [[_mk_conn("Claude：解析 Onboarding 意圖")]]
        },
        "Claude：解析 Onboarding 意圖": {
            "main": [[_mk_conn("Code：整合 Onboarding 輸出")]]
        },
        "Code：整合 Onboarding 輸出": {
            "main": [[_mk_conn("IF：intent=new_onboard?")]]
        },
        "IF：intent=new_onboard?": {
            "main": [
                [_mk_conn("PG：寫入 onboardings")],       # true
                [_mk_conn("IF：intent=update_date?")],     # false
            ]
        },
        "PG：寫入 onboardings": {
            "main": [[_mk_conn("PG：到職 email_logs")]]
        },
        "PG：到職 email_logs": {
            "main": [[]]
        },
        "IF：intent=update_date?": {
            "main": [
                [_mk_conn("PG：UPDATE onboarding date")],  # true
                [_mk_conn("IF：intent=cancel?")],           # false
            ]
        },
        "PG：UPDATE onboarding date": {
            "main": [[_mk_conn("PG：到職 email_logs_update")]]
        },
        "PG：到職 email_logs_update": {
            "main": [[]]
        },
        "IF：intent=cancel?": {
            "main": [
                [_mk_conn("PG：UPDATE onboarding cancel")],  # true
                [_mk_conn("PG：到職 email_logs skip")],       # false
            ]
        },
        "PG：UPDATE onboarding cancel": {
            "main": [[_mk_conn("PG：到職 email_logs_cancel")]]
        },
        "PG：到職 email_logs_cancel": {
            "main": [[]]
        },
        "PG：到職 email_logs skip": {
            "main": [[]]
        },
        # ── RESIGNATION PIPELINE ─────────────────────────────────────────────
        "Outlook 收信觸發：離職 (離職資料夾)": {
            "main": [[_mk_conn("Code：萃取離職資訊")]]
        },
        "Code：萃取離職資訊": {
            "main": [[_mk_conn("PG：寫入 resignations")]]
        },
        "PG：寫入 resignations": {
            "main": [[_mk_conn("PG：離職 email_logs")]]
        },
        "PG：離職 email_logs": {
            "main": [[]]
        },
    }


# ══════════════════════════════════════════════════════════════════════════════
# MAIN TRANSFORM
# ══════════════════════════════════════════════════════════════════════════════

def transform(wf: dict) -> dict:
    import copy

    # ── 1. Mutate existing nodes ──────────────────────────────────────────────

    def patch_nodes(nodes: list) -> list:
        result = []
        for node in nodes:
            nid = node.get("id")
            name = node.get("name")

            # Drop unwanted nodes
            if nid in REMOVE_IDS:
                continue

            # Update PG：寫入 onboardings – move position, update SQL
            if nid == "177e2c15-35cf-4cd3-8976-f1911ddf98c1":
                node = copy.deepcopy(node)
                node["position"] = [3760, -128]
                node["parameters"]["query"] = SQL_INSERT_ONBOARDINGS

            # Update PG：到職 email_logs – move position, keep SQL (already fine)
            elif nid == "8a85255a-4e76-4306-9f6a-4af77c64c66f":
                node = copy.deepcopy(node)
                node["position"] = [3984, -128]

            # Rename Code：標記離職 → Code：萃取離職資訊, update JS
            elif nid == "71f201ca-926d-4ce8-bfcd-9b2e7dc709c1":
                node = copy.deepcopy(node)
                node["name"] = "Code：萃取離職資訊"
                node["position"] = [2640, 176]
                node["parameters"]["jsCode"] = JS_RESIGNATION

            # Update PG：寫入 resignations – update SQL
            elif nid == "64110571-f499-4045-ac05-25982d1ab97e":
                node = copy.deepcopy(node)
                node["position"] = [3520, 176]
                node["parameters"]["query"] = SQL_INSERT_RESIGNATIONS

            result.append(node)

        # ── 2. Append new nodes ───────────────────────────────────────────────
        existing_ids = {n["id"] for n in result}
        for nn in NEW_NODES:
            if nn["id"] not in existing_ids:
                result.append(copy.deepcopy(nn))

        return result

    wf["nodes"] = patch_nodes(wf["nodes"])
    wf["connections"] = build_new_connections()

    # ── activeVersion sync ────────────────────────────────────────────────────
    if "activeVersion" in wf and wf["activeVersion"]:
        wf["activeVersion"]["nodes"] = patch_nodes(wf["activeVersion"]["nodes"])
        wf["activeVersion"]["connections"] = build_new_connections()

    return wf


# ══════════════════════════════════════════════════════════════════════════════
# VALIDATION
# ══════════════════════════════════════════════════════════════════════════════

def validate(wf: dict) -> None:
    node_names = {n["name"] for n in wf["nodes"]}
    conn_keys  = set(wf["connections"].keys())

    # Nodes that must be PRESENT
    required_nodes = {
        "Code：萃取 name_from_subject",
        "Code：組裝 Onboarding AI Body",
        "Claude：解析 Onboarding 意圖",
        "Code：整合 Onboarding 輸出",
        "IF：intent=new_onboard?",
        "IF：intent=update_date?",
        "IF：intent=cancel?",
        "PG：寫入 onboardings",
        "PG：UPDATE onboarding date",
        "PG：UPDATE onboarding cancel",
        "PG：到職 email_logs",
        "PG：到職 email_logs_update",
        "PG：到職 email_logs_cancel",
        "PG：到職 email_logs skip",
        "Code：萃取離職資訊",
        "PG：寫入 resignations",
        "PG：離職 email_logs",
    }

    # Nodes that must be ABSENT
    forbidden_nodes = {
        "Code：標記到職",
        "Merge：合併信件",
        "Code：萃取到職與離職資訊",
        "IF：到職 or 離職？",
        "Code：標記離職",
    }

    for rn in required_nodes:
        assert rn in node_names, f"MISSING node: {rn}"

    for fn in forbidden_nodes:
        assert fn not in node_names, f"UNEXPECTED node still present: {fn}"

    # Spot-check key connections
    assert "Code：萃取 name_from_subject" in conn_keys, "Missing connection key: Code：萃取 name_from_subject"
    assert "IF：intent=new_onboard?" in conn_keys, "Missing connection key: IF：intent=new_onboard?"
    assert "Code：萃取離職資訊" in conn_keys, "Missing connection key: Code：萃取離職資訊"

    # activeVersion must also be updated
    if "activeVersion" in wf and wf["activeVersion"]:
        av_names = {n["name"] for n in wf["activeVersion"]["nodes"]}
        for rn in required_nodes:
            assert rn in av_names, f"activeVersion MISSING node: {rn}"
        for fn in forbidden_nodes:
            assert fn not in av_names, f"activeVersion UNEXPECTED node: {fn}"


# ══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

def main():
    raw = WORKFLOW_PATH.read_text(encoding="utf-8-sig")
    wf  = json.loads(raw)

    wf = transform(wf)
    validate(wf)

    WORKFLOW_PATH.write_text(
        json.dumps(wf, ensure_ascii=False, indent=4),
        encoding="utf-8"
    )

    # Re-load and re-validate to confirm file round-trip
    wf2 = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
    validate(wf2)

    print("Module C fix complete")


if __name__ == "__main__":
    main()
