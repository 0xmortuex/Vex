// === Vex friend profile card ===
//
// Turns your profile (name, level, a title, a handful of medals) into a still
// picture you can copy or save and hand to a friend yourself. It is entirely
// local: nothing is uploaded, there is no link, no account, no code to look
// up. The card holds only what you tick.
//
// Data in: { name, level, title, medals: [{ id, title, svg }] }. When
// VexMedals is loaded, "Use my profile" fills that from it; otherwise the
// caller passes the object to FriendCard.setSource().
//
// Out: an SVG string (`build`), a PNG data URL (`toPngDataUrl`), the clipboard
// (`copy`, through the existing image:copy IPC) and a saved .svg (`saveSvg`,
// through file:save-text). Storage: localStorage vex.friendCard (what is
// ticked and the title text; this device only).
(function (root) {
  'use strict';

  const KEY = 'vex.friendCard';
  const W = 640;
  const COLS = 5;
  const CELL = 112;
  const MAX_MEDALS = 15;
  const NAME_MAX = 32;
  const TITLE_MAX = 40;

  const mem = {};
  function rawGet(k) {
    try { const v = root.localStorage && root.localStorage.getItem(k); if (v != null) return v; } catch { /* blocked */ }
    return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
  }
  function rawSet(k, v) {
    try { if (root.localStorage) root.localStorage.setItem(k, v); } catch { /* keep in memory */ }
    mem[k] = v;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stripControl = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩﻿]/g, '').replace(/\s+/g, ' ').trim();
  const clip = (s, n) => { const a = Array.from(stripControl(s)); return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };

  // --- a medal picture is accepted only if it is plain drawing markup -----------------
  const FORBIDDEN = /<\s*(script|foreignObject|iframe|object|embed|image|use|a|style|animate|set|link|meta)\b|\bon[a-z]+\s*=|javascript:|data:|\bhref\s*=|\bsrc\s*=|@import|expression\s*\(/i;
  function safeSvg(s) {
    if (typeof s !== 'string') return '';
    const t = s.trim();
    if (t.length > 20000 || !/^<svg[\s>]/i.test(t) || !/<\/svg>\s*$/i.test(t)) return '';
    if ((t.match(/<svg\b/gi) || []).length !== 1) return '';
    if (FORBIDDEN.test(t)) return '';
    return t;
  }
  // Same-named gradients from different medals must not collide on one card.
  function uniqueIds(svg, n) {
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    let out = svg;
    for (const id of ids) {
      const re = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp('id="' + re + '"', 'g'), 'id="fc' + n + '-' + id + '"')
        .replace(new RegExp('url\\(#' + re + '\\)', 'g'), 'url(#fc' + n + '-' + id + ')');
    }
    return out;
  }
  // Re-size and place the medal's own <svg> element on the card.
  function place(svg, x, y, size) {
    return svg.replace(/^<svg\b([^>]*)>/i, (m, attrs) => {
      const a = attrs.replace(/\s(width|height|x|y)="[^"]*"/gi, '').replace(/\sclass="[^"]*"/i, '');
      return `<svg${a} x="${x}" y="${y}" width="${size}" height="${size}">`;
    });
  }

  function accentOf(opts) {
    if (opts && /^#[0-9a-f]{3,8}$/i.test(opts.accent || '')) return opts.accent;
    try {
      if (root.document && root.getComputedStyle) {
        const v = root.getComputedStyle(root.document.documentElement).getPropertyValue('--vex-accent').trim();
        if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
      }
    } catch { /* default */ }
    return '#8b5cf6';
  }

  // include: { name, level, title, medals: [ids] } (booleans / id list). Anything
  // not ticked is not drawn and not even looked at.
  function build(data, include, opts) {
    const d = data || {};
    const inc = include || {};
    const accent = accentOf(opts);
    const lines = [];
    let y = 62;
    if (inc.name && stripControl(d.name)) { lines.push(`<text x="40" y="${y}" font-size="30" font-weight="700" fill="#f5f5f7">${esc(clip(d.name, NAME_MAX))}</text>`); y += 30; }
    if (inc.title && stripControl(d.title)) { lines.push(`<text x="40" y="${y}" font-size="17" fill="${esc(accent)}">${esc(clip(d.title, TITLE_MAX))}</text>`); y += 26; }
    let levelBadge = '';
    const lvl = Math.floor(Number(d.level));
    if (inc.level && Number.isFinite(lvl) && lvl >= 0 && lvl < 1000) {
      levelBadge = `<g transform="translate(${W - 150} 30)"><rect width="110" height="52" rx="14" fill="${esc(accent)}" fill-opacity=".18" stroke="${esc(accent)}" stroke-opacity=".6"/><text x="55" y="21" text-anchor="middle" font-size="12" fill="#c9c9d1">LEVEL</text><text x="55" y="44" text-anchor="middle" font-size="24" font-weight="700" fill="#f5f5f7">${lvl}</text></g>`;
    }
    const chosen = new Set(Array.isArray(inc.medals) ? inc.medals : []);
    const medals = (Array.isArray(d.medals) ? d.medals : []).filter(m => m && chosen.has(m.id)).slice(0, MAX_MEDALS);
    const top = Math.max(y + 18, 110);
    const rows = Math.ceil(medals.length / COLS);
    let body = '';
    medals.forEach((m, i) => {
      const col = i % COLS, row = Math.floor(i / COLS);
      const cx = 40 + col * CELL + (CELL - 72) / 2;
      const cy = top + row * (CELL + 10);
      const good = safeSvg(m.svg);
      const picture = good
        ? place(uniqueIds(good, i), cx, cy, 72)
        : `<circle cx="${cx + 36}" cy="${cy + 36}" r="32" fill="none" stroke="${esc(accent)}" stroke-width="3"/>`;
      body += picture
        + `<text x="${cx + 36}" y="${cy + 92}" text-anchor="middle" font-size="12" fill="#c9c9d1">${esc(clip(m.title, 16))}</text>`;
    });
    const empty = !lines.length && !levelBadge && !medals.length;
    if (empty) lines.push(`<text x="40" y="${y}" font-size="16" fill="#9a9aa6">Nothing is ticked yet.</text>`);
    const H = Math.ceil(top + (rows ? rows * (CELL + 10) : 0) + 34);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, system-ui, -apple-system, sans-serif" role="img" aria-label="Vex profile card">`
      + `<rect width="${W}" height="${H}" rx="22" fill="#15151c"/>`
      + `<rect x="0" y="0" width="${W}" height="6" rx="3" fill="${esc(accent)}"/>`
      + lines.join('') + levelBadge + body
      + `<text x="${W - 24}" y="${H - 16}" text-anchor="end" font-size="11" fill="#6f6f7b">Vex</text>`
      + '</svg>';
  }

  // --- output ---------------------------------------------------------------------------
  function toPngDataUrl(svg, scale) {
    return new Promise((resolve, reject) => {
      const doc = root.document;
      if (!doc || typeof root.Image !== 'function') { reject(new Error('Pictures cannot be made here')); return; }
      const m = /width="(\d+)" height="(\d+)"/.exec(svg);
      if (!m) { reject(new Error('The card has no size')); return; }
      const k = scale > 0 ? scale : 2;
      const img = new root.Image();
      img.onload = () => {
        try {
          const c = doc.createElement('canvas');
          c.width = Number(m[1]) * k; c.height = Number(m[2]) * k;
          const g = c.getContext('2d');
          g.scale(k, k);
          g.drawImage(img, 0, 0, Number(m[1]), Number(m[2]));
          resolve(c.toDataURL('image/png'));
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('The card could not be drawn'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  async function copy(svg) {
    const b = root.vex;
    if (!b || typeof b.copyImageFrom !== 'function') throw new Error('Copying pictures is not available in this build');
    const url = await toPngDataUrl(svg, 2);
    await b.copyImageFrom(url);
    return true;
  }
  async function saveSvg(svg, name) {
    const b = root.vex;
    if (!b || typeof b.saveTextFile !== 'function') throw new Error('Saving files is not available in this build');
    const res = await b.saveTextFile((name || 'vex-profile-card') + '.svg', svg, 'svg');
    if (res && res.cancelled) return null;
    if (!res || !res.ok) throw new Error((res && res.error) || 'The file was not saved.');
    return res.path;
  }

  // --- the profile ------------------------------------------------------------------------
  let source = null;
  function setSource(obj) { source = obj && typeof obj === 'object' ? obj : null; }
  function fromMedals() {
    const M = root.VexMedals;
    if (!M || typeof M.list !== 'function') return null;
    const p = M.profile ? M.profile() : {};
    const lv = M.levelInfo ? M.levelInfo() : {};
    const medals = M.list().filter(m => M.has(m.id)).map(m => ({ id: m.id, title: m.title, svg: M.artOf(m, { size: 72 }) }));
    return { name: p.name || '', level: lv.level, title: '', medals };
  }
  const data = () => source || fromMedals() || { name: '', level: undefined, title: '', medals: [] };

  function loadSel() {
    try { const s = JSON.parse(rawGet(KEY) || 'null'); if (s && typeof s === 'object') return s; } catch { /* blank */ }
    return { name: false, level: false, title: false, titleText: '', medals: [] };
  }
  function saveSel(s) { rawSet(KEY, JSON.stringify(s)); }

  function el(tag, props, ...kids) {
    const n = root.document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const c of kids) if (c) n.appendChild(c);
    return n;
  }
  function check(id, label, on, onchange) {
    const i = el('input', { type: 'checkbox', id });
    i.checked = !!on;
    i.addEventListener('change', () => onchange(i.checked));
    return el('label', { class: 'setting-toggle-row', for: id }, i, el('span', { text: ' ' + label }));
  }

  function render(host) {
    if (!host) return;
    host.textContent = '';
    const sel = loadSel();
    const d = data();
    const msg = el('div', { class: 'setting-hint', role: 'status', 'aria-live': 'polite' });
    const preview = el('div', { class: 'friendcard-preview', style: 'margin-top:12px;max-width:100%;overflow:auto' });
    const current = () => build(Object.assign({}, d, { title: sel.titleText }), { name: sel.name, level: sel.level, title: sel.title, medals: sel.medals });
    const repaint = () => { preview.innerHTML = current(); saveSel(sel); };
    const run = (fn) => async () => { try { msg.textContent = ''; await fn(); } catch (e) { msg.textContent = e && e.message ? e.message : String(e); msg.style.color = 'var(--vex-danger, #dc2626)'; } };
    const said = (t) => { msg.textContent = t; msg.style.color = ''; };

    host.appendChild(el('div', { class: 'setting-info', text: 'The card is made on this computer and never uploaded. It shows only what you tick below.' }));
    host.appendChild(check('fc-name', d.name ? 'Name: ' + clip(d.name, NAME_MAX) : 'Name (set it in your profile first)', sel.name, v => { sel.name = v; repaint(); }));
    host.appendChild(check('fc-level', d.level != null ? 'Level ' + Math.floor(Number(d.level)) : 'Level', sel.level, v => { sel.level = v; repaint(); }));
    const titleIn = el('input', { class: 'set-input', type: 'text', maxlength: String(TITLE_MAX), placeholder: 'A title, such as Night owl', 'aria-label': 'Title on the card', value: sel.titleText || '' });
    titleIn.addEventListener('input', () => { sel.titleText = clip(titleIn.value, TITLE_MAX); repaint(); });
    host.appendChild(check('fc-title', 'Title', sel.title, v => { sel.title = v; repaint(); }));
    host.appendChild(titleIn);

    const list = el('div', { class: 'friendcard-medals', style: 'margin-top:8px' });
    const medals = Array.isArray(d.medals) ? d.medals : [];
    if (!medals.length) list.appendChild(el('div', { class: 'setting-hint', text: 'No medals yet. Earned medals can be ticked here.' }));
    medals.forEach((m, i) => {
      list.appendChild(check('fc-m' + i, 'Medal: ' + clip(m.title, 40), sel.medals.includes(m.id), v => {
        sel.medals = sel.medals.filter(x => x !== m.id);
        if (v) {
          if (sel.medals.length >= MAX_MEDALS) { said('A card holds up to ' + MAX_MEDALS + ' medals.'); repaint(); return render(host); }
          sel.medals.push(m.id);
        }
        repaint();
      }));
    });
    host.appendChild(list);

    const btn = (label, fn) => { const b = el('button', { class: 'btn-secondary', type: 'button', text: label }); b.addEventListener('click', run(fn)); return b; };
    host.appendChild(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' },
      btn('Copy picture', async () => { await copy(current()); said('Card copied. Paste it wherever you like.'); }),
      btn('Save as SVG', async () => { const p = await saveSvg(current()); if (p) said('Saved to ' + p); })));
    host.appendChild(msg);
    host.appendChild(preview);
    repaint();
  }

  function mountSettings() {
    const doc = root.document;
    if (!doc) return null;
    if (doc.getElementById('settings-friend-card')) return doc.getElementById('friend-card-settings');
    const area = doc.querySelector('.settings-content');
    if (!area) return null;
    const group = el('div', { class: 'setting-group', id: 'settings-friend-card' },
      el('label', { class: 'setting-label', text: 'Personalization: friend profile card' }),
      el('div', { class: 'setting-hint', text: 'Make a picture of your profile to give to a friend. Nothing is uploaded and nothing links back to you.' }),
      el('div', { id: 'friend-card-settings' }));
    const before = doc.getElementById('settings-profiles');
    if (before && before.parentNode === area) area.insertBefore(group, before); else area.appendChild(group);
    const host = doc.getElementById('friend-card-settings');
    render(host);
    // Medals may be earned after startup: draw again when the panel's section is used.
    group.addEventListener('pointerenter', () => { if (!host.contains(root.document.activeElement)) render(host); });
    return host;
  }

  const api = { build, safeSvg, toPngDataUrl, copy, saveSvg, setSource, data, render, mountSettings, MAX_MEDALS, _esc: esc };
  root.FriendCard = api;

  if (root.document && typeof module === 'undefined') {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mountSettings);
    else mountSettings();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { FriendCard: api };
})(typeof window !== 'undefined' ? window : globalThis);
