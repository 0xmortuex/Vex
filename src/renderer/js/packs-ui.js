// === Vex Packs: the manager, the install confirm and the overlay ===============
//
// The window's side of src/main/packs.js (docs/packs.md). A pack is a single
// signed JSON file of DECLARATIVE items. Main judges every file; this file
// never parses a pack, never evaluates anything from one and never builds
// markup out of pack text: every string a pack supplies is put on the page with
// textContent, and pictures are shown only as <img> data addresses (which can
// run nothing and load nothing).
//
// Install is local only: "Open a pack file" or drag a .vexpack onto the
// window. There is no address field and no network fetch, on purpose.
//
// What consumes pack data here (docs/packs.md, "Security review checklist"):
//   - chains   -> Ctrl+K commands "packchain:<pack>:<item>", run by
//                 CommandChains.run (the existing runner, step by step)
//   - themes   -> copied to "My themes" only when the person presses the
//                 button, through CustomThemes.validateRecord; the copy is
//                 remembered so uninstalling the pack takes it away again
//   - everything else is read through VexPacks.items(type) by the feature
//     that owns that kind of item (aliases, brief sections, page actions,
//     readability presets, stickers, medal frames, quotes).
const VexPacks = {
  ADOPTED_KEY: 'vex.packs.adopted',
  AUTHOR_KEY: 'vex.packs.authorName',
  _items: [],
  _state: null,
  _modal: null,
  _listeners: new Set(),

  _api() {
    const api = window.vex && window.vex.packs;
    if (!api) throw new Error('Packs are not available in this window');
    return api;
  },
  _isPrivate() { return !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow); },
  _toast(msg, kind) { if (typeof window.showToast === 'function') window.showToast(msg, kind || 'info', 5000); },
  _icon(name, size = 15) { return (typeof VexIcons !== 'undefined' && VexIcons.has(name)) ? VexIcons.svg(name, { size }) : ''; },

  // ---- what features read ----------------------------------------------------
  items(type) { return this._items.filter(x => !type || x.item.type === type); },
  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
  _emit() { for (const fn of this._listeners) { try { fn(); } catch (err) { console.error('[Packs] a listener failed:', err); } } },

  async refresh() {
    if (this._isPrivate()) { this._items = []; this._state = null; this._register(); this._emit(); return; }
    const api = this._api();
    this._state = await api.list();
    this._items = await api.items();
    this._register();
    this._emit();
  },

  init() {
    if (this._inited) return;
    this._inited = true;
    document.addEventListener('dragover', (e) => {
      if (e.defaultPrevented || !e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
      if (e.defaultPrevented || !e.dataTransfer) return;
      const file = Array.from(e.dataTransfer.files || []).find(f => /\.vexpack$/i.test(f.name));
      if (!file) return;
      e.preventDefault();
      this._fromDroppedFile(file).catch(err => this._fail(err));
    });
    this._registerOpenCommand();
    this.refresh().catch(err => console.error('[Packs] could not read the packs:', err && err.message));
  },

  _registerOpenCommand() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    CommandBar.commands = CommandBar.commands.filter(c => c.id !== 'vex-packs');
    CommandBar.commands.push({ id: 'vex-packs', label: 'Vex Packs', hint: 'Install, switch off or remove packs; make your own', icon: 'box', action: () => this.open() });
  },

  // Ctrl+K entries for installed chains. A pack chain runs the person's
  // existing runner: no step is run that CommandBar does not itself know.
  _register() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    CommandBar.commands = CommandBar.commands.filter(c => !String(c.id || '').startsWith('packchain:'));
    if (typeof CommandChains === 'undefined') return;
    for (const { packId, packName, item } of this.items('chain')) {
      CommandBar.commands.push({
        id: 'packchain:' + packId + ':' + item.id, label: item.name, icon: 'link',
        hint: 'Pack "' + packName + '" - runs: ' + item.steps.join(' > '),
        action: () => CommandChains.run({ name: item.name, steps: item.steps.slice() }),
      });
    }
  },

  _fail(err) {
    const msg = (err && err.message) || String(err);
    console.error('[Packs]', msg);
    if (typeof vexAlert === 'function') vexAlert({ title: 'Vex could not use that pack', message: msg });
    else this._toast(msg, 'error');
  },

  // ---- install -----------------------------------------------------------------
  async _fromDroppedFile(file) {
    if (this._isPrivate()) throw new Error('Packs are not available in a private window');
    if (file.size > 256 * 1024) throw new Error('A Vex pack is at most 256 KB; this file is ' + Math.ceil(file.size / 1024) + ' KB');
    const text = await file.text();
    await this._review(await this._api().preview(text));
  },
  async openFile() {
    if (this._isPrivate()) throw new Error('Packs are not available in a private window');
    const r = await this._api().pickFile();
    if (r.cancelled) return false;
    return this._review(r.preview);
  },

  // The plain-language confirm. An unsigned or unknown-key pack lists every
  // item and every permission; a pack from a key you trust gets the short one.
  _confirmText(p) {
    const lines = [];
    const by = p.author ? ' by ' + p.author : '';
    if (p.replaces) lines.push('This replaces the "' + p.replaces.name + '" you already have.', '');
    if (p.trust === 'trusted') {
      const counts = {};
      for (const it of p.items) counts[it.label] = (counts[it.label] || 0) + 1;
      lines.push('"' + p.name + '"' + by + ', signed with a key you trust (' + p.fingerprint + ').', '',
        'It adds: ' + Object.entries(counts).map(([k, n]) => n + ' x ' + k).join(', ') + '.');
      lines.push(p.permissions.length ? 'It asks for: ' + p.permissions.map(x => x.text).join(' ') : 'It asks for no permissions.');
      return lines.join('\n');
    }
    lines.push('"' + p.name + '"' + by);
    lines.push(p.trust === 'unsigned'
      ? 'NOT SIGNED: nothing proves who made this or that it is unchanged.'
      : 'Signed with a key you have not marked as trusted (' + p.fingerprint + '). That proves the file was not changed, not who the author is.');
    if (p.description) lines.push('', p.description);
    lines.push('', 'Everything it contains (' + p.items.length + '):');
    for (const it of p.items) lines.push('  - ' + it.line);
    lines.push('', p.permissions.length ? 'What it is allowed to do:' : 'It asks for no permissions.');
    for (const perm of p.permissions) lines.push('  - ' + perm.text);
    lines.push('', 'A pack cannot run code. This list is all it can do, and you can switch it off or remove it at any time from Vex Packs.');
    return lines.join('\n');
  },

  async _review(p) {
    const api = this._api();
    const risky = p.trust !== 'trusted';
    const ok = await vexConfirm({
      title: risky ? 'Install a pack from an unverified source?' : 'Install "' + p.name + '"?',
      message: this._confirmText(p),
      okLabel: p.replaces ? 'Replace' : 'Install',
      cancelLabel: 'Cancel',
      danger: risky,
      wide: true,
    });
    if (!ok) { await api.discard(p.token); return false; }
    await api.install(p.token, false);
    await this.refresh();
    this._toast('Installed "' + p.name + '"');
    if (this._modal) this._draw();
    return true;
  },

  // ---- themes: copied by an explicit press, and taken away with the pack ---------
  _adopted() {
    try { const o = JSON.parse(localStorage.getItem(this.ADOPTED_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
    catch { return {}; }
  },
  _saveAdopted(o) { localStorage.setItem(this.ADOPTED_KEY, JSON.stringify(o)); },
  addThemeToMine(packId, item) {
    if (typeof CustomThemes === 'undefined') throw new Error('Themes are not available here');
    const list = CustomThemes.list();
    const id = CustomThemes.newId(list.map(r => r.id));
    const rec = CustomThemes.validateRecord({ id, name: item.name, colors: CustomThemes.complete(item.colors), updated: Date.now() });
    CustomThemes.saveList(list.concat(rec));
    const a = this._adopted();
    (a[packId] = a[packId] || []).push({ type: 'theme', id });
    this._saveAdopted(a);
    if (typeof ThemeStudio !== 'undefined' && typeof ThemeStudio._changed === 'function') ThemeStudio._changed();
    this._toast('Added "' + rec.name + '" to My themes');
  },
  async _dropAdopted(packId) {
    const a = this._adopted();
    const mine = a[packId] || [];
    for (const x of mine) {
      if (x.type === 'theme' && typeof ThemeStudio !== 'undefined' && ThemeStudio.record(x.id)) await ThemeStudio.remove(x.id, { quiet: true });
    }
    delete a[packId];
    this._saveAdopted(a);
  },

  // ---- the manager ---------------------------------------------------------------
  async open() {
    if (this._isPrivate()) { await vexAlert({ title: 'Vex Packs', message: 'Packs are not available in a private window.' }); return; }
    await this.refresh();
    this._draw();
  },
  close() {
    if (this._modal) { this._modal.remove(); this._modal = null; }
    if (this._returnFocus && this._returnFocus.focus) { try { this._returnFocus.focus(); } catch { /* element gone */ } }
  },

  _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  },
  _btn(label, onClick, { danger = false, icon = '', title = '' } = {}) {
    const b = this._el('button', 'vex-packs-btn' + (danger ? ' danger' : ''));
    b.type = 'button';
    if (icon) { const s = this._el('span', 'vex-packs-ico'); s.innerHTML = this._icon(icon, 14); b.appendChild(s); }
    b.appendChild(document.createTextNode(label));
    if (title) b.title = title;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await onClick(); } catch (err) { this._fail(err); }
      finally { b.disabled = false; }
    });
    return b;
  },
  _trustLabel(t) { return t === 'trusted' ? 'Trusted key' : t === 'unknown-key' ? 'Signed, key not trusted' : 'Not signed'; },

  _draw() {
    const st = this._state;
    if (!this._modal) {
      this._returnFocus = document.activeElement;
      const overlay = this._el('div', 'vex-packs-overlay');
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.close(); });
      overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
      document.body.appendChild(overlay);
      this._modal = overlay;
    }
    const root = this._modal;
    root.textContent = '';
    const dlg = this._el('div', 'vex-packs-dialog');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-label', 'Vex Packs');
    root.appendChild(dlg);

    const head = this._el('div', 'vex-packs-head');
    const title = this._el('h2', 'vex-packs-title');
    const ti = this._el('span', 'vex-packs-ico'); ti.innerHTML = this._icon('box', 18);
    title.append(ti, document.createTextNode('Vex Packs'));
    head.append(title, this._btn('Close', () => this.close(), { icon: 'x' }));
    dlg.appendChild(head);

    dlg.appendChild(this._el('p', 'vex-packs-note',
      'A pack is one signed file of ready-made themes, chains, page actions and similar items. It cannot run code. Packs are installed only from a file on this computer or by dropping a .vexpack onto the window.'));

    const bar = this._el('div', 'vex-packs-bar');
    bar.append(
      this._btn('Open a pack file', () => this.openFile(), { icon: 'upload' }),
      this._btn('Export my items as a pack', () => this.exportMine(), { icon: 'download' }),
    );
    const master = this._el('label', 'vex-packs-master');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!(st && st.globalEnabled);
    cb.addEventListener('change', async () => {
      try { await this._api().setGlobal(cb.checked); await this.refresh(); this._draw(); }
      catch (err) { this._fail(err); cb.checked = !cb.checked; }
    });
    master.append(cb, document.createTextNode(' Packs are on (the switch for all packs at once)'));
    bar.appendChild(master);
    dlg.appendChild(bar);

    const list = this._el('div', 'vex-packs-list');
    if (!st || !st.packs.length) list.appendChild(this._el('p', 'vex-packs-empty', 'No packs installed.'));
    for (const p of (st ? st.packs : [])) list.appendChild(this._packCard(p));
    for (const d of (st ? st.damaged : [])) {
      const c = this._el('div', 'vex-packs-card damaged');
      c.appendChild(this._el('strong', '', 'Damaged pack file: ' + d.file));
      c.appendChild(this._el('div', 'vex-packs-sub', d.error + ' It is not applied.'));
      list.appendChild(c);
    }
    dlg.appendChild(list);

    dlg.appendChild(this._keysSection(st));
    dlg.appendChild(this._logSection(st));
    const first = dlg.querySelector('button');
    if (first && !root.contains(document.activeElement)) first.focus();
  },

  _packCard(p) {
    const card = this._el('div', 'vex-packs-card' + (p.enabled ? '' : ' off'));
    const top = this._el('div', 'vex-packs-cardtop');
    const name = this._el('strong', 'vex-packs-name', p.name);
    const badge = this._el('span', 'vex-packs-badge ' + p.trust, this._trustLabel(p.trust));
    top.append(name, badge);
    card.appendChild(top);
    card.appendChild(this._el('div', 'vex-packs-sub', 'by ' + p.author + (p.fingerprint ? ' - key ' + p.fingerprint : '')));
    if (p.description) card.appendChild(this._el('div', 'vex-packs-desc', p.description));

    const items = this._el('details', 'vex-packs-items');
    items.appendChild(this._el('summary', '', p.items.length + ' item' + (p.items.length === 1 ? '' : 's')));
    const ul = this._el('ul');
    for (const it of p.items) {
      const li = this._el('li', '', it.type + ': ' + it.name);
      if (it.type === 'theme') {
        const item = this._items.find(x => x.packId === p.id && x.item.id === it.id);
        if (item) li.appendChild(this._btn('Add to My themes', async () => this.addThemeToMine(p.id, item.item)));
      }
      ul.appendChild(li);
    }
    items.appendChild(ul);
    card.appendChild(items);

    const perms = this._el('div', 'vex-packs-perms');
    if (!p.permissions.length) perms.appendChild(this._el('span', 'vex-packs-sub', 'Permissions: none'));
    else {
      perms.appendChild(this._el('span', 'vex-packs-sub', 'Permissions:'));
      const pl = this._el('ul');
      for (const x of p.permissions) pl.appendChild(this._el('li', '', x.id + ' - ' + x.text));
      perms.appendChild(pl);
    }
    card.appendChild(perms);

    const row = this._el('div', 'vex-packs-actions');
    row.appendChild(this._btn(p.enabled ? 'Switch off' : 'Switch on', async () => {
      await this._api().setEnabled(p.id, !p.enabled); await this.refresh(); this._draw();
    }, { icon: p.enabled ? 'x' : 'check', title: 'The per-pack kill switch: nothing from this pack is used while it is off' }));
    if (p.trust === 'unknown-key') {
      row.appendChild(this._btn('Trust this key', async () => {
        const ok = await vexConfirm({ title: 'Trust this author key?', message: 'Packs signed with ' + p.fingerprint + ' will install with the short confirm from now on. Only do this if you know this key belongs to someone you trust.', okLabel: 'Trust key' });
        if (!ok) return;
        await this._api().trustKey(p.id, p.author); await this.refresh(); this._draw();
      }, { icon: 'key' }));
    }
    row.appendChild(this._btn('Remove', async () => {
      const ok = await vexConfirm({ title: 'Remove "' + p.name + '"?', message: 'Everything this pack added goes away, including themes you copied from it to My themes.', okLabel: 'Remove', danger: true });
      if (!ok) return;
      await this._api().uninstall(p.id);
      await this._dropAdopted(p.id);
      await this.refresh();
      this._draw();
    }, { danger: true, icon: 'trash' }));
    card.appendChild(row);
    return card;
  },

  _keysSection(st) {
    const sec = this._el('details', 'vex-packs-section');
    sec.appendChild(this._el('summary', '', 'Keys'));
    const mine = this._el('div', 'vex-packs-keyrow');
    if (st && st.authorKey) {
      mine.appendChild(this._el('span', '', 'Your signing key: ' + st.authorKey.fingerprint));
      mine.appendChild(this._btn('Replace it', async () => {
        const ok = await vexConfirm({ title: 'Replace your signing key?', message: 'Packs you signed before will show up as signed by an unknown key.', okLabel: 'Replace', danger: true });
        if (!ok) return;
        await this._api().generateKey(true); await this.refresh(); this._draw();
      }));
    } else {
      mine.appendChild(this._el('span', '', 'You have no signing key. Packs you export are unsigned until you make one.'));
      mine.appendChild(this._btn('Create my signing key', async () => {
        await this._api().generateKey(false); await this.refresh(); this._draw();
      }, { icon: 'key' }));
    }
    sec.appendChild(mine);
    const t = st ? st.trusted : [];
    if (!t.length) sec.appendChild(this._el('p', 'vex-packs-sub', 'No trusted author keys.'));
    for (const k of t) {
      const r = this._el('div', 'vex-packs-keyrow');
      r.appendChild(this._el('span', '', k.fingerprint + (k.label ? ' (' + k.label + ')' : '')));
      r.appendChild(this._btn('Stop trusting', async () => { await this._api().untrustKey(k.fingerprint); await this.refresh(); this._draw(); }));
      sec.appendChild(r);
    }
    return sec;
  },

  _logSection(st) {
    const sec = this._el('details', 'vex-packs-section');
    sec.appendChild(this._el('summary', '', 'Install log'));
    const log = st ? st.log.slice().reverse() : [];
    if (!log.length) sec.appendChild(this._el('p', 'vex-packs-sub', 'Nothing yet.'));
    const ul = this._el('ul', 'vex-packs-log');
    for (const e of log.slice(0, 40)) ul.appendChild(this._el('li', '', new Date(e.at).toLocaleString() + ' - ' + e.event + (e.packId ? ' ' + e.packId : '') + (e.detail ? ': ' + e.detail : '')));
    sec.appendChild(ul);
    return sec;
  },

  // ---- authoring ---------------------------------------------------------------------
  // The person's OWN themes, chains and command shortcuts, as pack items. Main
  // validates them like any pack, so a chain that runs a command a pack may not
  // is refused with a reason rather than exported.
  _collect(kind) {
    const out = [];
    if (kind === 'themes') {
      if (typeof CustomThemes === 'undefined') throw new Error('Themes are not available here');
      CustomThemes.list().forEach((r, i) => out.push({ type: 'theme', id: 'theme-' + (i + 1), name: r.name, colors: r.colors }));
    } else if (kind === 'chains') {
      if (typeof CommandChains === 'undefined') throw new Error('Chains are not available here');
      CommandChains.chains.forEach((c, i) => out.push({ type: 'chain', id: 'chain-' + (i + 1), name: c.name, steps: c.steps.slice() }));
    } else if (kind === 'aliases') {
      if (typeof VexAliases === 'undefined') throw new Error('Command shortcuts are not available in this build');
      const entries = Object.entries(VexAliases.all().aliases).map(([word, v]) => ({ word, command: v.id }));
      if (entries.length) out.push({ type: 'aliases', id: 'aliases-1', name: 'My command shortcuts', entries: entries.slice(0, 50) });
    } else throw new Error('Choose themes, chains or aliases');
    return out;
  },
  async exportMine() {
    const kind = await vexPrompt({ title: 'Export my items as a pack', label: 'What to export: themes, chains or aliases', value: 'themes', okLabel: 'Next' });
    if (kind == null) return false;
    const k = String(kind).trim().toLowerCase();
    const items = this._collect(k);
    if (!items.length) { await vexAlert({ title: 'Nothing to export', message: 'You have no ' + k + ' to put in a pack.' }); return false; }
    const name = await vexPrompt({ title: 'Name your pack', label: 'Pack name', value: 'My ' + k, okLabel: 'Next' });
    if (name == null) return false;
    let remembered = '';
    try { remembered = localStorage.getItem(this.AUTHOR_KEY) || ''; } catch { remembered = ''; }
    const authorName = await vexPrompt({ title: 'Author', label: 'Your name as the author', value: remembered, okLabel: 'Next' });
    if (authorName == null) return false;
    try { localStorage.setItem(this.AUTHOR_KEY, authorName); } catch { /* a remembered name is optional */ }
    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'pack';
    const id = (slug.length < 3 ? slug + '-pack' : slug) + '-' + Math.random().toString(16).slice(2, 6);
    const sign = !!(this._state && this._state.authorKey);
    const r = await this._api().export({ id, name: String(name).trim(), authorName: String(authorName).trim() || 'Me', description: '', sign, items });
    if (r.cancelled) return false;
    this._toast('Saved ' + r.path + (sign ? ' (signed with your key)' : ' (not signed: create a signing key under Keys)'));
    return true;
  },
};
window.VexPacks = VexPacks;
