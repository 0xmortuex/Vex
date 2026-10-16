// === Wiring between the 2026-10 feature modules ==============================
//
// Each feature was built on its own. This file holds the few joins that belong
// to none of them and that must not depend on load order or on the feature
// being present:
//
//   VexNewTab.snapshot()      what the New Tab page may show beyond the brief,
//                             bounded, handed in with the Today snapshot
//                             (js/today.js -> window.__vexToday.newtab). The
//                             start page is a separate document with its own
//                             storage, so everything it needs is in this value.
//   VexIntegration.init()     sets VexTimeTravel.briefProvider and adds the
//                             Settings entries for features that only had a
//                             command (Web safety, Vex Packs, Time travel).
//
// Everything here is OFF unless the person turned the feature on: a snapshot
// with nothing enabled is `{ v: 1 }`.
const VexNewTab = {
  MAX_JSON: 16 * 1024,      // the whole value, serialised
  MAX_WIDGETS: 8,
  MAX_SVG: 6000,
  MAX_TEXT_WIDGETS: 4,
  _textWidgets: new Map(),

  // A feature adds a few plain words to the New Tab shelf (a reset countdown, an
  // incident, a drop ending): fn() -> an array of lines, or []. Bounded here:
  // MAX_TEXT_WIDGETS lines in all, 200 characters each, text only. The page is
  // a separate document and is never given anything else from the feature.
  addTextWidget(id, fn) {
    if (!/^[a-z][a-z0-9-]{1,48}$/.test(String(id || ''))) throw new Error('A New Tab text line needs an id of lowercase letters, digits and dashes');
    if (typeof fn !== 'function') throw new Error('A New Tab text line needs a function');
    this._textWidgets.set(id, fn);
  },
  _text() {
    const out = [];
    for (const [id, fn] of this._textWidgets) {
      let lines;
      try { lines = fn(); } catch (err) { console.error('[NewTab] text line "' + id + '" could not be read:', err); continue; }
      for (const l of (Array.isArray(lines) ? lines : [])) {
        const text = String(l == null ? '' : l).replace(/\s+/g, ' ').trim().slice(0, 200);
        if (text) out.push({ type: id, text });
        if (out.length >= this.MAX_TEXT_WIDGETS) return out;
      }
    }
    return out;
  },

  // What the time-of-day profile says, as an ordering hint only.
  _profile() {
    if (typeof VexTimeOfDay === 'undefined' || typeof VexTimeOfDay.snapshot !== 'function') return null;
    const s = VexTimeOfDay.snapshot();
    if (!s || !s.enabled) return null;
    return { profile: String(s.profile), label: String(s.label || '') };
  },

  _quiet() {
    try { if (localStorage.getItem('vex.fun.quiet') === '1') return true; } catch { return false; }
    return typeof VexPlayfulness !== 'undefined' && VexPlayfulness.isOff();
  },

  _pet() {
    if (typeof VexPet === 'undefined' || typeof VexProgress === 'undefined') return null;
    if (!VexProgress.enabled('pet') || !VexProgress.allows('pet')) return null;
    const s = VexPet.snapshot();
    if (!s || !s.enabled || typeof s.svg !== 'string' || !s.svg || s.svg.length > this.MAX_SVG) return null;
    return { label: String(s.label), svg: s.svg };
  },

  // The shelf, as text. A component is drawn into a detached element and its
  // words are read back, so the start page needs none of the widget code and a
  // habit tap stays a browser-side thing. A photo carries too much to hand over.
  _widgets() {
    if (typeof VexDelights === 'undefined' || !VexDelights.isOn('widgets')) return null;
    if (typeof VexWidgets === 'undefined') return null;
    let list;
    try { list = VexWidgets.list(); } catch (err) { console.error('[NewTab] the widget shelf could not be read:', err); return null; }
    const out = [];
    for (const w of (Array.isArray(list) ? list : []).slice(0, this.MAX_WIDGETS)) {
      if (!w || w.type === 'photo') continue;
      const el = document.createElement('div');
      let handle = null;
      try {
        handle = VexWidgets.mount(el, { id: w.id, type: w.type, cfg: w.cfg }, {});
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (text) out.push({ type: String(w.type), text });
      } catch (err) {
        console.error('[NewTab] widget "' + w.type + '" could not be drawn:', err);
      } finally {
        try { if (handle && typeof handle.dispose === 'function') handle.dispose(); } catch { /* detached element */ }
      }
    }
    return out.length ? out : null;
  },

  // The living layers: only the settings they need, never the whole record.
  _living() {
    if (typeof VexLiving === 'undefined' || typeof VexLiving.read !== 'function') return null;
    const s = VexLiving.read();
    const world = s.world !== 'off';
    if (!world && !s.weatherLayer) return null;
    return {
      settings: { animations: s.animations !== false, world: s.world, weatherLayer: !!s.weatherLayer, weatherManual: s.weatherManual },
    };
  },

  // The shelf plus the text lines features added, together at most MAX_WIDGETS + MAX_TEXT_WIDGETS.
  _allWidgets() {
    const shelf = this._widgets() || [];
    const extra = this._text();
    const all = extra.concat(shelf);   // the start page shows the first 8, so what a feature says comes first
    return all.length ? all : null;
  },

  snapshot() {
    const out = { v: 1, quiet: this._quiet() };
    const parts = { profile: () => this._profile(), pet: () => this._pet(), widgets: () => this._allWidgets(), living: () => this._living() };
    for (const [k, fn] of Object.entries(parts)) {
      let v = null;
      try { v = fn(); } catch (err) { console.error('[NewTab] "' + k + '" could not be read:', err); }
      if (v) out[k] = v;
    }
    // Quiet means nothing moves or draws: the page is given no living layer, no pet.
    if (out.quiet) { delete out.pet; delete out.living; }
    // Bounded: drop the heavy parts rather than hand over an oversized value.
    for (const drop of ['widgets', 'pet', 'living']) {
      if (JSON.stringify(out).length <= this.MAX_JSON) break;
      delete out[drop];
    }
    return out;
  },
};

const VexIntegration = {
  _wired: false,

  // The last Morning Brief, as the short lines the time-travel journal keeps.
  briefLines() {
    const last = typeof VexBrief !== 'undefined' ? VexBrief._last : null;
    const secs = (last && Array.isArray(last.sections)) ? last.sections : [];
    const lines = [];
    for (const s of secs) {
      const first = Array.isArray(s.items) && s.items[0] ? s.items[0].text : (s.summary || '');
      if (s.title && first) lines.push(String(s.title).slice(0, 60) + ': ' + String(first).slice(0, 140));
      if (lines.length >= 8) break;
    }
    return lines;
  },

  _entry(id, title, info, label, run) {
    return {
      id, title, keywords: info,
      build(el) {
        const p = document.createElement('p');
        p.className = 'setting-info';
        p.textContent = info;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-primary';
        b.textContent = label;
        b.addEventListener('click', () => {
          try { run(); } catch (err) { window.showToast?.((err && err.message) || String(err), 'error'); }
        });
        el.append(p, b);
      },
    };
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof VexTimeTravel !== 'undefined') VexTimeTravel.briefProvider = () => this.briefLines();
    if (typeof VexSettingsGroups !== 'undefined') {
      const add = (def) => VexSettingsGroups.register(def);
      if (typeof WebSafetyUI !== 'undefined' && typeof WebSafetyUI.open === 'function') {
        add(this._entry('web-safety', 'Web safety',
          'Fake addresses, risky downloads and sites that ask for too much are checked on this computer. Choose how often Vex warns, and which sites you trust.',
          'Open Web safety', () => WebSafetyUI.open()));
      }
      if (typeof VexPacks !== 'undefined' && typeof VexPacks.open === 'function') {
        add(this._entry('vex-packs', 'Vex Packs',
          'Themes, aliases, quotes and other small packs. Each is checked before it installs and can be switched off or removed.',
          'Open Vex Packs', () => VexPacks.open()));
      }
      if (typeof VexTimeTravel !== 'undefined' && typeof VexTimeTravel.open === 'function') {
        add(this._entry('time-travel', 'Time travel',
          'See what was open and written a day ago, and bring a tab or a note back. Kept on this computer.',
          'Open Time travel', () => VexTimeTravel.open()));
      }
    }
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexNewTab = VexNewTab;
  window.VexIntegration = VexIntegration;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => VexIntegration.init());
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexNewTab, VexIntegration };
