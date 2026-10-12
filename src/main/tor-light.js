// Tor pages always report light (prefers-color-scheme: light), as Tor Browser
// does, so every Tor user looks alike to a site. Website appearance
// (website-appearance.js) sets nativeTheme.themeSource, which is one switch
// for the whole app: with a dark Vex, Tor tabs told sites "dark" too.
//
// Chromium has no per-page switch for it except the DevTools protocol, so a
// page in a Tor session (a Tor tab, a Tor container, a site routed through
// Tor, or everything when all of Vex goes through Tor: the same session mark,
// __vexTor, the fingerprint noise reads) gets the media feature emulated
// through its own debugger, and each cross-site frame in it as it attaches.
// A session set back off Tor lets go, and its pages follow Vex again.
const LIGHT = [{ name: 'prefers-color-scheme', value: 'light' }];

const held = new WeakSet();

async function hold(contents) {
  const dbg = contents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  held.add(contents);
  if (!contents.__vexTorLightWired) {
    contents.__vexTorLightWired = true;
    // Opened DevTools' "detach", a crashed page: the hold is gone, and the
    // next sync (the next navigation) takes it again.
    dbg.on('detach', () => { held.delete(contents); });
    dbg.on('message', (_event, method, params) => {
      if (method !== 'Target.attachedToTarget' || !held.has(contents)) return;
      const sessionId = params && params.sessionId;
      if (!sessionId) return;
      dbg.sendCommand('Emulation.setEmulatedMedia', { features: LIGHT }, sessionId)
        .then(() => dbg.sendCommand('Runtime.runIfWaitingForDebugger', {}, sessionId))
        .catch(err => console.error('[Tor light] a frame in a Tor page could not be held light:', err));
    });
  }
  try {
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: LIGHT });
    await dbg.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  } catch (err) {
    held.delete(contents); // the next sync tries again
    throw err;
  }
}

/**
 * Hold a page light while its session goes through Tor; let go when it no
 * longer does. Rejects when the emulation fails, so the caller logs it.
 * @param {any} contents
 */
async function syncTorLight(contents) {
  if (!contents || contents.isDestroyed()) return;
  const tor = !!(contents.session && contents.session.__vexTor);
  if (tor && !held.has(contents)) return hold(contents);
  if (!tor && held.has(contents)) {
    held.delete(contents);
    if (contents.debugger.isAttached()) contents.debugger.detach();
  }
}

module.exports = { syncTorLight, LIGHT };
