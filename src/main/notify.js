// === Desktop notifications, from the main process ===========================
//
// Every OS notification Vex sends goes through here, and nothing in the
// renderer calls `new Notification()` any more. That is not a style choice.
//
// Vex's interface is a file:// page, and Chromium refuses the Notification API
// to a file:// origin outright: `Notification.permission` reads "denied",
// requestPermission() resolves "denied", and a constructed Notification fires
// its error event — regardless of what Electron's permission handler says.
// Measured on Windows 11 with Electron 42. Every renderer-side notification in
// Vex was guarded by `permission === 'granted'`, which was never true, so none
// of them had ever shown. The prompt that did appear read "null wants to send
// notifications" — the interface asking itself, with an opaque origin.
//
// Electron's own Notification class, from the main process, uses the Windows
// toast API directly under the AppUserModelID set at startup. That path works,
// reports 'show' when Windows accepted the toast and 'failed' with the OS's
// reason when it did not — so a caller can say "that did not show" instead of
// assuming.
//
// Everything is injected so the module is testable without Electron.
// `profile` (src/main/profiles.js) is set for every profile but the default:
// a toast's buttons start Vex through the vex:// protocol with no profile of
// their own, so the URL carries it, and the launch picks that profile.
function createNotifier({ Notification, nativeImage, iconPath, onClick, log, showTimeoutMs = 5000, profile = null }) {
  if (!Notification) throw new Error('createNotifier needs Electron\'s Notification class');
  const note = typeof log === 'function' ? log : () => {};

  let icon = null;
  if (iconPath && nativeImage) {
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (img && !img.isEmpty()) icon = img;
      else note(`[Notify] icon at ${iconPath} is empty; toasts show without one`);
    } catch (err) {
      note(`[Notify] could not load icon ${iconPath}: ${err.message}`);
    }
  }

  function isSupported() {
    try { return Notification.isSupported(); } catch { return false; }
  }

  // Windows toasts can carry buttons. Electron does not report which button
  // was pressed, so each one launches a vex:// URL instead: Windows starts (or
  // signals) Vex with it, and main.js reads the action from argv. That works
  // even after the toast has sat in Action Center for an hour.
  const xmlEsc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inProfile = profile && /^p-[a-z0-9]{8}$/.test(String(profile)) ? '?profile=' + profile : '';
  function toastXml({ title, body, tag, iconPath: img, kind }) {
    const image = img ? `<image placement="appLogoOverride" src="${xmlEsc(img)}"/>` : '';
    // A news toast (js/ai-news.js) is not an alarm: no reminder scenario, which
    // would keep it on screen until dismissed, and no Snooze. Its buttons are
    // Open and "Mute this source" (vex://news-open|news-mute, main.js).
    if (kind === 'news') {
      return `<toast activationType="protocol" launch="vex://news-open/${xmlEsc(tag)}${inProfile}">
  <visual><binding template="ToastGeneric">${image}<text>${xmlEsc(title)}</text><text>${xmlEsc(body)}</text></binding></visual>
  <actions>
    <action content="Open" activationType="protocol" arguments="vex://news-open/${xmlEsc(tag)}${inProfile}"/>
    <action content="Mute this source" activationType="protocol" arguments="vex://news-mute/${xmlEsc(tag)}${inProfile}"/>
  </actions>
</toast>`;
    }
    return `<toast scenario="reminder" activationType="protocol" launch="vex://open/${xmlEsc(tag)}${inProfile}">
  <visual><binding template="ToastGeneric">${image}<text>${xmlEsc(title)}</text><text>${xmlEsc(body)}</text></binding></visual>
  <actions>
    <action content="Snooze 9 min" activationType="protocol" arguments="vex://snooze/${xmlEsc(tag)}${inProfile}"/>
    <action content="Open" activationType="protocol" arguments="vex://open/${xmlEsc(tag)}${inProfile}"/>
  </actions>
</toast>`;
  }

  // Resolves when the OS has actually shown the toast. Rejects with the OS's
  // reason when it refused, and after a timeout when it said nothing at all —
  // both are failures the caller must be able to report.
  // onClick, where given, is this toast's own click (an extension's
  // chrome.notifications.onClicked) in place of the one for every toast.
  function show({ title, body, silent = false, tag, actions = false, kind, onClick: ownClick } = {}) {
    const heading = String(title || '').trim();
    if (!heading) return Promise.reject(new Error('A notification needs a title'));
    if (!isSupported()) return Promise.reject(new Error('This system does not support desktop notifications'));

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
      const timer = setTimeout(
        () => settle(reject, new Error(`Windows did not confirm the notification within ${showTimeoutMs / 1000}s`)),
        showTimeoutMs,
      );

      let n;
      try {
        const opts = { title: heading, body: String(body || ''), silent: !!silent };
        if (icon) opts.icon = icon;
        // Buttons need the raw toast XML, which replaces everything above on
        // Windows; the tag is what the buttons carry back.
        if (actions && tag && process.platform === 'win32' && /^[A-Za-z0-9_-]{1,64}$/.test(String(tag))) {
          opts.toastXml = toastXml({ title: heading, body: String(body || ''), tag, iconPath, kind });
        }
        n = new Notification(opts);
      } catch (err) {
        return settle(reject, err);
      }

      n.on('show', () => { note(`[Notify] shown: ${heading}`); settle(resolve, { ok: true, tag: tag || null }); });
      n.on('failed', (_event, error) => {
        note(`[Notify] FAILED: ${heading} — ${error}`);
        settle(reject, new Error(`Windows refused the notification: ${error || 'no reason given'}`));
      });
      n.on('click', () => { try { if (typeof ownClick === 'function') ownClick(); else if (typeof onClick === 'function') onClick({ tag: tag || null }); } catch (err) { note(`[Notify] click handler threw: ${err.message}`); } });

      try { n.show(); } catch (err) { settle(reject, err); }
    });
  }

  return { show, isSupported, toastXml };
}

// === The Attention Budget for OS toasts ====================================
//
// The renderer's VexAttention (js/vex-attention.js) rules the toasts inside the
// window; this is the same rule set for the ones Windows shows, so that ~150
// features cannot each add a notification. Every toast says how urgent it is:
//
//   critical  reminders and alarms (kind 'reminder' is critical on its own)
//   asked     the person pressed something, or an extension / userscript they
//             installed raised it. This is also what a toast with no urgency is:
//             nothing that existed before changes class
//   useful    worth knowing, not worth an interruption (AI news, a free game, a
//             channel going live, a GitHub change)
//   ambient   nice to have
//
// critical and asked always pass. useful and ambient are refused (not queued) while
// the renderer says it is a bad moment (setState: Game mode, a meeting, Focus,
// the wind-down, the quiet switch), when the same toast was shown in the last
// repeatMs, or over the per-minute / per-hour / per-day caps. A refusal resolves
// { ok:false, suppressed:true, reason } -- not an error -- and is listed (denied()),
// so the renderer can move it into the Attention Inbox and Settings can show it.
const URGENCIES = ['critical', 'asked', 'useful', 'ambient'];

function createNotifyGate({ show, now = () => Date.now(), log, minuteCap = 3, hourCap = 3, dayCap = 12, repeatMs = 10 * 60 * 1000, maxDenied = 50 }) {
  if (typeof show !== 'function') throw new Error("createNotifyGate needs the notifier's show function");
  const note = typeof log === 'function' ? log : () => {};
  let state = { quiet: false, reason: '', until: 0 };
  let sent = [];                 // timestamps of useful/ambient toasts let through
  const seen = new Map();        // 'feature::key' -> timestamp
  const denied = [];             // newest first

  function classify(opts) {
    if (opts && opts.urgency != null) {
      if (!URGENCIES.includes(opts.urgency)) throw new Error('Urgency must be one of ' + URGENCIES.join(', '));
      return opts.urgency;
    }
    return opts && opts.kind === 'reminder' ? 'critical' : 'asked';
  }

  function setState(next) {
    if (!next || typeof next !== 'object' || typeof next.quiet !== 'boolean') throw new Error('The attention state needs a quiet flag');
    state = { quiet: next.quiet, reason: String(next.reason || '').slice(0, 40), until: Number.isFinite(next.until) ? next.until : 0 };
    return state;
  }

  function deny(opts, urgency, reason, record = true) {
    if (record) {
      denied.unshift({ feature: String(opts.feature || opts.kind || 'app').slice(0, 64), title: String(opts.title || '').slice(0, 120), reason, urgency, t: now() });
      while (denied.length > maxDenied) denied.pop();
    }
    note('[Notify] held back (' + reason + '): ' + String(opts.title || '').slice(0, 60));
    return { ok: false, suppressed: true, reason };
  }

  async function gated(opts = {}) {
    const urgency = classify(opts);
    if (urgency === 'critical' || urgency === 'asked') return show(opts);
    const t = now();
    const feature = String(opts.feature || opts.kind || 'app');
    const key = feature + '::' + String(opts.tag || opts.title || '');
    const last = seen.get(key);
    if (last !== undefined && t - last < repeatMs) return deny(opts, urgency, 'repeat', false);
    if (state.quiet) return deny(opts, urgency, 'quiet: ' + state.reason);
    sent = sent.filter(x => t - x < 24 * 3600 * 1000);
    if (sent.filter(x => t - x < 60 * 1000).length >= minuteCap) return deny(opts, urgency, 'too many in a minute');
    if (sent.filter(x => t - x < 3600 * 1000).length >= hourCap) return deny(opts, urgency, 'hourly limit');
    if (sent.length >= dayCap) return deny(opts, urgency, 'daily limit');
    const result = await show(opts);          // a refused toast is not counted
    sent.push(t);
    seen.set(key, t);
    if (seen.size > 200) for (const [k, at] of seen) if (t - at >= repeatMs) seen.delete(k);
    return result;
  }

  return { gated, setState, getState: () => ({ ...state }), classify, denied: () => denied.map(d => ({ ...d })), clearDenied: () => { denied.length = 0; } };
}

// A Start Menu shortcut for the development binary.
//
// Windows heads a toast with the name of the Start Menu shortcut whose target
// is the process, carrying the AppUserModelID. The installer writes one for
// Vex.exe, so packaged toasts read "Vex". A development run is electron.exe,
// which no shortcut targets — and Electron then writes one itself, named after
// the exe: "Electron". That is what a dev Vex woken by Task Scheduler showed.
//
// Writing our own shortcut first, with Vex's id, name and icon, means the one
// Windows finds is ours. Development only; the packaged app never gets here.
// Uses Electron's shell.writeShortcutLink, the documented way to do this.
function ensureDevShortcut({ shell, fs, packaged, platform = process.platform, startMenuDir, execPath, appPath, iconPath, appUserModelId, name = 'Vex (dev)', log }) {
  const note = typeof log === 'function' ? log : () => {};
  if (platform !== 'win32') return { ok: false, skipped: 'not windows' };
  if (packaged) return { ok: false, skipped: 'packaged builds are registered by the installer' };
  if (!shell || typeof shell.writeShortcutLink !== 'function') throw new Error('shell.writeShortcutLink is not available');
  if (!startMenuDir) throw new Error('No Start Menu directory to write the shortcut into');
  // Electron writes "Electron.lnk" for its own exe on the first toast, and a
  // stale one present at toast time wins the header. If one is there and it
  // points at this binary, it is Electron's artifact for this very app — take
  // it away before Windows can pick it. Anything else named Electron is left.
  let removedStray = false;
  const stray = `${startMenuDir}\\Electron.lnk`;
  try {
    if (fs.existsSync(stray) && typeof shell.readShortcutLink === 'function') {
      const link = shell.readShortcutLink(stray);
      if (link && String(link.target || '').toLowerCase() === String(execPath).toLowerCase()) {
        fs.unlinkSync(stray);
        removedStray = true;
        note(`[Notify] removed Electron's own Start Menu shortcut for this binary: ${stray}`);
      }
    }
  } catch (err) {
    note(`[Notify] could not inspect ${stray}: ${err.message}`);
  }

  const file = `${startMenuDir}\\${name}.lnk`;
  const exists = (() => { try { return fs.existsSync(file); } catch { return false; } })();
  const ok = shell.writeShortcutLink(file, exists ? 'update' : 'create', {
    target: execPath,
    args: `"${String(appPath).replace(/"/g, '\\"')}"`,
    cwd: String(appPath),
    icon: iconPath, iconIndex: 0,
    appUserModelId,
    description: 'Vex, running from source',
  });
  if (!ok) throw new Error(`Could not write the Start Menu shortcut at ${file}`);
  note(`[Notify] dev Start Menu shortcut ${exists ? 'updated' : 'created'}: ${file}`);
  return { ok: true, file, created: !exists, removedStray };
}

module.exports = { createNotifier, ensureDevShortcut, createNotifyGate, URGENCIES };
