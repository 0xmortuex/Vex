// === Feature packs: one screen to turn on what you actually use =====================================
//
// An update adds features, and on a profile that already existed they arrive switched OFF and are offered a few at
// a time (js/feature-registry.js). With a couple of hundred waiting that never gets anywhere. This is the other way
// in: ONE screen, "Turn on the packs for how you use Vex", with four packs (MUN, Study, Gaming, Developer), each
// listing exactly which features it would turn on, each feature with its own tick box and a plain sentence from the
// catalogue. Nothing is turned on until the person presses Apply, and the last Apply can be reversed with one press.
//
//   - Offered ONCE, as a row in the Attention Inbox (never a modal, never a toast on start-up), when enough
//     features are waiting. After that it is only there if the person opens it: Settings > Minimal Vex, or Ctrl+K
//     "Choose Feature Packs". "Not now" is remembered and the offer is not made again.
//   - A pack is not a list kept here: a feature belongs to a pack by rules over the catalogue entry (its name, words
//     and category, js/feature-catalog.js) and the manifest (js/feature-manifests.js group). PACK_RULES below is the
//     whole table; the first pack whose rule matches takes the feature, so a feature is never listed twice.
//   - Apply uses the same switch as every other way to turn a feature on (VexRegistry.switchOn -> VexUsage.enable).
//     "Turn these back off" uses VexRegistry.switchOff for the features the last Apply turned on and that are still on.
//     Minimal Vex (Settings) still switches every optional feature off at once.
//
// One record, vex.featurePacks: { v: 1, offeredAt, dismissedAt, lastApply: { at, ids: [] } }. Local only.
const VexFeaturePacks = {
  KEY: 'vex.featurePacks',
  FEATURE: 'feature-packs',
  // Fewer waiting features than this is not worth an inbox row; the weekly offers handle it.
  MIN_WAITING: 5,

  PACKS: [
    { id: 'mun', name: 'MUN', blurb: 'Model UN: dossier, procedure and speeches.' },
    { id: 'study', name: 'Study', blurb: 'Exams, courses, notes, deadlines and reading for school.' },
    { id: 'gaming', name: 'Gaming', blurb: 'Game mode extras, overlays, patch news and timers.' },
    { id: 'developer', name: 'Developer', blurb: 'GitHub, deploys, logs, ports and request tools.' },
  ],

  // How a feature is put in a pack. `entry` is its catalogue entry (or null), `m` its manifest. The packs are tried in
  // RULE_ORDER and the first match wins. Pure: no state, so the table can be tested alone. The rules read the
  // catalogue name and the manifest title and group, never the long sentence or the search words (they mention too much).
  RULE_ORDER: ['mun', 'developer', 'gaming', 'study'],
  PACK_RULES: {
    mun: (entry, m) => /\b(model un|mun|speakers list|speech timer)\b/i.test(words(entry, m)),
    gaming: (entry, m) => /^game-|^gcc-|^second-screen$/.test(m.id) || /^(game\b|loadout|held while you played)/i.test(m.group) || /\b(gam(e|es|ing)|roblox|valorant|patch notes)\b/i.test(words(entry, m)),
    developer: (entry, m) => (entry && entry.cat === 'dev') || /^developer\b/i.test(m.group),
    study: (entry, m) => /^(study|exam|exams|past papers|courses|paper brief|deadlines|library links|reading aids|pdf|sources|archive on cite|breaks|focus block)/i.test(m.group)
      || /\b(study|exam|exams|course|courses|syllabus|homework|past paper|lecture|flashcards?|citations?)\b/i.test(words(entry, m)),
  },

  // The pack a feature belongs to, or null (then it is only ever offered the old way).
  packOf(entry, m) {
    for (const id of this.RULE_ORDER) if (this.PACK_RULES[id](entry, m)) return id;
    return null;
  },

  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },
  _entry(id) {
    if (typeof VexFeatures === 'undefined') return null;
    return VexFeatures.ITEMS.find(f => f.feature === id) || VexFeatures.ITEMS.find(f => f.id === id) || null;
  },

  // The packs with what each would turn on: [{ id, name, blurb, features: [{ id, title, what }] }], only packs that
  // have something waiting. A feature already on, or not running in this build, is not listed.
  packs() {
    if (typeof VexRegistry === 'undefined') throw new Error('Feature packs need the feature registry');
    const out = new Map(this.PACKS.map(p => [p.id, { ...p, features: [] }]));
    for (const id of VexRegistry.waitingOff()) {
      const m = VexRegistry.get(id);
      const entry = this._entry(id);
      const pack = this.packOf(entry, m);
      if (!pack) continue;
      const title = (entry && typeof VexFeatures.nameOf === 'function' && VexFeatures.nameOf(entry)) || m.title;
      out.get(pack).features.push({ id, title, what: (entry && entry.what) || m.title });
    }
    return Array.from(out.values()).filter(p => p.features.length);
  },
  waitingCount() { return this.packs().reduce((n, p) => n + p.features.length, 0); },

  // ---- the record --------------------------------------------------------------------------------
  _read() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); }
    catch (err) { throw new Error('The feature-pack note could not be read: ' + err.message, { cause: err }); }
    if (!raw) return { v: 1, offeredAt: 0, dismissedAt: 0, lastApply: null };
    let s;
    try { s = JSON.parse(raw); }
    catch (err) { throw new Error('The feature-pack note is not readable: ' + err.message, { cause: err }); }
    if (!s || typeof s !== 'object' || s.v !== 1) throw new Error('The feature-pack note is not in a form Vex knows');
    return {
      v: 1,
      offeredAt: Number.isFinite(s.offeredAt) ? s.offeredAt : 0,
      dismissedAt: Number.isFinite(s.dismissedAt) ? s.dismissedAt : 0,
      lastApply: s.lastApply && Array.isArray(s.lastApply.ids) ? { at: Number(s.lastApply.at) || 0, ids: s.lastApply.ids.filter(x => typeof x === 'string') } : null,
    };
  },
  _write(state) {
    try { localStorage.setItem(this.KEY, JSON.stringify(state)); }
    catch (err) { throw new Error('The feature-pack note could not be saved: ' + err.message, { cause: err }); }
  },

  // ---- the offer: once, in the Attention Inbox --------------------------------------------------------
  // Offered when the profile is an existing one, enough is waiting, and it was never offered or dismissed before.
  shouldOffer() {
    const s = this._read();
    if (s.offeredAt || s.dismissedAt) return false;
    const st = VexRegistry._load();
    if (!st.profile || st.profile.kind !== 'existing') return false;
    return this.waitingCount() >= this.MIN_WAITING;
  },
  // -> true when the row was added now. A switched-off inbox adds nothing and leaves the offer for a later start.
  maybeOffer() {
    if (typeof AttentionInbox === 'undefined' || !this.shouldOffer()) return false;
    const n = this.waitingCount();
    const added = AttentionInbox.add({
      feature: this.FEATURE, id: 'offer', label: 'Feature packs',
      title: this._t('Turn on the packs for how you use Vex'),
      body: this._t('{1} features came with updates and are switched off. Pick the ones you want; nothing changes until you press Apply.').replace('{1}', String(n)),
      action: { label: this._t('Choose'), key: 'open' },
    });
    if (added) this._write({ ...this._read(), offeredAt: Date.now() });
    return added;
  },
  // "Not now": remembered, and the offer is not made again. It stays reachable from Settings and Ctrl+K.
  dismiss() {
    this._write({ ...this._read(), dismissedAt: Date.now() });
    this.close();
  },

  // ---- Apply and undo ----------------------------------------------------------------------------------
  // ids: the features the person left ticked. Only a feature that is really waiting can be turned on this way.
  // -> { on: [ids], failed: [{ id, error }] }
  async apply(ids) {
    if (!Array.isArray(ids) || !ids.length) throw new Error('Tick at least one feature to turn on');
    if (typeof VexMinimalMode !== 'undefined' && VexMinimalMode.isOn()) throw new Error('Minimal Vex is on. Switch it off in Settings first, then choose your packs');
    const waiting = new Set(VexRegistry.waitingOff());
    for (const id of ids) if (!waiting.has(id)) throw new Error('"' + id + '" is not waiting to be turned on');
    const on = [], failed = [];
    for (const id of ids) {
      try { await VexRegistry.switchOn(id); VexRegistry.markTried(id); on.push(id); }
      catch (err) { failed.push({ id, error: (err && err.message) || String(err) }); }
    }
    // The note is written once the attempts are done: it names exactly what is on because of this Apply.
    if (on.length) this._write({ ...this._read(), lastApply: { at: Date.now(), ids: on } });
    return { on, failed };
  },
  canUndo() { const s = this._read(); return !!(s.lastApply && s.lastApply.ids.length); },
  // Turns off what the last Apply turned on, if it is still on. -> { off: [ids], failed: [{ id, error }] }
  async undo() {
    const s = this._read();
    if (!s.lastApply) return { off: [], failed: [] };
    const off = [], failed = [], keep = [];
    const u = VexRegistry._usage();
    for (const id of s.lastApply.ids) {
      try {
        if (u && u.get(id) && u.isEnabled(id)) await VexRegistry.switchOff(id);
        off.push(id);
      } catch (err) { failed.push({ id, error: (err && err.message) || String(err) }); keep.push(id); }
    }
    // What would not switch off stays on the note, so the button is still there for it.
    this._write({ ...s, lastApply: keep.length ? { at: s.lastApply.at, ids: keep } : null });
    return { off, failed };
  },

  // ---- the screen --------------------------------------------------------------------------------------
  _open: null,
  isOpen() { return !!this._open; },
  close() {
    const c = this._open;
    if (!c) return;
    this._open = null;
    document.removeEventListener('keydown', c.onKey, true);
    c.el.remove();
  },

  _plural(n) {
    return typeof VexPlural !== 'undefined' ? VexPlural.count(n, { en: ['feature', 'features'], tr: 'özellik' }) : n + ' features';
  },

  open() {
    if (typeof document === 'undefined') return null;
    if (this._open) this.close();
    const packs = this.packs();
    const state = this._read();
    const el = document.createElement('div');
    el.className = 'vex-packs-overlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.42);display:grid;place-items:start center;padding-top:5vh;overflow:auto';
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', this._t('Turn on the packs for how you use Vex'));
    box.style.cssText = 'width:min(680px,94vw);max-height:88vh;display:flex;flex-direction:column;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.28)';
    el.appendChild(box);
    const head = document.createElement('div');
    head.style.cssText = 'padding:14px 16px;border-bottom:1px solid var(--border)';
    const h = document.createElement('div'); h.style.cssText = 'font-size:14px;font-weight:650'; h.textContent = this._t('Turn on the packs for how you use Vex');
    const intro = document.createElement('div'); intro.style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:4px';
    intro.textContent = this._t('These features came with updates and are switched off for you. Tick the ones you want and press Apply. Nothing changes until you do.');
    head.append(h, intro);
    const list = document.createElement('div');
    list.style.cssText = 'overflow:auto;padding:8px 16px;display:grid;gap:12px';
    const foot = document.createElement('div');
    foot.style.cssText = 'padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;align-items:center';
    const status = document.createElement('div'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.style.cssText = 'flex:1;min-width:160px;font-size:12px;color:var(--text-muted)';
    const mkBtn = (text, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls || 'btn-secondary'; b.textContent = this._t(text); b.style.cssText = 'font-size:12px;padding:5px 12px'; return b; };
    const apply = mkBtn('Apply', 'btn-primary');
    const later = mkBtn('Not now');
    const undo = mkBtn('Turn these back off');
    undo.hidden = !this.canUndo();
    foot.append(status, undo, later, apply);
    box.append(head, list, foot);

    const c = { el, boxes: new Map(), onKey: null };
    this._open = c;
    const ticked = () => Array.from(c.boxes.entries()).filter(([, cb]) => cb.checked).map(([id]) => id);
    const refresh = () => {
      const n = ticked().length;
      apply.disabled = n === 0;
      apply.textContent = n ? this._t('Apply') + ' (' + n + ')' : this._t('Apply');
    };
    if (!packs.length) {
      const none = document.createElement('div'); none.style.cssText = 'font-size:12.5px;color:var(--text-muted);padding:10px 0';
      none.textContent = this._t('Nothing is waiting. Every feature in these packs is already on, or was never switched off for you.');
      list.appendChild(none);
    }
    for (const pack of packs) {
      const sec = document.createElement('section'); sec.dataset.pack = pack.id; sec.style.cssText = 'border:1px solid var(--border);border-radius:10px;padding:8px 12px';
      const all = document.createElement('input'); all.type = 'checkbox'; all.dataset.packAll = pack.id;
      const label = document.createElement('label'); label.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:13px;font-weight:650;cursor:pointer';
      const name = document.createElement('span'); name.textContent = this._t(pack.name);
      const count = document.createElement('span'); count.style.cssText = 'font-weight:400;font-size:11.5px;color:var(--text-muted)'; count.textContent = this._plural(pack.features.length);
      label.append(all, name, count);
      const blurb = document.createElement('div'); blurb.style.cssText = 'font-size:11.5px;color:var(--text-muted);margin:2px 0 6px 24px'; blurb.textContent = this._t(pack.blurb);
      sec.append(label, blurb);
      const mine = [];
      for (const f of pack.features) {
        const row = document.createElement('label'); row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;padding:4px 0 4px 24px;cursor:pointer';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.feature = f.id; cb.style.marginTop = '2px';
        const txt = document.createElement('span'); txt.style.cssText = 'display:grid;gap:1px';
        const t = document.createElement('span'); t.style.cssText = 'font-size:12.5px;font-weight:600'; t.textContent = this._t(f.title);
        const w = document.createElement('span'); w.style.cssText = 'font-size:11.5px;color:var(--text-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden'; w.textContent = this._t(f.what);
        txt.append(t, w); row.append(cb, txt); sec.appendChild(row);
        c.boxes.set(f.id, cb); mine.push(cb);
        cb.addEventListener('change', () => { all.checked = mine.every(x => x.checked); refresh(); });
      }
      all.addEventListener('change', () => { for (const cb of mine) cb.checked = all.checked; refresh(); });
      list.appendChild(sec);
    }
    refresh();

    const fail = (err) => { status.textContent = (err && err.message) || String(err); status.style.color = '#ef4444'; };
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      try {
        const r = await this.apply(ticked());
        window.showToast?.(this._plural(r.on.length) + ' ' + this._t('turned on') + (r.failed.length ? ' — ' + r.failed.length + ' ' + this._t('could not be') : ''), r.failed.length ? 'error' : 'info');
        this.close();
      } catch (err) { fail(err); refresh(); }
    });
    later.addEventListener('click', () => { try { this.dismiss(); } catch (err) { fail(err); } });
    undo.addEventListener('click', async () => {
      undo.disabled = true;
      try {
        const r = await this.undo();
        window.showToast?.(this._plural(r.off.length) + ' ' + this._t('turned back off') + (r.failed.length ? ' — ' + r.failed.length + ' ' + this._t('could not be') : ''), r.failed.length ? 'error' : 'info');
        this.close();
      } catch (err) { fail(err); undo.disabled = false; }
    });
    c.onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } };
    document.addEventListener('keydown', c.onKey, true);
    el.addEventListener('mousedown', (e) => { if (e.target === el) this.close(); });
    document.body.appendChild(el);
    if (typeof VexLayer !== 'undefined') VexLayer.track(el, { tier: 'dialog', id: 'feature-packs', close: () => this.close() });
    (list.querySelector('input') || later).focus({ preventScroll: true });
    if (state.dismissedAt) status.textContent = this._t('You chose "Not now" earlier. This screen is here whenever you want it.');
    return c;
  },

  // Joins the Attention Inbox (the row's button), and offers once. Called when the module loads and again from the
  // start-up staging chain (js/app.js), whichever comes second finds the work done.
  start() {
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle(this.FEATURE, (key) => { if (key === 'open') this.open(); });
    }
    const staging = typeof VexRegistry !== 'undefined' && VexRegistry._staging ? VexRegistry._staging : Promise.resolve();
    return staging.then(() => this.maybeOffer()).catch(err => window.VexProblems?.note('Feature packs', 'Could not offer the feature packs', err));
  },
};

// The words a rule looks at: the catalogue's name and the manifest's own title and group.
function words(entry, m) {
  return [entry && entry.name, m && m.title, m && m.group].filter(Boolean).join(' ');
}

if (typeof window !== 'undefined') {
  window.VexFeaturePacks = VexFeaturePacks;
  if (typeof document !== 'undefined') VexFeaturePacks.start();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFeaturePacks };
