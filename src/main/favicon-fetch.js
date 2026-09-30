// === A tab's icon, fetched through the tab's own session ===================
//
// The tab strip, the vertical list, the stacks and every other picture of a
// tab are drawn in Vex's own window, and an <img> there loads through the
// window's session, which is direct. So a tab going through Tor or a proxy
// showed its site the real address every time it drew the site's icon: the
// page itself went through Tor, its /favicon.ico did not (found 2026-09-30).
//
// For a tab in a session of its own, the renderer asks here instead. The icon
// is fetched through that tab's session — its proxy, its Tor, its refusal when
// Tor is down — and handed back as a data: URL, which the window can draw
// without asking anyone for anything.
//
//   - only the guest page named by its webContents id (ipc-policy.js checks it
//     belongs to the asking window), never a session looked up by name: a
//     partition that is not open yet would be a fresh, unrouted one;
//   - web addresses only, pictures only, at most MAX_BYTES, within a deadline.

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 15000;

// What a picture's first bytes say it is, for a server that labels its icon
// application/octet-stream or text/plain (many do for /favicon.ico).
function sniffImage(buf) {
  const b = buf;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0) return 'image/x-icon';
  if (b.length >= 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(b.toString('utf8', 0, Math.min(b.length, 1024)))) return 'image/svg+xml';
  return '';
}

function createFaviconFetch({ webContents, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES }) {
  // { ok: true, dataUrl } or { ok: false, error, answered } — answered says
  // the site itself replied (no icon there), as against the request never
  // getting through (Tor down, proxy refusing), which is worth asking again.
  async function fetchIcon(guestId, url) {
    let u;
    try { u = new URL(String(url)); } catch { return { ok: false, answered: false, error: 'Not a web address' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, answered: false, error: 'Only a web address can be fetched' };
    const guest = webContents.fromId(guestId);
    if (!guest || guest.isDestroyed()) return { ok: false, answered: false, error: 'That tab is gone' };
    if (typeof guest.getType === 'function' && guest.getType() !== 'webview') return { ok: false, answered: false, error: 'That is not a tab' };
    const ses = guest.session;
    if (!ses || typeof ses.fetch !== 'function') return { ok: false, answered: false, error: 'That tab has no session to fetch through' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await ses.fetch(u.href, { signal: controller.signal, headers: { Accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5' } });
      } catch (err) {
        return { ok: false, answered: false, error: controller.signal.aborted ? 'timeout' : ((err && err.message) || 'the request failed') };
      }
      if (!res.ok) return { ok: false, answered: true, error: 'the site answered ' + res.status };
      const declared = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const length = Number(res.headers.get('content-length'));
      if (Number.isFinite(length) && length > maxBytes) { controller.abort(); return { ok: false, answered: true, error: 'the icon is too large' }; }
      const chunks = [];
      let size = 0;
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) { controller.abort(); return { ok: false, answered: true, error: 'the icon is too large' }; }
          chunks.push(Buffer.from(value));
        }
      } else {
        const whole = Buffer.from(await res.arrayBuffer());
        if (whole.length > maxBytes) return { ok: false, answered: true, error: 'the icon is too large' };
        chunks.push(whole);
      }
      const body = Buffer.concat(chunks);
      if (!body.length) return { ok: false, answered: true, error: 'the icon is empty' };
      const sniffed = sniffImage(body);
      const type = /^image\/[\w.+-]+$/.test(declared) ? declared : sniffed;
      if (!type) return { ok: false, answered: true, error: 'the site did not send a picture (' + (declared || 'no type') + ')' };
      return { ok: true, dataUrl: 'data:' + type + ';base64,' + body.toString('base64') };
    } catch (err) {
      return { ok: false, answered: false, error: controller.signal.aborted ? 'timeout' : ((err && err.message) || 'the request failed') };
    } finally {
      clearTimeout(timer);
    }
  }
  return { fetchIcon };
}

module.exports = { createFaviconFetch, sniffImage, MAX_BYTES };
