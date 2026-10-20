// === The pop-up after an update: every new feature, with its switch, why it is there and how to use it ======
//
// Every update used to say "what's new" in a few lines and leave the rest to Settings. After an update that added features, a pop-up now
// lists each of them, one block per feature:
//
//   * a switch, to turn it on or off right there (nothing is switched on for you: a new feature starts off on a profile that existed before),
//   * why it is there and what it does, how to use it, and what it reads, writes and sends off this computer,
//   * a way into its own Settings,
//
// and, below, the fixes of the update explained. It is offered once per update and closing it any way is final for that update.
//
// Which features are "new" is found two ways, so no one has to remember to list them:
//   * the ones the release notes name with a trailing "(feature: id)" (RELEASING.md), with the sentence the notes say about them, and
//   * every feature Vex did not have at the last start: vex.featuresKnown keeps the list from then (js/feature-registry.js knows them all).
//
// The words come from the feature's own description (VexActivation.describe, js/feature-catalog.js, js/feature-details.js), the same ones
// the "switched off" offer and Discover use. They are written in English; the frame around them follows the language Vex is set to.
const VexUpdateTour = {
  KNOWN_KEY: 'vex.featuresKnown',
  MAX: 12,
  MAX_FIXES: 10,
  DIALOG_ID: 'vex-update-tour',

  _note(message, err) {
    if (typeof VexProblems !== 'undefined') VexProblems.note('Update pop-up', message, err);
    else console.error('[update-tour] ' + message + ':', err && err.message);
  },
  _L(s) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup && VexI18nUI.lookup(s)) || s; },
  _fill(s, vars) { let t = s; for (const k of Object.keys(vars || {})) t = t.split('{' + k + '}').join(String(vars[k])); return t; },

  // ---- which features are new -------------------------------------------------------------------------------------------------------
  current() {
    if (typeof VexRegistry === 'undefined') throw new Error('The feature list is not loaded');
    return VexRegistry.all().map(m => m.id);
  },
  // The ids seen at the last start, or null when there is no record yet (the first start of this, which only makes the record).
  known() {
    let raw = null;
    try { raw = localStorage.getItem(this.KNOWN_KEY); } catch (err) { this._note('the list of seen features could not be read', err); return null; }
    if (!raw) return null;
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : null; }
    catch (err) { this._note('the list of seen features is not readable and is started again', err); return null; }
  },
  saveKnown(ids = this.current()) {
    try { localStorage.setItem(this.KNOWN_KEY, JSON.stringify(ids)); }
    catch (err) { throw new Error('Could not remember which features you have seen: ' + err.message); }
  },
  // Not there at the last start. Nothing without a record: the first start only makes one.
  fresh() {
    const k = this.known();
    if (!k) return [];
    const have = new Set(k);
    return this.current().filter(id => !have.has(id));
  },
  // Quietly keeps the record up to date when there is no update to tell about.
  syncKnown() {
    let pending = null;
    try { pending = localStorage.getItem('vex.whatsNewPending'); } catch (err) { this._note('could not tell whether an update is waiting', err); return false; }
    if (pending) return false;               // an update is about to be shown: the pop-up keeps the old record until it has been
    this.saveKnown();
    return true;
  },

  // "pick a shape. Try: Settings > Mouse cursor." -> { why: 'pick a shape.', how: 'Settings > Mouse cursor.' }
  splitTry(detail) {
    const m = /^([\s\S]*?)\s*\bTry:\s*([\s\S]*)$/.exec(String(detail || ''));
    return m ? { why: m[1].trim(), how: m[2].trim() } : { why: String(detail || '').trim(), how: '' };
  },

  // The features to list, tagged ones first (newest release first), then the ones Vex did not have before. Each once.
  collect(entries) {
    if (typeof VexRegistry === 'undefined' || typeof VexUpdateNotes === 'undefined') return [];
    const have = new Set(VexRegistry.all().map(m => m.id));
    const out = new Map();
    for (const e of entries || []) {
      for (const it of VexUpdateNotes.items(e && e.body)) {
        if (it.feature && have.has(it.feature) && !out.has(it.feature)) out.set(it.feature, { id: it.feature, lead: it.lead, ...this.splitTry(it.detail), tagged: true });
      }
    }
    for (const id of this.fresh()) if (!out.has(id)) out.set(id, { id, lead: '', why: '', how: '', tagged: false });
    return [...out.values()];
  },
  // The points of the update that are not about a feature, explained.
  fixes(entries) {
    const out = [];
    for (const e of entries || []) {
      for (const it of VexUpdateNotes.items(e && e.body)) {
        if (!it.feature) out.push({ lead: it.lead, detail: it.detail });
        if (out.length >= this.MAX_FIXES) return out;
      }
    }
    return out;
  },

  // ---- the switch -------------------------------------------------------------------------------------------------------------------
  // How a feature is switched, or null when it has no switch here (it is part of Vex): through the usage record, the sidebar, or the
  // checkbox in Settings. Turning on goes through the same check the "switched off" offer uses (Minimal Vex, quiet modes).
  capability(entry, id) {
    let m = null;
    try { m = VexRegistry.all().find(x => x.id === id) || null; } catch (err) { this._note('the feature list could not be read', err); }
    const usage = typeof VexUsage !== 'undefined' ? VexUsage : null;
    const item = entry || { id, feature: id };
    if (usage && m && m.killSwitch !== 'none' && usage.get(id)) {
      return {
        kind: 'usage',
        on: () => !!usage.isEnabled(id),
        set: async (on) => {
          if (on) { const off = VexFeatures.offState(item); if (off) await off.enable(); }
          else await VexRegistry.switchOff(id);
        },
      };
    }
    if (entry && entry.panel && typeof SidebarManager !== 'undefined' && typeof SidebarManager.setPanelOverride === 'function') {
      const hidden = () => {
        try { const ov = JSON.parse(localStorage.getItem('vex.panelOverrides') || '{}') || {}; return !!(ov[entry.panel] && ov[entry.panel].hidden); }
        catch (err) { this._note('the panel choices could not be read', err); return false; }
      };
      return { kind: 'panel', on: () => !hidden(), set: async (on) => { SidebarManager.setPanelOverride(entry.panel, { hidden: !on }); } };
    }
    const box = entry && entry.setting && entry.setting.id ? document.getElementById(entry.setting.id) : null;
    if (box && box.type === 'checkbox') {
      return { kind: 'checkbox', on: () => box.checked, set: async (on) => { box.checked = on; box.dispatchEvent(new Event('change', { bubbles: true })); } };
    }
    return null;
  },

  // ---- the pop-up ---------------------------------------------------------------------------------------------------------------------
  // -> true when it was shown. entries: the release entries the update covers. onClose: called once, when it closes any way.
  async open({ entries, version, onClose, preview = false } = {}) {
    if (typeof VexRegistry === 'undefined' || typeof VexActivation === 'undefined' || typeof VexFeatures === 'undefined' || typeof VexSettingsGroups === 'undefined') return false;
    let feats = this.collect(entries);
    if (preview && !feats.length) feats = this.current().slice(-6).map(id => ({ id, lead: '', why: '', how: '', tagged: false }));
    if (!feats.length) return false;
    const shown = feats.slice(0, this.MAX);
    const more = feats.length - shown.length;
    const infos = await Promise.all(shown.map(f => VexActivation.describe(VexActivation.entryFor(f.id), f.id)));
    const fixes = this.fixes(entries);
    const L = (s, v) => this._fill(this._L(s), v);

    const G = VexSettingsGroups;
    const { overlay, body, close } = G.dialog({
      id: this.DIALOG_ID,
      title: version ? L('Vex {v} is here: what is new, feature by feature', { v: String(version).replace(/^v/i, '') }) : L('What is new, feature by feature'),
      sub: L('Each new feature has a switch: turn it on or off right here, and change your mind any time in Settings › Feature usage. A new feature starts off on a profile that existed before, so nothing changes until you choose.'),
    });

    const rows = [];                                   // { cap, input } for "turn all on/off"
    const sec = (card, title, text) => {
      if (!text) return;
      const p = document.createElement('p');
      p.className = 'vex-tour-sec';
      const b = document.createElement('strong');
      b.textContent = title + ' ';
      p.append(b, document.createTextNode(text));
      card.appendChild(p);
    };

    shown.forEach((f, i) => {
      const info = infos[i];
      const entry = VexActivation.entryFor(f.id);
      const cap = this.capability(entry, f.id);
      const card = document.createElement('section');
      card.className = 'vex-tour-feat';
      const head = document.createElement('div');
      head.className = 'vex-tour-head';
      const name = document.createElement('h3');
      name.className = 'vex-tour-name';
      name.textContent = info.name;
      head.appendChild(name);

      const status = document.createElement('p');
      status.className = 'vex-tour-status';
      status.setAttribute('role', 'status');

      if (cap) {
        const wrap = document.createElement('label');
        wrap.className = 'toggle';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('role', 'switch');
        input.checked = cap.on();
        input.setAttribute('aria-label', L('Turn {title} on or off', { title: info.name }));
        const slider = document.createElement('span');
        slider.className = 'toggle-slider';
        wrap.append(input, slider);
        input.addEventListener('change', async () => {
          const want = input.checked;
          input.disabled = true;
          status.textContent = '';
          try {
            await cap.set(want);
            input.checked = cap.on();
            status.textContent = L(input.checked ? '{title} is on' : '{title} is off', { title: info.name });
          } catch (err) {
            input.checked = cap.on();
            this._note('could not switch ' + f.id + (want ? ' on' : ' off'), err);
            status.textContent = L('Could not change {title}:', { title: info.name }) + ' ' + ((err && err.message) || err);
          } finally { input.disabled = false; }
        });
        head.appendChild(wrap);
        rows.push({ cap, input, info, status });
      } else {
        const fixed = document.createElement('span');
        fixed.className = 'vex-tour-fixed';
        fixed.textContent = L('Part of Vex: no switch');
        head.appendChild(fixed);
      }
      card.appendChild(head);

      const why = [f.lead ? f.lead + (f.why ? ': ' + f.why : '.') : '', info.what, info.more].filter(Boolean).join(' ');
      sec(card, L('Why'), why);
      sec(card, L('How'), f.how || info.how);
      if (info.touches.length) sec(card, L('What it touches'), info.touches.join('. ') + '.');
      card.appendChild(status);
      if (info.settings) {
        card.appendChild(G.button(L('Open its settings'), () => {
          close();
          if (typeof SettingsUI !== 'undefined' && typeof SettingsUI.openSection === 'function') SettingsUI.openSection(info.settings.target);
          else window.showToast?.(L('Settings is not available in this window'), 'error');
        }));
      }
      body.appendChild(card);
    });

    if (more > 0) body.appendChild(G.note(this._fill(L('and {n} more new features. Ctrl+K › What\'s new for me lists them all.'), { n: more })));

    if (fixes.length) {
      const h = document.createElement('h3');
      h.className = 'vex-tour-name vex-tour-fixes-h';
      h.textContent = L('Fixes and changes in this update');
      body.appendChild(h);
      for (const fx of fixes) {
        const d = document.createElement('details');
        d.className = 'vex-tour-fix';
        const s = document.createElement('summary');
        s.textContent = fx.lead;
        d.appendChild(s);
        if (fx.detail) { const p = document.createElement('p'); p.textContent = fx.detail; d.appendChild(p); }
        body.appendChild(d);
      }
    }

    // All on / all off, through each feature's own switch so each one is checked and reports its own refusal.
    const setAll = async (on) => {
      for (const r of rows) {
        if (r.cap.on() === on) continue;
        r.input.checked = on;
        r.input.dispatchEvent(new Event('change'));
        await new Promise(res => setTimeout(res, 0));
      }
    };
    const actions = document.createElement('div');
    actions.className = 'vexsr-actions';
    if (rows.length > 1) {
      actions.appendChild(G.button(L('Turn all on'), () => { setAll(true); }));
      actions.appendChild(G.button(L('Turn all off'), () => { setAll(false); }));
    }
    actions.appendChild(G.button(L('Done'), () => close(), { primary: true }));
    body.appendChild(actions);

    // Closing any way (Done, the X, Escape, a click outside) is final for this update.
    let closed = false;
    const observer = new MutationObserver(() => {
      if (overlay.isConnected || closed) return;
      closed = true;
      observer.disconnect();
      if (!preview) { try { this.saveKnown(); } catch (err) { this._note('the seen features could not be saved', err); } }
      if (onClose) { try { onClose(); } catch (err) { this._note('closing the update pop-up failed', err); } }
    });
    observer.observe(document.body, { childList: true });
    return true;
  },

  // Ctrl+K "Show the new features of this update": the pop-up again, without changing what counts as seen.
  async preview() {
    if (typeof VexUpdateNotes === 'undefined' || !window.vex || typeof window.vex.getReleaseList !== 'function') throw new Error('The release notes are not available in this window');
    const list = await window.vex.getReleaseList();
    if (!Array.isArray(list) || !list.length) throw new Error('The release list could not be read');
    const version = window.vex.getAppVersion ? String(await window.vex.getAppVersion()).replace(/^v/i, '') : '';
    const entries = list.slice(0, 3);
    const shown = await this.open({ entries, version, preview: true });
    if (!shown) window.showToast?.(this._L('No new features to show.'), 'info');
    return shown;
  },
};

if (typeof window !== 'undefined') {
  window.VexUpdateTour = VexUpdateTour;
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'update-tour', label: 'Show the new features of this update', hint: 'Every new feature of the last updates, each with a switch, why it is there and how to use it', icon: 'gift', action: () => { VexUpdateTour.preview().catch(err => window.showToast?.(err.message, 'error')); } });
  }
  // With no update to tell about, the record of seen features is kept up to date quietly, once the late modules are in.
  if (typeof VexBoot !== 'undefined' && typeof VexBoot.whenSettled === 'function') {
    VexBoot.whenSettled().then(() => { try { VexUpdateTour.syncKnown(); } catch (err) { VexUpdateTour._note('the seen features could not be kept up to date', err); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUpdateTour };
