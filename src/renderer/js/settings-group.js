// === A Settings group a module owns ========================================
//
// Settings is a long static page (index.html) that SettingsUI.enhance() turns
// into cards and a category menu every time it opens. A module that has a few
// switches of its own should not need an edit in that page: it hands this file
// a title and a function that fills a box, and the group is put into the page
// at start-up — before About, which stays last — in the same markup as the
// groups that are written out by hand, so the search, the menu, Simple mode and
// every look treat it like any other.
//
//   VexSettingsGroup.add({ id: 'settings-foo', title: 'Foo', info: 'What it does',
//                          build(body) { body.append(VexSettingsGroup.toggle(...)); } });
//
// build(body) runs again, on the same box, when the module calls
// VexSettingsGroup.refresh(id) after its data changed.
const VexSettingsGroup = {
  _specs: new Map(),

  root() {
    return typeof document === 'undefined' ? null : document.querySelector('#panel-settings .settings-content');
  },

  // A group is added once; adding the same id again replaces its builder and
  // draws it again.
  add(spec) {
    if (!spec || !/^[a-z][a-z0-9-]*$/.test(String(spec.id || ''))) throw new Error('A Settings group needs an id of lower-case letters, digits and dashes');
    if (!spec.title || typeof spec.build !== 'function') throw new Error('A Settings group needs a title and a build function');
    this._specs.set(spec.id, spec);
    return this._place(spec);
  },

  _place(spec) {
    const root = this.root();
    if (!root) return null;
    let group = document.getElementById(spec.id);
    if (!group) {
      group = document.createElement('div');
      group.className = 'setting-group';
      group.id = spec.id;
      const label = document.createElement('label');
      label.className = 'setting-label';
      label.textContent = spec.title;
      group.appendChild(label);
      if (spec.info) {
        const info = document.createElement('p');
        info.className = 'setting-info muted';
        info.style.marginBottom = '8px';
        info.textContent = spec.info;
        group.appendChild(info);
      }
      const body = document.createElement('div');
      body.dataset.groupBody = '1';
      group.appendChild(body);
      // Before About, which stays last in Settings.
      const about = Array.from(root.children).find(el => el.classList && el.classList.contains('setting-group')
        && /^about\b/i.test(((el.querySelector('.setting-label') || {}).textContent || '').trim()));
      if (about) root.insertBefore(group, about); else root.appendChild(group);
    }
    this._fill(group, spec);
    // The category menu is built from the groups when Settings opens; a group
    // added after that is put in the menu by drawing it again. Before the first
    // open there is nothing to redraw.
    try { if (typeof SettingsUI !== 'undefined' && SettingsUI.enhance && root.parentElement && root.parentElement.querySelector('.set-toolbar')) SettingsUI.enhance(); }
    catch (err) { console.error('[Settings] could not add the ' + spec.title + ' group to the menu:', err); }
    return group;
  },

  _fill(group, spec) {
    const body = group.querySelector('[data-group-body]');
    if (!body) return;
    body.textContent = '';
    try { spec.build(body); }
    catch (err) {
      console.error('[Settings] the ' + spec.title + ' group could not be drawn:', err);
      const p = document.createElement('p');
      p.className = 'setting-info muted';
      p.textContent = 'This section could not be drawn: ' + ((err && err.message) || err);
      body.appendChild(p);
    }
  },

  refresh(id) {
    const spec = this._specs.get(id);
    const group = typeof document === 'undefined' ? null : document.getElementById(id);
    if (spec && group) this._fill(group, spec);
  },

  // --- the small parts the groups are made of -----------------------------
  toggle(label, checked, onChange, hint) {
    const row = document.createElement('div');
    row.className = 'setting-toggle-row';
    const text = document.createElement('span');
    text.textContent = label;
    if (hint) {
      const h = document.createElement('span');
      h.style.cssText = 'color:var(--text-muted);font-size:11px';
      h.textContent = ' · ' + hint;
      text.appendChild(h);
    }
    const sw = document.createElement('label');
    sw.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.setAttribute('aria-label', label);
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    sw.append(input, slider);
    input.addEventListener('change', () => onChange(input.checked));
    row.append(text, sw);
    return row;
  },

  button(label, onClick, kind) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = kind === 'danger' ? 'btn-danger' : 'btn-secondary';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  },

  // A labelled line: name on the left, the control after it.
  field(label, control, id) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0';
    const l = document.createElement('label');
    l.style.cssText = 'font-size:12px;color:var(--text-muted);min-width:110px';
    l.textContent = label;
    if (id) { control.id = id; l.htmlFor = id; }
    if (!control.getAttribute('aria-label')) control.setAttribute('aria-label', label);
    row.append(l, control);
    return row;
  },

  note(text) {
    const p = document.createElement('p');
    p.className = 'setting-info muted';
    p.style.marginTop = '6px';
    p.textContent = text;
    return p;
  },
};

if (typeof window !== 'undefined') window.VexSettingsGroup = VexSettingsGroup;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSettingsGroup };
