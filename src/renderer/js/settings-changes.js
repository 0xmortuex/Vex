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
// Not done here (deferred): the "most-used sections" row and the preview of what a Saved Setup
// would change; the saved-setup gallery does not expose a diff to read yet.

const VexChanges = {
  PREF: 'vex.changes.enabled',
  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
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
      let c, f;
      try { c = this.controls(document.getElementById('panel-settings')); f = this.features(); }
      catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      if (!c.length && !f.length) { body.appendChild(VexSettingsGroups.note('Everything is at its default.')); return; }
      const all = VexSettingsGroups.button('Revert all (' + (c.length + f.length) + ')', async () => {
        const ok = await window.vexConfirm({ title: 'Revert every change?', message: 'This puts ' + (c.length + f.length) + ' setting' + VexPlural.s(c.length + f.length) + ' back to the default.', okLabel: 'Revert all' });
        if (!ok) return;
        try { const n = await this.revertAll(); window.showToast?.('Reverted ' + n + ' setting' + VexPlural.s(n)); }
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
