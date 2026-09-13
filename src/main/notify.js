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
function createNotifier({ Notification, nativeImage, iconPath, onClick, log, showTimeoutMs = 5000 }) {
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

  // Resolves when the OS has actually shown the toast. Rejects with the OS's
  // reason when it refused, and after a timeout when it said nothing at all —
  // both are failures the caller must be able to report.
  function show({ title, body, silent = false, tag } = {}) {
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
        n = new Notification(opts);
      } catch (err) {
        return settle(reject, err);
      }

      n.on('show', () => { note(`[Notify] shown: ${heading}`); settle(resolve, { ok: true, tag: tag || null }); });
      n.on('failed', (_event, error) => {
        note(`[Notify] FAILED: ${heading} — ${error}`);
        settle(reject, new Error(`Windows refused the notification: ${error || 'no reason given'}`));
      });
      n.on('click', () => { try { if (typeof onClick === 'function') onClick({ tag: tag || null }); } catch (err) { note(`[Notify] click handler threw: ${err.message}`); } });

      try { n.show(); } catch (err) { settle(reject, err); }
    });
  }

  return { show, isSupported };
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

module.exports = { createNotifier, ensureDevShortcut };
