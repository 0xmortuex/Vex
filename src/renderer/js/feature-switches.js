// === An on/off switch for every feature (2026-10-29) ===========================
//
// Two places, one switch. Every feature that Vex can switch (VexUsage.register: disable/enable/isEnabled) gets
//   1. a row in Settings > Features: a searchable list of every feature, grouped, one switch each, and
//   2. a switch at the top of its own Settings section.
// Both call VexUsage.enable()/disable(), the same switch Minimal Vex and Feature usage use, so a feature turned off here stays off across
// restarts, loses its Settings section and has its own off() run. A feature that cannot be switched (the plumbing: preference store,
// feature records, storage ledger, your data) is listed as "always on", never given a switch that could break saving.
//
// Turning a feature off from its own section hides that section (VexUsage.applyGroups), so the toast says where to turn it back on and
// has an Undo.
const VexFeatureSwitches = {
  _t(key, fallback) { return (window.VexI18n && window.VexI18n.t(key, fallback)) || fallback; },

  // Every manifest joined with its switch: { id, title, group, switchable, on }. Features that registered a switch with no manifest are listed too.
  rows() {
    const out = new Map();
    const manifests = typeof VexRegistry !== 'undefined' ? VexRegistry.all() : [];
    for (const m of manifests) out.set(m.id, { id: m.id, title: m.title || m.id, group: m.group || m.title || m.id, switchable: false, on: true });
    for (const f of VexUsage.features()) {
      const row = out.get(f.id) || { id: f.id, title: f.title, group: f.group || f.title, switchable: false, on: true };
      row.switchable = true;
      try { row.on = VexUsage.isEnabled(f.id); } catch (err) { console.error('[Features] could not read the switch of "' + f.id + '":', err); row.on = true; }
      out.set(f.id, row);
    }
    return Array.from(out.values()).sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
  },

  // One switch changes one feature; the answer says whether it did, and a failure is shown, never swallowed.
  async set(id, on) {
    try {
      if (on) await VexUsage.enable(id); else await VexUsage.disable(id);
      return true;
    } catch (err) {
      console.error('[Features] could not switch "' + id + '":', err);
      window.showToast?.(this._t('featSwitchFail', 'Could not change it: ') + ((err && err.message) || err), 'error');
      return false;
    }
  },

  _switchRow(title, checked, onChange, label) {
    const row = document.createElement('div');
    row.className = 'setting-toggle-row vex-feature-switch';
    const text = document.createElement('span');
    text.className = 'setting-label-text';
    text.textContent = title;
    const lab = document.createElement('label');
    lab.className = 'toggle';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!checked;
    box.setAttribute('aria-label', label || title);
    box.addEventListener('change', () => onChange(box));
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    lab.append(box, slider);
    row.append(text, lab);
    row._box = box;
    return row;
  },

  // The switch was flipped: do it, put the box back if it failed, and say how to undo an off.
  async _flip(row, box) {
    const wanted = box.checked;
    box.disabled = true;
    const done = await this.set(row.id, wanted);
    box.disabled = false;
    if (!done) { box.checked = !wanted; return; }
    if (!wanted) {
      window.showToast?.(this._t('featOffDone', '{name} is off. Turn it back on in Settings > Feature switches.').split('{name}').join(row.title), 'info', 9000, {
        action: { label: this._t('featUndo', 'Undo'), run: () => { this.set(row.id, true).then(() => this.refresh()); } },
      });
    }
    this.refresh();
  },

  // ---- Settings > Features ------------------------------------------------
  open() {
    const { body } = VexSettingsGroups.dialog({
      id: 'vex-features-dialog',
      title: this._t('featTitle', 'Features'),
      sub: this._t('featSub', 'Every feature of Vex with its on/off switch. A feature that is off loses its Settings section; nothing you made with it is deleted.'),
    });
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'vex-features-search';
    search.placeholder = this._t('featSearch', 'Search features');
    search.setAttribute('aria-label', this._t('featSearch', 'Search features'));
    const summary = document.createElement('p');
    summary.className = 'setting-info';
    const list = document.createElement('div');
    list.className = 'vex-features-list';
    body.append(search, summary, list);
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const rows = this.rows();
      const on = rows.filter(r => r.switchable && r.on).length, switchable = rows.filter(r => r.switchable).length;
      summary.textContent = this._t('featSummary', '{on} of {n} switchable features are on. {fixed} cannot be switched off.')
        .split('{on}').join(on).split('{n}').join(switchable).split('{fixed}').join(rows.length - switchable);
      list.textContent = '';
      let lastGroup = null;
      for (const r of rows) {
        if (q && !(r.title + ' ' + r.group).toLowerCase().includes(q)) continue;
        if (r.group !== lastGroup) {
          lastGroup = r.group;
          const h = document.createElement('div');
          h.className = 'vexsr-sub';
          h.style.marginTop = '12px';
          h.textContent = r.group;
          list.appendChild(h);
        }
        if (r.switchable) {
          const row = this._switchRow(r.title, r.on, (box) => { this._flip({ id: r.id, title: r.title }, box).then(draw); }, r.title);
          row.dataset.feature = r.id;
          list.appendChild(row);
        } else {
          const row = document.createElement('div');
          row.className = 'setting-toggle-row vex-feature-fixed';
          row.dataset.feature = r.id;
          const t = document.createElement('span');
          t.className = 'setting-label-text';
          t.textContent = r.title;
          const f = document.createElement('span');
          f.className = 'setting-info';
          f.textContent = this._t('featAlwaysOn', 'Always on');
          row.append(t, f);
          list.appendChild(row);
        }
      }
      if (!list.children.length) list.appendChild(Object.assign(document.createElement('p'), { className: 'setting-info', textContent: this._t('featNone', 'No feature matches that.') }));
    };
    search.addEventListener('input', draw);
    draw();
    search.focus();
  },

  group(el) {
    const rows = this.rows();
    const switchable = rows.filter(r => r.switchable), on = switchable.filter(r => r.on).length;
    const note = document.createElement('p');
    note.className = 'setting-info';
    note.textContent = this._t('featGroupNote', '{n} features can be switched on and off here, and in each feature\'s own section; {on} are on.')
      .split('{n}').join(switchable.length).split('{on}').join(on);
    el.appendChild(note);
    el.appendChild(VexSettingsGroups.button(this._t('featOpen', 'Open the features list'), () => this.open(), { primary: true }));
  },

  // ---- a switch at the top of each feature's own section -----------------------
  // The same matching as VexUsage.applyGroups (VexUsage.featuresOfSection): by the section's id, else by its heading's group.
  decorate(scope) {
    if (!scope || typeof VexUsage === 'undefined') return;
    const byGroup = new Map();
    for (const f of VexUsage.features()) {
      if (!f.group) continue;
      const key = f.group.toLowerCase();
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(f);
    }
    scope.querySelectorAll('.setting-group').forEach((g) => {
      if (g.dataset.featureSwitches === '1' || g.id === 'vex-sg-features') return;
      const owners = VexUsage.featuresOfSection(g, byGroup);
      if (!owners.length) return;
      g.dataset.featureSwitches = '1';
      const label = g.querySelector(':scope > .setting-label') || g.querySelector('.setting-label');
      const anchor = label && label.parentNode === g ? label : null;
      for (const f of owners.slice().reverse()) {
        let on = true;
        try { on = VexUsage.isEnabled(f.id); } catch (err) { console.error('[Features] could not read the switch of "' + f.id + '":', err); }
        const info = { id: f.id, title: f.title };
        const text = this._t('featSectionSwitch', 'Use {name}').split('{name}').join(f.title);
        const row = this._switchRow(text, on, (box) => { this._flip(info, box); }, text);
        row.dataset.feature = f.id;
        if (anchor && anchor.nextSibling) g.insertBefore(row, anchor.nextSibling); else g.prepend(row);
      }
    });
  },

  // The boxes follow the truth when something else switched a feature (the list, Minimal Vex, Undo).
  refresh() {
    document.querySelectorAll('.vex-feature-switch[data-feature]').forEach((row) => {
      if (!row._box) return;
      try { row._box.checked = VexUsage.isEnabled(row.dataset.feature); } catch (err) { console.error('[Features] could not read a switch:', err); }
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexFeatureSwitches = VexFeatureSwitches;
  if (typeof VexUsage !== 'undefined') {
    if (typeof VexUsage.onGroups === 'function') VexUsage.onGroups((scope) => VexFeatureSwitches.decorate(scope));
    VexUsage.onChange(() => VexFeatureSwitches.refresh());
    // Settings may already be drawn (this module loads when the page is idle): give its sections their switches now.
    VexUsage.applyGroups();
  }
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'features',
      title: 'Feature switches',
      keywords: 'features on off switch turn off turn on enable disable toggle every feature list',
      before: 'feature usage',
      build: (el) => VexFeatureSwitches.group(el),
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFeatureSwitches };
