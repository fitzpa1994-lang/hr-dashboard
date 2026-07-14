import json, sys

# ── 1. Dashboard API: add 'id' to candidatesData ──────────────────────────────
with open('n8n/live_Dashboard_API.json', 'r', encoding='utf-8') as f:
    dash = json.load(f)

dash_changed = 0
for node in dash.get('nodes', []):
    q = node.get('parameters', {}).get('query', '')
    if 'candidatesData' in q and "'name', c.name," in q and "'id', c.id," not in q:
        node['parameters']['query'] = q.replace(
            "'name', c.name,",
            "'id', c.id,\n      'name', c.name,",
            1
        )
        dash_changed += 1

with open('n8n/live_Dashboard_API.json', 'w', encoding='utf-8') as f:
    json.dump(dash, f, ensure_ascii=False, indent=2)
print(f'Dashboard API: patched {dash_changed} node(s)')

# ── 2. Write workflow: add candidate_id/status + UPDATE candidates CTE ────────
with open('n8n/live_Job_Requisition_Write.json', 'r', encoding='utf-8') as f:
    write = json.load(f)

# The SQL additions
INPUT_APPEND = (
    "\n    NULLIF('{{ $json.body.candidateId ?? \"\" }}', '')::INTEGER AS candidate_id,"
    "\n    '{{ ($json.body.candidateStatus || \"\").replace(/\\'/g, \"''\") }}'::TEXT AS candidate_status"
)

CANDIDATE_CTE = """
candidate_updated AS (
  UPDATE candidates
  SET status = input.candidate_status,
      updated_at = NOW()
  FROM input
  WHERE candidates.id = input.candidate_id
    AND input.action = 'update_candidate_status'
    AND input.candidate_status IN ('withdrawn', 'rejected')
  RETURNING candidates.id, candidates.name, candidates.status
)"""

write_changed = 0
for node in write.get('nodes', []):
    q = node.get('parameters', {}).get('query', '')
    if 'onboard_updated' in q and 'candidate_updated' not in q:
        # a) add candidateId/candidateStatus to input CTE
        q = q.replace("onboard_status\n)", INPUT_APPEND + "\n    onboard_status\n)", 1)
        # b) insert candidate_updated CTE before the final SELECT
        q = q.replace("\nSELECT json_build_object(", CANDIDATE_CTE + "\nSELECT json_build_object(", 1)
        # c) add candidate field in json_build_object
        q = q.replace(
            "'onboard', CASE WHEN input.action = 'update_onboard'",
            "'candidate', CASE WHEN input.action = 'update_candidate_status' THEN (SELECT json_build_object('id', cu.id, 'name', cu.name, 'status', cu.status) FROM candidate_updated cu LIMIT 1) ELSE NULL END,\n  'onboard', CASE WHEN input.action = 'update_onboard'",
            1
        )
        # d) add LEFT JOIN candidate_updated
        q = q.replace(
            "LEFT JOIN onboard_updated ON TRUE;",
            "LEFT JOIN onboard_updated ON TRUE\nLEFT JOIN candidate_updated ON TRUE;"
        )
        node['parameters']['query'] = q
        write_changed += 1

with open('n8n/live_Job_Requisition_Write.json', 'w', encoding='utf-8') as f:
    json.dump(write, f, ensure_ascii=False, indent=2)
print(f'Write workflow: patched {write_changed} node(s)')
