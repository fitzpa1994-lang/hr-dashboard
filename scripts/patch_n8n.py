import json, sys

# ── 1. Dashboard API: add 'id' to candidatesData (correct location) ──────────
with open('n8n/live_Dashboard_API.json', 'r', encoding='utf-8') as f:
    dash = json.load(f)

WRONG_PATCH = "'id', c.id,\n      'name', c.name,"   # what we wrongly inserted
RIGHT_ORIG  = "'name', c.name,"                        # original in correct location

# The unique anchor for the CORRECT candidatesData json_build_object:
CORRECT_ANCHOR = "json_agg(json_build_object(\n      'name', c.name,"
CORRECT_REPLACE = "json_agg(json_build_object(\n      'id', c.id,\n      'name', c.name,"

dash_changed = 0
for node in dash.get('nodes', []):
    q = node.get('parameters', {}).get('query', '')
    if 'candidatesData' not in q:
        continue
    # 1a. Undo the wrong patch (in history sub-object)
    if WRONG_PATCH in q:
        q = q.replace(WRONG_PATCH, RIGHT_ORIG, 1)
        print("  Reverted wrong patch")
    # 1b. Apply correct patch if not already done
    if CORRECT_ANCHOR in q and "'id', c.id," not in q:
        q = q.replace(CORRECT_ANCHOR, CORRECT_REPLACE, 1)
        dash_changed += 1
    elif "'id', c.id," in q and CORRECT_ANCHOR.replace("'name'", "'id', c.id,\n      'name'") in q:
        print("  Already correctly patched")
    node['parameters']['query'] = q

with open('n8n/live_Dashboard_API.json', 'w', encoding='utf-8') as f:
    json.dump(dash, f, ensure_ascii=False, indent=2)
print(f'Dashboard API: applied {dash_changed} correct patch(es)')

# Verify
with open('n8n/live_Dashboard_API.json', 'r', encoding='utf-8') as f:
    verify = f.read()
cidx = verify.find("'candidatesData'")
print("Verify candidatesData snippet:")
print(repr(verify[cidx:cidx+200]))
