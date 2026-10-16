// === What a feature touches: permission summary, reset, first-use sheet (T3-091) ====
//
// Every feature declares in its manifest (js/feature-manifests.js) what it
// READS, WRITES and SENDS off this computer, which storage keys it owns, which
// jobs and commands it runs. This reads those manifests and gives them back to
// the person in three places:
//
//   1. a permission summary: Settings > "What each feature touches" lists every
//      feature with those lines (and the Library's "What it touches" block, via
//      linesForCatalog);
//   2. "Reset this feature": lists exactly which stored data would go (its own
//      keys, with sizes; data it only uses and another feature owns is never
//      touched), asks through the shared preview list, then deletes. The data
//      is kept in memory until you close Vex, so Undo brings it back. The notes,
//      bookmarks and read-later list, the preference file and the records the
//      registry itself needs cannot be reset from here;
//   3. a first-use sheet: the first time you use a NEW or BETA feature, a small
//      card says what it does, what it touches and how to turn it off. Once per
//      feature, at most one every ten minutes, never in a private window or
//      while a game has the screen.
const VexFeatureSheet = {
  SEEN_KEY: 'vex.firstUse.seen',
  PREF: 'vex.firstUse.enabled',
  PROTECTED: ['library-data', 'preference-store', 'defaults-consents', 'feature-registry'],
  GAP_MS: 10 * 60 * 1000,
  _lastShownAt: 0,
  _undo: null,
  _now() { return Date.now(); },

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save the setting: ' + err.message); }
    return !!on;
  },

  _manifest(id) {
    if (typeof VexRegistry === 'undefined') throw new Error('The feature manifests are not loaded (js/feature-registry.js)');
    return VexRegistry.get(id);
  },

  // ---- 1. the permission summary --------------------------------------------------------
  lines(id) {
    const m = this._manifest(id);
    if (!m) throw new Error('No feature "' + id + '" has a manifest');
    return VexRegistry.permissionLines(id);
  },
  // The catalogue id (feature-catalog.js) is the manifest id, or named by the manifest's `catalog`.
  linesForCatalog(catalogId) {
    if (typeof VexRegistry === 'undefined') return [];
    const m = VexRegistry.all().find(x => x.id === catalogId || x.catalog === catalogId);
    return m ? VexRegistry.permissionLines(m.id) : [];
  },

  // ---- 2. reset -------------------------------------------------------------------------------
  // The localStorage keys a feature owns right now: exact keys, and every key under a prefix claim.
  ownedKeys(id) {
    const m = this._manifest(id);
    if (!m) throw new Error('No feature "' + id + '" has a manifest');
    const present = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('vex.')) present.push(k); }
    const out = new Set();
    for (const claim of m.storageKeys) {
      if (claim.endsWith('.')) { for (const k of present) if (k.startsWith(claim)) out.add(k); }
      else if (present.includes(claim)) out.add(claim);
    }
    return [...out].sort();
  },
  resettable(id) {
    const m = this._manifest(id);
    if (!m) return { ok: false, why: 'It has no manifest.' };
    if (this.PROTECTED.includes(id)) return { ok: false, why: m.title + ' holds data Vex needs to run (or that you made yourself), so it cannot be reset from here.' };
    if (!m.storageKeys.length) return { ok: false, why: m.title + ' keeps nothing of its own.' };
    return { ok: true, why: '' };
  },

  // Deletes the data; keeps it in memory for Undo. -> { removed, undo() }
  clear(id) {
    const r = this.resettable(id);
    if (!r.ok) throw new Error(r.why);
    const keys = this.ownedKeys(id);
    const kept = {};
    for (const k of keys) kept[k] = localStorage.getItem(k);
    for (const k of keys) localStorage.removeItem(k);
    const undo = () => { for (const [k, v] of Object.entries(kept)) if (v !== null) localStorage.setItem(k, v); };
    this._undo = { id, undo };
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:feature-reset', { detail: { id, keys } }));
    return { removed: keys, undo };
  },

  async reset(id) {
    const m = this._manifest(id);
    const r = this.resettable(id);
    if (!r.ok) { window.showToast?.(r.why, 'info'); return false; }
    const keys = this.ownedKeys(id);
    if (!keys.length) { window.showToast?.(m.title + ' has nothing stored right now.', 'info'); return false; }
    const plan = await VexPlan.confirm({
      title: 'Delete the data of "' + m.title + '"?',
      intro: 'These stored items go, and the feature starts again as if new. Anything else stays. You can undo this until you close Vex. Some features keep a copy in memory: restart Vex to see it fully reset.',
      items: keys.map(k => ({ id: k, label: k, detail: Math.round(String(localStorage.getItem(k) || '').length / 102.4) / 10 + ' KB' })),
      okLabel: 'Delete this data', noun: 'item', selectable: false, danger: true,
    });
    if (!plan.ok) return false;
    const done = this.clear(id);
    if (typeof VexUndo !== 'undefined') VexUndo.offer({ message: m.title + ' was reset', undo: () => done.undo(), ms: 30000 });
    return true;
  },

  // ---- 3. first use ---------------------------------------------------------------------------
  _seen() {
    let raw = null;
    try { raw = localStorage.getItem(this.SEEN_KEY); }
    catch (err) { throw new Error('The first-use record could not be read: ' + err.message); }
    if (!raw) return {};
    try { const o = JSON.parse(raw); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
    catch (err) { throw new Error('The first-use record is not readable: ' + err.message); }
  },
  _mark(id) { const s = this._seen(); s[id] = this._now(); localStorage.setItem(this.SEEN_KEY, JSON.stringify(s)); },

  // Should the sheet show for this feature now? Pure over what it is given.
  shouldShow(m, { seen, enabled, now, lastShownAt, privateWindow, gaming }) {
    if (!enabled || !m) return false;
    if (m.maturity === 'stable') return false;
    if (seen[m.id]) return false;
    if (privateWindow || gaming) return false;
    return now - lastShownAt >= this.GAP_MS;
  },

  // Called by VexUsage.touch the first time a feature is used. Never throws into the feature.
  firstUse(id) {
    try {
      if (typeof VexRegistry === 'undefined' || !VexRegistry.has(id)) return false;
      const m = VexRegistry.get(id);
      const ok = this.shouldShow(m, {
        seen: this._seen(), enabled: this.enabled(), now: this._now(), lastShownAt: this._lastShownAt,
        privateWindow: !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow), gaming: typeof GameMode !== 'undefined' && !!GameMode.gaming,
      });
      if (!ok) return false;
      this._mark(id);
      this._lastShownAt = this._now();
      this.showCard(m);
      return true;
    } catch (err) {
      if (typeof VexProblems !== 'undefined') VexProblems.note('First-use sheet', 'Could not show the sheet for ' + id, err); else console.error('[FeatureSheet]', err);
      return false;
    }
  },

  showCard(m) {
    document.querySelector('.vex-firstuse')?.remove();
    const card = document.createElement('div');
    card.className = 'vex-firstuse';
    // A corner card that never takes focus or traps Tab is not a modal dialog, so it must not claim
    // role="dialog" (the UI check requires aria-modal on those, which would hide the page behind it).
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', 'About ' + m.title);
    card.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9000;width:min(380px,92vw);background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 14px 40px var(--vex-shadow-color,rgba(0,0,0,.35));padding:12px 14px';
    const head = document.createElement('div');
    head.style.cssText = 'font-size:13px;font-weight:650;margin-bottom:6px';
    head.textContent = m.title + ' is new. Here is what it touches.';
    const list = document.createElement('ul');
    list.style.cssText = 'margin:0 0 8px;padding-left:18px;font-size:11.5px;color:var(--text-muted)';
    for (const line of VexRegistry.permissionLines(m.id)) { const li = document.createElement('li'); li.textContent = line; list.appendChild(li); }
    const acts = document.createElement('div');
    acts.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    const mk = (label, fn, primary) => { const b = document.createElement('button'); b.type = 'button'; b.className = primary ? 'btn-primary' : 'btn-secondary'; b.style.cssText = 'font-size:11.5px;padding:4px 11px;border-radius:6px;cursor:pointer'; b.textContent = label; b.addEventListener('click', fn); return b; };
    const close = () => card.remove();
    acts.append(mk('Got it', close, true));
    if (m.killSwitch === 'usage') {
      acts.append(mk('Turn this off', async () => {
        try { await VexRegistry.switchOff(m.id); window.showToast?.(m.title + ' is off. Settings > Usage can turn it back on.', 'info'); close(); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      }));
    }
    card.append(head, list, acts);
    document.body.appendChild(card);
    return card;
  },

  // ---- the Settings section ------------------------------------------------------------------------
  group(el) {
    el.appendChild(VexSettingsGroups.note('What each feature reads, writes and sends off this computer, from the description it ships with. "Reset" deletes only the data that feature owns, after showing you the list; you can undo it until you close Vex.'));
    const all = VexRegistry.all().slice().sort((a, b) => (a.group || a.title).localeCompare(b.group || b.title) || a.title.localeCompare(b.title));
    const box = document.createElement('div');
    box.className = 'vexsr-list';
    for (const m of all) {
      const d = document.createElement('details');
      d.style.cssText = 'margin:2px 0';
      const s = document.createElement('summary');
      s.textContent = m.title + (m.maturity !== 'stable' ? ' (' + VexRegistry.maturityLabel(m.id) + ')' : '');
      d.appendChild(s);
      const ul = document.createElement('ul');
      ul.style.cssText = 'margin:4px 0 4px 18px;padding:0;font-size:11.5px;color:var(--text-muted)';
      for (const line of VexRegistry.permissionLines(m.id)) { const li = document.createElement('li'); li.textContent = line; ul.appendChild(li); }
      if (m.storageKeys.length) { const li = document.createElement('li'); li.textContent = 'Stores: ' + m.storageKeys.join(', '); ul.appendChild(li); }
      d.appendChild(ul);
      const r = this.resettable(m.id);
      if (r.ok) d.appendChild(VexSettingsGroups.button('Reset ' + m.title + '…', () => this.reset(m.id).catch(err => window.showToast?.(err.message, 'error')), { danger: true }));
      box.appendChild(d);
    }
    el.appendChild(box);
  },
};

if (typeof window !== 'undefined') {
  window.VexFeatureSheet = VexFeatureSheet;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'feature-sheet', title: 'What each feature touches', keywords: 'permissions what reads writes sends reset feature delete data privacy first use sheet', before: 'about', build: (el) => VexFeatureSheet.group(el) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFeatureSheet };
