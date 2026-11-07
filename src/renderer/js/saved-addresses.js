// === Saved addresses: an address book that is filled into a form only when you ask ======================
//
// Ctrl+K "Saved Addresses" keeps a few addresses (name, street, city, postcode, country, phone). They live in an encrypted
// file in the profile (main/addresses.js, sealed by Windows like saved cards; never written as plain JSON, never in a backup,
// never synced, never in the page's storage).
//
// Ctrl+K "Fill Saved Address into This Page" is the only way an address leaves the book, and it is never automatic:
//   1. it picks the address (a list, when there is more than one);
//   2. it shows exactly what will be typed and into which site (the address bar's host), and waits for "Fill";
//   3. only then it types it into the visible, empty fields of the form in front, with the same field matching as Form Fill
//      (js/form-fill.js). Nothing is submitted: pressing the site's own button is still yours.
// Refused without asking: a private, Tor, burner or routed tab (the same rule as everything that shares a tab), a page that is not
// https (this computer excepted), and a page that changed while the question was open.
const VexSaved = {
  FIELDS: [['name', 'Name'], ['street', 'Street'], ['city', 'City'], ['postcode', 'Postcode'], ['country', 'Country'], ['phone', 'Phone']],
  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },

  // ---- pure parts -------------------------------------------------------------------------------------------------------
  hostOf(url) {
    try { return new URL(String(url)).hostname.toLowerCase(); } catch { return ''; }
  },
  // Whether an address may be typed into this page. -> { ok: true, host } or { ok: false, reason }
  canFillUrl(url) {
    let u;
    try { u = new URL(String(url)); } catch { return { ok: false, reason: 'There is no page to fill' }; }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return { ok: true, host: u.hostname.toLowerCase() };
    if (u.protocol === 'http:') return { ok: false, reason: 'This page is not secure (http): saved addresses are only filled into https pages' };
    return { ok: false, reason: 'Saved addresses are only filled into web pages' };
  },
  // The labelled lines of an address, empty ones left out.
  lines(a) {
    return this.FIELDS.filter(([k]) => a && a[k]).map(([k, label]) => ({ key: k, label, value: String(a[k]) }));
  },
  // What Form Fill (js/form-fill.js) is given: its own field names.
  toProfile(a) {
    const map = { name: 'fullName', street: 'address', city: 'city', postcode: 'zip', country: 'country', phone: 'phone' };
    const out = {};
    for (const [k, to] of Object.entries(map)) if (a && a[k]) out[to] = String(a[k]);
    return out;
  },
  // Plain text of what will be typed, for the question and for the tests.
  confirmText(a, host) {
    return this._t('These details will be typed into the form on {1}:').replace('{1}', host) + '\n' + this.lines(a).map(l => this._t(l.label) + ': ' + l.value).join('\n');
  },

  // ---- the window ------------------------------------------------------------------------------------------------------
  _api() {
    const v = window.vex;
    if (!v || typeof v.addressesList !== 'function' || typeof v.addressesGet !== 'function' || typeof v.addressesSave !== 'function' || typeof v.addressesDelete !== 'function') throw new Error('Saved addresses are not available in this window');
    return v;
  },
  _el(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) { if (k === 'style') e.style.cssText = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
    for (const kid of kids) if (kid) e.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    return e;
  },
  _btn(label, fn, primary) {
    return this._el('button', { type: 'button', text: this._t(label), onclick: fn, style: 'padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12.5px;border:1px solid var(--border);' + (primary ? 'background:var(--primary,var(--accent,#d4a574));color:#111;font-weight:600' : 'background:var(--bg);color:var(--text)') });
  },
  _shell(id, title, onClose) {
    document.getElementById(id)?.remove();
    const overlay = this._el('div', { id, role: 'dialog', 'aria-modal': 'true', 'aria-label': this._t(title), style: 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center' });
    const box = this._el('div', { style: 'width:480px;max-width:94vw;max-height:86vh;display:flex;flex-direction:column;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden' });
    const head = this._el('div', { style: 'padding:16px 18px 8px;font-size:14px;font-weight:700', text: this._t(title) });
    const body = this._el('div', { style: 'overflow-y:auto;padding:6px 18px 10px;display:flex;flex-direction:column;gap:8px' });
    const foot = this._el('div', { style: 'display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--border)' });
    box.append(head, body, foot);
    overlay.appendChild(box);
    const close = () => { overlay.remove(); if (onClose) onClose(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
    document.body.appendChild(overlay);
    if (typeof VexLayer !== 'undefined') VexLayer.track(overlay, { tier: 'dialog', id, close });
    return { overlay, body, foot, close };
  },
  _problem(what, err) {
    window.VexProblems?.note('Saved addresses', what, err);
    window.showToast?.(this._t(err.message), 'error');
  },

  // The address book: add, edit, delete.
  async manage() {
    const api = this._api();
    const sh = this._shell('vex-address-book', 'Saved addresses');
    const draw = async () => {
      sh.body.textContent = '';
      sh.foot.textContent = '';
      let list;
      try { list = await api.addressesList(); } catch (err) { this._problem('the list could not be read', err); sh.close(); return; }
      sh.body.appendChild(this._el('div', { style: 'font-size:11.5px;color:var(--text-muted)', text: this._t('Kept on this computer in an encrypted file. Never synced, never in a backup, never filled unless you ask.') }));
      if (!list.length) sh.body.appendChild(this._el('div', { style: 'padding:14px 0;color:var(--text-muted)', text: this._t('No saved addresses yet.') }));
      for (const a of list) {
        const row = this._el('div', { style: 'display:flex;gap:8px;align-items:center;border:1px solid var(--border);border-radius:10px;padding:8px 10px' });
        const info = this._el('div', { style: 'flex:1;min-width:0' },
          this._el('div', { style: 'font-weight:600', text: a.label }),
          this._el('div', { style: 'font-size:11.5px;color:var(--text-muted)', text: [a.name, a.city, a.country].filter(Boolean).join(', ') }));
        row.append(info, this._btn('Edit', () => this.edit(a.id, draw)), this._btn('Delete', async () => {
          const yes = await window.vexConfirm({ title: this._t('Delete this address?'), message: a.label, okLabel: this._t('Delete'), danger: true });
          if (!yes) return;
          try { const r = await api.addressesDelete(a.id); if (!r || !r.ok) throw new Error((r && r.error) || 'It could not be deleted'); } catch (err) { this._problem('an address could not be deleted', err); }
          draw();
        }));
        sh.body.appendChild(row);
      }
      sh.foot.append(this._btn('Add an address', () => this.edit('', draw), true), this._btn('Close', sh.close));
    };
    await draw();
  },

  // The form for one address (id '' = a new one). onDone runs after a save.
  async edit(id, onDone) {
    const api = this._api();
    let current = { label: '', name: '', street: '', city: '', postcode: '', country: '', phone: '' };
    if (id) {
      try { current = await api.addressesGet(id); } catch (err) { this._problem('the address could not be read', err); return; }
      if (!current) { window.showToast?.(this._t('That address is not saved any more')); return; }
    }
    const sh = this._shell('vex-address-edit', id ? 'Edit address' : 'New address');
    const inputs = {};
    for (const [k, label] of [['label', 'Name for this address (optional)'], ...this.FIELDS]) {
      const input = this._el('input', { type: 'text', autocomplete: 'off', style: 'width:100%;box-sizing:border-box;padding:8px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;font-size:12.5px' });
      input.value = current[k] || '';
      inputs[k] = input;
      sh.body.appendChild(this._el('label', { style: 'display:block' }, this._el('span', { style: 'display:block;font-size:11px;color:var(--text-muted);margin-bottom:3px', text: this._t(label) }), input));
    }
    const msg = this._el('div', { role: 'alert', style: 'color:var(--danger,#e5484d);font-size:12px;min-height:1em' });
    sh.body.appendChild(msg);
    const save = async () => {
      const entry = { id: id || undefined };
      for (const k of Object.keys(inputs)) entry[k] = inputs[k].value;
      try {
        const r = await api.addressesSave(entry);
        if (!r || !r.ok) throw new Error((r && r.error) || 'It could not be saved');
        sh.close();
        if (onDone) onDone();
      } catch (err) { msg.textContent = this._t(err.message); }
    };
    sh.foot.append(this._btn('Cancel', sh.close), this._btn('Save', save, true));
    inputs.label.focus();
  },

  // A list to choose from when there is more than one address. -> the id, or null
  pick(list, host) {
    return new Promise((resolve) => {
      let settled = false;
      const answer = (v) => { if (!settled) { settled = true; resolve(v); } };
      const sh = this._shell('vex-address-pick', 'Which address to fill?', () => answer(null));
      const done = (v) => { answer(v); sh.close(); };
      sh.body.appendChild(this._el('div', { style: 'font-size:11.5px;color:var(--text-muted)', text: this._t('For the form on {1}. You will see exactly what is typed before anything is.').replace('{1}', host) }));
      for (const a of list) {
        const row = this._el('div', { style: 'display:flex;gap:8px;align-items:center;border:1px solid var(--border);border-radius:10px;padding:8px 10px' },
          this._el('div', { style: 'flex:1;min-width:0' }, this._el('div', { style: 'font-weight:600', text: a.label }), this._el('div', { style: 'font-size:11.5px;color:var(--text-muted)', text: [a.name, a.city, a.country].filter(Boolean).join(', ') })),
          this._btn('Use this one', () => done(a.id), true));
        sh.body.appendChild(row);
      }
      sh.foot.appendChild(this._btn('Cancel', () => done(null)));
    });
  },

  // The whole fill: ask which, show exactly what and where, fill only after a yes. -> true when the fill ran.
  async fill() {
    const api = this._api();
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') throw new Error('Saved addresses are not available in this window');
    const wv = WebviewManager.getActiveWebview();
    const tab = TabManager.tabs.find(t => t.id === TabManager.activeTabId);
    if (!wv || !tab) { window.showToast?.(this._t('Open a page with a form first')); return false; }
    if (typeof VexTabPolicy === 'undefined' || !VexTabPolicy.canShareTab(tab)) { window.showToast?.(this._t('Saved addresses are not filled into private, Tor or burner tabs')); return false; }
    const where = this.canFillUrl(wv.getURL());
    if (!where.ok) { window.showToast?.(this._t(where.reason)); return false; }
    const list = await api.addressesList();
    if (!list.length) { window.showToast?.(this._t('No saved addresses yet.')); await this.manage(); return false; }
    const id = list.length === 1 ? list[0].id : await this.pick(list, where.host);
    if (!id) return false;
    const address = await api.addressesGet(id);
    if (!address) throw new Error('That address is not saved any more');
    const esc = (v) => window.escapeHtml(String(v));
    const items = this.lines(address).map(l => `<li><b>${esc(this._t(l.label))}:</b> ${esc(l.value)}</li>`).join('');
    const yes = await window.vexConfirm({
      title: this._t('Fill this address into {1}?').replace('{1}', where.host),
      message: this._t('These details will be typed into the empty fields of the form in front. Nothing is submitted; the site gets them only if you send the form.'),
      html: `<ul style="margin:8px 0 0;padding-left:18px">${items}</ul>`,
      okLabel: this._t('Fill'),
      cancelLabel: this._t('Cancel'),
    });
    if (!yes) return false;
    // The question may have been open for a while: the page in front must still be this one.
    const now = this.canFillUrl(wv.getURL());
    if (WebviewManager.getActiveWebview() !== wv || !now.ok || now.host !== where.host) { window.showToast?.(this._t('The page changed, so nothing was filled')); return false; }
    if (typeof FormFill === 'undefined' || typeof FormFill.fill !== 'function') throw new Error('Form Fill is not available in this window');
    FormFill.fill(this.toProfile(address));
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexSaved = VexSaved;
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'address-book', label: 'Saved Addresses', hint: 'Add, edit or delete the addresses kept in an encrypted file on this computer', icon: 'home', action: () => { VexSaved.manage().catch((err) => VexSaved._problem('the address book did not open', err)); } });
    VexExtras.registerCommand({ id: 'address-fill', label: 'Fill Saved Address into This Page', hint: 'Shows exactly what will be typed and into which site, and fills only after you press Fill', icon: 'home', action: () => { VexSaved.fill().catch((err) => VexSaved._problem('the address could not be filled', err)); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSaved };
