const REQUEST_TYPE = 'SPORTON_104_SYNC_REQUEST';
const RESPONSE_TYPE = 'SPORTON_104_SYNC_RESPONSE';
const READY_TYPE = 'SPORTON_104_EXTENSION_READY';

function announceReady() {
  window.postMessage({
    type: READY_TYPE,
    version: chrome.runtime.getManifest().version
  }, location.origin);
}

announceReady();
document.addEventListener('DOMContentLoaded', announceReady, { once: true });

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (event.data?.type !== REQUEST_TYPE) return;

  const requestId = String(event.data.requestId || '');
  chrome.runtime.sendMessage({ type: 'sync104JobsManual' }, response => {
    const runtimeError = chrome.runtime.lastError;
    window.postMessage({
      type: RESPONSE_TYPE,
      requestId,
      ...(runtimeError
        ? { ok: false, error: runtimeError.message || '104 同步掛件連線失敗' }
        : response || { ok: false, error: '104 同步掛件沒有回應' })
    }, location.origin);
  });
});
