// === Vex extension host — orchestration ===
//
// Ties the three pieces together: register the bridge preload on every session,
// register the chrome.* implementations, then copy/patch/load the extension.
//
// Ordering matters. Preloads have to be registered before the extension loads,
// or the service worker starts without globalThis.vexBridge and every shimmed
// call is inert for the life of that worker.

const path = require('path');
const fs = require('fs');
const { ipcMain, dialog, session, shell } = require('electron');

const install = require('./install');
const api = require('./api');

let _hostDir = null;      // where patched extensions live
let _loaded = null;       // { id, name, version, path }
let _sessions = [];

function hostDir(app) {
  if (!_hostDir) {
    _hostDir = path.join(app.getPath('userData'), 'vex-ext-host');
    fs.mkdirSync(_hostDir, { recursive: true });
  }
  return _hostDir;
}

function stateFile(app) { return path.join(hostDir(app), 'installed.json'); }

function readState(app) {
  try { return JSON.parse(fs.readFileSync(stateFile(app), 'utf8')); } catch { return null; }
}
function writeState(app, state) {
  try { fs.writeFileSync(stateFile(app), JSON.stringify(state, null, 2), 'utf8'); } catch {}
}

async function loadInto(sessions, dir) {
  let loaded = null;
  for (const ses of sessions) {
    try {
      const ext = await ses.loadExtension(dir, { allowFileAccess: true });
      if (!loaded) loaded = ext;
    } catch (err) {
      console.error('[vex-ext] load failed on a session:', err.message);
    }
  }
  return loaded;
}

// Copy + patch + load. `srcDir` is an unpacked Chrome extension directory.
async function installFrom(app, srcDir) {
  const dest = path.join(hostDir(app), 'current');
  const prep = install.prepare(srcDir, dest);
  if (!prep.ok) return prep;

  install.registerPreloads(_sessions);

  const ext = await loadInto(_sessions, dest);
  if (!ext) return { ok: false, error: 'Files were patched but the extension did not attach.' };

  api.setExtension(ext.id, prep.manifest, dest);
  _loaded = { id: ext.id, name: ext.name, version: ext.manifest.version, path: dest };
  writeState(app, { srcDir, dest, id: ext.id, name: ext.name, version: ext.manifest.version });

  console.log('[vex-ext] installed', ext.name, ext.manifest.version, ext.id, '(patched:', prep.patched.length, 'files)');
  return { ok: true, ...(_loaded), patched: prep.patched };
}

function init(app, sessions, opts = {}) {
  _sessions = sessions.filter(Boolean);

  // Preloads first — before any extension gets a chance to start a worker.
  install.registerPreloads(_sessions);
  api.register({ onSidePanelOpen: opts.onSidePanelOpen });

  ipcMain.handle('ext-host:status', () => ({
    installed: !!_loaded,
    ...(_loaded || {}),
  }));

  ipcMain.handle('ext-host:install-folder', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Select the unpacked Claude extension folder (must contain manifest.json)',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, cancelled: true };
    return installFrom(app, res.filePaths[0]);
  });

  // Convenience: Chrome keeps unpacked copies of installed extensions under
  // the user's profile, so offer to pick one up straight from there.
  ipcMain.handle('ext-host:find-chrome-copies', () => {
    const out = [];
    const base = path.join(app.getPath('appData'), '..', 'Local', 'Google', 'Chrome', 'User Data');
    for (const profile of ['Default', 'Profile 1', 'Profile 2']) {
      const extRoot = path.join(base, profile, 'Extensions');
      if (!fs.existsSync(extRoot)) continue;
      for (const id of fs.readdirSync(extRoot)) {
        const idDir = path.join(extRoot, id);
        let versions = [];
        try { versions = fs.readdirSync(idDir).filter(v => fs.existsSync(path.join(idDir, v, 'manifest.json'))); } catch { continue; }
        for (const v of versions) {
          const dir = path.join(idDir, v);
          try {
            const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
            out.push({ id, name: mf.name || id, version: mf.version || v, dir, profile });
          } catch {}
        }
      }
    }
    return out;
  });

  ipcMain.handle('ext-host:install-path', async (_e, dir) => {
    if (!dir || !fs.existsSync(path.join(String(dir), 'manifest.json'))) {
      return { ok: false, error: 'That folder has no manifest.json' };
    }
    return installFrom(app, String(dir));
  });

  ipcMain.handle('ext-host:uninstall', async () => {
    const st = readState(app);
    for (const ses of _sessions) {
      try {
        for (const ex of ses.getAllExtensions()) {
          if (st && ex.id === st.id) ses.removeExtension(ex.id);
        }
      } catch {}
    }
    try { fs.rmSync(path.join(hostDir(app), 'current'), { recursive: true, force: true }); } catch {}
    try { fs.rmSync(stateFile(app), { force: true }); } catch {}
    _loaded = null;
    return { ok: true };
  });

  ipcMain.handle('ext-host:open-folder', () => { shell.openPath(hostDir(app)); return { ok: true }; });

  // Re-load whatever was installed last run.
  const st = readState(app);
  if (st && st.dest && fs.existsSync(path.join(st.dest, 'manifest.json'))) {
    loadInto(_sessions, st.dest).then(ext => {
      if (!ext) return;
      let manifest = null;
      try { manifest = JSON.parse(fs.readFileSync(path.join(st.dest, 'manifest.json'), 'utf8')); } catch {}
      api.setExtension(ext.id, manifest, st.dest);
      _loaded = { id: ext.id, name: ext.name, version: ext.manifest.version, path: st.dest };
      console.log('[vex-ext] restored', ext.name, ext.manifest.version);
    }).catch(err => console.error('[vex-ext] restore failed:', err.message));
  }
}

module.exports = { init, installFrom, hostDir };
