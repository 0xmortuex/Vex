// === "What I changed": every setting that is not at its default (T3-038) =======
//
// Settings has well over a hundred switches. After a year nobody remembers which ones they moved.
// This lists the ones that differ from how Vex ships them, each with a Revert button and one
// "Revert all", read from two places:
//
//   1. Settings itself: every switch and dropdown that has an id (VexSettingsControl.controls) is
//      compared with the value it is built with (the checked / selected attribute in index.html).
//      Reverting sets the real control and fires its change event, so the code that already saves
//      that setting saves the revert; nothing here writes a setting of its own.
//   2. The feature registry: a feature whose manifest says it is ON in the standard tier but that you
//      switched off, and one the standard tier leaves OFF that you switched on. A 'new' feature that
//      arrived off for an existing profile is not a change you made, so it is not listed. While
//      Minimal Vex is on nothing is listed from here (it switched them).
//
// Two more parts (Wave 5):
//   * a row of the Settings sections you open most (the category chips you press are counted, on this
//     computer, 60 sections at most), at the top of the list, each a button that takes you there;
//   * a preview of what a Saved Setup would change: setupDiff() compares a setup code with the setup you
//     have now (theme, look, hidden panels, shortcut bar, skin, fonts), and the Setup Gallery shows the
//     lines in the confirm before it applies one. Nothing is applied without that press.

const VexChanges = {
  PREF: 'vex.changes.enabled',
  SECTIONS_KEY: 'vex.changes.sections',    // { [chipKey]: { n, at, name } }
  MAX_SECTIONS: 60,
  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  // ---- the sections you open most ---------------------------------------------------------------------
  sectionsRecord() {
    const raw = localStorage.getItem(this.SECTIONS_KEY);
    if (raw == null) return {};
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The count of Settings sections could not be read', { cause: err }); }
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  },
  // A category chip in Settings was pressed.
  noteSection(key, name, now = Date.now()) {
    if (!this.enabled() || !key) return false;
    const all = this.sectionsRecord();
    const e = all[key] || { n: 0, at: 0, name: '' };
    e.n = Math.min(9999, e.n + 1); e.at = now; e.name = String(name || key).slice(0, 60);
    all[key] = e;
    const keys = Object.keys(all);
    if (keys.length > this.MAX_SECTIONS) keys.sort((a, b) => all[a].n - all[b].n || all[a].at - all[b].at).slice(0, keys.length - this.MAX_SECTIONS).forEach(k => { delete all[k]; });
    localStorage.setItem(this.SECTIONS_KEY, JSON.stringify(all));
    return true;
  },
  // -> [{ key, name, n }] most opened first, ties by the one opened last.
  mostUsed(limit = 5) {
    const all = this.sectionsRecord();
    return Object.entries(all).filter(([, e]) => e && e.n >= 2).sort((a, b) => b[1].n - a[1].n || b[1].at - a[1].at).slice(0, limit).map(([key, e]) => ({ key, name: e.name || key, n: e.n }));
  },
  clearSections() { localStorage.removeItem(this.SECTIONS_KEY); },
  // Opens Settings at that category.
  openSectionByKey(key) {
    const mgr = typeof SidebarManager !== 'undefined' ? SidebarManager : null;
    if (!mgr || typeof mgr.openPanel !== 'function') throw new Error('Settings cannot be opened from here');
    mgr.openPanel('settings');
    let tries = 0;
    const attempt = () => {
      const chip = Array.from(document.querySelectorAll('.set-nav-chip')).find(c => c.dataset.navKey === key);
      if (chip) { chip.click(); return; }
      if (++tries > 10) { window.showToast?.('That section is no longer in Settings', 'error'); return; }
      requestAnimationFrame(attempt);
    };
    attempt();
  },

  // ---- what a Saved Setup would change ----------------------------------------------------------------------
  // cur and next are decoded setup objects (Onboarding._decodeSetupCode). -> [line, ...], [] when they match.
  setupDiff(cur, next) {
    if (!cur || !next) throw new Error('There is no setup to compare');
    const out = [];
    const list = (a) => (a && a.length ? a.join(', ') : 'none');
    const nm = (id) => { try { const p = Onboarding._APP_PANELS().find(x => x.id === id); return p ? p.name : id; } catch { return id; } };
    if (next.theme && next.theme !== cur.theme) out.push('Theme: ' + (cur.theme || 'default') + ' to ' + next.theme);
    if (!!next.glass !== !!cur.glass) out.push('Look: ' + (cur.glass ? 'Glass' : 'Classic') + ' to ' + (next.glass ? 'Glass' : 'Classic'));
    const hide = (next.hidden || []).filter(p => !(cur.hidden || []).includes(p));
    const show = (cur.hidden || []).filter(p => !(next.hidden || []).includes(p));
    if (hide.length) out.push('Hidden panels: ' + list(hide.map(nm)));
    if (show.length) out.push('Panels shown again: ' + list(show.map(nm)));
    const sc = (a) => (a == null ? null : a.map(s => s.name + '|' + s.url).join('\n'));
    if (sc(next.shortcuts) !== sc(cur.shortcuts)) out.push('Shortcut bar: ' + (cur.shortcuts == null ? 'the stock set' : cur.shortcuts.length + ' shortcuts') + ' to ' + (next.shortcuts == null ? 'the stock set' : next.shortcuts.length + ' shortcuts'));
    for (const k of ['pattern', 'shape', 'glow', 'strength']) {
      if (next.skin && next.skin[k] && (!cur.skin || cur.skin[k] !== next.skin[k])) out.push('Skin ' + k + ': ' + ((cur.skin && cur.skin[k]) || 'default') + ' to ' + next.skin[k]);
    }
    for (const k of ['ui', 'mono']) {
      if (next.font && next.font[k] && (!cur.font || cur.font[k] !== next.font[k])) out.push((k === 'ui' ? 'Font' : 'Code font') + ': ' + ((cur.font && cur.font[k]) || 'default') + ' to ' + next.font[k]);
    }
    return out;
  },
  // The lines for applying `code`, against the setup in front. Throws when the code is not one.
  previewSetup(code) {
    if (typeof Onboarding === 'undefined') throw new Error('The setup reader is not loaded');
    const next = Onboarding._decodeSetupCode(code);
    if (!next) throw new Error('That is not a valid setup code');
    const cur = Onboarding._decodeSetupCode(Onboarding._encodeSetupCode());
    return this.setupDiff(cur, next);
  },

  // -> [{ id, label, section, kind, now, nowText, def, defText }]
  controls(root) {
    if (typeof VexSettingsControl === 'undefined') throw new Error('The settings reader is not loaded');
    const rows = [];
    for (const c of VexSettingsControl.controls(root)) {
      const el = c.el;
      if (!el.id) continue;                                   // no id: it cannot be found again to revert
      // Controls a module draws at run time are set by script, so the page has no default to compare with.
      if (el.closest('[id^="vex-sg-"], .vex-module-group-body')) continue;
      let def, defText, now, nowText;
      if (c.kind === 'toggle') {
        def = !!el.defaultChecked; now = !!el.checked;
        if (def === now) continue;
        defText = def ? 'On' : 'Off'; nowText = now ? 'On' : 'Off';
      } else {
        const opts = Array.from(el.options);
        const d = opts.find(o => o.defaultSelected) || opts[0];
        if (!d) continue;
        def = d.value; now = el.value;
        if (def === now) continue;
        defText = d.textContent.trim();
        const cur = el.selectedOptions[0];
        nowText = cur ? cur.textContent.trim() : String(now);
      }
      const group = el.closest('.setting-group');
      const head = group && group.querySelector('.setting-label');
      rows.push({ id: el.id, label: c.label, section: head ? head.textContent.trim().split('\n')[0].trim() : '', kind: c.kind, now, nowText, def, defText });
    }
    return rows;
  },

  // -> [{ id, title, group, now, def }]
  features() {
    if (typeof VexUsage === 'undefined' || typeof VexRegistry === 'undefined') return [];
    if (typeof VexMinimalMode !== 'undefined' && VexMinimalMode.isOn()) return [];
    const out = [];
    for (const f of VexUsage.features()) {
      if (!VexRegistry.has(f.id)) continue;
      const m = VexRegistry.get(f.id);
      if (m.killSwitch === 'none') continue;
      const def = VexRegistry.tierDefault(f.id, 'standard');
      const now = VexUsage.isEnabled(f.id);
      if (now === def) continue;
      if (!now && def && m.maturity !== 'stable') continue;    // new/beta features arrive off: not a choice made
      out.push({ id: f.id, title: f.title, group: m.group || '', now, def });
    }
    return out;
  },

  async revertControl(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error('That setting is no longer there');
    const row = this.controls().find(r => r.id === id);
    if (!row) return false;                                   // already at its default
    VexSettingsControl._set({ el, kind: row.kind }, row.def);
    return true;
  },

  async revertFeature(id) {
    const f = VexUsage.get(id);
    if (!f) throw new Error('That feature is not registered');
    const def = VexRegistry.tierDefault(id, 'standard');
    if (def) await f.enable(); else await f.disable();
    return true;
  },

  async revertAll() {
    const failed = [];
    let n = 0;
    for (const r of this.controls()) {
      try { if (await this.revertControl(r.id)) n++; } catch (err) { failed.push(r.label + ': ' + err.message); }
    }
    for (const r of this.features()) {
      try { if (await this.revertFeature(r.id)) n++; } catch (err) { failed.push(r.title + ': ' + err.message); }
    }
    if (failed.length) throw new Error('Reverted ' + n + ', but ' + failed.length + ' would not go back: ' + failed.join('; '));
    return n;
  },

  open() {
    if (!this.enabled()) { window.showToast?.('What I changed is switched off in Settings', 'info'); return; }
    const { body } = VexSettingsGroups.dialog({ id: 'vex-changes', title: 'What I changed', sub: 'Settings that are not at the way Vex ships them. Compared with how Settings is built, so a setting Vex changed for you is not counted.' });
    const draw = () => {
      body.textContent = '';
      // The sections you open most, one press away.
      let top = [];
      try { top = this.mostUsed(); } catch (err) { body.appendChild(VexSettingsGroups.note('Could not read your most used sections: ' + err.message)); }
      if (top.length) {
        const rowTop = document.createElement('div');
        rowTop.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px';
        rowTop.appendChild(Object.assign(document.createElement('span'), { textContent: 'You open these most:', className: 'vexsr-mode' }));
        for (const s of top) rowTop.appendChild(VexSettingsGroups.button(s.name + ' (' + s.n + ')', () => { try { this.openSectionByKey(s.key); } catch (err) { window.showToast?.(err.message, 'error'); } }, { label: 'Open the ' + s.name + ' settings' }));
        body.appendChild(rowTop);
      }
      let c, f;
      try { c = this.controls(document.getElementById('panel-settings')); f = this.features(); }
      catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      if (!c.length && !f.length) { body.appendChild(VexSettingsGroups.note('Everything is at its default.')); return; }
      const all = VexSettingsGroups.button('Revert all (' + (c.length + f.length) + ')', async () => {
        const ok = await window.vexConfirm({ title: 'Revert every change?', message: 'This puts ' + (c.length + f.length) + ' setting' + (c.length + f.length === 1 ? '' : 's') + ' back to the default.', okLabel: 'Revert all' });
        if (!ok) return;
        try { const n = await this.revertAll(); window.showToast?.('Reverted ' + n + ' setting' + (n === 1 ? '' : 's')); }
        catch (err) { window.showToast?.(err.message, 'error'); }
        draw();
      }, { danger: true });
      body.appendChild(all);
      const add = (label, detail, revert, show) => {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        text.textContent = label + '  ' + detail;
        const rv = VexSettingsGroups.button('Revert', async () => {
          try { await revert(); } catch (err) { window.showToast?.(err.message, 'error'); }
          draw();
        }, { label: 'Revert ' + label + ' to the default' });
        row.append(text);
        if (show) row.append(VexSettingsGroups.button('Show', show, { label: 'Show ' + label + ' in Settings' }));
        row.append(rv);
        body.appendChild(row);
      };
      for (const r of c) add(r.label, '(' + (r.section ? r.section + ': ' : '') + r.nowText + ', default ' + r.defText + ')', () => this.revertControl(r.id), () => { if (typeof SettingsUI !== 'undefined') SettingsUI.openSection(r.id); });
      for (const r of f) add(r.title, '(feature ' + (r.now ? 'on' : 'off') + ', default ' + (r.def ? 'on' : 'off') + ')', () => this.revertFeature(r.id));
    };
    draw();
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Lists every switch and dropdown you have moved from its default, with a Revert for each and one for all. Ctrl+K › What I changed.'));
    el.appendChild(VexSettingsGroups.button('Show what I changed', () => this.open(), { primary: true }));
    el.appendChild(VexSettingsGroups.button('Forget which sections I open most', () => { try { this.clearSections(); window.showToast?.('Forgotten'); } catch (err) { window.showToast?.(err.message, 'error'); } }));
  },
};

if (typeof window !== 'undefined') {
  window.VexChanges = VexChanges;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'what-i-changed', title: 'What I changed', keywords: 'changed defaults revert reset differ settings modified', before: 'about', build: (el) => VexChanges.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'what-i-changed', label: 'What I changed', hint: 'Every setting that is not at its default, with Revert', icon: 'settings', action: () => VexChanges.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexChanges };
