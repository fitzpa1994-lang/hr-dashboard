import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertWorkflowQueriesEqual,
  deployAndVerifyWorkflow,
} from '../deploy_n8n_export.mjs';

const url = 'https://n8n.invalid/api/v1/workflows/workflow-1';
const headers = {
  'Content-Type': 'application/json',
  'X-N8N-API-KEY': 'test-only',
};
const payload = {
  name: 'Workflow',
  nodes: [
    {
      id: 'pg-1',
      name: 'PG Query',
      parameters: { query: "SELECT 'external104Jobs'\nFROM job_requisition_sources;" },
    },
  ],
  connections: {},
  settings: { executionOrder: 'v1' },
};

function response(json, { ok = true, status = 200, text = '' } = {}) {
  return { res: { ok, status }, json, text };
}

function mockRequests(steps) {
  const pending = [...steps];
  const calls = [];
  const requestJsonFn = async (requestUrl, options = {}) => {
    calls.push({ url: requestUrl, ...options });
    assert.ok(pending.length, `Unexpected request: ${options.method || 'GET'} ${requestUrl}`);
    const next = pending.shift();
    assert.equal(options.method || 'GET', next.method);
    assert.equal(requestUrl, next.url || url);
    return response(next.json, next.responseOptions);
  };
  return {
    calls,
    requestJsonFn,
    assertDone() {
      assert.equal(pending.length, 0, `${pending.length} expected request(s) were not made`);
    },
  };
}

function versionedWorkflow({
  versionId,
  activeVersionId,
  activeNodes = payload.nodes,
  rootNodes = payload.nodes,
}) {
  return {
    active: Boolean(activeVersionId),
    versionId,
    activeVersionId,
    activeVersion: activeVersionId
      ? { versionId: activeVersionId, nodes: activeNodes, connections: {} }
      : null,
    nodes: rootNodes,
    connections: {},
  };
}

test('query verification normalizes CRLF but rejects stale SQL', () => {
  const crlfNodes = [
    {
      ...payload.nodes[0],
      parameters: { query: payload.nodes[0].parameters.query.replace(/\n/g, '\r\n') },
    },
  ];
  assert.doesNotThrow(() => assertWorkflowQueriesEqual(payload.nodes, crlfNodes));

  const staleNodes = [
    { ...payload.nodes[0], parameters: { query: 'SELECT 1;' } },
  ];
  assert.throws(
    () => assertWorkflowQueriesEqual(payload.nodes, staleNodes, 'activeVersion'),
    /deployed query differs/,
  );
});

test('current API accepts PUT auto-publish after a fresh GET without redundant activate', async () => {
  const mock = mockRequests([
    { method: 'PUT', json: versionedWorkflow({ versionId: 'new', activeVersionId: 'new' }) },
    { method: 'GET', json: versionedWorkflow({ versionId: 'new', activeVersionId: 'new' }) },
  ]);

  const result = await deployAndVerifyWorkflow({
    url,
    headers,
    workflowId: 'workflow-1',
    payload,
    live: versionedWorkflow({ versionId: 'old', activeVersionId: 'old' }),
    requestJsonFn: mock.requestJsonFn,
  });

  mock.assertDone();
  assert.equal(result.savedVersionId, 'new');
  assert.equal(result.activeVersionId, 'new');
  assert.deepEqual(mock.calls.map(call => call.method || 'GET'), ['PUT', 'GET']);
});

test('current API fails closed when activeVersion lags after PUT', async () => {
  const mock = mockRequests([
    { method: 'PUT', json: versionedWorkflow({ versionId: 'new', activeVersionId: 'old' }) },
    {
      method: 'GET',
      json: versionedWorkflow({
        versionId: 'new',
        activeVersionId: 'old',
        activeNodes: [{ ...payload.nodes[0], parameters: { query: 'SELECT old;' } }],
      }),
    },
  ]);

  await assert.rejects(
    deployAndVerifyWorkflow({
      url,
      headers,
      workflowId: 'workflow-1',
      payload,
      live: versionedWorkflow({ versionId: 'old', activeVersionId: 'old' }),
      requestJsonFn: mock.requestJsonFn,
    }),
    /active version did not advance.*Refusing to publish automatically/,
  );

  mock.assertDone();
  assert.equal(mock.calls.some(call => call.method === 'POST'), false);
});

test('current API refuses to publish when another save wins after PUT', async () => {
  const mock = mockRequests([
    { method: 'PUT', json: versionedWorkflow({ versionId: 'ours', activeVersionId: 'ours' }) },
    { method: 'GET', json: versionedWorkflow({ versionId: 'other', activeVersionId: 'other' }) },
  ]);

  await assert.rejects(
    deployAndVerifyWorkflow({
      url,
      headers,
      workflowId: 'workflow-1',
      payload,
      live: versionedWorkflow({ versionId: 'old', activeVersionId: 'old' }),
      requestJsonFn: mock.requestJsonFn,
    }),
    /changed after PUT.*Refusing to publish/,
  );
  mock.assertDone();
  assert.equal(mock.calls.some(call => call.method === 'POST'), false);
});

test('current API does not overwrite a concurrent unpublish or alternate publication', async () => {
  for (const currentActiveVersionId of [null, 'other-active']) {
    const mock = mockRequests([
      { method: 'PUT', json: versionedWorkflow({ versionId: 'new', activeVersionId: 'old' }) },
      {
        method: 'GET',
        json: versionedWorkflow({
          versionId: 'new',
          activeVersionId: currentActiveVersionId,
          activeNodes: [{ ...payload.nodes[0], parameters: { query: 'SELECT other;' } }],
        }),
      },
    ]);

    await assert.rejects(
      deployAndVerifyWorkflow({
        url,
        headers,
        workflowId: 'workflow-1',
        payload,
        live: versionedWorkflow({ versionId: 'old', activeVersionId: 'old' }),
        requestJsonFn: mock.requestJsonFn,
      }),
      /active version did not advance.*Refusing to publish automatically/,
    );
    mock.assertDone();
    assert.equal(mock.calls.some(call => call.method === 'POST'), false);
  }
});

test('an unpublished versioned workflow stays unpublished and verifies saved SQL', async () => {
  const mock = mockRequests([
    { method: 'PUT', json: versionedWorkflow({ versionId: 'new', activeVersionId: null }) },
    { method: 'GET', json: versionedWorkflow({ versionId: 'new', activeVersionId: null }) },
  ]);

  const result = await deployAndVerifyWorkflow({
    url,
    headers,
    workflowId: 'workflow-1',
    payload,
    live: versionedWorkflow({ versionId: 'old', activeVersionId: null }),
    requestJsonFn: mock.requestJsonFn,
  });

  mock.assertDone();
  assert.equal(result.wasPublished, false);
  assert.equal(result.activeVersionId, null);
  assert.equal(mock.calls.some(call => call.method === 'POST'), false);
});

test('legacy API refuses to overwrite a concurrent deactivation', async () => {
  const legacyActive = { active: true, nodes: payload.nodes, connections: {} };
  const legacyInactive = { active: false, nodes: payload.nodes, connections: {} };
  const mock = mockRequests([
    { method: 'PUT', json: legacyActive },
    { method: 'GET', json: legacyInactive },
  ]);

  await assert.rejects(
    deployAndVerifyWorkflow({
      url,
      headers,
      workflowId: 'workflow-1',
      payload,
      live: legacyActive,
      requestJsonFn: mock.requestJsonFn,
    }),
    /became inactive after PUT; refusing to reactivate/,
  );

  mock.assertDone();
  assert.equal(mock.calls.some(call => call.method === 'POST'), false);
  assert.equal(mock.calls.some(call => call.url.endsWith('/deactivate')), false);
});
