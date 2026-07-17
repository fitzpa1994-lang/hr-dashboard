const REQUEST_TYPE = 'SPORTON_104_SYNC_REQUEST';
const RESPONSE_TYPE = 'SPORTON_104_SYNC_RESPONSE';
const READY_TYPE = 'SPORTON_104_EXTENSION_READY';
const CAPTURE_REQUEST_TYPE = 'SPORTON_104_CAPTURE_REQUEST';
const CAPTURE_RESPONSE_TYPE = 'SPORTON_104_CAPTURE_RESPONSE';

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
  if (![REQUEST_TYPE, CAPTURE_REQUEST_TYPE].includes(event.data?.type)) return;

  const requestId = String(event.data.requestId || '');
  const isCapture = event.data.type === CAPTURE_REQUEST_TYPE;
  chrome.runtime.sendMessage({ type: isCapture ? 'capture104SearchConditions' : 'sync104JobsManual' }, response => {
    const runtimeError = chrome.runtime.lastError;
    window.postMessage({
      type: isCapture ? CAPTURE_RESPONSE_TYPE : RESPONSE_TYPE,
      requestId,
      ...(runtimeError
        ? { ok: false, error: runtimeError.message || '104 同步掛件連線失敗' }
        : response || { ok: false, error: '104 同步掛件沒有回應' })
    }, location.origin);
  });
});
