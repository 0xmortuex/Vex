// === Page automations: the Electron side ======================================
//
// What automations.js leaves injected, supplied here:
//   * the window a run uses (a BrowserWindow in the recording's own session:
//     the main session or one of the person's containers), made fresh for the
//     run and destroyed at its end, so a run leaves no tab and no window behind
//   * the encrypted file (automations.enc, through SecretStore)
//   * the IPC handlers (Vex's own window only: ipc-policy.js UI_ONLY_CHANNELS,
//     closed in private windows) and the events sent back to the interface
//   * the Windows wake-up, through the same Task Scheduler code reminders use
//
// A run window has no preload and no IPC, is sandboxed, muted, never opens a
// popup, never downloads (a download is cancelled), and only follows http(s).
const path = require('path');

const RUN_LOAD_TIMEOUT_MS = 30000;
const SETTLE_MS = 350;

function createElectronDriverFactory({ BrowserWindow, getSession }) {
  return async function makeDriver(partition, { visible = false, name = 'Automation' } = {}) {
    const ses = getSession(partition);
    const win = new BrowserWindow({
      show: false, width: 1280, height: 900, skipTaskbar: !visible, focusable: true, title: 'Vex automation: ' + name,
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: false, autoplayPolicy: 'user-gesture-required' },
    });
    const wc = win.webContents;
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e, to) => { if (!/^https?:/i.test(String(to))) e.preventDefault(); });
    // A run never downloads or installs: the file is cancelled before it is written.
    const onDownload = (e, item, from) => { if (from === wc) { e.preventDefault(); console.warn('[Automations] a run tried to download a file; it was cancelled'); } };
    ses.on('will-download', onDownload);
    if (visible) win.show();

    const withTimeout = (p, ms, what) => {
      let t;
      return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(what + ' took longer than ' + Math.round(ms / 1000) + ' seconds')), ms); })]).finally(() => clearTimeout(t));
    };
    return {
      async load(url) {
        try { await withTimeout(wc.loadURL(url), RUN_LOAD_TIMEOUT_MS, 'The page'); }
        catch (err) {
          // A redirect that interrupts the first load reports ERR_ABORTED (-3) although the page arrives.
          if (!(err && err.code === 'ERR_ABORTED' && wc.getURL())) throw err;
        }
      },
      evaluate: (code) => withTimeout(wc.executeJavaScript(code, false), RUN_LOAD_TIMEOUT_MS, 'The step'),
      async settle() {
        await new Promise(r => setTimeout(r, SETTLE_MS));
        if (wc.isLoading()) await withTimeout(new Promise(r => wc.once('did-stop-loading', r)), RUN_LOAD_TIMEOUT_MS, 'The page');
        await new Promise(r => setTimeout(r, SETTLE_MS));
      },
      async screenshot() {
        const img = await wc.capturePage();
        if (!img || img.isEmpty()) return null;
        const small = img.getSize().width > 800 ? img.resize({ width: 800 }) : img;
        return 'data:image/jpeg;base64,' + small.toJPEG(60).toString('base64');
      },
      // An "ask me" step needs the person to see the page.
      async reveal() { if (!win.isDestroyed()) { win.show(); win.focus(); } },
      currentUrl: () => wc.getURL(),
      async close() {
        ses.removeListener('will-download', onDownload);
        if (!win.isDestroyed()) win.destroy();
      },
    };
  };
}

function registerAutomations({ ipcMain, BrowserWindow, getSession, secretStore, userDataPath, notifier, osScheduler, mainWindowOf, readRouting, focusMainWindow, log = (m) => console.log(m) }) {
  const { createAutomations } = require('./automations.js');
  const file = path.join(userDataPath, 'automations.enc');
  const svc = createAutomations({
    store: { read: () => secretStore.read(file, () => null), write: (doc) => secretStore.write(file, doc) },
    notifier, osScheduler, log,
    makeDriver: createElectronDriverFactory({ BrowserWindow, getSession }),
    // Only for the real-window checks against a local test page; never set in normal use.
    allowLocal: process.env.VEX_AUTOMATIONS_ALLOW_LOCAL === '1',
    routeOf: (partition) => { const r = readRouting(); return (r && r[partition] && r[partition].mode) || 'direct'; },
    windowFocused: () => { const w = mainWindowOf(); return !!(w && !w.isDestroyed() && w.isFocused() && w.isVisible()); },
    emit: (event) => { const w = mainWindowOf(); if (w && !w.isDestroyed()) w.webContents.send('automations:event', event); },
  });
  const h = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => fn(...args));
  h('automations:state', () => svc.state());
  h('automations:set-enabled', (on) => svc.setEnabled(on));
  h('automations:kill', () => svc.kill('pressed in the interface'));
  h('automations:rearm', () => svc.rearm());
  h('automations:save', (rec) => svc.save(rec));
  h('automations:delete', (id) => svc.remove(id));
  h('automations:run', async (id) => { const r = await svc.startNow(id, { trigger: 'manual' }); return { runId: r.runId }; });
  h('automations:stop', () => svc.stop());
  h('automations:decide', (runId, decision) => svc.decide(runId, decision));
  h('automations:runs', (recId) => svc.runs(recId));
  h('automations:run-get', (runId) => svc.runGet(runId));
  h('automations:ack', (ids) => svc.ack(ids));
  h('automations:export', (id) => svc.exportOne(id));
  h('automations:import', (text) => svc.importText(text));
  h('automations:reveal', () => { focusMainWindow('an automation needs you'); return true; });

  svc.init().catch(err => console.error('[Automations] failed to start:', err.message));
  return svc;
}

module.exports = { registerAutomations, createElectronDriverFactory };
