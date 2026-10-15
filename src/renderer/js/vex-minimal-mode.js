// === Minimal Vex ===========================================================
//
// One switch: every feature that registered with VexUsage (js/vex-usage.js) is
// switched off and its Settings section is hidden. Core browsing — tabs, the
// address bar, bookmarks, history, downloads, passwords, Settings itself — is
// not a registered feature and is not touched.
//
// Switching back restores exactly what was there: the state of each feature is
// written down before it is turned off, and only the ones that were on are
// turned on again. A feature that was already off stays off.
//
// The note is one preference, vex.minimalMode:
//   { v: 1, on: true, at, prior: { <feature id>: true|false } }
// A feature that registers while Minimal mode is on (a module that loads late)
// is taken out of play the same way and written down.
const VexMinimalMode = {
  KEY: 'vex.minimalMode',
  _busy: null,

  _read() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); }
    catch (err) { throw new Error('Minimal mode could not read its note: ' + err.message, { cause: err }); }
    if (!raw) return { v: 1, on: false, at: 0, prior: {} };
    let s;
    try { s = JSON.parse(raw); }
    catch (err) { throw new Error('The Minimal mode note is not readable: ' + err.message, { cause: err }); }
    if (!s || typeof s !== 'object' || s.v !== 1 || typeof s.prior !== 'object' || !s.prior) throw new Error('The Minimal mode note is not in a form Vex knows');
    return s;
  },
  _write(state) {
    try { localStorage.setItem(this.KEY, JSON.stringify(state)); }
    catch (err) { throw new Error('Minimal mode could not save its note: ' + err.message, { cause: err }); }
  },

  isOn() { return this._read().on === true; },

  // What a feature is doing right now, as best Vex can tell.
  _was(feature) { return VexUsage._isOn(feature); },

  _hiddenIds(state) { return Object.keys(state.prior); },
  _refreshHidden(state) { VexUsage.setForcedHidden(state.on ? this._hiddenIds(state) : []); },

  // -> { off: [titles turned off], failed: [{ id, error }] }
  async enter() {
    if (this._busy) return this._busy;
    this._busy = (async () => {
      const state = this._read();
      if (state.on) { this._refreshHidden(state); return { off: [], failed: [] }; }
      const next = { v: 1, on: true, at: Date.now(), prior: {} };
      if (state.restoreOnRegister) next.restoreOnRegister = state.restoreOnRegister;
      const off = [];
      const failed = [];
      for (const f of VexUsage.features()) {
        const was = this._was(f);
        next.prior[f.id] = was;
        if (!was) continue;
        try { await f.disable(); off.push(f.title); }
        catch (err) { failed.push({ id: f.id, error: (err && err.message) || String(err) }); }
      }
      // Written once everything has been tried, so a crash half way leaves the
      // switch off and the features on, not a note that is half true. A feature
      // that would not switch off was not changed: it is left out of `prior`.
      for (const x of failed) delete next.prior[x.id];
      this._write(next);
      this._refreshHidden(next);
      window.dispatchEvent(new CustomEvent('vex-minimal-mode', { detail: { on: true } }));
      return { off, failed };
    })();
    try { return await this._busy; } finally { this._busy = null; }
  },

  // -> { restored: [titles], failed: [{ id, error }] }
  async leave() {
    if (this._busy) return this._busy;
    this._busy = (async () => {
      const state = this._read();
      if (!state.on) return { restored: [], failed: [] };
      const restored = [];
      const failed = [];
      const waiting = { ...(state.restoreOnRegister || {}) };
      for (const [id, was] of Object.entries(state.prior)) {
        const f = VexUsage.get(id);
        if (!f) { if (was) waiting[id] = true; continue; }   // not loaded: put back when it registers
        if (!was) continue;
        try { await f.enable(); restored.push(f.title); }
        catch (err) { failed.push({ id, error: (err && err.message) || String(err) }); waiting[id] = true; }
      }
      // What could not be put back stays on the note, so it is not lost: a
      // feature that registers later is restored then, and the person is told
      // about the ones that failed now.
      const leftover = Object.keys(waiting).length;
      const next = leftover ? { v: 1, on: false, at: 0, prior: {}, restoreOnRegister: waiting } : { v: 1, on: false, at: 0, prior: {} };
      this._write(next);
      VexUsage.setForcedHidden([]);
      window.dispatchEvent(new CustomEvent('vex-minimal-mode', { detail: { on: false } }));
      return { restored, failed };
    })();
    try { return await this._busy; } finally { this._busy = null; }
  },

  // A feature that registers after the switch was thrown.
  _onRegister(feature) {
    let state;
    try { state = this._read(); }
    catch (err) { console.error('[Minimal] could not read the note for a late feature:', err.message); return; }
    if (state.on) {
      if (Object.hasOwn(state.prior, feature.id)) {
        // Known from before a restart: the module's own start-up may have
        // switched it on again, so it is told again (disable() is idempotent).
        this._refreshHidden(state);
        if (state.prior[feature.id]) Promise.resolve().then(() => feature.disable()).catch(err => console.error('[Minimal] could not keep "' + feature.id + '" switched off:', err));
        return;
      }
      const was = this._was(feature);
      state.prior[feature.id] = was;
      try { this._write(state); } catch (err) { console.error('[Minimal]', err.message); return; }
      this._refreshHidden(state);
      if (was) Promise.resolve().then(() => feature.disable()).catch(err => console.error('[Minimal] could not switch off "' + feature.id + '":', err));
    } else if (state.restoreOnRegister && state.restoreOnRegister[feature.id]) {
      delete state.restoreOnRegister[feature.id];
      if (!Object.keys(state.restoreOnRegister).length) delete state.restoreOnRegister;
      try { this._write(state); } catch (err) { console.error('[Minimal]', err.message); return; }
      Promise.resolve().then(() => feature.enable()).catch(err => console.error('[Minimal] could not put "' + feature.id + '" back:', err));
    }
  },

  async toggle() {
    if (this.isOn()) {
      const r = await this.leave();
      return { on: false, ...r };
    }
    const r = await this.enter();
    return { on: true, ...r };
  },

  group(el) {
    let on = false;
    try { on = this.isOn(); }
    catch (err) { el.appendChild(VexSettingsGroups.note('Minimal mode cannot read its own note: ' + err.message)); return; }
    const n = VexUsage.features().length;
    el.appendChild(VexSettingsGroups.note(on
      ? 'Minimal Vex is on: the extras are switched off and their Settings sections are hidden. Tabs, the address bar, bookmarks, history, downloads and passwords are as they always were.'
      : 'Minimal Vex switches off ' + (n ? 'all ' + n + ' optional features' : 'every optional feature') + ' and hides their Settings sections, leaving the browser itself. Switching it off again puts each one back exactly as it was.'));
    const label = document.createElement('label');
    label.className = 'setting-toggle-row';
    const text = document.createElement('span');
    text.textContent = 'Minimal Vex';
    const toggle = document.createElement('span');
    toggle.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'setting-minimal-vex';
    input.checked = on;
    input.setAttribute('aria-label', 'Minimal Vex');
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    toggle.append(input, slider);
    label.append(text, toggle);
    el.appendChild(label);
    input.addEventListener('change', async () => {
      input.disabled = true;
      const want = input.checked;
      try {
        if (want) {
          const r = await this.enter();
          window.showToast?.('Minimal Vex is on' + (r.failed.length ? ' — ' + r.failed.length + ' feature(s) would not switch off' : ''), r.failed.length ? 'error' : 'info');
        } else {
          const r = await this.leave();
          window.showToast?.('Minimal Vex is off: ' + r.restored.length + ' feature(s) put back' + (r.failed.length ? ' — ' + r.failed.length + ' could not be' : ''), r.failed.length ? 'error' : 'info');
        }
      } catch (err) {
        input.checked = !want;
        window.showToast?.('Minimal Vex could not be changed: ' + ((err && err.message) || err), 'error');
      }
      input.disabled = false;
      VexSettingsGroups.inject();
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexMinimalMode = VexMinimalMode;
  if (typeof VexUsage !== 'undefined') {
    VexUsage.onRegister(f => VexMinimalMode._onRegister(f));
    // Restart with Minimal mode on: the sections stay hidden from the start.
    try {
      VexMinimalMode._refreshHidden(VexMinimalMode._read());
      // Features that registered before this file loaded.
      for (const f of VexUsage.features()) VexMinimalMode._onRegister(f);
    } catch (err) { console.error('[Minimal]', err.message); }
  }
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'minimal-vex',
      title: 'Minimal Vex',
      keywords: 'minimal simple lean clean quiet turn off extras features declutter bare',
      before: 'about',
      build: (el) => VexMinimalMode.group(el),
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMinimalMode };
