// === Vex Sticker Sheet ======================================================
//
// Small hand-drawn stickers you collect from milestones (the `vex:medal-signal`
// document event) and stick wherever you like on a New Tab corkboard. They are
// a keepsake, not a score: nothing is lost, nothing nags, there is no streak.
//
//   StickerSheet.mount(el, opts)   a corkboard + tray (drag, arrow keys, Delete)
//   StickerSheet.unmount()
//   StickerSheet.snapshot()        counts, for the integrator and tests
//
// The medal signal is expected to carry an id in `detail.id` (also tolerated:
// key, medal, name, milestone). The same id never grants twice, and the same
// id always maps to the same sticker.
//
// Data is local only (localStorage vex.living.stickers). The board draws once
// and again on a change: no timer, no animation frame, zero idle cost. Off by
// default (Settings > Living Vex): while off, medal signals are ignored.
// Stickers are plain SVG paths; there are no emoji and no bitmaps.

const StickerSheet = (() => {
  const KEY = 'vex.living.stickers';
  const MAX_COLLECTED = 200, MAX_PLACED = 60;

  // 64x64 viewBox. Strokes use currentColor-free fixed warm colours so a
  // sticker looks the same on any theme (it is "paper", not chrome).
  const S = (body) => body;
  const CATALOG = Object.freeze([
    { id: 'star', name: 'Star', svg: S('<path d="M32 6l7.4 17.2 18.6 1.7-14.1 12.3 4.3 18.3L32 45.6 15.8 55.5l4.3-18.3L6 24.9l18.6-1.7z" fill="#f6c945" stroke="#7a5a10" stroke-width="2.4" stroke-linejoin="round"/>') },
    { id: 'moon', name: 'Moon', svg: S('<path d="M44 8a24 24 0 1 0 12 36A20 20 0 0 1 44 8z" fill="#d9dff2" stroke="#4a527a" stroke-width="2.4" stroke-linejoin="round"/><circle cx="26" cy="30" r="2.6" fill="#b5bde0"/><circle cx="34" cy="44" r="3.4" fill="#b5bde0"/>') },
    { id: 'sun', name: 'Sun', svg: S('<circle cx="32" cy="32" r="12" fill="#ffb347" stroke="#8a4b05" stroke-width="2.4"/><path d="M32 5v9M32 50v9M5 32h9M50 32h9M13 13l6 6M45 45l6 6M51 13l-6 6M19 45l-6 6" stroke="#8a4b05" stroke-width="3" stroke-linecap="round" fill="none"/>') },
    { id: 'leaf', name: 'Leaf', svg: S('<path d="M10 52C8 28 24 10 54 10 56 38 40 56 14 54" fill="#7bbf5a" stroke="#2f5d1c" stroke-width="2.4" stroke-linejoin="round"/><path d="M10 54C22 40 32 30 46 18" stroke="#2f5d1c" stroke-width="2.4" fill="none" stroke-linecap="round"/>') },
    { id: 'mug', name: 'Mug', svg: S('<path d="M12 22h30v20a12 12 0 0 1-12 12h-6A12 12 0 0 1 12 42z" fill="#e8d2b0" stroke="#6b4a24" stroke-width="2.4" stroke-linejoin="round"/><path d="M42 27h5a6 6 0 0 1 0 14h-5" fill="none" stroke="#6b4a24" stroke-width="2.4" stroke-linecap="round"/><path d="M20 14c-3-3 3-5 0-8M30 14c-3-3 3-5 0-8" fill="none" stroke="#8a8a8a" stroke-width="2" stroke-linecap="round"/>') },
    { id: 'rocket', name: 'Rocket', svg: S('<path d="M32 5c11 8 14 22 11 36H21C18 27 21 13 32 5z" fill="#eef1f6" stroke="#3a4558" stroke-width="2.4" stroke-linejoin="round"/><circle cx="32" cy="25" r="5" fill="#6fb3ff" stroke="#3a4558" stroke-width="2.2"/><path d="M21 34l-9 10 10-1M43 34l9 10-10-1" fill="#e5533d" stroke="#3a4558" stroke-width="2.2" stroke-linejoin="round"/><path d="M27 44c0 6 2 10 5 14 3-4 5-8 5-14" fill="#ffb347" stroke="#8a4b05" stroke-width="2"/>') },
    { id: 'key', name: 'Key', svg: S('<circle cx="21" cy="21" r="11" fill="#f1c95a" stroke="#6e5410" stroke-width="2.4"/><circle cx="21" cy="21" r="4" fill="#fff8dc" stroke="#6e5410" stroke-width="2"/><path d="M29 29l25 25M44 44l6-6M50 50l5-5" stroke="#6e5410" stroke-width="3.2" stroke-linecap="round" fill="none"/>') },
    { id: 'bolt', name: 'Bolt', svg: S('<path d="M36 4L14 36h14l-4 24 26-34H35z" fill="#ffd84a" stroke="#7a5a10" stroke-width="2.4" stroke-linejoin="round"/>') },
    { id: 'cloud', name: 'Cloud', svg: S('<path d="M18 46a12 12 0 0 1-1-24 15 15 0 0 1 29 3 10 10 0 0 1 1 21z" fill="#eaf1fb" stroke="#4a6488" stroke-width="2.4" stroke-linejoin="round"/>') },
    { id: 'flag', name: 'Flag', svg: S('<path d="M14 8v50" stroke="#5b3a1a" stroke-width="3.4" stroke-linecap="round"/><path d="M16 10c10-5 18 5 30 0v22c-12 5-20-5-30 0z" fill="#e5533d" stroke="#7a1f12" stroke-width="2.4" stroke-linejoin="round"/>') },
    { id: 'paw', name: 'Paw', svg: S('<ellipse cx="32" cy="42" rx="14" ry="11" fill="#caa27a" stroke="#5b3a1a" stroke-width="2.4"/><ellipse cx="15" cy="27" rx="6" ry="8" fill="#caa27a" stroke="#5b3a1a" stroke-width="2.2" transform="rotate(-20 15 27)"/><ellipse cx="27" cy="16" rx="6" ry="8" fill="#caa27a" stroke="#5b3a1a" stroke-width="2.2"/><ellipse cx="38" cy="16" rx="6" ry="8" fill="#caa27a" stroke="#5b3a1a" stroke-width="2.2"/><ellipse cx="50" cy="27" rx="6" ry="8" fill="#caa27a" stroke="#5b3a1a" stroke-width="2.2" transform="rotate(20 50 27)"/>') },
    { id: 'heart', name: 'Heart', svg: S('<path d="M32 56C10 40 6 26 12 16c6-8 16-5 20 3 4-8 14-11 20-3 6 10 2 24-20 40z" fill="#ef6a8a" stroke="#7a1f3a" stroke-width="2.4" stroke-linejoin="round"/>') }
  ]);
  const IDS = CATALOG.map(c => c.id);
  // Stickers from installed Vex Packs (js/packs-consumers.js): in memory only,
  // never part of what a signal can grant, always free to stick, and drawn as
  // an image (<img> with a data: SVG), which cannot run script or load anything.
  let PACK = [];
  const isPack = (id) => typeof id === 'string' && id.startsWith('pack:') && PACK.some(c => c.id === id);
  const isKnown = (id) => IDS.includes(id) || isPack(id);
  const byId = (id) => CATALOG.find(c => c.id === id) || PACK.find(c => c.id === id) || null;
  function setPackStickers(list) {
    PACK = (Array.isArray(list) ? list : [])
      .filter(s => s && typeof s.id === 'string' && typeof s.svg === 'string' && s.svg.length <= 16 * 1024 && /^<svg[\s>]/i.test(s.svg.trim()))
      .slice(0, 50)
      .map(s => ({ id: 'pack:' + s.id, name: String(s.name || s.id).slice(0, 40), href: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.svg), pack: true }));
    return PACK.length;
  }

  // ---- pure data model ------------------------------------------------------
  const empty = () => ({ v: 1, collected: [], placed: [], seq: 0 });

  function normalize(raw) {
    const m = empty();
    if (!raw || typeof raw !== 'object') return m;
    if (Array.isArray(raw.collected)) {
      m.collected = raw.collected.filter(c => c && typeof c.key === 'string' && isKnown(c.sticker)).slice(0, MAX_COLLECTED)
        .map(c => ({ key: c.key, sticker: c.sticker, at: Number(c.at) || 0 }));
    }
    if (Array.isArray(raw.placed)) {
      m.placed = raw.placed.filter(p => p && typeof p.uid === 'string' && isKnown(p.sticker)).slice(0, MAX_PLACED)
        .map(p => ({ uid: p.uid, sticker: p.sticker, x: clamp(p.x), y: clamp(p.y), rot: clampRot(p.rot), scale: clampScale(p.scale), z: Number(p.z) || 0 }));
    }
    m.seq = Math.max(Number(raw.seq) || 0, m.placed.length);
    return m;
  }
  const clamp = (v) => Math.min(1, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 0.5));
  const clampRot = (v) => Math.min(45, Math.max(-45, Number.isFinite(Number(v)) ? Number(v) : 0));
  const clampScale = (v) => Math.min(1.6, Math.max(0.6, Number.isFinite(Number(v)) ? Number(v) : 1));

  // The medal id a signal carries, or '' when it carries none.
  function signalKey(detail) {
    if (!detail || typeof detail !== 'object') return '';
    for (const k of ['id', 'key', 'medal', 'name', 'milestone']) {
      const v = detail[k];
      if ((typeof v === 'string' && v.trim()) || typeof v === 'number') return String(v).trim();
    }
    return '';
  }

  // FNV-1a: the same id always picks the same sticker, on every machine.
  function stickerForKey(key) {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return IDS[h % IDS.length];
  }

  // Returns { model, granted } where granted is the collected entry or null.
  function grant(model, detail, nowMs) {
    const key = signalKey(detail);
    if (!key) return { model, granted: null, reason: 'no-id' };
    if (model.collected.some(c => c.key === key)) return { model, granted: null, reason: 'already' };
    if (model.collected.length >= MAX_COLLECTED) return { model, granted: null, reason: 'full' };
    const entry = { key, sticker: stickerForKey(key), at: nowMs || Date.now() };
    return { model: { ...model, collected: model.collected.concat(entry) }, granted: entry };
  }

  const ownedCount = (model, id) => model.collected.filter(c => c.sticker === id).length;
  const placedCount = (model, id) => model.placed.filter(p => p.sticker === id).length;
  // You may stick a sticker as many times as you have earned it.
  // A pack sticker is free: as many as the board takes.
  const available = (model, id) => (isPack(id) ? 1 : ownedCount(model, id) - placedCount(model, id));

  function place(model, id, x, y) {
    if (!byId(id)) throw new Error('Unknown sticker ' + id);
    if (available(model, id) <= 0) throw new Error('No ' + id + ' sticker left to place');
    if (model.placed.length >= MAX_PLACED) throw new Error('The board is full');
    const seq = model.seq + 1;
    const z = model.placed.reduce((m, p) => Math.max(m, p.z), 0) + 1;
    return { ...model, seq, placed: model.placed.concat({ uid: 's' + seq, sticker: id, x: clamp(x), y: clamp(y), rot: 0, scale: 1, z }) };
  }
  const _edit = (model, uid, fn) => {
    if (!model.placed.some(p => p.uid === uid)) throw new Error('No such sticker on the board');
    return { ...model, placed: model.placed.map(p => (p.uid === uid ? fn(p) : p)) };
  };
  const move = (m, uid, x, y) => _edit(m, uid, p => ({ ...p, x: clamp(x), y: clamp(y) }));
  const rotate = (m, uid, deg) => _edit(m, uid, p => ({ ...p, rot: clampRot(deg) }));
  const resize = (m, uid, s) => _edit(m, uid, p => ({ ...p, scale: clampScale(s) }));
  const raise = (m, uid) => { const top = m.placed.reduce((a, p) => Math.max(a, p.z), 0); return _edit(m, uid, p => ({ ...p, z: top + 1 })); };
  function remove(model, uid) {
    if (!model.placed.some(p => p.uid === uid)) throw new Error('No such sticker on the board');
    return { ...model, placed: model.placed.filter(p => p.uid !== uid) };
  }

  // ---- storage --------------------------------------------------------------
  const _ls = (storage) => { if (storage) return storage; try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };
  function load(storage) {
    const s = _ls(storage);
    if (!s) return empty();
    try { return normalize(JSON.parse(s.getItem(KEY) || 'null')); }
    catch (err) { console.warn('[Stickers] the saved board could not be read:', err && err.message); return empty(); }
  }
  // false when storage refused: the caller must not say it saved.
  function save(model, storage) {
    const s = _ls(storage);
    if (!s) return false;
    try { s.setItem(KEY, JSON.stringify(model)); return true; } catch { return false; }
  }

  // ---- the medal-signal listener -------------------------------------------
  let _listening = false;
  function onMedal(e, storage) {
    const VL = (typeof VexLiving !== 'undefined') ? VexLiving : null;
    const on = VL ? VL.read(storage).stickers : false;
    if (!on) return null;
    const r = grant(load(storage), e && e.detail);
    if (!r.granted) return null;
    if (!save(r.model, storage)) { console.error('[Stickers] a new sticker could not be kept: storage refused the write'); return null; }
    try { document.dispatchEvent(new CustomEvent('vex:sticker-granted', { detail: { sticker: r.granted.sticker, key: r.granted.key, name: byId(r.granted.sticker).name } })); } catch { /* no DOM */ }
    return r.granted;
  }
  function listen() {
    if (_listening || typeof document === 'undefined') return false;
    _listening = true;
    document.addEventListener('vex:medal-signal', (e) => onMedal(e));
    return true;
  }

  // ---- the corkboard component ---------------------------------------------
  let _mounted = null;

  function _svgEl(id) {
    const c = byId(id);
    const NS = 'http://www.w3.org/2000/svg';
    if (c && c.pack) {
      const holder = document.createElementNS(NS, 'svg');
      holder.setAttribute('viewBox', '0 0 64 64');
      holder.setAttribute('aria-hidden', 'true');
      const im = document.createElementNS(NS, 'image');
      im.setAttribute('href', c.href);
      im.setAttribute('width', '64');
      im.setAttribute('height', '64');
      holder.appendChild(im);
      return holder;
    }
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = c.svg;                    // catalog constants only, never user text
    return svg;
  }

  function mount(el, opts) {
    const o = opts || {};
    if (!el) throw new Error('StickerSheet.mount needs an element');
    // The master Playfulness level (js/vex-playfulness.js): Off, Game mode, Focus, Simple mode and Minimal Vex draw no board.
    if (typeof VexPlayfulness !== 'undefined' && !VexPlayfulness.allowed('living')) return false;
    if (typeof VexLiving !== 'undefined') VexLiving.ensureStyles();
    if (_mounted) unmount();
    let model = load(o.storage);
    const board = document.createElement('div');
    board.className = 'vex-board';
    board.setAttribute('role', 'group');
    board.setAttribute('aria-label', 'Sticker board');
    const tray = document.createElement('div');
    tray.className = 'vex-tray';
    tray.setAttribute('role', 'group');
    tray.setAttribute('aria-label', 'Stickers you have earned');
    el.append(board, tray);

    const persist = () => { if (!save(model, o.storage) && typeof window !== 'undefined' && window.showToast) window.showToast('The sticker board could not be saved', 'error'); };

    function paint() {
      board.textContent = '';
      if (!model.placed.length) {
        const empty = document.createElement('div');
        empty.className = 'vex-board-empty';
        empty.textContent = model.collected.length ? 'Pick a sticker below to stick it here.' : 'Stickers you earn from milestones will show up here.';
        board.appendChild(empty);
      }
      for (const p of model.placed) {
        const d = document.createElement('div');
        d.className = 'vex-sticker';
        d.dataset.uid = p.uid;
        d.tabIndex = 0;
        d.setAttribute('role', 'img');
        d.setAttribute('aria-label', byId(p.sticker).name + ' sticker. Arrow keys move it, Delete removes it.');
        d.style.left = 'calc(' + (p.x * 100) + '% - 32px)';
        d.style.top = 'calc(' + (p.y * 100) + '% - 32px)';
        d.style.transform = 'rotate(' + p.rot + 'deg) scale(' + p.scale + ')';
        d.style.zIndex = String(p.z);
        d.appendChild(_svgEl(p.sticker));
        wire(d, p.uid);
        board.appendChild(d);
      }
      tray.textContent = '';
      for (const c of CATALOG.concat(PACK)) {
        const left = available(model, c.id);
        if (left <= 0) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'vex-tray-item';
        b.title = c.name + (left > 1 ? ' (x' + left + ')' : '');
        b.setAttribute('aria-label', 'Stick a ' + c.name + ' on the board');
        b.appendChild(_svgEl(c.id));
        b.addEventListener('click', () => {
          try { model = place(model, c.id, 0.2 + Math.random() * 0.6, 0.25 + Math.random() * 0.5); }
          catch (err) { if (window.showToast) window.showToast(err.message, 'error'); else throw err; return; }
          persist(); paint();
        });
        tray.appendChild(b);
      }
    }

    function wire(d, uid) {
      let drag = null;
      d.addEventListener('pointerdown', (e) => {
        const r = board.getBoundingClientRect();
        if (!r.width || !r.height) return;
        drag = { r };
        d.classList.add('dragging');
        try { d.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
        model = raise(model, uid);
        d.style.zIndex = String(model.placed.find(p => p.uid === uid).z);
      });
      d.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const x = (e.clientX - drag.r.left) / drag.r.width, y = (e.clientY - drag.r.top) / drag.r.height;
        model = move(model, uid, x, y);
        const p = model.placed.find(q => q.uid === uid);
        d.style.left = 'calc(' + (p.x * 100) + '% - 32px)';
        d.style.top = 'calc(' + (p.y * 100) + '% - 32px)';
      });
      const end = () => { if (!drag) return; drag = null; d.classList.remove('dragging'); persist(); };
      d.addEventListener('pointerup', end);
      d.addEventListener('pointercancel', end);
      d.addEventListener('keydown', (e) => {
        const step = 0.02, p = model.placed.find(q => q.uid === uid);
        if (!p) return;
        let handled = true;
        if (e.key === 'ArrowLeft') model = move(model, uid, p.x - step, p.y);
        else if (e.key === 'ArrowRight') model = move(model, uid, p.x + step, p.y);
        else if (e.key === 'ArrowUp') model = move(model, uid, p.x, p.y - step);
        else if (e.key === 'ArrowDown') model = move(model, uid, p.x, p.y + step);
        else if (e.key === '[') model = rotate(model, uid, p.rot - 5);
        else if (e.key === ']') model = rotate(model, uid, p.rot + 5);
        else if (e.key === 'Delete' || e.key === 'Backspace') model = remove(model, uid);
        else handled = false;
        if (!handled) return;
        e.preventDefault(); persist(); paint();
        const again = board.querySelector('[data-uid="' + uid + '"]');
        if (again) again.focus();
      });
    }

    paint();
    _mounted = { el, board, tray, repaint: () => { model = load(o.storage); paint(); }, get model() { return model; } };
    const onGrant = () => _mounted && _mounted.repaint();
    document.addEventListener('vex:sticker-granted', onGrant);
    _mounted.off = () => document.removeEventListener('vex:sticker-granted', onGrant);
    return true;
  }

  function unmount() {
    if (!_mounted) return false;
    _mounted.off();
    _mounted.board.remove(); _mounted.tray.remove();
    _mounted = null;
    return true;
  }

  function snapshot(storage) {
    const m = _mounted ? _mounted.model : load(storage);
    return { id: 'stickers', mounted: !!_mounted, collected: m.collected.length, placed: m.placed.length, catalog: CATALOG.length, timers: 0, frames: 0 };
  }

  return {
    CATALOG, IDS, MAX_COLLECTED, MAX_PLACED, KEY, setPackStickers,
    normalize, signalKey, stickerForKey, grant, place, move, rotate, resize, raise, remove,
    available, ownedCount, placedCount, load, save, onMedal, listen, mount, unmount, snapshot,
    _reset() { _mounted = null; _listening = false; }
  };
})();

if (typeof window !== 'undefined') {
  window.StickerSheet = StickerSheet;
  StickerSheet.listen();
  if (typeof VexLiving !== 'undefined') {
    VexLiving.registerSettings([{ key: 'stickers', label: 'Collect stickers from milestones for the New Tab corkboard', type: 'toggle' }]);
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { StickerSheet };
