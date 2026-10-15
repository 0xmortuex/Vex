// === Vex co-op focus timer ===
//
// Two or more people run one shared timer by entering the same room code.
//
// WHAT LEAVES THIS COMPUTER, and it is all of it:
//   - the 6-character room code,
//   - the display name you typed for the room,
//   - start / pause / resume / end requests (the relay turns them into
//     timestamps) and the length in minutes.
// Nothing about browsing: no page, no tab, no history, no account.
//
// There is no built-in relay address. Until the person pastes the address of a
// relay they (or a friend) deployed from workers/coop-timer/, the feature says
// it is unavailable and sends nothing. The first create/join asks first
// (vexConfirm) and says exactly the list above.
//
// Optional: link to Focus mode, which then starts and stops with the shared timer.
//
// Storage (localStorage, this device only): vex.coop.relayUrl, vex.coop.name,
// vex.coop.consent, vex.coop.focus, vex.coop.session (room code + this
// device's room secret, so a reload keeps you in the room).
(function (root) {
  'use strict';

  const K = {
    url: 'vex.coop.relayUrl', name: 'vex.coop.name', consent: 'vex.coop.consent',
    focus: 'vex.coop.focus', session: 'vex.coop.session',
  };
  const POLL_MS = 5000;
  const TIMEOUT_MS = 10000;
  const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

  // --- storage ------------------------------------------------------------------
  const mem = {};
  function rawGet(k) {
    try { const v = root.localStorage && root.localStorage.getItem(k); if (v != null) return v; } catch { /* blocked */ }
    return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
  }
  function rawSet(k, v) {
    try { if (root.localStorage) { if (v == null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, v); } } catch { /* keep in memory */ }
    if (v == null) delete mem[k]; else mem[k] = v;
  }

  // --- configuration ----------------------------------------------------------------
  // Only https, or http on this computer (a relay under test). No credentials,
  // query or fragment: the address is an origin plus an optional path.
  function normalizeRelayUrl(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    let u;
    try { u = new URL(s); } catch { throw new Error('That is not a web address'); }
    const loop = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loop)) throw new Error('The relay address must start with https://');
    if (u.username || u.password) throw new Error('The relay address must not contain a user name or password');
    if (u.search || u.hash) throw new Error('The relay address must not have a query or a # part');
    return (u.origin + u.pathname).replace(/\/+$/, '');
  }
  function relayUrl() { try { return normalizeRelayUrl(rawGet(K.url)); } catch { return ''; } }
  function setRelayUrl(v) {
    const n = normalizeRelayUrl(v);
    rawSet(K.url, n || null);
    if (!n && session) { session = null; rawSet(K.session, null); stopPolling(); state = null; emit(); }
    return n;
  }
  const isAvailable = () => !!relayUrl();

  function cleanName(v) {
    return Array.from(String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 24).join('').trim();
  }
  const displayName = () => cleanName(rawGet(K.name));
  function setDisplayName(v) { rawSet(K.name, cleanName(v) || null); }
  const focusLinked = () => rawGet(K.focus) === '1';
  function setFocusLinked(on) { rawSet(K.focus, on ? '1' : '0'); }

  // --- first-use notice -----------------------------------------------------------------
  const CONSENT_TEXT =
    'To share a timer, Vex will send this to your relay (' + '%RELAY%' + '):\n\n' +
    '  - the room code,\n  - the name you chose for the room,\n  - when you start, pause, resume or end the timer, and its length.\n\n' +
    'Nothing else is sent: no pages, tabs, history or account. People who enter the same code in the room can see your name and the timer. Vex has no relay of its own; this goes only to the address you set.';
  function consented() { return rawGet(K.consent) === '1'; }
  async function ensureConsent() {
    if (consented()) return true;
    const confirm = typeof root.vexConfirm === 'function' ? root.vexConfirm : null;
    if (!confirm) throw new Error('The confirmation dialog is not available');
    const ok = await confirm({
      title: 'Share a focus timer?',
      message: CONSENT_TEXT.replace('%RELAY%', relayUrl() || 'not set'),
      okLabel: 'Share timer',
    });
    if (ok) rawSet(K.consent, '1');
    return !!ok;
  }
  function resetConsent() { rawSet(K.consent, null); }

  // --- relay calls ------------------------------------------------------------------------
  let session = null;      // { code, secret, memberId }
  let state = null;        // the relay's last public state
  let offset = 0;          // relay clock minus this clock, ms
  let pollTimer = null;
  let startedFocus = false;
  let announcedDone = '';
  const listeners = new Set();

  try { const s = JSON.parse(rawGet(K.session) || 'null'); if (s && CODE_RE.test(s.code) && /^[0-9a-f]{32}$/.test(s.secret)) session = s; } catch { session = null; }

  async function call(method, path, body, secret) {
    const base = relayUrl();
    if (!base) throw new Error('The co-op timer is unavailable: no relay address is set (Settings, Co-op focus timer).');
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (secret) headers.authorization = 'Bearer ' + secret;
    let res;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
    try {
      res = await root.fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl ? ctl.signal : undefined, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch (err) {
      const e = new Error('Could not reach the relay. Check the address and your connection.');
      e.network = true; e.cause = err;
      throw e;
    } finally { if (t) clearTimeout(t); }
    let data = null;
    try { data = await res.json(); } catch { /* handled below */ }
    if (!res.ok || !data || data.ok === false) {
      const e = new Error((data && data.error) || ('The relay answered ' + res.status));
      e.status = res.status;
      throw e;
    }
    return data;
  }

  function adopt(data) {
    if (data && data.state) {
      state = data.state;
      offset = Number(state.now) - Date.now();
    }
    syncFocus();
    announce();
    emit();
  }

  function saveSession(s) { session = s; rawSet(K.session, s ? JSON.stringify(s) : null); }

  async function create(name) {
    const n = cleanName(name != null ? name : displayName());
    if (!n) throw new Error('Choose a display name first');
    if (!isAvailable()) throw new Error('The co-op timer is unavailable: no relay address is set.');
    if (session) throw new Error('You are already in a room. Leave it first.');
    if (!(await ensureConsent())) return null;
    setDisplayName(n);
    const d = await call('POST', '/v1/room', { name: n });
    saveSession({ code: d.code, secret: d.secret, memberId: d.memberId });
    startPolling();
    adopt(d);
    return d.code;
  }

  async function join(code, name) {
    const c = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!CODE_RE.test(c)) throw new Error('A room code is 6 letters and numbers');
    const n = cleanName(name != null ? name : displayName());
    if (!n) throw new Error('Choose a display name first');
    if (!isAvailable()) throw new Error('The co-op timer is unavailable: no relay address is set.');
    if (session) throw new Error('You are already in a room. Leave it first.');
    if (!(await ensureConsent())) return null;
    setDisplayName(n);
    const d = await call('POST', '/v1/room/' + c + '/join', { name: n });
    saveSession({ code: d.code, secret: d.secret, memberId: d.memberId });
    startPolling();
    adopt(d);
    return d.code;
  }

  function needRoom() { if (!session) throw new Error('You are not in a room'); return session; }

  async function act(type, body) {
    const s = needRoom();
    try {
      const d = await call('POST', '/v1/room/' + s.code + '/' + type, body === undefined ? {} : body, s.secret);
      adopt(d);
      return d;
    } catch (err) { dropIfGone(err); throw err; }
  }
  const start = (minutes) => act('start', minutes === undefined ? {} : { minutes });
  const pause = () => act('pause');
  const resume = () => act('resume');
  const end = () => act('end');
  async function leave() {
    const s = needRoom();
    try { await call('POST', '/v1/room/' + s.code + '/leave', {}, s.secret); } catch (err) {
      if (!(err.status === 404 || err.status === 401)) throw err;   // already gone is fine, anything else is reported
    }
    closeRoom();
  }
  async function refresh() {
    const s = needRoom();
    try { adopt(await call('GET', '/v1/room/' + s.code, undefined, s.secret)); } catch (err) { dropIfGone(err); throw err; }
  }

  function closeRoom() {
    stopPolling();
    saveSession(null);
    state = null;
    announcedDone = '';
    syncFocus();
    emit();
  }
  // A room that no longer exists (everyone left, or it expired) ends our session.
  function dropIfGone(err) {
    if (err && (err.status === 404 || err.status === 401)) { closeRoom(); err.roomClosed = true; }
  }

  function startPolling() {
    stopPolling();
    pollTimer = root.setInterval(() => {
      refresh().catch(err => { if (err && err.roomClosed) toast('The room has closed', 'info'); });
    }, POLL_MS);
  }
  function stopPolling() { if (pollTimer) { root.clearInterval(pollTimer); pollTimer = null; } }

  // --- view ----------------------------------------------------------------------------------
  function serverNow() { return Date.now() + offset; }
  function view() {
    if (!session || !state) return { inRoom: false, code: '', members: [], status: 'idle', remainingMs: 0, durationMs: 0 };
    const t = state.timer;
    let status = t.status;
    let remainingMs = t.remainingMs;
    if (status === 'running') {
      remainingMs = Math.max(0, t.endsAt - serverNow());
      if (remainingMs === 0) status = 'done';
    }
    return { inRoom: true, code: state.code, members: state.members.slice(), status, remainingMs, durationMs: t.durationMs };
  }
  function fmt(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function toast(msg, kind) { if (typeof root.showToast === 'function') root.showToast(msg, kind || 'info'); }
  function announce() {
    const v = view();
    if (v.status === 'done' && state && announcedDone !== String(state.timer.startedAt)) {
      announcedDone = String(state.timer.startedAt);
      toast('Focus timer finished', 'success');
    }
  }

  // --- optional Focus mode link --------------------------------------------------------------
  function focusApi() {
    try { return (typeof FocusMode !== 'undefined' && FocusMode) || root.FocusMode || null; } catch { return root.FocusMode || null; }
  }
  function syncFocus() {
    const fm = focusApi();
    if (!fm) return;
    const v = view();
    const wants = focusLinked() && v.inRoom && v.status === 'running';
    try {
      if (wants && !fm.active) {
        fm.start(Math.max(1, Math.ceil(v.remainingMs / 60000)));
        startedFocus = true;
      } else if (!wants && startedFocus) {
        startedFocus = false;
        if (fm.active) fm.stop();
      }
    } catch (err) { console.error('[CoopTimer] Focus mode could not be linked:', err && err.message); }
  }

  function emit() {
    const v = view();
    for (const fn of listeners) { try { fn(v); } catch (e) { console.error('[CoopTimer] listener failed:', e && e.message); } }
    if (root.document && typeof root.CustomEvent === 'function') root.document.dispatchEvent(new root.CustomEvent('vex:coop-timer', { detail: v }));
  }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // --- the panel ------------------------------------------------------------------------------
  function el(tag, props, ...kids) {
    const n = root.document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const c of kids) if (c) n.appendChild(c);
    return n;
  }
  function icon(name) {
    const s = el('span', { class: 'coop-ico', 'aria-hidden': 'true' });
    if (root.VexIcons && typeof root.VexIcons.svg === 'function') s.innerHTML = root.VexIcons.svg(name, { size: 15 });
    return s;
  }
  function button(label, ico, onclick, cls) {
    const b = el('button', { class: cls || 'btn-secondary', type: 'button' });
    b.appendChild(icon(ico));
    b.appendChild(root.document.createTextNode(' ' + label));
    b.addEventListener('click', onclick);
    return b;
  }

  function render(host) {
    if (!host) return;
    host.textContent = '';
    const msg = el('div', { class: 'setting-hint coop-msg', role: 'status', 'aria-live': 'polite' });
    const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? 'var(--vex-danger, #dc2626)' : ''; };
    const run = (fn) => async () => {
      try { await fn(); } catch (err) { say(err && err.message ? err.message : String(err), true); }
    };

    // The relay address is always editable here.
    const url = el('input', { class: 'set-input', type: 'url', placeholder: 'https://your-relay.example', 'aria-label': 'Relay address', value: rawGet(K.url) || '' });
    const saveUrl = button('Save address', 'save', run(async () => {
      const n = setRelayUrl(url.value);
      say(n ? 'Relay saved.' : 'Relay cleared. The co-op timer is unavailable.');
      render(host);
    }));
    const relayRow = el('div', { class: 'coop-row', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, url, saveUrl);
    url.style.flex = '1 1 260px';

    if (!isAvailable()) {
      host.appendChild(el('div', { class: 'setting-info', text: 'Unavailable. The co-op timer needs a relay address, and Vex does not provide one. Deploy workers/coop-timer from the Vex source (its README explains how) or paste the address a friend runs. Until then nothing is sent anywhere.' }));
      host.appendChild(relayRow);
      host.appendChild(msg);
      return;
    }

    const v = view();
    const link = el('input', { type: 'checkbox', id: 'coop-focus-link' });
    link.checked = focusLinked();
    link.addEventListener('change', () => { setFocusLinked(link.checked); syncFocus(); });
    const linkRow = el('label', { class: 'setting-toggle-row', for: 'coop-focus-link' }, link, el('span', { text: ' Start Focus mode while the shared timer runs' }));

    if (!v.inRoom) {
      const name = el('input', { class: 'set-input', type: 'text', maxlength: '24', placeholder: 'Your display name', 'aria-label': 'Display name', value: displayName() });
      const code = el('input', { class: 'set-input', type: 'text', maxlength: '6', placeholder: 'ROOM CODE', 'aria-label': 'Room code', style: 'text-transform:uppercase;letter-spacing:.15em;width:9em' });
      const row1 = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, name,
        button('Start a room', 'users', run(async () => { await create(name.value); }), 'btn-primary'));
      const row2 = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, code,
        button('Join', 'link', run(async () => { await join(code.value, name.value); })));
      host.appendChild(el('div', { class: 'setting-info', text: 'Only the room code, your display name and the timer start, pause and end times are shared with the relay. Nothing about what you browse.' }));
      host.appendChild(row1);
      host.appendChild(row2);
      host.appendChild(linkRow);
      host.appendChild(relayRow);
      host.appendChild(msg);
      return;
    }

    // In a room.
    const clock = el('div', { class: 'coop-clock', style: 'font-size:34px;font-variant-numeric:tabular-nums;font-weight:600;margin:8px 0', 'aria-live': 'off' });
    const status = el('div', { class: 'setting-hint' });
    const people = el('ul', { class: 'coop-members', style: 'margin:6px 0 0 18px;padding:0' });
    const codeLine = el('div', { class: 'setting-info' });
    codeLine.appendChild(root.document.createTextNode('Room code: '));
    codeLine.appendChild(el('strong', { text: v.code, style: 'letter-spacing:.15em;user-select:all' }));
    codeLine.appendChild(root.document.createTextNode('. Share it with the people you want in this room.'));
    const buttons = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' });
    host.appendChild(codeLine);
    host.appendChild(clock);
    host.appendChild(status);
    host.appendChild(people);
    host.appendChild(buttons);
    host.appendChild(linkRow);
    host.appendChild(msg);

    const paint = () => {
      if (!host.isConnected) return false;
      const c = view();
      if (!c.inRoom) { render(host); return false; }
      clock.textContent = c.status === 'idle' ? '--:--' : c.status === 'done' ? '00:00' : fmt(c.remainingMs);
      status.textContent = ({ idle: 'Ready. Anyone in the room can start the timer.', running: 'Running', paused: 'Paused', done: 'Finished' })[c.status];
      people.textContent = '';
      for (const m of c.members) people.appendChild(el('li', { text: m.name + (m.you ? ' (you)' : '') }));
      buttons.textContent = '';
      if (c.status === 'idle' || c.status === 'done') buttons.appendChild(button('Start 25 minutes', 'play', run(() => start(25)), 'btn-primary'));
      if (c.status === 'running') buttons.appendChild(button('Pause', 'pause', run(pause)));
      if (c.status === 'paused') buttons.appendChild(button('Resume', 'play', run(resume), 'btn-primary'));
      if (c.status === 'running' || c.status === 'paused') buttons.appendChild(button('End timer', 'stop', run(end)));
      buttons.appendChild(button('Leave room', 'x', run(leave)));
      return true;
    };
    paint();
    const off = onChange(() => { if (!paint()) off(); });
    const tick = root.setInterval(() => {
      if (!host.isConnected) { root.clearInterval(tick); return; }
      const c = view();
      if (c.status === 'running') clock.textContent = fmt(c.remainingMs);
    }, 1000);
  }

  // The Settings group belongs to this module: index.html only has the script tag.
  function mountSettings() {
    const doc = root.document;
    if (!doc) return null;
    if (doc.getElementById('settings-coop-timer')) return doc.getElementById('coop-timer-settings');
    const area = doc.querySelector('.settings-content');
    if (!area) return null;
    const group = el('div', { class: 'setting-group', id: 'settings-coop-timer' },
      el('label', { class: 'setting-label', text: 'Co-op focus timer' }),
      el('div', { class: 'setting-hint', text: 'Run one 25-minute timer with friends by entering the same room code. It needs a small relay that you or a friend deploy; only the room code, your display name and the start, pause and end times are sent. No accounts, no activity feed.' }),
      el('div', { id: 'coop-timer-settings' }));
    const before = doc.getElementById('settings-profiles');
    if (before && before.parentNode === area) area.insertBefore(group, before); else area.appendChild(group);
    const host = doc.getElementById('coop-timer-settings');
    render(host);
    return host;
  }

  function init() {
    mountSettings();
    if (session && isAvailable()) {
      startPolling();
      refresh().catch(err => { if (err && err.roomClosed) toast('Your focus room has closed', 'info'); else console.warn('[CoopTimer] could not refresh the room:', err && err.message); });
    }
  }

  const api = {
    normalizeRelayUrl, relayUrl, setRelayUrl, isAvailable, displayName, setDisplayName, focusLinked, setFocusLinked,
    consented, ensureConsent, resetConsent, create, join, start, pause, resume, end, leave, refresh,
    view, fmt, onChange, render, mountSettings, init, CONSENT_TEXT,
    _reset() { stopPolling(); session = null; state = null; offset = 0; startedFocus = false; announcedDone = ''; listeners.clear(); },
  };
  root.CoopTimer = api;

  if (root.document && typeof module === 'undefined') {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init);
    else init();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { CoopTimer: api };
})(typeof window !== 'undefined' ? window : globalThis);
