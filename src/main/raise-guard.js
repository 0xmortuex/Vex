// === No-raise in fullscreen (T1-038) =========================================
//
// While a full-screen game has the screen, Vex does not take it back. A window
// that raises, takes focus or flashes the taskbar over a full-screen game can
// minimise it, drop it out of exclusive full screen, or (on some drivers) crash
// it. So every call in the main process that brings a Vex window forward on its
// OWN (a toast clicked, a reminder waking Vex, a second Vex started, a link
// handed over by another program, an extension asking for focus, the first
// window at start-up) goes through this guard:
//
//   a full-screen game is in front   ->  nothing is raised; a small dot is put
//                                        on Vex's taskbar button instead, and
//                                        it clears when Vex is next looked at;
//   otherwise                         ->  the window is raised as before.
//
// What it does NOT guard: things the person just did inside Vex itself (they
// are not looking at the game then), and the quick-capture box, which exists
// to be opened over a game by a hotkey the person pressed.
//
// "A game is in front" is the signal main already has from game-watch.js
// (SHQueryUserNotificationState: Windows' own answer to "is something full
// screen"). Nothing here opens, reads or hooks any other program.
//
// Everything is injected, so it is testable without Electron.

const zlib = require('zlib');

// A tiny solid dot as a PNG, built here so no image file has to ship. 16x16 RGBA.
function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function dotPng(size = 16, rgb = [0xe5, 0x39, 0x35]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;                                   // filter: none
    for (let x = 0; x < size; x++) {
      const inside = Math.hypot(x - r, y - r) <= r;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// fullscreenGame()  -> boolean   a full-screen game is in front right now
// makeBadge()       -> an image for win.setOverlayIcon (Electron nativeImage)
// log(msg)          -> optional
function createRaiseGuard({ fullscreenGame, makeBadge, log, now = () => Date.now() }) {
  if (typeof fullscreenGame !== 'function') throw new TypeError('createRaiseGuard: fullscreenGame is required');
  const note = typeof log === 'function' ? log : () => {};
  const held = [];                 // newest last: { at, why }
  let badged = null;               // the window that carries the dot
  const MAX_HELD = 20;

  const alive = (win) => !!win && !(typeof win.isDestroyed === 'function' && win.isDestroyed());

  function putBadge(win, why) {
    held.push({ at: now(), why: String(why || 'something') });
    while (held.length > MAX_HELD) held.shift();
    if (!alive(win) || typeof win.setOverlayIcon !== 'function' || typeof makeBadge !== 'function') return false;
    try { win.setOverlayIcon(makeBadge(), 'Vex has something for you'); badged = win; return true; }
    catch (err) { note('[RaiseGuard] could not put the dot on the taskbar button: ' + err.message); return false; }
  }

  // Clears the dot (the window was looked at, or the game is over).
  function release() {
    const win = badged;
    badged = null;
    held.length = 0;
    if (alive(win) && typeof win.setOverlayIcon === 'function') {
      try { win.setOverlayIcon(null, ''); } catch (err) { note('[RaiseGuard] could not clear the dot: ' + err.message); }
    }
    return true;
  }

  // Bring a window forward. { user: true } is something the person just did in
  // Vex; it is always raised. -> { raised, held }
  function raise(win, why, { user = false } = {}) {
    if (!alive(win)) return { raised: false, held: false };
    if (!user && fullscreenGame()) {
      note('[RaiseGuard] not raised over a full-screen game: ' + why);
      putBadge(win, why);
      return { raised: false, held: true };
    }
    if (typeof win.isMinimized === 'function' && win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return { raised: true, held: false };
  }

  // The first show of a window at start-up: in the background when a game is in front.
  function reveal(win, why) {
    if (!alive(win)) return { raised: false, held: false };
    if (fullscreenGame()) {
      note('[RaiseGuard] shown behind a full-screen game: ' + why);
      win.showInactive();
      putBadge(win, why);
      return { raised: false, held: true };
    }
    win.show();
    win.focus();
    return { raised: true, held: false };
  }

  // Taskbar flash: a game in front gets the dot instead.
  function flash(win, why) {
    if (!alive(win)) return { flashed: false, held: false };
    if (fullscreenGame()) { putBadge(win, why || 'attention requested'); return { flashed: false, held: true }; }
    win.flashFrame(true);
    return { flashed: true, held: false };
  }

  return { raise, reveal, flash, release, held: () => held.map(h => ({ ...h })), badged: () => !!badged };
}

module.exports = { createRaiseGuard, dotPng };
