// === Your data: export and import everything, by feature (T3-099) ====================
//
// js/backup.js already writes one file with everything Vex remembers, with the
// secret filter, a preview and an Undo (Settings > Data > Back up). It is one flat
// list of keys. This adds, on top of it and never around it:
//
//   - an archive with one SECTION PER FEATURE (from the feature manifests, so the
//     person sees "Notes, bookmarks and read later", "Mail triage in the brief"...),
//     each with its own schema version, so an old archive can be read after a
//     section changes shape;
//   - an import PREVIEW per section: how many items, how many would replace what is
//     there now, and a tick for each section, so you can bring back only some;
//   - a plain Markdown / JSON folder export of notes, highlights and clips that other
//     tools (Obsidian, any editor) can read, into a folder you pick.
//
// What is never in it (the same filter as a backup, VexBackup._blocked): saved
// logins, authenticator codes, tokens, keys, the Lock PIN, page actions. Those live
// in the main process, encrypted, and are not readable from here at all. A key that
// looks like a secret by its name is dropped on the way out AND on the way in.
//
//   VexYourData.build(include)  -> the archive object (pure over localStorage)
//   VexYourData.describe(a)     -> per-section counts for the preview, or null if it is not one
//   VexYourData.apply(a, ids)   -> writes the ticked sections (through VexBackup.apply, so Undo works)
//   VexYourData.markdownFiles() -> [{ path, text }] for the folder export
const VexYourData = {
  FORMAT: 'vex-your-data',
  VERSION: 2,
  SECTION_SCHEMA: 1,           // the shape of one section; raised when a section's keys change meaning

  _need() {
    if (typeof VexBackup === 'undefined') throw new Error('The backup module is not loaded (js/backup.js)');
    if (typeof VexRegistry === 'undefined') throw new Error('The feature manifests are not loaded (js/feature-registry.js)');
  },

  // ---- the archive ------------------------------------------------------------------
  // Items grouped by the feature that owns each key; a key nobody owns goes in "other".
  build(include = []) {
    this._need();
    const flat = VexBackup.collect(include);
    const sections = new Map();
    for (const [key, value] of Object.entries(flat.items)) {
      const owner = VexRegistry.ownerOfKey(key);
      const id = owner || 'other';
      if (!sections.has(id)) {
        const m = owner ? VexRegistry.get(owner) : null;
        sections.set(id, { id, title: m ? m.title : 'Other settings', schema: this.SECTION_SCHEMA, items: {} });
      }
      sections.get(id).items[key] = value;
    }
    return {
      format: this.FORMAT, v: this.VERSION, at: flat.at, app: flat.app, includes: flat.includes.slice(), skipped: flat.skipped,
      sections: [...sections.values()].sort((a, b) => a.title.localeCompare(b.title)),
    };
  },

  // The settings files (ad blocker, sleeping tabs...) are not in browser storage: added when asked for.
  async buildFull(include = []) {
    const a = this.build(include);
    a.stores = await VexBackup.collectStores(include);
    return a;
  },

  isArchive(a) {
    return !!a && typeof a === 'object' && a.format === this.FORMAT && Number.isInteger(a.v) && Array.isArray(a.sections);
  },

  // What an archive holds, for the preview. null when it is not one of ours.
  describe(a) {
    this._need();
    if (!this.isArchive(a)) return null;
    if (a.v > this.VERSION) return { tooNew: true, v: a.v, sections: [] };
    const sections = [];
    for (const s of a.sections) {
      if (!s || typeof s.id !== 'string' || !s.items || typeof s.items !== 'object') continue;
      const keys = Object.keys(s.items).filter(k => k.startsWith('vex.') && !VexBackup._blocked(k) && typeof s.items[k] === 'string');
      let replaces = 0, same = 0;
      for (const k of keys) {
        const now = localStorage.getItem(k);
        if (now === null) continue;
        if (now === s.items[k]) same++; else replaces++;
      }
      sections.push({
        id: s.id, title: String(s.title || s.id), schema: Number.isInteger(s.schema) ? s.schema : 1,
        count: keys.length, replaces, same, added: keys.length - replaces - same,
        newerSchema: Number.isInteger(s.schema) && s.schema > this.SECTION_SCHEMA,
        dropped: Object.keys(s.items).length - keys.length,
      });
    }
    const stores = a.stores && typeof a.stores === 'object' ? Object.keys(a.stores) : [];
    return { tooNew: false, v: a.v, when: a.at ? new Date(a.at) : null, app: a.app || '', sections, stores };
  },

  // Writes the sections in `ids` (all when omitted). A section with a newer schema than this
  // build understands is refused, not guessed at. -> { written, failed, sections }
  apply(a, ids) {
    this._need();
    const d = this.describe(a);
    if (!d) throw new Error('That is not a Vex "Your data" archive');
    if (d.tooNew) throw new Error('That archive was made by a newer Vex (format ' + d.v + '); update Vex to read it');
    const want = new Set(ids || d.sections.map(s => s.id));
    const items = {};
    const used = [];
    for (const s of a.sections) {
      if (!want.has(s.id)) continue;
      if (Number.isInteger(s.schema) && s.schema > this.SECTION_SCHEMA) throw new Error('"' + (s.title || s.id) + '" in that archive is newer than this Vex understands; update Vex first');
      Object.assign(items, s.items);
      used.push(s.id);
    }
    // VexBackup.apply keeps what is there for Undo, drops secret-shaped keys, and checks each value.
    const r = VexBackup.apply({ v: VexBackup.VERSION, at: a.at, app: a.app, includes: a.includes || [], items });
    return { written: r.written, failed: r.failed, sections: used };
  },

  // ---- the plain folder export -----------------------------------------------------------
  _slug(s, fallback) {
    const t = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return t || fallback;
  },
  _yaml(v) { return JSON.stringify(String(v == null ? '' : v)); },
  _json(key) {
    let raw = null;
    try { raw = localStorage.getItem(key); }
    catch (err) { throw new Error('Could not read ' + key + ': ' + err.message); }
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (err) { throw new Error(key + ' is not readable: ' + err.message); }
  },

  // Notes as Markdown with front matter, highlights grouped by page, clips as one file each.
  markdownFiles(clips = []) {
    const files = [];
    const used = new Set();
    const unique = (dir, name) => {
      let p = dir + '/' + name + '.md', n = 2;
      while (used.has(p)) p = dir + '/' + name + '-' + (n++) + '.md';
      used.add(p);
      return p;
    };
    const notes = this._json('vex.notes');
    for (const n of Array.isArray(notes) ? notes : []) {
      if (!n || typeof n.content !== 'string') continue;
      const tags = Array.isArray(n.tags) ? n.tags.filter(t => typeof t === 'string' && t.trim()) : [];
      const head = ['---', 'title: ' + this._yaml(n.title || 'Untitled')];
      if (n.createdAt) head.push('created: ' + this._yaml(n.createdAt));
      if (n.updatedAt) head.push('updated: ' + this._yaml(n.updatedAt));
      if (tags.length) head.push('tags: [' + tags.map(t => this._yaml(t.replace(/^#/, ''))).join(', ') + ']');
      head.push('---', '');
      files.push({ path: unique('Notes', this._slug(n.title, 'note')), text: head.join('\n') + n.content + '\n' });
    }
    const ann = this._json('vex.annotations');
    if (ann && typeof ann === 'object') {
      for (const [url, list] of Object.entries(ann)) {
        if (!Array.isArray(list) || !list.length) continue;
        const title = (list.find(h => h && h.title) || {}).title || url;
        const body = ['---', 'title: ' + this._yaml(title), 'source: ' + this._yaml(url), '---', ''];
        for (const h of list) {
          if (!h || !(h.text || h.quote)) continue;
          body.push('> ' + String(h.text || h.quote).replace(/\r?\n/g, '\n> '));
          if (h.note) body.push('', String(h.note));
          body.push('');
        }
        files.push({ path: unique('Highlights', this._slug(title, 'page')), text: body.join('\n') });
      }
    }
    for (const c of Array.isArray(clips) ? clips : []) {
      if (!c || typeof c.text !== 'string') continue;
      const first = c.text.split('\n')[0].slice(0, 60);
      const head = ['---', 'title: ' + this._yaml(first)];
      if (c.at) head.push('captured: ' + this._yaml(new Date(c.at).toISOString()));
      if (c.url) head.push('source: ' + this._yaml(c.url));
      head.push('---', '');
      files.push({ path: unique('Clips', this._slug(first, 'clip')), text: head.join('\n') + c.text + '\n' });
    }
    return files;
  },

  // Into a folder the person picks (File System Access picker: Vex gets that folder and nothing else).
  async exportFolder() {
    if (typeof window.showDirectoryPicker !== 'function') throw new Error('This window cannot pick a folder');
    let clips = [];
    if (window.vex && typeof window.vex.clipsInboxList === 'function') {
      const r = await window.vex.clipsInboxList();
      if (!r || !r.ok) throw new Error('Could not read the clips inbox');
      clips = r.items || [];
    }
    const files = this.markdownFiles(clips);
    if (!files.length) throw new Error('There are no notes, highlights or clips to export');
    const root = await window.showDirectoryPicker({ mode: 'readwrite', id: 'vex-your-data' });
    for (const f of files) {
      const parts = f.path.split('/');
      let dir = root;
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
      const h = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const w = await h.createWritable();
      await w.write(f.text);
      await w.close();
    }
    return files.length;
  },

  fileName(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return 'vex-your-data-' + now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate()) + '.json';
  },

  // ---- the screen ------------------------------------------------------------------------------
  async open() {
    this._need();
    const { body } = VexSettingsGroups.dialog({ id: 'vex-your-data', title: 'Your data', sub: 'Everything Vex remembers about how you work, by feature. Saved logins and authenticator codes are never in it.' });
    const msg = VexSettingsGroups.note('');
    const say = (t) => { msg.textContent = t; };
    const a = this.build([]);
    body.appendChild(VexSettingsGroups.note('Right now: ' + a.sections.length + ' features hold ' + a.sections.reduce((n, s) => n + Object.keys(s.items).length, 0) + ' stored items.'));
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:8px 0';
    bar.append(
      VexSettingsGroups.button('Save everything as a file', async () => {
        try {
          const data = await this.buildFull([]);
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
          const link = document.createElement('a');
          link.href = url; link.download = this.fileName();
          document.body.appendChild(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          if (typeof VexUsage !== 'undefined') VexUsage.touch('your-data');
          say('Saved ' + data.sections.length + ' sections to your Downloads folder.');
        } catch (err) { say('Could not save: ' + err.message); }
      }, { primary: true }),
      VexSettingsGroups.button('Notes and highlights as Markdown…', async () => {
        try { const n = await this.exportFolder(); say('Wrote ' + n + ' files.'); }
        catch (err) { say(err.name === 'AbortError' ? 'No folder chosen.' : 'Could not export: ' + err.message); }
      }),
    );
    const pick = document.createElement('input');
    pick.type = 'file'; pick.accept = 'application/json,.json'; pick.className = 'vexsr-input';
    pick.setAttribute('aria-label', 'A Your data file to bring back');
    const preview = document.createElement('div');
    pick.addEventListener('change', async () => {
      preview.textContent = '';
      const file = pick.files[0];
      if (!file) return;
      try {
        const archive = await VexBackup.read(file);
        const d = this.describe(archive);
        if (!d) throw new Error('That is not a Vex "Your data" file. (A backup made by Back up everything is restored there.)');
        if (d.tooNew) throw new Error('That file was made by a newer Vex; update Vex to read it.');
        const ticked = new Set(d.sections.filter(s => !s.newerSchema).map(s => s.id));
        preview.appendChild(VexSettingsGroups.note('Saved ' + (d.when ? d.when.toLocaleString() : 'at an unknown time') + (d.app ? ' by Vex ' + d.app : '') + '. Tick what to bring back:'));
        for (const s of d.sections) {
          const row = document.createElement('label');
          row.className = 'vexsr-rule';
          const box = document.createElement('input');
          box.type = 'checkbox'; box.checked = ticked.has(s.id); box.disabled = s.newerSchema;
          box.setAttribute('aria-label', s.title);
          box.addEventListener('change', () => { if (box.checked) ticked.add(s.id); else ticked.delete(s.id); });
          const name = document.createElement('span');
          name.className = 'vexsr-host';
          name.textContent = s.title;
          const meta = document.createElement('span');
          meta.className = 'vexsr-mode';
          meta.textContent = s.newerSchema ? 'newer than this Vex' : s.count + ' items, ' + s.replaces + ' replace what is here, ' + s.added + ' new';
          row.append(box, name, meta);
          preview.appendChild(row);
        }
        preview.appendChild(VexSettingsGroups.button('Bring back the ticked sections', async () => {
          try {
            const ok = await vexConfirm({ title: 'Bring back ' + ticked.size + ' sections?', message: 'Their items are written over what is here; anything the file does not hold stays. You can undo this until you close Vex, and Vex has to be restarted for all of it to take.', okLabel: 'Bring back', danger: true });
            if (!ok) return;
            const r = this.apply(archive, [...ticked]);
            VexBackup._reloadLive();
            say('Brought back ' + r.written + ' items' + (r.failed ? ' (' + r.failed + ' skipped)' : '') + '. Restart Vex.');
          } catch (err) { say(err.message); }
        }, { primary: true }));
      } catch (err) { say(err.message); }
    });
    body.append(bar, pick, preview, msg);
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('One file with everything Vex remembers, sorted by feature, that you can bring back whole or in part. Notes, highlights and clips can also go to a folder as plain Markdown. Saved logins and authenticator codes are never in it.'));
    el.appendChild(VexSettingsGroups.button('Open Your data', () => this.open().catch(err => window.showToast?.(err.message, 'error')), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexYourData = VexYourData;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'your-data', title: 'Your data', keywords: 'export import everything archive backup markdown obsidian notes highlights clips restore sections portable', before: 'about', build: (el) => VexYourData.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'your-data', label: 'Your data', hint: 'Export or bring back everything by feature, or send notes and highlights to a folder as Markdown', icon: 'archive', action: () => VexYourData.open().catch(err => window.showToast?.(err.message, 'error')) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexYourData };
