// === Sharing one ByeDPI process between Roblox and Discord =================
//
// Both bypasses run through a SINGLE ByeDPI instance. Every start() replaces it
// on a fresh port and every stop() ends it — but each caller only ever
// re-pointed its own session. So running Discord's auto-configure sweep while
// the Roblox bypass was on left persist:roblox aimed at a port that no longer
// existed, and Roblox stopped connecting with nothing said about why.
//
// This is the bookkeeping that keeps the other consumer pointed at whatever is
// actually listening. It is a separate module because the network behaviour
// (whether a desync actually beats a given ISP's DPI) can only be judged on a
// connection that is really being blocked — but *this* part, the "who is using
// the shared process and where did it go" logic, is ordinary state handling and
// is where the bug was.
function createByedpiShare({ byedpi, setRobloxProxy, notify }) {
  if (!byedpi) throw new Error('createByedpiShare needs the byedpi module');
  const setProxy = typeof setRobloxProxy === 'function' ? setRobloxProxy : () => {};
  const tell = typeof notify === 'function' ? notify : () => {};

  // Is Roblox currently riding the shared process?
  let robloxAttached = false;
  // Is Discord's bypass (Strong, or a sweep) using it?
  let discordUsing = false;
  // Is the Unblock centre (src/main/unblock-main.js) using it for some sites?
  let unblockUsing = false;
  let unblockRepoint = () => {};

  const socks = (port) => 'socks5://127.0.0.1:' + port;

  return {
    // Roblox has taken (or released) the shared process.
    attachRoblox(on) { robloxAttached = !!on; },
    isRobloxAttached() { return robloxAttached; },

    // The Unblock centre has taken (or released) the shared process. repoint(port) is called when
    // the process moves to another port, and with 0 when it stops, so its sites follow it.
    attachUnblock(on) { unblockUsing = !!on; },
    isUnblockAttached() { return unblockUsing; },
    setUnblockRepoint(fn) { if (typeof fn !== 'function') throw new Error('setUnblockRepoint needs a function'); unblockRepoint = fn; },

    // Reuse whatever is already listening, if anything.
    reuseExisting() {
      if (!byedpi.isRunning || !byedpi.isRunning()) return null;
      const port = byedpi.getPort();
      robloxAttached = true;
      setProxy(socks(port));
      return port;
    },

    // Start (or restart) the shared process. Whoever else is using it is
    // re-pointed at the new port rather than left on the old one.
    async start(userData, buffer, preset, custom) {
      const port = await byedpi.start(userData, buffer, preset, custom);
      if (robloxAttached) setProxy(socks(port));
      if (unblockUsing) unblockRepoint(port);
      return port;
    },

    // Stop it, and take every consumer off the port that no longer exists.
    // Leaving a dead proxy configured fails every request in silence, which is
    // the worst possible outcome for something the user turned on deliberately.
    stop() {
      byedpi.stop();
      if (unblockUsing) { unblockUsing = false; unblockRepoint(0); }
      if (!robloxAttached) return;
      robloxAttached = false;
      setProxy(null);
      tell('Roblox bypass is off — the shared bypass it was using has stopped');
    },

    // Discord no longer needs the process (its bypass turned off or to light,
    // or a sweep that found nothing). Roblox may still be riding it: then it
    // keeps running and Roblox keeps its bypass. Turning Discord's bypass off
    // used to stop it for both, and Roblox's menu still said "On".
    // Returns true when the process was stopped.
    releaseDiscord() {
      discordUsing = false;
      if ((robloxAttached || unblockUsing) && byedpi.isRunning && byedpi.isRunning()) return false;
      this.stop();
      return true;
    },

    // Discord's bypass starting (or restarting) the process for itself.
    startForDiscord(userData, buffer, preset, custom) {
      discordUsing = true;
      return this.start(userData, buffer, preset, custom);
    },

    // Roblox's bypass turned off (or its sweep found nothing). The process
    // stops too unless Discord is using it: after Discord went to Light or
    // Off with Roblox riding it, turning Roblox off used to leave ciadpi.exe
    // running with nobody on it until Vex quit. Returns true when stopped.
    releaseRoblox() {
      robloxAttached = false;
      setProxy(null);
      if ((discordUsing || unblockUsing) && byedpi.isRunning && byedpi.isRunning()) return false;
      byedpi.stop();
      return true;
    },

    // The last Unblock centre site that needed the process is gone (or none could be opened). It stops
    // unless Discord or Roblox are riding it. Returns true when stopped.
    releaseUnblock() {
      unblockUsing = false;
      if ((discordUsing || robloxAttached) && byedpi.isRunning && byedpi.isRunning()) return false;
      byedpi.stop();
      return true;
    },
  };
}

module.exports = { createByedpiShare };
