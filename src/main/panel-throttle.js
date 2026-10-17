// === Throttle one Vex side panel (T3-024) =====================================
//
// The panel guard (js/panel-guard.js) can put a panel that burns the processor during a
// game to sleep. Some panels cannot be slept (you keep them awake); for those, and for
// anyone who would rather keep the panel loaded, this lowers how much the panel can take:
//
//   - the operating system priority of the process that runs ONLY that panel is set to
//     the lowest class (it still runs, it just yields to everything else, the game
//     first), and
//   - background throttling is switched on for it.
//
// What it will not do, by construction:
//   - the id is a Vex page's webContents id (the policy has already checked that the
//     window owns it); the process id comes from Electron here, never from the window;
//   - only a <webview> guest, never the interface, never the main process;
//   - a process that also runs any other page is refused (a tab of the same site shares
//     a renderer; lowering it would lower that tab too);
//   - what it changed is remembered, and restore() puts the priority back; a page that
//     goes away needs nothing restored.
//
// createPanelThrottle({ os, webContents, ownPid }) so a test can pass stand-ins.

function createPanelThrottle({ os, webContents, ownPid = process.pid, log = () => {} }) {
  for (const k of ['setPriority', 'getPriority']) if (typeof os[k] !== 'function') throw new TypeError('createPanelThrottle: os.' + k + ' is required');
  if (!webContents || typeof webContents.fromId !== 'function' || typeof webContents.getAllWebContents !== 'function') throw new TypeError('createPanelThrottle: webContents is required');
  const LOW = os.constants.priority.PRIORITY_LOW;
  const NORMAL = os.constants.priority.PRIORITY_NORMAL;
  const lowered = new Map();      // wcId -> { pid, before }

  function guest(wcId) {
    const wc = webContents.fromId(wcId);
    if (!wc || wc.isDestroyed()) throw new Error('That panel is not there any more');
    if (wc.getType() !== 'webview') throw new Error('Only a panel page can be throttled');
    return wc;
  }

  function lower(wcId) {
    const wc = guest(wcId);
    const pid = wc.getOSProcessId();
    if (!pid || pid === ownPid) throw new Error('That panel shares the process of the Vex window and is left alone');
    const sharers = webContents.getAllWebContents().filter(o => o.id !== wcId && !o.isDestroyed() && o.getOSProcessId() === pid);
    if (sharers.length) throw new Error('That panel shares its process with another page, so it is left alone');
    if (!lowered.has(wcId)) {
      const before = os.getPriority(pid);
      os.setPriority(pid, LOW);
      lowered.set(wcId, { pid, before });
    }
    wc.setBackgroundThrottling(true);
    return { throttled: true, pid };
  }

  function restore(wcId) {
    const rec = lowered.get(wcId);
    if (!rec) return { throttled: false };
    lowered.delete(wcId);
    // The page may be gone already: nothing to put back then.
    const wc = webContents.fromId(wcId);
    if (!wc || wc.isDestroyed()) return { throttled: false };
    try { os.setPriority(rec.pid, rec.before >= os.constants.priority.PRIORITY_BELOW_NORMAL ? NORMAL : rec.before); }
    catch (err) { if (!/ESRCH|no such process/i.test(err.message)) throw new Error('The panel priority could not be put back: ' + err.message, { cause: err }); log('[PanelThrottle] process ' + rec.pid + ' was already gone'); }
    return { throttled: false };
  }

  return { set: (wcId, on) => (on ? lower(wcId) : restore(wcId)), restore, isThrottled: (wcId) => lowered.has(wcId), count: () => lowered.size };
}

module.exports = { createPanelThrottle };
