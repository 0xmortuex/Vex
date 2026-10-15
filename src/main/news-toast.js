// === AI news toasts: what main accepts from the renderer ====================
//
// js/ai-news.js asks main for a Windows toast through `news:notify`. The IPC
// schema (ipc-schemas.js) already checks the shape; this checks it again where
// the toast is made, because a toast is something a person reads and clicks:
//
//   * the tag is what the toast's buttons carry back (vex://news-open/<tag>),
//     so it is a short word of letters, digits, "_" and "-", and starts "news-";
//   * the address, when there is one, is https only (no http, file:, vex:,
//     javascript:), without a login in it, and not long;
//   * the text is capped. Windows shows little of it anyway, and a feed is
//     written by someone else.
//
// A click or a button comes back as `news-open` / `news-mute` with that tag;
// the interface looks the item up by it. The address is kept here too, in a
// small bounded table, so a click still opens it when the interface no longer
// holds the item.
const TAG = /^news-[A-Za-z0-9_-]{1,56}$/;
const LIMITS = { title: 120, body: 400, url: 2048, remembered: 100 };

function validateNewsToast(payload) {
  const p = payload && typeof payload === 'object' ? payload : null;
  if (!p) throw new Error('A news notification needs a payload');
  const title = typeof p.title === 'string' ? p.title.trim() : '';
  if (!title) throw new Error('A news notification needs a title');
  if (title.length > LIMITS.title) throw new Error(`The news title is longer than ${LIMITS.title} characters`);
  const body = p.body == null ? '' : p.body;
  if (typeof body !== 'string') throw new Error('The news text must be text');
  if (body.length > LIMITS.body) throw new Error(`The news text is longer than ${LIMITS.body} characters`);
  if (typeof p.tag !== 'string' || !TAG.test(p.tag)) throw new Error('The news notification tag is not valid');
  let url = null;
  if (p.url != null && p.url !== '') {
    if (typeof p.url !== 'string' || p.url.length > LIMITS.url) throw new Error('The news address is missing or too long');
    let u;
    try { u = new URL(p.url); } catch { throw new Error('The news address is not a valid address'); }
    if (u.protocol !== 'https:') throw new Error('Only https news addresses are allowed');
    if (u.username || u.password) throw new Error('A news address may not carry a login');
    url = u.toString();
  }
  return { title, body, tag: p.tag, url, silent: p.silent === true };
}

// tag -> address, newest kept.
function createUrlTable(max = LIMITS.remembered) {
  const map = new Map();
  return {
    set(tag, url) {
      if (!url) return;
      map.delete(tag);
      map.set(tag, url);
      while (map.size > max) map.delete(map.keys().next().value);
    },
    get(tag) { return map.get(tag) || null; },
    get size() { return map.size; },
  };
}

module.exports = { validateNewsToast, createUrlTable, TAG, LIMITS };
