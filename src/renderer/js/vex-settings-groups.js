// === Module-owned Settings sections, added at runtime =========================
//
// A module that owns a Settings section does not edit index.html: it registers
// a builder here and the section is put in the Settings list the next time
// Settings is enhanced (SettingsUI.enhance runs whenever Settings opens).
//
//   VexSettingsGroups.register({
//     id: 'vex-health',                  // unique; the section's element id
//     title: 'Health check',             // its heading, and what the chips/search read
//     keywords: 'repair fix storage',    // extra words the Settings search finds it by
//     before: 'about',                   // optional: sit before the section whose
//                                        //   heading starts with this (default: last)
//     build(el) { el.append(...) },      // fill the section; called on every open
//   });
//
// The section is an ordinary `.setting-group` with a `.setting-label` heading,
// so SettingsUI's chips, tiers, columns and search treat it like any other.
const VexSettingsGroups = {
  _defs: new Map(),

  register(def) {
    if (!def || !/^[a-z][a-z0-9-]{0,63}$/.test(String(def.id || ''))) throw new Error('A Settings section needs an id of lowercase letters, digits and dashes');
    // Two shapes share this one registry: build(el) fills the whole group (the
    // platform tools), render(body) fills the body under a title the registry
    // draws (the per-module groups; their element id is setting-<id>).
    const hasBuild = typeof def.build === 'function', hasRender = typeof def.render === 'function';
    if (!hasBuild && !hasRender) throw new Error('Settings section "' + def.id + '" needs build(el) or render(body)');
    if (!hasBuild && (typeof def.title !== 'string' || !def.title.trim())) throw new Error('A settings group needs a title');
    this._defs.set(def.id, { title: String(def.title || def.id), keywords: String(def.keywords || ''), before: def.before ? String(def.before).toLowerCase() : '', build: hasBuild ? def.build : null, render: hasRender ? def.render : null });
    this._wrap();
    // Settings already drawn: it appears now, not at the next open.
    this.inject();
    return def.id;
  },

  ids() { return Array.from(this._defs.keys()); },

  // Create or refresh every registered group under root (.settings-content).
  mount(root) { return this.inject(root); },

  // Settings reads the groups present when enhance() runs, so ours go in just
  // before it. Wrapped once, whichever module registers first.
  _wrap() {
    if (typeof SettingsUI === 'undefined' || typeof SettingsUI.enhance !== 'function' || SettingsUI._vexGroupsPatched) return;
    const original = SettingsUI.enhance;
    SettingsUI.enhance = function () {
      try { VexSettingsGroups.inject(); } catch (err) { console.error('[Settings] module groups failed:', err); }
      const out = original.apply(this, arguments);
      if (typeof VexUsage !== 'undefined') VexUsage.applyGroups();
      return out;
    };
    SettingsUI._vexGroupsPatched = true;
  },

  // The full-screen card the platform tools share (the Backup screen's look,
  // css/skins.css .vexsr-*). -> { overlay, body, close }. Escape and the X
  // close it; an Escape meant for a vexConfirm on top is left to that dialog.
  dialog({ id, title, sub }) {
    document.getElementById(id)?.remove();
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'vexsr-ov';
    const card = document.createElement('div');
    card.className = 'vexsr-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', id + '-title');
    const head = document.createElement('div');
    head.className = 'vexsr-head';
    const t = document.createElement('span');
    t.className = 'vexsr-title';
    t.id = id + '-title';
    t.textContent = title;
    const x = document.createElement('button');
    x.className = 'vexsr-x';
    x.setAttribute('aria-label', 'Close');
    x.title = 'Close';
    x.innerHTML = (typeof VexIcons !== 'undefined' ? VexIcons.svg('x', { size: 13 }) : '');
    head.append(t, x);
    card.appendChild(head);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'vexsr-sub';
      s.textContent = sub;
      card.appendChild(s);
    }
    const body = document.createElement('div');
    body.className = 'vex-platform-body';
    card.appendChild(body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const onKey = (e) => {
      if (!overlay.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    x.addEventListener('click', close);
    x.focus({ preventScroll: true });
    return { overlay, body, close };
  },

  // A button in the platform tools' own look.
  button(text, onClick, { primary = false, danger = false, label } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = primary ? 'btn-primary' : (danger ? 'btn-danger' : 'btn-secondary');
    b.textContent = text;
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  },

  // A line of explanation under a heading.
  note(text) {
    const d = document.createElement('div');
    d.className = 'vex-platform-note';
    d.textContent = text;
    return d;
  },

  // Idempotent. Puts every registered section in the list (building each one
  // fresh) and returns how many are there.
  inject(rootArg) {
    if (typeof document === 'undefined') return 0;
    const root = rootArg || document.querySelector('#panel-settings .settings-content');
    if (!root) return 0;
    let n = 0;
    for (const [id, def] of this._defs) {
      const elId = def.build ? 'vex-sg-' + id : 'setting-' + id;
      let el = root.querySelector(':scope > #' + elId) || (rootArg ? null : document.getElementById(elId));
      const fresh = !el;
      if (fresh) {
        el = document.createElement('div');
        el.id = elId;
        el.className = 'setting-group';
        el.dataset.keywords = def.keywords;
      }
      el.textContent = '';
      const label = document.createElement('label');
      label.className = 'setting-label';
      label.textContent = def.title;
      el.appendChild(label);
      let into = el;
      if (!def.build) { into = document.createElement('div'); into.className = 'vex-module-group-body'; el.appendChild(into); }
      try { (def.build || def.render)(into); }
      catch (err) {
        console.error('[Settings] section "' + id + '" could not be built:', err);
        if (!def.build) into.textContent = 'This section could not be shown: ' + ((err && err.message) || err);
      }
      if (fresh) {
        const anchor = def.before
          ? Array.from(root.children).find(c => c.classList && c.classList.contains('setting-group')
            && String((c.querySelector('.setting-label') || {}).textContent || '').trim().toLowerCase().startsWith(def.before))
          : null;
        if (anchor) root.insertBefore(el, anchor); else root.appendChild(el);
      }
      n++;
    }
    if (typeof VexUsage !== 'undefined') VexUsage.applyGroups(root);
    return n;
  },
};

// Settings builds its chips and tiers from the sections present when
// enhance() runs, so the sections go in just before it.
VexSettingsGroups._wrap();
// A module registered before settings-ui.js was parsed gets wrapped here.
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => VexSettingsGroups._wrap());

if (typeof window !== 'undefined') window.VexSettingsGroups = VexSettingsGroups;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSettingsGroups };
