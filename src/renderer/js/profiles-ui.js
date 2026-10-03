// === Profiles: the switcher on the toolbar (#btn-profile) ===================
//
// A profile is a separate Vex with its own folder (src/main/profiles.js):
// tabs, bookmarks, history, passwords, extensions, the sync account, settings
// and cookies are all its own. This module is the menu that lists them, opens
// one in its own window, adds, edits and deletes them, and makes a desktop
// shortcut — and it shows which profile this window is: the window title
// ("Vex — Work") and a dot in the profile's colour on the button, once there
// is more than one profile to tell apart.
//
// Only the main window has it: a private window has no profile menu.
const ProfilesUI = {
  COLORS: ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b'],
  COLOR_NAMES: ['Indigo', 'Sky', 'Teal', 'Green', 'Amber', 'Orange', 'Red', 'Pink', 'Purple', 'Slate'],
  ICONS: ['user', 'briefcase', 'home', 'heart', 'star', 'gamepad', 'graduation', 'code', 'book', 'music', 'coffee', 'leaf'],

  _state: null,
  _menu: null,
  _btn: null,
  _outside: null,
  _key: null,

  async init() {
    this._btn = document.getElementById('btn-profile');
    if (!this._btn) return;
    if (window.VexTabPolicy?.isPrivateWindow || !window.vex?.profiles) { this._btn.hidden = true; return; }
    this._btn.addEventListener('click', () => (this._menu ? this.close() : this.open()));
    document.getElementById('setting-profiles-open')?.addEventListener('click', () => this.open());
    try { await this.refresh(); }
    catch (err) { window.VexProblems?.note('Profiles', 'Could not read the profile list', err); }
  },

  // "Error invoking remote method 'profiles:delete': Error: That profile is
  // open…" — the part after the prefix is what the person needs.
  message(err) {
    return String((err && err.message) || err || 'Something went wrong').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  },

  safeColor(c) { return /^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c) : 'var(--vex-accent, var(--primary))'; },
  icon(name, size) {
    const V = window.VexIcons;
    if (!V) return '';
    return V.svg(V.has(name) ? name : 'user', { size });
  },
  esc(s) { return window.escapeHtml ? window.escapeHtml(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); },

  current() { return this._state?.profiles?.find(p => p.current) || null; },

  // What the window is called: just "Vex" while there is only one profile.
  titleFor(state) {
    const list = state?.profiles || [];
    const me = list.find(p => p.current);
    if (!me || (list.length < 2 && me.isDefault)) return 'Vex';
    return 'Vex — ' + me.name;
  },

  async refresh() {
    this._state = await window.vex.profiles.list();
    this.paint();
    return this._state;
  },

  paint() {
    const me = this.current();
    if (!me || !this._btn) return;
    const several = (this._state.profiles || []).length > 1 || !me.isDefault;
    this._btn.innerHTML = `<span class="profile-btn-icon" aria-hidden="true">${this.icon(me.icon, 16)}</span>` +
      (several ? `<span class="profile-btn-dot" aria-hidden="true" style="--pc:${this.safeColor(me.color)}"></span>` : '');
    const label = several ? `Profile: ${me.name}` : 'Profiles';
    this._btn.title = label;
    this._btn.setAttribute('aria-label', label);
    this._btn.setAttribute('aria-haspopup', 'dialog');
    this._btn.setAttribute('aria-expanded', this._menu ? 'true' : 'false');
    document.title = this.titleFor(this._state);
    document.body.dataset.vexProfile = me.id;
  },

  // ---- the menu ------------------------------------------------------------

  async open() {
    try { await this.refresh(); }
    catch (err) { window.showToast?.('Could not read the profiles: ' + this.message(err), 'error', 5000); return; }
    this.close();
    const menu = document.createElement('div');
    menu.className = 'profile-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Profiles');
    document.body.appendChild(menu);
    this._menu = menu;
    this._btn.setAttribute('aria-expanded', 'true');
    this.renderList();
    this.place();
    this._outside = (e) => { if (this._menu && !this._menu.contains(e.target) && !this._btn.contains(e.target) && !e.target.closest?.('.vex-dialog-overlay')) this.close(); };
    this._key = (e) => { if (e.key === 'Escape' && this._menu && !document.querySelector('.vex-dialog-overlay')) { e.stopPropagation(); this.close(true); } };
    setTimeout(() => document.addEventListener('mousedown', this._outside, true), 0);
    document.addEventListener('keydown', this._key, true);
    menu.querySelector('button')?.focus();
  },

  close(returnFocus) {
    if (this._outside) document.removeEventListener('mousedown', this._outside, true);
    if (this._key) document.removeEventListener('keydown', this._key, true);
    this._outside = this._key = null;
    if (this._menu) { this._menu.remove(); this._menu = null; }
    this._btn?.setAttribute('aria-expanded', 'false');
    if (returnFocus) this._btn?.focus();
  },

  // Under the button, kept inside the window.
  place() {
    const m = this._menu;
    if (!m || !this._btn) return;
    const r = this._btn.getBoundingClientRect();
    const w = m.offsetWidth || 300;
    m.style.top = Math.round(r.bottom + 6) + 'px';
    m.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))) + 'px';
    m.style.maxHeight = Math.max(160, window.innerHeight - r.bottom - 20) + 'px';
  },

  renderList() {
    const m = this._menu;
    if (!m) return;
    const list = this._state?.profiles || [];
    const me = this.current();
    const rows = list.map(p => {
      const state = p.current ? 'This window' : (p.running ? 'Open' : '');
      const canDelete = !p.isDefault && !p.current;
      return `<div class="pm-row${p.current ? ' current' : ''}">
        <button type="button" class="pm-open" data-act="open" data-id="${this.esc(p.id)}" title="${p.current ? 'This window' : 'Open ' + this.esc(p.name) + ' in its own window'}">
          <span class="pm-avatar" style="--pc:${this.safeColor(p.color)}" aria-hidden="true">${this.icon(p.icon, 15)}</span>
          <span class="pm-name">${this.esc(p.name)}</span>
          ${state ? `<span class="pm-state">${state}</span>` : ''}
        </button>
        <button type="button" class="pm-mini" data-act="edit" data-id="${this.esc(p.id)}" title="Rename or recolour ${this.esc(p.name)}" aria-label="Edit ${this.esc(p.name)}">${this.icon('edit', 14)}</button>
        ${canDelete ? `<button type="button" class="pm-mini pm-danger" data-act="delete" data-id="${this.esc(p.id)}" title="Delete ${this.esc(p.name)}" aria-label="Delete ${this.esc(p.name)}">${this.icon('trash', 14)}</button>` : '<span class="pm-mini-space" aria-hidden="true"></span>'}
      </div>`;
    }).join('');
    m.innerHTML = `
      <div class="pm-head">Profiles</div>
      <div class="pm-list">${rows}</div>
      <div class="pm-sep" role="separator"></div>
      <button type="button" class="pm-action" data-act="add">${this.icon('plus', 15)}<span>Add profile</span></button>
      <button type="button" class="pm-action" data-act="shortcut">${this.icon('link', 15)}<span>Desktop shortcut to ${this.esc(me ? me.name : 'this profile')}</span></button>
      <p class="pm-hint">Each profile is a separate Vex: its own tabs, bookmarks, history, passwords, extensions, sync and settings.</p>`;
    m.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => this.act(b.dataset.act, b.dataset.id)));
  },

  async act(what, id) {
    const p = (this._state?.profiles || []).find(x => x.id === id);
    if (what === 'open') return this.openProfile(p);
    if (what === 'edit') return this.renderForm(p);
    if (what === 'add') return this.renderForm(null);
    if (what === 'delete') return this.remove(p);
    if (what === 'shortcut') return this.shortcut(this.current());
  },

  async openProfile(p) {
    if (!p) return;
    if (p.current) { this.close(true); return; }
    try {
      await window.vex.profiles.open(p.id);
      window.showToast?.(p.running ? `Switching to ${p.name}` : `Opening ${p.name} in a new window`);
      this.close();
    } catch (err) { window.showToast?.('Could not open the profile: ' + this.message(err), 'error', 5000); }
  },

  async shortcut(p) {
    if (!p) return;
    try {
      const r = await window.vex.profiles.createShortcut(p.id);
      window.showToast?.(`Shortcut "${(r.file || '').split(/[\\/]/).pop()}" is on your desktop`);
      this.close();
    } catch (err) { window.showToast?.('Could not make the shortcut: ' + this.message(err), 'error', 5000); }
  },

  async remove(p) {
    if (!p) return;
    const ok = await window.vexConfirm({
      title: `Delete the profile "${p.name}"?`,
      message: 'Everything in it is deleted from this computer: its tabs, bookmarks, history, saved passwords, extensions, settings and cookies. This cannot be undone.',
      okLabel: 'Delete profile',
      danger: true,
    });
    if (!ok) return;
    try {
      this._state = await window.vex.profiles.remove(p.id);
      this.paint();
      if (this._menu) { this.renderList(); this.place(); this._menu.querySelector('[data-act="add"]')?.focus(); }
      window.showToast?.(`Deleted the profile ${p.name}`);
    } catch (err) { window.showToast?.('Could not delete the profile: ' + this.message(err), 'error', 6000); }
  },

  // Add (p null) or edit: a name, a colour and an icon.
  renderForm(p) {
    const m = this._menu;
    if (!m) return;
    const used = new Set((this._state?.profiles || []).map(x => x.color));
    const color = p ? p.color : (this.COLORS.find(c => !used.has(c)) || this.COLORS[0]);
    const icons = this.ICONS.filter(n => window.VexIcons?.has(n));
    const icon = p ? p.icon : 'user';
    m.innerHTML = `
      <form class="pm-form" novalidate>
        <div class="pm-head">${p ? 'Edit ' + this.esc(p.name) : 'Add a profile'}</div>
        <label class="pm-label" for="pm-name">Name</label>
        <input id="pm-name" class="set-input pm-input" type="text" maxlength="40" autocomplete="off" spellcheck="false" value="${p ? this.esc(p.name) : ''}" placeholder="Work, School, Gaming…">
        <div class="pm-label" id="pm-color-label">Colour</div>
        <div class="pm-swatches" role="radiogroup" aria-labelledby="pm-color-label">
          ${this.COLORS.map((c, i) => `<button type="button" class="pm-swatch" role="radio" aria-checked="${c === color}" aria-label="${this.COLOR_NAMES[i]}" title="${this.COLOR_NAMES[i]}" data-color="${c}" style="--pc:${c}"></button>`).join('')}
        </div>
        <div class="pm-label" id="pm-icon-label">Icon</div>
        <div class="pm-icons" role="radiogroup" aria-labelledby="pm-icon-label">
          ${icons.map(n => `<button type="button" class="pm-icon-choice" role="radio" aria-checked="${n === icon}" aria-label="${n}" title="${n}" data-icon="${n}">${this.icon(n, 16)}</button>`).join('')}
        </div>
        <p class="pm-error" role="alert" hidden></p>
        <div class="pm-form-actions">
          <button type="button" class="btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn-primary">${p ? 'Save' : 'Create and open'}</button>
        </div>
      </form>`;
    const form = m.querySelector('form');
    const pick = (sel, attr) => form.querySelectorAll(sel).forEach(b => b.addEventListener('click', () => {
      form.querySelectorAll(sel).forEach(o => o.setAttribute('aria-checked', String(o === b)));
      if (attr === 'color') form.querySelector('.pm-head').style.setProperty('--pc', b.dataset.color);
    }));
    pick('.pm-swatch', 'color');
    pick('.pm-icon-choice', 'icon');
    form.querySelector('[data-act="cancel"]').addEventListener('click', () => { this.renderList(); this.place(); this._menu?.querySelector('button')?.focus(); });
    form.addEventListener('submit', (e) => { e.preventDefault(); this.save(p, form); });
    this.place();
    form.querySelector('#pm-name').focus();
  },

  async save(p, form) {
    const err = form.querySelector('.pm-error');
    const name = form.querySelector('#pm-name').value.trim();
    const look = {
      name,
      color: form.querySelector('.pm-swatch[aria-checked="true"]')?.dataset.color || this.COLORS[0],
      icon: form.querySelector('.pm-icon-choice[aria-checked="true"]')?.dataset.icon || 'user',
    };
    if (!name) { err.textContent = 'Give the profile a name.'; err.hidden = false; form.querySelector('#pm-name').focus(); return; }
    try {
      if (p) {
        this._state = await window.vex.profiles.update(p.id, look);
        this.paint();
        this.renderList(); this.place();
        window.showToast?.(`Saved ${name}`);
      } else {
        const before = new Set((this._state?.profiles || []).map(x => x.id));
        this._state = await window.vex.profiles.create(look);
        this.paint();
        const made = this._state.profiles.find(x => !before.has(x.id));
        this.close();
        if (made) {
          await window.vex.profiles.open(made.id);
          window.showToast?.(`Made the profile ${made.name} — it opens in a new window`);
        }
      }
    } catch (e) { err.textContent = this.message(e); err.hidden = false; }
  },
};

if (typeof window !== 'undefined') {
  window.ProfilesUI = ProfilesUI;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ProfilesUI.init());
  else ProfilesUI.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = ProfilesUI;
