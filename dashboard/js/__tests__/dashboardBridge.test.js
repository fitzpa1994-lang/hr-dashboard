import { describe, expect, jest, test } from '@jest/globals';
import { readFileSync } from 'node:fs';

const bridgeSource = readFileSync(
  new URL('../../../chrome-extension/104-job-sync/dashboard_bridge.js', import.meta.url),
  'utf8'
);

function loadBridge() {
  const messageListeners = [];
  const postedMessages = [];
  const location = { origin: 'https://sp-hr.zeabur.app' };
  const window = {
    addEventListener: jest.fn((type, listener) => {
      if (type === 'message') messageListeners.push(listener);
    }),
    postMessage: jest.fn((message, origin) => postedMessages.push({ message, origin })),
  };
  const document = { addEventListener: jest.fn() };
  const chrome = {
    runtime: {
      getManifest: jest.fn(() => ({ version: '1.3.1' })),
      sendMessage: jest.fn(),
      lastError: null,
    },
  };

  Function('window', 'document', 'location', 'chrome', bridgeSource)(
    window,
    document,
    location,
    chrome
  );

  return { chrome, location, messageListeners, postedMessages, window };
}

describe('104 dashboard content-script bridge', () => {
  test('announces readiness again when the dashboard sends a ready request', () => {
    const context = loadBridge();
    expect(context.messageListeners).toHaveLength(1);
    context.postedMessages.length = 0;

    context.messageListeners[0]({
      source: context.window,
      origin: context.location.origin,
      data: { type: 'SPORTON_104_EXTENSION_READY_REQUEST' },
    });

    expect(context.postedMessages).toEqual([{
      message: {
        type: 'SPORTON_104_EXTENSION_READY',
        version: '1.3.1',
        contractVersion: 2,
      },
      origin: context.location.origin,
    }]);
    expect(context.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('ignores ready requests from a different source or origin', () => {
    const context = loadBridge();
    context.postedMessages.length = 0;

    context.messageListeners[0]({
      source: {},
      origin: context.location.origin,
      data: { type: 'SPORTON_104_EXTENSION_READY_REQUEST' },
    });
    context.messageListeners[0]({
      source: context.window,
      origin: 'https://example.com',
      data: { type: 'SPORTON_104_EXTENSION_READY_REQUEST' },
    });

    expect(context.postedMessages).toEqual([]);
  });
});
