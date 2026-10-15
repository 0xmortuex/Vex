// VexMedals — the registry, the award engine and the medal art generator.
//
//   VexMedals.define({ id, title, desc, tier, cat, art, hidden?, hint?, check? })
//   VexMedals.award(id)              -> true when newly earned, false when it already was
//   VexMedals.progress(id, n, of)    -> records progress; earns it when n >= of
//   VexMedals.has(id)                -> true only for REALLY earned medals
//   VexMedals.isShown(id)            -> earned, or everything shown by the
//                                       "Unlock all medals" switch
//
// Events (on document): `vex:medal-awarded` {id, title, tier} for each real
// award, `vex:medal-progress` {id, n, of}. Other code that does not want to
// import this can dispatch `vex:medal-signal` {id} (award) or
// {id, n, of} (progress).
//
// Storage: localStorage `vex.medals` (earned/progress/profile/counters) and
// `vex.medals.unlockAll` (the display switch). Neither is in sync-engine's
// SYNC_KEYS: medals are per device, nothing about them leaves this computer.
//
// Rules the code keeps: medals reward real use (never time on screen), there
// is no loss or "you will miss it" wording, nothing is ever taken away, and
// the display switch never touches the earned record.
(function (root) {
  'use strict';

  const KEY = 'vex.medals';
  const KEY_ALL = 'vex.medals.unlockAll';
  const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'special'];
  const SHAPES = ['circle', 'shield', 'star', 'hex'];
  const XP = { bronze: 10, silver: 25, gold: 60, platinum: 120, special: 200 };
  const TIER_NAMES = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', special: 'Special' };
  const CATS = [
    { id: 'start', name: 'Getting started', icon: 'rocket' },
    { id: 'focus', name: 'Focus and calm', icon: 'leaf' },
    { id: 'organize', name: 'Organize', icon: 'folder' },
    { id: 'explore', name: 'Explore and discovery', icon: 'compass' },
    { id: 'privacy', name: 'Privacy and care', icon: 'shield' },
    { id: 'mastery', name: 'Streaks and mastery', icon: 'flame' },
  ];

  // --- storage (a tiny in-memory fallback so the engine runs under test) ----
  const mem = {};
  function ls() { try { return root.localStorage || null; } catch { return null; } }
  function rawGet(k) { const s = ls(); if (s) { try { return s.getItem(k); } catch { return null; } } return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; }
  function rawSet(k, v) { const s = ls(); if (s) { try { s.setItem(k, v); return; } catch { /* quota: keep in memory */ } } mem[k] = v; }

  let cache = null;
  function blank() { return { v: 1, earned: {}, progress: {}, profile: {}, counters: {}, days: [], bonus: {} }; }
  function load() {
    if (cache) return cache;
    let d = null;
    try { d = JSON.parse(rawGet(KEY) || 'null'); } catch { d = null; }
    cache = Object.assign(blank(), d && typeof d === 'object' ? d : {});
    for (const k of ['earned', 'progress', 'profile', 'counters', 'bonus']) if (!cache[k] || typeof cache[k] !== 'object') cache[k] = {};
    if (!Array.isArray(cache.days)) cache.days = [];
    return cache;
  }
  function save() { rawSet(KEY, JSON.stringify(load())); }

  // --- registry ------------------------------------------------------------
  const registry = new Map();
  const listeners = new Set();

  function define(def) {
    if (!def || typeof def.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(def.id)) throw new Error('A medal needs a lowercase id');
    if (registry.has(def.id)) throw new Error('Medal already defined: ' + def.id);
    if (!def.title || !def.desc) throw new Error('Medal ' + def.id + ' needs a title and a description');
    if (!TIERS.includes(def.tier)) throw new Error('Medal ' + def.id + ' has an unknown tier: ' + def.tier);
    const art = def.art || {};
    if (!art.glyph) throw new Error('Medal ' + def.id + ' needs art.glyph');
    if (art.shape && !SHAPES.includes(art.shape)) throw new Error('Medal ' + def.id + ' has an unknown shape: ' + art.shape);
    registry.set(def.id, Object.freeze(Object.assign({ cat: 'start', hidden: false }, def)));
    return registry.get(def.id);
  }

  // One ledger of signal names. Features were written against their own ids
  // (a dotted "play.tetris.cleared", a cosmetic's "first-focus"); canon() maps
  // each to the catalogue id that really exists, so nothing is dropped.
  const aliases = new Map();
  const unmappedSeen = new Set();
  function alias(from, to) {
    if (typeof from !== 'string' || typeof to !== 'string') throw new Error('A medal alias maps one id to another');
    if (registry.has(from)) throw new Error('Medal alias would hide a real medal: ' + from);
    aliases.set(from, to);
  }
  function canon(id) {
    if (typeof id !== 'string') return id;
    if (aliases.has(id)) return aliases.get(id);
    if (!registry.has(id) && id.indexOf('.') >= 0) {
      const dashed = id.replace(/\./g, '-');
      if (registry.has(dashed)) return dashed;
    }
    return id;
  }
  // Signals that reached the engine with no medal behind them (a bug to fix in
  // the catalogue, not something to hide).
  function unmapped() { return [...unmappedSeen]; }

  const get = (id) => registry.get(canon(id)) || null;
  const list = () => [...registry.values()];

  // --- unlock-all display switch ---------------------------------------------
  function unlockAll() { return rawGet(KEY_ALL) === '1'; }
  function setUnlockAll(on) {
    const was = unlockAll();
    rawSet(KEY_ALL, on ? '1' : '0');
    // One notice, never one per medal, and no medal event: nothing was earned.
    emit('vex:medal-display', { unlockAll: !!on, changed: was !== !!on });
  }

  // --- toasts: queued while a game runs ---------------------------------------
  const queue = [];
  function gaming() {
    try {
      if (typeof root.GameSession !== 'undefined' && root.GameSession && root.GameSession.active) return true;
    } catch { /* not loaded */ }
    try {
      if (typeof root.GameMode !== 'undefined' && root.GameMode && root.GameMode.gaming) return true;
    } catch { /* not loaded */ }
    return false;
  }
  function toast(text, kind) {
    if (typeof root.showToast === 'function') root.showToast(text, kind || 'success', 4500);
  }
  function summaryText(items) {
    if (items.length === 1) return 'Medal earned: ' + items[0].title;
    return items.length + ' medals earned: ' + items.slice(0, 2).map(m => m.title).join(', ') + (items.length > 2 ? ' and more' : '');
  }
  function flush() {
    if (!queue.length || gaming()) return;
    const items = queue.splice(0, queue.length);
    toast(summaryText(items));
  }
  function notify(def) {
    queue.push({ id: def.id, title: def.title });
    if (!gaming()) {
      // Several awards in the same moment become one toast.
      clearTimeout(notify._t);
      notify._t = setTimeout(flush, 350);
    }
  }
  function pendingToasts() { return queue.length; }

  // --- events ------------------------------------------------------------------
  function emit(name, detail) {
    for (const fn of listeners) { try { fn(name, detail); } catch { /* a listener must not break an award */ } }
    const doc = root.document;
    if (doc && typeof doc.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
      try { doc.dispatchEvent(new root.CustomEvent(name, { detail })); } catch { /* no DOM */ }
    }
  }
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // --- awarding ----------------------------------------------------------------
  function has(id) { return !!load().earned[canon(id)]; }
  function isShown(id) { return has(id) || (unlockAll() && registry.has(canon(id))); }

  function award(rawId, opts) {
    const id = canon(rawId);
    const def = registry.get(id);
    if (!def) throw new Error('Unknown medal: ' + id);
    const d = load();
    if (d.earned[id]) return false;
    d.earned[id] = { at: Date.now() };
    delete d.progress[id];
    save();
    emit('vex:medal-awarded', { id, title: def.title, tier: def.tier });
    // The sounds module listens for this older name; one award, both events.
    emit('vex:medal-earned', { id, title: def.title, tier: def.tier });
    if (!(opts && opts.silent)) notify(def);
    return true;
  }

  function progress(rawId, n, of) {
    const id = canon(rawId);
    const def = registry.get(id);
    if (!def) throw new Error('Unknown medal: ' + id);
    n = Math.max(0, Math.floor(Number(n) || 0));
    of = Math.max(1, Math.floor(Number(of) || 1));
    const d = load();
    if (d.earned[id]) return false;
    if (n >= of) return award(id);
    const p = d.progress[id];
    if (!p || p.n !== n || p.of !== of) {
      d.progress[id] = { n, of };
      save();
      emit('vex:medal-progress', { id, n, of });
    }
    return false;
  }

  function progressOf(id) {
    const p = load().progress[canon(id)];
    return p ? { n: p.n, of: p.of } : null;
  }

  // --- counters and active days (event-driven, never time on screen) -------------
  function bump(name, by) {
    const d = load();
    d.counters[name] = (Number(d.counters[name]) || 0) + (by == null ? 1 : by);
    return d.counters[name];
  }
  function counter(name) { return Number(load().counters[name]) || 0; }
  const dayKey = (t) => { const x = new Date(t == null ? Date.now() : t); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  // A day counts when something was really done on it.
  function markActiveDay(t) {
    const d = load();
    const k = dayKey(t);
    if (d.days.includes(k)) return false;
    d.days.push(k);
    if (d.days.length > 800) d.days = d.days.slice(-800);
    return true;
  }
  function streak() {
    const days = new Set(load().days);
    let n = 0;
    const t = new Date();
    // Today not being done yet does not break a run that reached yesterday.
    if (!days.has(dayKey(t))) t.setDate(t.getDate() - 1);
    while (days.has(dayKey(t))) { n++; t.setDate(t.getDate() - 1); }
    return n;
  }
  function activeDays() { return new Set(load().days).size; }
  function bestStreak() {
    const ds = [...new Set(load().days)].sort();
    let best = 0, run = 0, prev = null;
    for (const k of ds) {
      const [y, m, dd] = k.split('-').map(Number);
      const cur = new Date(y, m - 1, dd).getTime();
      run = prev != null && Math.round((cur - prev) / 86400000) === 1 ? run + 1 : 1;
      prev = cur;
      if (run > best) best = run;
    }
    return best;
  }

  // --- XP and level ------------------------------------------------------------------
  const MAX_LEVEL = 30;
  function xpOf(pred) { return list().reduce((s, m) => s + (pred(m) ? XP[m.tier] : 0), 0); }
  // Points other features earn for useful things (Browser levels). They add to
  // the one level the profile shows; a medal never depends on them.
  function bonusXp() { return Object.values(load().bonus).reduce((s, n) => s + (Number(n) || 0), 0); }
  function addXp(source, n) {
    if (typeof source !== 'string' || !/^[a-z0-9-]{1,40}$/.test(source)) throw new Error('Bonus points need a source name');
    const add = Math.floor(Number(n));
    if (!Number.isFinite(add) || add < 1 || add > 1000) throw new Error('Bonus points are a whole number from 1 to 1000');
    const d = load();
    d.bonus[source] = (Number(d.bonus[source]) || 0) + add;
    save();
    emit('vex:medal-profile', profile());
    return d.bonus[source];
  }
  function levelFor(xp) { return Math.min(MAX_LEVEL, Math.floor(Math.sqrt(xp / 20)) + 1); }
  function levelStart(l) { return 20 * (l - 1) * (l - 1); }
  function levelInfo() {
    const all = unlockAll();
    const xp = xpOf(m => (all ? true : has(m.id))) + bonusXp();
    const level = levelFor(xp);
    const lo = levelStart(level), hi = levelStart(level + 1);
    return { xp, level, max: level >= MAX_LEVEL, into: xp - lo, span: hi - lo, shownByDisplay: all };
  }
  function stats() {
    const ms = list();
    const earned = ms.filter(m => has(m.id));
    return {
      total: ms.length,
      earned: earned.length,
      shown: ms.filter(m => isShown(m.id)).length,
      byTier: TIERS.reduce((o, t) => { o[t] = { have: earned.filter(m => m.tier === t).length, all: ms.filter(m => m.tier === t).length }; return o; }, {}),
      recent: earned.map(m => ({ id: m.id, at: load().earned[m.id].at })).sort((a, b) => b.at - a.at),
    };
  }

  // --- profile ---------------------------------------------------------------------------
  function profile() { return Object.assign({ name: '', avatar: 'sunrise' }, load().profile); }
  function setProfile(patch) {
    const d = load();
    d.profile = Object.assign({}, d.profile, patch);
    if (typeof d.profile.name === 'string') d.profile.name = d.profile.name.trim().slice(0, 32);
    save();
    emit('vex:medal-profile', profile());
  }

  // --- art ----------------------------------------------------------------------------------
  const PAL = {
    bronze:   { hi: '#ffd2a1', mid: '#cd7f32', lo: '#7d4217', ink: '#3b1d08', rim: '#a8601f' },
    silver:   { hi: '#ffffff', mid: '#c4cbd4', lo: '#7b8794', ink: '#27303a', rim: '#9aa5b1' },
    gold:     { hi: '#fff3b0', mid: '#f5b81c', lo: '#a86a00', ink: '#452b00', rim: '#d99a06' },
    platinum: { hi: '#f3fdff', mid: '#a6dcef', lo: '#4f93b3', ink: '#0d3347', rim: '#7bbfd8' },
    special:  { hi: '#ffffff', mid: '#a78bfa', lo: '#5b21b6', ink: '#1b0b3a', rim: '#8b5cf6' },
  };
  const RIBBONS = { red: ['#e5484d', '#9f1d24'], blue: ['#3b82f6', '#1e4fb0'], green: ['#34c38f', '#1b7a56'], violet: ['#a855f7', '#6b21a8'], amber: ['#f59e0b', '#a85d00'], teal: ['#14b8a6', '#0b7468'] };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const f = (n) => Math.round(n * 100) / 100;

  function polygon(cx, cy, r, n, rot) {
    const pts = [];
    for (let i = 0; i < n; i++) { const a = rot + (i * 2 * Math.PI) / n; pts.push(f(cx + r * Math.cos(a)) + ',' + f(cy + r * Math.sin(a))); }
    return pts.join(' ');
  }
  function starPoints(cx, cy, ro, ri) {
    const pts = [];
    for (let i = 0; i < 10; i++) { const r = i % 2 ? ri : ro; const a = -Math.PI / 2 + (i * Math.PI) / 5; pts.push(f(cx + r * Math.cos(a)) + ',' + f(cy + r * Math.sin(a))); }
    return pts.join(' ');
  }
  function bodyShape(shape, attrs, inset) {
    const i = inset || 0;
    switch (shape) {
      case 'shield': return `<path ${attrs} d="M48 ${10 + i} L${78 - i} ${20 + i} V46 C${78 - i} 66 64 80 48 ${87 - i} C32 80 ${18 + i} 66 ${18 + i} 46 V${20 + i} Z"/>`;
      case 'star': return `<polygon ${attrs} points="${starPoints(48, 50, 42 - i, 22 - i * 0.5)}"/>`;
      case 'hex': return `<polygon ${attrs} points="${polygon(48, 48, 39 - i, 6, -Math.PI / 2)}"/>`;
      default: return `<circle ${attrs} cx="48" cy="48" r="${37 - i}"/>`;
    }
  }
  // Simple geometric glyphs for when no VexIcons name fits. 24x24 box.
  const GEO = {
    'g:diamond': '<path d="M12 3.5 20.5 12 12 20.5 3.5 12Z"/>',
    'g:rings': '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>',
    'g:triangle': '<path d="M12 4 21 19.5H3Z"/>',
    'g:wave': '<path d="M2.5 12c3-6 6-6 9.5 0s6.5 6 9.5 0"/>',
    'g:spark': '<path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18"/>',
    'g:orbit': '<circle cx="12" cy="12" r="2.4"/><ellipse cx="12" cy="12" rx="9" ry="4.2" transform="rotate(-30 12 12)"/>',
  };
  function glyphMarkup(name) {
    if (GEO[name]) return GEO[name];
    const I = root.VexIcons;
    if (I && I.has && I.has(name)) return I.icons[name];
    return '';
  }
  function glyphKnown(name) { return !!glyphMarkup(name); }

  let artSeq = 0;
  // art({ shape, tier, glyph, ribbon, title, locked, size, label })
  function art(spec) {
    const s = spec || {};
    const tier = TIERS.includes(s.tier) ? s.tier : 'bronze';
    const shape = SHAPES.includes(s.shape) ? s.shape : 'circle';
    const size = Number(s.size) > 0 ? Number(s.size) : 72;
    const p = PAL[tier];
    const u = 'vm' + (++artSeq);
    const label = s.label || ((s.locked ? 'Locked medal' : TIER_NAMES[tier] + ' medal') + (s.title ? ': ' + s.title : ''));
    const head = `<svg xmlns="http://www.w3.org/2000/svg" class="vmedal vmedal-${tier}${s.locked ? ' vmedal-locked' : ''}" width="${size}" height="${size}" viewBox="0 0 96 96" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>`;
    if (s.locked) {
      const inner = glyphMarkup('lock');
      return head
        + bodyShape(shape, 'fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-opacity="0.45" stroke-width="2.5" stroke-dasharray="5 4"')
        + `<g transform="translate(33 33) scale(1.25)" fill="none" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`;
    }
    const grad = tier === 'special'
      ? `<linearGradient id="${u}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b9a"/><stop offset=".25" stop-color="#ffd166"/><stop offset=".5" stop-color="#4ade80"/><stop offset=".75" stop-color="#38bdf8"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>`
      : `<linearGradient id="${u}g" x1="0" y1="0" x2="0.9" y2="1"><stop offset="0" stop-color="${p.hi}"/><stop offset=".5" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.lo}"/></linearGradient>`;
    const face = `<radialGradient id="${u}f" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset=".6" stop-color="#ffffff" stop-opacity=".12"/><stop offset="1" stop-color="#000000" stop-opacity=".18"/></radialGradient>`;
    let out = head + `<defs>${grad}${face}<clipPath id="${u}c">${bodyShape(shape, '', 0)}</clipPath></defs>`;
    if (s.ribbon) {
      const r = RIBBONS[s.ribbon] || RIBBONS.red;
      out += `<path d="M30 62 L22 92 L34 86 L40 94 L46 66 Z" fill="${r[1]}"/><path d="M66 62 L74 92 L62 86 L56 94 L50 66 Z" fill="${r[0]}"/>`;
    }
    out += bodyShape(shape, `fill="url(#${u}g)" stroke="${p.lo}" stroke-width="2.2" stroke-linejoin="round"`, 0);
    out += bodyShape(shape, `fill="url(#${u}f)" stroke="#ffffff" stroke-opacity=".55" stroke-width="1.6" stroke-linejoin="round"`, 6);
    const glyph = glyphMarkup(s.glyph);
    out += `<g class="vmedal-glyph" transform="translate(30 31) scale(1.5)" fill="none" stroke="${p.ink}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`;
    // Shine: a soft diagonal highlight, clipped to the body. CSS animates it
    // only when the user has not asked for reduced motion.
    out += `<g clip-path="url(#${u}c)"><rect class="vmedal-shine" x="-40" y="-10" width="26" height="130" fill="#ffffff" opacity=".28" transform="rotate(25 48 48)"/></g>`;
    return out + '</svg>';
  }

  function artOf(def, opts) {
    const a = def.art || {};
    return art(Object.assign({ shape: a.shape, tier: def.tier, glyph: a.glyph, ribbon: a.ribbon, title: def.title }, opts || {}));
  }

  // Preset avatars: plain geometric faces on a colour field. No images, no uploads.
  const AVATARS = [
    { id: 'sunrise', name: 'Sunrise', bg: ['#ffb36b', '#ff6b6b'], glyph: 'sun' },
    { id: 'tide', name: 'Tide', bg: ['#4cc9f0', '#4361ee'], glyph: 'droplet' },
    { id: 'fern', name: 'Fern', bg: ['#80ed99', '#2d6a4f'], glyph: 'leaf' },
    { id: 'ember', name: 'Ember', bg: ['#ffd166', '#ef476f'], glyph: 'flame' },
    { id: 'night', name: 'Night owl', bg: ['#6d5dfc', '#1b1464'], glyph: 'moon' },
    { id: 'spark', name: 'Spark', bg: ['#f9f871', '#ff9671'], glyph: 'zap' },
    { id: 'orbit', name: 'Orbit', bg: ['#c3a6ff', '#5f2eea'], glyph: 'atom' },
    { id: 'summit', name: 'Summit', bg: ['#a0c4ff', '#3a86ff'], glyph: 'flag' },
  ];
  function avatarSvg(id, size) {
    const a = AVATARS.find(x => x.id === id) || AVATARS[0];
    const u = 'va' + (++artSeq);
    const S = Number(size) > 0 ? Number(size) : 56;
    return `<svg xmlns="http://www.w3.org/2000/svg" class="vavatar" width="${S}" height="${S}" viewBox="0 0 96 96" role="img" aria-label="Avatar: ${esc(a.name)}"><title>Avatar: ${esc(a.name)}</title><defs><linearGradient id="${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a.bg[0]}"/><stop offset="1" stop-color="${a.bg[1]}"/></linearGradient></defs><circle cx="48" cy="48" r="46" fill="url(#${u})"/><g transform="translate(24 24) scale(2)" fill="none" stroke="#ffffff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${glyphMarkup(a.glyph)}</g></svg>`;
  }

  // A small progress ring (n of `of`), drawn with currentColor.
  function ring(n, of, size) {
    const S = Number(size) > 0 ? Number(size) : 44;
    const pct = Math.max(0, Math.min(1, of > 0 ? n / of : 0));
    const r = 18, c = 2 * Math.PI * r;
    return `<svg class="vring" width="${S}" height="${S}" viewBox="0 0 44 44" role="img" aria-label="${n} of ${of}"><title>${n} of ${of}</title><circle cx="22" cy="22" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="4"/><circle cx="22" cy="22" r="${r}" fill="none" stroke="var(--vex-accent, currentColor)" stroke-width="4" stroke-linecap="round" stroke-dasharray="${f(c * pct)} ${f(c)}" transform="rotate(-90 22 22)"/></svg>`;
  }

  // Test hook: forget everything held in memory (not the stored data).
  function _reset(opts) {
    cache = null; queue.length = 0;
    if (opts && opts.wipe) { delete mem[KEY]; delete mem[KEY_ALL]; const s = ls(); if (s) { try { s.removeItem(KEY); s.removeItem(KEY_ALL); } catch { /* */ } } }
  }

  const VexMedals = {
    TIERS, SHAPES, XP, TIER_NAMES, CATS, AVATARS, MAX_LEVEL,
    define, get, list, has, isShown, award, progress, progressOf, alias, canon, unmapped, addXp, bonusXp,
    unlockAll, setUnlockAll, on, flush, pendingToasts, gaming,
    bump, counter, markActiveDay, streak, bestStreak, activeDays, save,
    levelInfo, stats, profile, setProfile,
    art, artOf, avatarSvg, ring, glyphKnown, esc, dayKey,
    _reset,
    // Evaluates every medal that has a `check` and is not yet earned.
    // check() returns true, false, or { n, of }.
    evaluate() {
      const got = [];
      for (const def of registry.values()) {
        if (typeof def.check !== 'function' || has(def.id)) continue;
        let r;
        try { r = def.check(); } catch { continue; }
        if (r === true) { if (award(def.id)) got.push(def.id); }
        else if (r && typeof r === 'object') { if (progress(def.id, r.n, r.of)) got.push(def.id); }
      }
      return got;
    },
  };

  // The no-import contract: any code may dispatch `vex:medal-signal`.
  if (root.document && typeof root.document.addEventListener === 'function') {
    root.document.addEventListener('vex:medal-signal', (e) => {
      const d = e && e.detail;
      if (!d || typeof d.id !== 'string') return;
      if (!registry.has(canon(d.id))) { unmappedSeen.add(d.id); return; }
      if (d.n != null && d.of != null) progress(d.id, d.n, d.of);
      else award(d.id);
    });
    root.document.addEventListener('vex:game-mode', (e) => {
      if (e && e.detail && e.detail.active === false) setTimeout(flush, 800);
    });
  }

  globalThis.VexMedals = VexMedals;
  if (typeof module !== 'undefined' && module.exports) module.exports = { VexMedals };
})(typeof window !== 'undefined' ? window : globalThis);
