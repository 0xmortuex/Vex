// === chrome.debugger for an extension (2026-10-28) ==========================
//
// An extension that asked for the "debugger" permission drives a tab through the Chrome DevTools protocol: it reads the page, clicks, types,
// takes screenshots. The Claude extension does all of its browser work this way. Electron has the same debugger on every web contents, so
// this is the real thing, not a pretence, with the rules Vex puts around it:
//
//   - OFF unless the person switched it on, for that extension, on its card in Settings > Extensions ("Allow it to control other tabs").
//     `allowed(folder)` says; an extension that is not allowed gets an error in words, and is detached the moment the switch goes off;
//   - only a tab of the extension's own session (so never a private or Tor tab, which have no extensions) and only a web page: Vex's own
//     pages, an extension's pages and file:// are refused, as Chrome refuses chrome:// and other extensions' pages;
//   - one debugger per tab: a tab someone else (DevTools, another extension) has attached is refused, as in Chrome;
//   - every attached tab is reported (`changed`), and the window draws a bar on it that says which extension is in control and lets the
//     person stop it (detach with the reason "canceled_by_user").
//
// createExtensionDebugger is pure over what it is given, so it is tested against fakes:
//   pageOf(ses, tabId) -> a web contents of that session or null      usable(page) -> whether it is a page an extension may debug
//   allowed(folder) -> the person's switch                            emit(ses, extId, type, args) -> tells the extension (debugger.onEvent...)
//   changed(rows) -> [{ tabId, extId, folder }] every time one is attached or detached         pagesOf(ses) -> the session's tabs, for getTargets

const REASONS = Object.freeze({
  'target closed': 'target_closed',
  'target_closed': 'target_closed',
  'replaced with devtools': 'replaced_with_devtools',
  'canceled by user': 'canceled_by_user',
});
const DENIED = 'Vex has not let this extension control other tabs. Turn on "Allow it to control other tabs" on its card in Settings > Extensions.';

function createExtensionDebugger({ pageOf, usable, allowed, emit, changed = () => {}, pagesOf = () => [] }) {
  const attached = new Map();   // `${key}|${tabId}` -> { ses, key, extId, folder, tabId, page, onMessage, onDetach }
  const rows = () => [...attached.values()].map(a => ({ tabId: a.tabId, extId: a.extId, folder: a.folder }));
  const slot = (key, tabId) => key + '|' + tabId;
  const mine = (key, tabId) => {
    const a = attached.get(slot(key, tabId));
    if (!a) throw new Error(`Debugger is not attached to the tab with id: ${tabId}.`);
    return a;
  };

  function forget(a, reason) {
    if (attached.get(slot(a.key, a.tabId)) !== a) return false;
    attached.delete(slot(a.key, a.tabId));
    try { a.page.debugger.removeListener('message', a.onMessage); a.page.debugger.removeListener('detach', a.onDetach); }
    catch (err) { console.error('[Extensions] could not stop listening to a tab:', err.message); }
    changed(rows());
    if (reason) {
      try { emit(a.ses, a.extId, 'debugger.onDetach', [{ tabId: a.tabId }, reason]); }
      catch (err) { console.error('[Extensions] debugger.onDetach did not reach ' + a.extId + ':', err.message); }
    }
    return true;
  }

  function attach({ ses, key, extId, folder, tabId, version }) {
    if (!allowed(folder)) throw new Error(DENIED);
    const page = pageOf(ses, tabId);
    if (!page) throw new Error(`No tab with id: ${tabId}.`);
    if (!usable(page)) throw new Error('Cannot access a chrome:// URL');
    if (attached.has(slot(key, tabId)) || page.debugger.isAttached()) throw new Error(`Another debugger is already attached to the tab with id: ${tabId}.`);
    const a = { ses, key, extId, folder, tabId, page };
    a.onMessage = (_e, method, params, sessionId) => {
      const source = sessionId ? { tabId, sessionId } : { tabId };
      try { emit(ses, extId, 'debugger.onEvent', [source, method, params]); }
      catch (err) { console.error('[Extensions] debugger.onEvent did not reach ' + extId + ':', err.message); }
    };
    a.onDetach = (_e, reason) => { forget(a, REASONS[String(reason)] || 'target_closed'); };
    page.debugger.attach(typeof version === 'string' && version ? version : '1.3');
    page.debugger.on('message', a.onMessage);
    page.debugger.on('detach', a.onDetach);
    attached.set(slot(key, tabId), a);
    changed(rows());
    return undefined;
  }

  function detach({ key, tabId }) {
    const a = mine(key, tabId);
    forget(a, null);
    try { if (a.page.debugger.isAttached()) a.page.debugger.detach(); }
    catch (err) { console.error('[Extensions] could not detach a tab:', err.message); }
    return undefined;
  }

  async function sendCommand({ key, tabId, method, params, sessionId }) {
    const a = mine(key, tabId);
    if (typeof method !== 'string' || !/^[A-Za-z]+\.[A-Za-z]+$/.test(method)) throw new Error('Invalid debugger command');
    return a.page.debugger.sendCommand(method, params && typeof params === 'object' ? params : {}, sessionId || undefined);
  }

  // The tabs the extension could attach to, as chrome.debugger.getTargets describes them.
  function targets({ ses, key }) {
    return pagesOf(ses).filter(usable).map(page => ({
      type: 'page', id: String(page.id), tabId: page.id, title: page.getTitle(), url: page.getURL(), faviconUrl: '',
      attached: attached.has(slot(key, page.id)) || page.debugger.isAttached(),
    }));
  }

  // The person pressed Stop on the bar, or switched the extension's switch off, or removed it: the extension hears "canceled_by_user".
  function stop({ tabId, extId, folder }) {
    let n = 0;
    for (const a of [...attached.values()]) {
      if (tabId != null && a.tabId !== tabId) continue;
      if (extId != null && a.extId !== extId) continue;
      if (folder != null && a.folder !== folder) continue;
      forget(a, 'canceled_by_user');
      try { if (a.page.debugger.isAttached()) a.page.debugger.detach(); } catch (err) { console.error('[Extensions] could not detach a tab:', err.message); }
      n++;
    }
    return n;
  }

  return { attach, detach, sendCommand, targets, stop, rows, _attached: attached };
}

module.exports = { createExtensionDebugger, DENIED, REASONS };
