import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// This pins the CURRENT candidate department/position resolution ladder in
// Workflow1 ("HR Workflow 1：面試信件解析") before any Phase 2 changes touch it.
// The ladder has no other regression coverage today (unlike the Job
// Requisition Write node), and a prior silent edit to it caused a real
// misclassification incident (RF candidates filed under SAR, commit
// 5967cbac9). If a future change breaks one of these markers, that is the
// signal to update this test deliberately — not to let it drift silently.

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const workflow = JSON.parse(
  fs.readFileSync(path.join(root, 'n8n', 'live_Workflow1_面試解析.json'), 'utf8'),
);

function nodeQueries(nodeName) {
  return [workflow.nodes, workflow.activeVersion?.nodes]
    .filter(Array.isArray)
    .map(nodes => nodes.find(node => node.name === nodeName)?.parameters?.query || '');
}

function nodeJsCode(nodeName) {
  return [workflow.nodes, workflow.activeVersion?.nodes]
    .filter(Array.isArray)
    .map(nodes => nodes.find(node => node.name === nodeName)?.parameters?.jsCode || '');
}

const candidateQueries = nodeQueries('PG：寫入 candidates');
const extractCodes = nodeJsCode('Code：萃取基本資訊');

test('root and activeVersion use the same candidate-write SQL', () => {
  assert.equal(candidateQueries.length, 2);
  assert.ok(candidateQueries[0]);
  assert.equal(candidateQueries[0], candidateQueries[1]);
});

test('root and activeVersion use the same recipient-extraction code', () => {
  assert.equal(extractCodes.length, 2);
  assert.ok(extractCodes[0]);
  assert.equal(extractCodes[0], extractCodes[1]);
});

test('weak/placeholder department values are treated identically in both branches', () => {
  const weakList = "IN ('', '未分類', '未知部門', '未知職位', '測試', '人力資源部')";
  for (const query of candidateQueries) {
    assert.equal(
      query.split(weakList).length - 1,
      2,
      'weak-department blacklist must appear exactly twice (non_weak_department + is_weak_department)',
    );
  }
});

test('resolution priority ladder is present, in order, and gated as documented', () => {
  for (const query of candidateQueries) {
    const pri0 = query.indexOf('0 AS pri');
    const pri1 = query.indexOf('1 AS pri');
    const pri2 = query.indexOf('2 AS pri');
    const pri3 = query.indexOf('3 AS pri');
    const pri4 = query.indexOf('4 AS pri');
    assert.ok(pri0 > 0 && pri0 < pri1 && pri1 < pri2 && pri2 < pri3 && pri3 < pri4, 'priority tiers must stay in 0..4 order');
    assert.ok(query.includes('ORDER BY pri\n  LIMIT 1'), 'matched_requisition must take the single lowest-priority hit');

    // pri 0: recipient-map hard override, unconditional on department/position text
    assert.ok(query.includes('c.recipient_preferred_requisition_id IS NOT NULL\n      AND j.id = c.recipient_preferred_requisition_id'));

    // pri 1: exact department match is required (never fires when department is weak)
    assert.ok(query.includes('WHERE NOT c.is_weak_department\n      AND j.status'));

    // pri 2 / pri 3: both require is_weak_department AND a *unique* fuzzy hit
    assert.ok(query.includes('WHERE c.is_weak_department\n    AND j.status'), 'fuzzy_position_matches must require weak department');
    assert.ok(query.includes('WHERE (SELECT COUNT(*) FROM fuzzy_position_matches) = 1'), 'pri 2 must require a unique fuzzy match');
    assert.ok(query.includes('WHERE c.is_weak_department\n    AND s.publication_status'), 'linked_104_matches must require weak department');
    assert.ok(query.includes('WHERE (SELECT COUNT(DISTINCT id) FROM linked_104_matches) = 1'), 'pri 3 must require a unique 104-linked match');
  }
});

test('pri 4 hardcoded safety net keeps its exact four entries', () => {
  // These four raw-text -> requisition-id overrides are the fragile "magic
  // number" fallback position_routing_rules is meant to replace. Until the
  // old branch is removed (a deliberate later step), they must not silently
  // change — verified as of 2026-07-24 against live production data that ids
  // 17/23/27 still point at MIS工程師/SAR測試工程師/軟體工程師(AI開發) respectively
  // (RF has no entry here; that gap is intentional/known).
  for (const query of candidateQueries) {
    for (const marker of [
      "U&'MIS\\7DB2\\7BA1\\5DE5\\7A0B\\5E2B' || '%' AND j.id = 17",
      "U&'MIS\\7DB2\\7BA1' || '%' AND j.id = 17",
      "U&'SAR\\5DE5\\7A0B\\5E2B' || '%' AND j.id = 23",
      "U&'AI\\8EDF\\9AD4\\5DE5\\7A0B\\5E2B' || '%' AND j.id = 27",
    ]) {
      assert.ok(query.includes(marker), `missing pri-4 safety net entry: ${marker}`);
    }
    // 2, not 1: the old hardcoded branch plus the new additive
    // routing_rule_keyword_match branch (see next test), both tied at pri 4.
    assert.equal(query.split('4 AS pri').length - 1, 2, 'pri-4 must have exactly the old branch plus the new additive routing_rule_keyword_match branch');
  }
});

test('position_routing_rules is consulted as an additive pri-0/pri-4 layer, old branches untouched', () => {
  // 2026-07-24: Workflow1 was wired to also consult position_routing_rules,
  // strictly additively — the old JS array and SQL literals above are left
  // in place on purpose. Because the migrated table rows are identical to
  // those old hardcoded values, a tie at the same pri number always resolves
  // to the same job_requisition_id either way, so today's routing outcomes
  // are unchanged. Removing the old branches is a deliberate later step.
  for (const query of candidateQueries) {
    assert.ok(query.includes('CREATE TABLE IF NOT EXISTS position_routing_rules'), 'bootstrap must create the table if missing');

    assert.ok(query.includes('routing_rule_recipient_match AS ('), 'missing routing_rule_recipient_match CTE');
    assert.ok(query.includes("AND rr.match_type = 'recipient_email'"));
    assert.ok(query.includes('routing_rule_recipient_match'), 'CTE must be referenced by a pri-0 branch');

    assert.ok(query.includes('routing_rule_keyword_match AS ('), 'missing routing_rule_keyword_match CTE');
    assert.ok(query.includes("AND rr.match_type = 'position_keyword'"));
    assert.ok(query.includes("c.raw_position LIKE '%' || rr.pattern || '%'"));

    // Both new CTEs require rr.is_active and a non-null job_requisition_id —
    // a rule with only a department_hint (like the migrated yenchen row) must
    // never surface here as a hard override.
    assert.equal(query.split('rr.is_active').length - 1, 2, 'both new CTEs must gate on rr.is_active');
    assert.equal(query.split('rr.job_requisition_id IS NOT NULL').length - 1, 2, 'both new CTEs must require a non-null job_requisition_id');

    // 2, not 1: old hardcoded pri-0 branch plus the new additive branch.
    assert.equal(query.split('0 AS pri').length - 1, 2, 'pri-0 must have exactly the old branch plus the new additive routing_rule_recipient_match branch');
  }
});

test('auto_req never writes a placeholder department/position as the literal value', () => {
  for (const query of candidateQueries) {
    assert.ok(query.includes("NOT IN ('未知職位','未分類','','null','未知','未知的職位')"));
    assert.equal(query.split("NOT IN ('未知職位','未分類','','null','未知','未知的職位')").length - 1, 2);
    assert.ok(query.includes('ON CONFLICT (department, position_title) DO NOTHING'));
  }
});

test('recipient routing rules keep their current three hardcoded overrides', () => {
  // Mirrors the pri-4 SQL safety net's fragility: these three email -> department
  // (+ optional requisition id) overrides live in JS, invisible from the SQL layer.
  // Verified as of 2026-07-24 against live data that id 25 = WBU/RF工程一部/測試工程師
  // and id 1 = ICC/工程部/測試工程師.
  for (const code of extractCodes) {
    assert.ok(code.includes("{ match: /viclee@sporton\\.com\\.tw$/, topDepartment: 'WBU', preferredRequisitionId: 25 }"));
    assert.ok(code.includes("{ match: /codychang@sporton\\.com\\.tw$/, topDepartment: 'ICC', preferredRequisitionId: 1 }"));
    assert.ok(code.includes("{ match: /yenchen@sporton\\.com\\.tw$/, topDepartment: 'ICC' }"));
    assert.equal(code.split('recipientRoutingRules').length - 1, 2, 'recipientRoutingRules must be declared once and referenced once');
  }
});

test('candidate query stays within its expected size envelope', () => {
  for (const query of candidateQueries) {
    assert.ok(query.length > 9_000 && query.length < 15_000, `unexpected candidate-write SQL length: ${query.length}`);
  }
});
