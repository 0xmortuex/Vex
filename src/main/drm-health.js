// === Protected playback (DRM) that explains itself ==========================
//
// Netflix, Spotify, Prime Video and the like need the Widevine decryption module (the "CDM"), and castLabs'
// Electron only gets it when Vex's own program file carries a valid castLabs "VMP" signature. When either is
// missing the sites just say "DRM failed". This module reads what the app can know OFFLINE and turns it into
// one plain answer: { state: 'ok' | 'degraded' | 'broken', reasons[], fix }.
//
// What it reads (nothing is sent anywhere; Electron's own component updater does its own downloads):
//   * the build: process.versions (a castLabs build says "+wvcus"), whether the components API exists,
//     whether the app is installed (app.isPackaged);
//   * components.status() for the Widevine CDM (status text and version), components.updatesEnabled;
//   * the signature file castLabs writes next to the program (Vex.exe.sig): whether it is there;
//   * the Widevine folders in the profile (userData/WidevineCdm);
//   * how the start-up install of the component ended (noteInit, from main.js initWidevine);
//   * what a page itself said when playback failed (passed in as `reported`).
//
// What it can NOT know: whether the signature is VALID. Only castLabs' tool (verify-pkg) or Google's license
// server can say that, so a present signature file is never reported as "valid". The one honest signal is
// the pattern seen in practice (memory note drm-widevine-vmp-signing): with a bad signature the component
// server hands out no CDM, so "no Widevine installed although the signature file is there" is reported as
// "most likely an invalid or expired signature", never as a fact.
//
// Every sentence is a template with {0}, {1} holes and its values in `args`: the window translates the
// template (js/i18n-ui.js is keyed by the English template) and then fills the holes, so a version number or a
// site name is never lost in translation. `text` is the filled English, for logs and tests.
//
// diagnose(facts) is pure (tests/main/drmHealth.test.js feeds it fakes). createDrmHealth(env) gathers the
// facts with injected electron/fs/path so it can be tested too.

const REPAIRS = ['recheck', 'enable-updates', 'reset-component', 'clear-site', 'reload'];

// What a person who builds Vex has to do when the signature is the problem (the owner's recipe).
const BUILDER_STEPS = [
  'In a terminal run: python -m castlabs_evs.account reauth (type the castLabs password there, never into a chat).',
  'Sign the unpacked app freshly: python -m castlabs_evs.vmp sign-pkg -f "dist\\win-unpacked"',
  'Check it: python -m castlabs_evs.vmp verify-pkg "dist\\win-unpacked" must say "Signature is valid".',
  'Build the installer from that folder without changing the program file again: npx electron-builder --prepackaged "dist/win-unpacked" --win',
];

const short = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const fill = (template, args) => String(template).replace(/\{(\d+)\}/g, (_, i) => (args[+i] == null ? '' : String(args[+i])));

// The sentences, by code. Each is the English template the Turkish table is keyed by.
const T = {
  'no-widevine-build': 'This copy of Vex was not built on the castLabs Electron, which is the only Electron that can play Netflix, Spotify and other protected video.',
  'no-widevine-build-owner': 'The app has to be rebuilt on the castLabs Electron (the "+wvcus" build) and signed with castLabs EVS. Nothing inside the running app can add that.',
  'not-castlabs-version': 'The Electron version ({0}) does not say it is a castLabs build, yet it has the Widevine component API.',
  'dev-build': 'Vex is running from source (npm start). A source run is not signed, so protected playback is only expected to work in the installed Vex.',
  'updates-off': 'Component updates are switched off in this profile, so the Widevine module can never be installed or updated.',
  'sig-missing': 'The castLabs signature file ({0}) is missing next to the program. Without it castLabs\' servers will not give this copy of Vex the Widevine module.',
  'sig-missing-owner': 'This copy of Vex was built without the castLabs signature. Only the person who builds Vex can fix that: sign it with castLabs EVS and build again. If you got Vex from someone else, install their latest release.',
  'cdm-unregistered': 'The Widevine component is not registered in this build, so there is nothing to install.',
  'cdm-unregistered-owner': 'The build does not register the Widevine component. It needs a rebuild on the castLabs Electron.',
  'cdm-missing': 'The Widevine module is not installed. Without it protected video cannot play.',
  'cdm-missing-state': 'The Widevine module is not installed (component state: {0}). Without it protected video cannot play.',
  'sig-suspect': 'The signature file is present, but the Widevine module still did not come. That is how an invalid or expired castLabs signature looks (the server gives no module). Vex cannot check a signature itself, so this is a likely cause, not a proven one.',
  'sig-suspect-owner': 'If the repairs above do not bring the module, the signature is the likely cause. The person who builds Vex has to sign it again with castLabs EVS and build again; the check "verify-pkg" must say "Signature is valid".',
  'cdm-missing-owner': 'If the repairs above do not bring the module, check the internet connection first, then the castLabs signature of this build.',
  'cdm-present': 'The Widevine module is installed (version {0}).',
  'mf-only': 'Only the Windows (Media Foundation) Widevine module is present. Web players such as Netflix and Spotify use the other one.',
  'init-failed': 'Setting up the Widevine module at start-up failed: {0}.',
  'init-network': 'That looks like a network problem. The module is downloaded by Electron\'s own updater from Google\'s component server; check the connection and try again.',
  'init-pending': 'Vex is still setting up the Widevine module. Give it a minute, then check again.',
  'cdm-folder-empty': 'The profile\'s Widevine folder is empty, so a clean re-download is the next step.',
  'page-reported': '{0} reported a playback problem: "{1}".',
  'page-reported-site': '{0} reported a playback problem: "{1}". Widevine itself looks fine here, so this points at the site (its account, region, device limit or a stale saved state), or at the site rejecting this copy of Vex.',
  'page-reported-owner': 'If clearing the site and reloading does not help, the site\'s license server may be rejecting this copy of Vex. That is the same castLabs signature problem: the person who builds Vex checks it with "verify-pkg".',
  'signature-unverifiable': 'Vex cannot check its own castLabs signature. Whether a site accepts this copy is only proven by playing something.',
  'read-error': 'Vex could not read {0}.',
  'headline-ok': 'Protected playback should work: the Widevine module is installed.',
  'headline-degraded': 'Protected playback may not work as expected.',
  'headline-broken': 'Protected playback (Netflix, Spotify, Prime Video and similar) cannot work right now.',
};

// -> { state, headline, reasons: [{ code, level, text, template, args }], fix: { repairs[], owner }, facts }
//   reasons[].level: 'bad' | 'warn' | 'info'.
//   fix.owner: null, or { needed: 'yes' | 'maybe', text, template, builderSteps[] }.
function diagnose(f) {
  const reasons = [];
  const add = (code, level, template, ...args) => reasons.push({ code, level, template, args, text: fill(template, args) });
  const repairs = new Set();
  let owner = null;
  const needOwner = (needed, template) => {
    if (!owner || needed === 'yes') owner = { needed, template, text: template, builderSteps: BUILDER_STEPS.slice() };
  };

  for (const e of f.readErrors || []) add('read-error', 'warn', T['read-error'], e);

  if (!f.api) {
    add('no-widevine-build', 'bad', T['no-widevine-build']);
    needOwner('yes', T['no-widevine-build-owner']);
  } else {
    if (!f.castlabsBuild) add('not-castlabs-version', 'warn', T['not-castlabs-version'], f.electron);
    if (!f.packaged) add('dev-build', 'warn', T['dev-build']);
    if (f.updatesEnabled === false) {
      add('updates-off', 'bad', T['updates-off']);
      repairs.add('enable-updates');
    }
    if (f.packaged && f.sig && f.sig.checked && !f.sig.exists) {
      add('sig-missing', 'bad', T['sig-missing'], f.sig.name);
      needOwner('yes', T['sig-missing-owner']);
    }
    const w = f.widevine;
    if (!w) {
      add('cdm-unregistered', 'bad', T['cdm-unregistered']);
      needOwner('yes', T['cdm-unregistered-owner']);
    } else if (!w.version) {
      if (w.status) add('cdm-missing', 'bad', T['cdm-missing-state'], short(w.status, 60));
      else add('cdm-missing', 'bad', T['cdm-missing']);
      repairs.add('recheck');
      repairs.add('reset-component');
      if (f.packaged && f.sig && f.sig.exists) {
        add('sig-suspect', 'warn', T['sig-suspect']);
        needOwner('maybe', T['sig-suspect-owner']);
      } else if (f.packaged && !(f.sig && f.sig.checked && !f.sig.exists)) {
        needOwner('maybe', T['cdm-missing-owner']);
      }
    } else {
      add('cdm-present', 'info', T['cdm-present'], w.version);
    }
    if (f.mediaFoundation && f.mediaFoundation.version && (!w || !w.version)) add('mf-only', 'info', T['mf-only']);
    const init = f.init || {};
    if (init.state === 'failed') {
      add('init-failed', w && w.version ? 'warn' : 'bad', T['init-failed'], short(init.message, 160));
      repairs.add('recheck');
      if (/timed out|network|internet|ERR_/i.test(init.message || '')) add('init-network', 'info', T['init-network']);
    } else if (init.state === 'pending' && !(w && w.version)) {
      add('init-pending', 'warn', T['init-pending']);
      repairs.add('recheck');
    }
    if (f.cdmDirs && f.cdmDirs.exists && !f.cdmDirs.versions.length && !(w && w.version)) {
      add('cdm-folder-empty', 'info', T['cdm-folder-empty']);
      repairs.add('reset-component');
    }
  }

  const rep = f.reported;
  if (rep && rep.message) {
    const host = short(rep.host, 80) || 'A site';
    const bad = reasons.some(r => r.level === 'bad');
    if (bad) {
      add('page-reported', 'warn', T['page-reported'], host, short(rep.message, 160));
      repairs.add('reload');
    } else {
      add('page-reported', 'warn', T['page-reported-site'], host, short(rep.message, 160));
      repairs.add('clear-site');
      repairs.add('reload');
      needOwner('maybe', T['page-reported-owner']);
    }
  }

  const state = reasons.some(r => r.level === 'bad') ? 'broken' : reasons.some(r => r.level === 'warn') ? 'degraded' : 'ok';
  if (state === 'ok') {
    add('signature-unverifiable', 'info', T['signature-unverifiable']);
    owner = null;
  }
  const headlineTemplate = T['headline-' + state];
  return {
    state, headline: headlineTemplate, reasons,
    fix: { repairs: REPAIRS.filter(r => repairs.has(r)), owner },
    facts: {
      packaged: f.packaged, electron: f.electron, chrome: f.chrome, castlabsBuild: f.castlabsBuild, componentsApi: f.api,
      updatesEnabled: f.updatesEnabled, widevine: f.widevine, mediaFoundation: f.mediaFoundation,
      signatureFile: f.sig ? { name: f.sig.name, exists: f.sig.exists, checked: f.sig.checked } : null,
      cdmVersionsOnDisk: f.cdmDirs ? f.cdmDirs.versions : null, init: f.init || null,
    },
  };
}

// The facts diagnose() reads, from the live app. env: { app, electron, versions, execPath, platform, fs, path }
// (all injected). Anything that cannot be read is named in readErrors, never skipped.
function gatherFacts(env, init, reported) {
  const readErrors = [];
  const { app, fs, path } = env;
  const components = env.electron && env.electron.components;
  const api = !!(components && typeof components.status === 'function' && typeof components.whenReady === 'function');
  const electron = String(env.versions.electron || '');
  const f = {
    packaged: !!app.isPackaged, electron, chrome: String(env.versions.chrome || ''), castlabsBuild: /\+wvcus/i.test(electron),
    api, updatesEnabled: null, widevine: null, mediaFoundation: null, sig: null, cdmDirs: null, init, reported, readErrors,
  };
  if (api) {
    try { if (typeof components.updatesEnabled === 'boolean') f.updatesEnabled = components.updatesEnabled; }
    catch (err) { readErrors.push('whether component updates are on (' + err.message + ')'); }
    try {
      const st = components.status() || {};
      const pick = (id) => {
        const c = id ? st[id] : null;
        return c ? { status: c.status == null ? null : String(c.status), version: c.version || null, title: c.title || null } : null;
      };
      f.widevine = pick(components.WIDEVINE_CDM_ID);
      f.mediaFoundation = pick(components.MEDIA_FOUNDATION_WIDEVINE_CDM_ID);
    } catch (err) { readErrors.push('the Widevine component state (' + err.message + ')'); }
  }
  if (f.packaged) {
    const name = path.basename(env.execPath) + '.sig';
    try { f.sig = { checked: true, name, exists: fs.existsSync(path.join(path.dirname(env.execPath), name)) }; }
    catch (err) { f.sig = { checked: false, name, exists: false }; readErrors.push('the signature file (' + err.message + ')'); }
  }
  try {
    const dir = path.join(app.getPath('userData'), 'WidevineCdm');
    if (fs.existsSync(dir)) {
      const versions = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && /^\d+(\.\d+)+$/.test(d.name)).map(d => d.name);
      f.cdmDirs = { exists: true, versions };
    } else f.cdmDirs = { exists: false, versions: [] };
  } catch (err) { readErrors.push('the Widevine folder of the profile (' + err.message + ')'); }
  return f;
}

// Only what the renderer may say about a page: a host and a short message.
function cleanReport(r) {
  if (!r || typeof r !== 'object' || !r.message) return null;
  return { host: short(r.host, 100), message: short(r.message, 300) };
}

// env: { app, electron, versions, execPath, platform, fs, path, timeoutMs? }
function createDrmHealth(env) {
  let init = { state: 'pending', message: '' };
  const timeoutMs = env.timeoutMs || 15000;
  const self = {
    // main.js initWidevine reports how the start-up install ended.
    noteInit(ok, message) { init = ok ? { state: 'ready', message: '' } : { state: 'failed', message: short(message, 200) || 'unknown error' }; },
    check(reported) { return diagnose(gatherFacts(env, init, cleanReport(reported))); },

    // "Check now": ask Electron again whether the component is ready. whenReady() answers from what is installed
    // (it is memoised per run, so it may repeat an earlier failure); the late install after a timeout shows in status().
    async recheck(reported) {
      const components = env.electron && env.electron.components;
      if (!components || typeof components.whenReady !== 'function') return self.check(reported);
      let timer;
      try {
        await Promise.race([
          components.whenReady(),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out after ' + Math.round(timeoutMs / 1000) + ' s')), timeoutMs); }),
        ]);
        self.noteInit(true);
      } catch (err) { self.noteInit(false, err && err.message); }
      finally { clearTimeout(timer); }
      return self.check(reported);
    },

    // Component updates were off; turn them on (the setting persists in Electron's local state) and check again.
    async enableUpdates(reported) {
      const components = env.electron && env.electron.components;
      if (!components) throw new Error('This build has no component updater');
      components.updatesEnabled = true;
      if (components.updatesEnabled !== true) throw new Error('Electron did not accept switching component updates on');
      return self.recheck(reported);
    },
  };
  return self;
}

// Removes what one tab's site stored that can hold a stale player: its service workers, caches, IndexedDB and file
// storage. Not cookies (the login stays) and not local storage. Only this site's own origin, in the tab's own session.
// wc: the tab's webContents. Throws (never answers ok) when nothing could be cleared.
async function clearSiteForPlayback(wc) {
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) throw new Error('That page is gone');
  let u;
  try { u = new URL(wc.getURL()); } catch { throw new Error('The page\'s address could not be read, so nothing was cleared'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only a website\'s stored data can be cleared');
  await wc.session.clearStorageData({ origin: u.origin, storages: ['serviceworkers', 'cachestorage', 'indexdb', 'filesystem'] });
  return { ok: true, origin: u.origin };
}

module.exports = { diagnose, gatherFacts, createDrmHealth, clearSiteForPlayback, cleanReport, fill, REPAIRS, BUILDER_STEPS, TEMPLATES: T };
