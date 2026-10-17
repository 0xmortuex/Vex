// === Vex AI Memory: facts the assistant remembers across sessions ===
//
// A small store of user-stated facts/preferences ("I'm a TypeScript dev",
// "always answer concisely", "I live in Istanbul"). When enabled, they're
// injected as a system message at the FRONT of the chat history on every AI
// request — so it works on BOTH the local (Ollama) and cloud (worker) backends
// without any server change, and it's additive (never replaces the tuned
// default/persona prompt). Stored in localStorage 'vex.aiMemory'.
//
// Provenance, scope and expiry (T2-080). Every fact now says
//   source      where it came from: you typed it, you told the chat, a page you
//               were on, an import ({ kind, label? })
//   scope       where it applies: global (every chat), site (only while you are
//               on that site or a page of it), project (only in that project
//               space)  -> { kind: 'global' | 'site' | 'project', value }
//   confidence  1 when you stated it, lower for something Vex inferred
//   expires     a time after which it is no longer used, or null
//   lastUsed    when it was last put in a request (saved at most once a minute)
// A fact from before this change reads as: you, global, never expires. An
// expired fact is NOT deleted: it stops being used and is listed as expired
// until you forget or renew it. After each request AIMemory.lastInjection says
// exactly which facts went in ("Which facts did you use?" in the command bar).

const AIMemory = {
  KEY: 'vex.aiMemory',
  SCOPES: ['global', 'site', 'project'],
  SOURCE_KINDS: ['you', 'chat', 'page', 'import'],
  USED_SAVE_MS: 60 * 1000,
  // Off until the user switches it on; and, even then, not sent to a cloud
  // backend until they tick "include memory" for it (includeCloud).
  data: { enabled: false, includeCloud: false, facts: [] },
  // The facts of the last request: { at, backend, facts: [{ id, text, scope }] } or null.
  lastInjection: null,

  init() {
    try { const d = JSON.parse(localStorage.getItem(this.KEY) || 'null'); if (d && typeof d === 'object') this.data = { enabled: d.enabled === true, includeCloud: d.includeCloud === true, facts: Array.isArray(d.facts) ? d.facts.map(f => this.normalize(f)) : [] }; } catch (err) { console.error('[AIMemory] the saved memory could not be read:', err); }
    this._registerCommands();
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (err) { console.error('[AIMemory] the memory could not be saved:', err); } },

  // ---- the shape of a fact (pure) -------------------------------------------------
  // Fills what is missing; never changes what is there.
  normalize(f) {
    if (!f || typeof f !== 'object') return f;
    const src = f.source && typeof f.source === 'object' ? f.source : {};
    f.source = { kind: this.SOURCE_KINDS.includes(src.kind) ? src.kind : 'you', ...(src.label ? { label: String(src.label).slice(0, 120) } : {}), ...(src.url ? { url: String(src.url).slice(0, 500) } : {}) };
    const sc = f.scope && typeof f.scope === 'object' ? f.scope : {};
    f.scope = this.SCOPES.includes(sc.kind) && (sc.kind === 'global' || String(sc.value || '').trim())
      ? { kind: sc.kind, ...(sc.kind === 'global' ? {} : { value: String(sc.value).trim().toLowerCase().slice(0, 200) }), ...(sc.kind === 'project' && sc.label ? { label: String(sc.label).slice(0, 80) } : {}) }
      : { kind: 'global' };
    f.confidence = typeof f.confidence === 'number' && f.confidence > 0 && f.confidence <= 1 ? f.confidence : 1;
    f.expires = typeof f.expires === 'number' && Number.isFinite(f.expires) ? f.expires : null;
    if (typeof f.lastUsed !== 'number') f.lastUsed = 0;
    return f;
  },

  isExpired(f, now = Date.now()) { return typeof f.expires === 'number' && f.expires <= now; },

  // host of a web address, no "www."; '' when it has none.
  hostOf(url) { try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },

  // Does this fact apply where the person is? ctx: { host, projectId }.
  applies(f, ctx, now = Date.now()) {
    if (this.isExpired(f, now)) return false;
    const sc = f.scope || { kind: 'global' };
    if (sc.kind === 'global') return true;
    if (sc.kind === 'site') { const h = (ctx && ctx.host) || ''; return !!h && (h === sc.value || h.endsWith('.' + sc.value)); }
    if (sc.kind === 'project') return !!(ctx && ctx.projectId) && ctx.projectId === sc.value;
    return false;
  },

  // Where the person is right now (the tab in front, the project space in use).
  context() {
    let host = '', projectId = '';
    try {
      const tab = (typeof TabManager !== 'undefined' && TabManager.getActiveTab) ? TabManager.getActiveTab() : null;
      if (tab && tab.url) host = this.hostOf(tab.url);
    } catch (err) { console.error('[AIMemory] could not tell which site this is:', err); }
    try { projectId = (typeof ProjectSpaces !== 'undefined' && ProjectSpaces.activeId) ? (ProjectSpaces.activeId() || '') : ''; }
    catch (err) { console.error('[AIMemory] could not tell which project this is:', err); }
    return { host, projectId };
  },

  list() { return this.data.facts; },
  get(id) { return this.data.facts.find(f => f.id === id) || null; },
  // meta: { source: { kind, label }, scope: { kind, value }, confidence, expires }
  add(text, meta) {
    text = (text || '').trim();
    if (!text) return false;
    if (this.data.facts.some(f => f.text.toLowerCase() === text.toLowerCase())) { window.showToast?.('Already remembered'); return false; }
    const fact = this.normalize({ id: vexId('m'), text: text.slice(0, 400), at: Date.now(), ...(meta || {}) });
    this.data.facts.unshift(fact);
    if (this.data.facts.length > 100) this.data.facts.length = 100;
    this.save();
    window.showToast?.('Vex will remember that');
    return true;
  },
  // Changes the text, scope, expiry or confidence of a fact; the source stays what it was.
  update(id, patch) {
    const f = this.get(id);
    if (!f) throw new Error('That fact is gone.');
    if (patch.text != null) {
      const t = String(patch.text).trim().slice(0, 400);
      if (!t) throw new Error('A fact needs some words.');
      if (this.data.facts.some(o => o.id !== id && o.text.toLowerCase() === t.toLowerCase())) throw new Error('Another fact already says that.');
      f.text = t;
    }
    if (patch.scope) {
      if (!this.SCOPES.includes(patch.scope.kind)) throw new Error('A scope is global, site or project.');
      if (patch.scope.kind !== 'global' && !String(patch.scope.value || '').trim()) throw new Error('A ' + patch.scope.kind + ' fact needs a ' + patch.scope.kind + '.');
      f.scope = patch.scope;
    }
    if ('expires' in patch) f.expires = patch.expires;
    if (patch.confidence != null) f.confidence = patch.confidence;
    this.normalize(f);
    this.save();
    return f;
  },
  remove(id) { this.data.facts = this.data.facts.filter(f => f.id !== id); this.save(); },
  setEnabled(v) { this.data.enabled = !!v; this.save(); },
  setIncludeCloud(v) { this.data.includeCloud = !!v; this.save(); },
  clear() { this.data.facts = []; this.save(); },

  // The same facts as plain text, one per line, for the editor in Settings.
  asText() { return this.data.facts.map(f => f.text).join('\n'); },
  // Replaces the facts with the lines of `text` (blank lines and repeats
  // dropped). A line that is unchanged keeps its id and date.
  setFromText(text) {
    const seen = new Set();
    const old = new Map(this.data.facts.map(f => [f.text.toLowerCase(), f]));
    const facts = [];
    for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
      const t = raw.trim().slice(0, 400);
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      facts.push(old.get(t.toLowerCase()) || this.normalize({ id: vexId('m'), text: t, at: Date.now() }));
      if (facts.length >= 100) break;
    }
    this.data.facts = facts;
    this.save();
    return facts.length;
  },

  // May the memory go to this backend? Local and on-device: whenever it is on.
  // Cloud: only when the user ticked "include memory" for it.
  allowsBackend(backend) {
    if (!this.data.enabled) return false;
    return backend === 'cloud' ? this.data.includeCloud === true : true;
  },

  // The system message injected into chat history (null when off/empty).
  // ctx: { host, projectId }; read from the tab and project in use when not given.
  // Only facts that apply here and have not expired are put in; which ones is
  // kept in lastInjection for "Which facts did you use?".
  historyMessage(backend = 'local', ctx) {
    if (!this.allowsBackend(backend)) return null;
    const where = ctx || this.context();
    const now = Date.now();
    const used = this.data.facts.filter(f => this.applies(f, where, now));
    this.lastInjection = { at: now, backend, where, facts: used.map(f => ({ id: f.id, text: f.text, scope: f.scope, source: f.source })) };
    if (!used.length) return null;
    // lastUsed is saved at most once a minute, not on every message.
    let dirty = false;
    for (const f of used) if (now - (f.lastUsed || 0) > this.USED_SAVE_MS) { f.lastUsed = now; dirty = true; }
    if (dirty) this.save();
    const body = 'The user has asked you to remember these facts and preferences about them. Honor them whenever relevant:\n' +
      used.map(f => '- ' + f.text).join('\n');
    // vexMemory lets the router take it back out before a request goes to the
    // cloud when the user has not ticked it (ai-router.js callBackend).
    return { role: 'system', content: body, vexMemory: true };
  },

  // ---- what a fact says about itself (pure) ----------------------------------------
  describe(f, now = Date.now()) {
    const parts = [];
    const sc = f.scope || { kind: 'global' };
    parts.push(sc.kind === 'global' ? 'Everywhere' : (sc.kind === 'site' ? 'Only on ' + sc.value : 'Only in project ' + (sc.label || sc.value)));
    const src = f.source || { kind: 'you' };
    parts.push({ you: 'you typed it', chat: 'from a chat', page: 'from a page' + (src.label ? ': ' + src.label : ''), import: 'imported' }[src.kind] || 'you typed it');
    if (typeof f.confidence === 'number' && f.confidence < 1) parts.push('inferred, ' + Math.round(f.confidence * 100) + '% sure');
    if (typeof f.expires === 'number') parts.push(f.expires <= now ? 'expired ' + new Date(f.expires).toLocaleDateString() : 'until ' + new Date(f.expires).toLocaleDateString());
    parts.push(f.lastUsed ? 'last used ' + new Date(f.lastUsed).toLocaleDateString() : 'not used yet');
    return parts.join(' · ');
  },

  // ---- edit one fact: words, where it applies, how long ---------------------------------
  openEditor(id, after) {
    const f = this.get(id);
    if (!f) { window.showToast?.('That fact is gone', 'error'); return; }
    if (typeof VexSettingsGroups === 'undefined') { window.showToast?.('The editor is unavailable', 'error'); return; }
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-memory-edit', title: 'Edit a remembered fact', sub: this.describe(f) });
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const lab = (t) => el('label', 'vexsr-sub', t);
    const text = el('textarea', 'set-input'); text.rows = 3; text.value = f.text; text.maxLength = 400; text.setAttribute('aria-label', 'The fact');
    text.style.cssText = 'width:100%;box-sizing:border-box';
    const scope = el('select', 'vexsr-input'); scope.setAttribute('aria-label', 'Where it applies');
    for (const [v, t] of [['global', 'Everywhere'], ['site', 'Only on one site'], ['project', 'Only in one project']]) { const o = el('option', null, t); o.value = v; scope.appendChild(o); }
    scope.value = f.scope.kind;
    const site = el('input', 'vexsr-input'); site.type = 'text'; site.placeholder = 'example.com'; site.setAttribute('aria-label', 'Site');
    site.value = f.scope.kind === 'site' ? f.scope.value : this.context().host;
    const proj = el('select', 'vexsr-input'); proj.setAttribute('aria-label', 'Project');
    const spaces = (typeof ProjectSpaces !== 'undefined' && ProjectSpaces.list) ? ProjectSpaces.list() : [];
    for (const sp of spaces) { const o = el('option', null, sp.name); o.value = sp.id; proj.appendChild(o); }
    if (f.scope.kind === 'project') proj.value = f.scope.value;
    const expiry = el('select', 'vexsr-input'); expiry.setAttribute('aria-label', 'How long to keep using it');
    const DAY = 86400000;
    const choices = [['keep', typeof f.expires === 'number' ? 'Keep as it is' : 'Never expires'], ['never', 'Never expires'], ['1', 'One day from now'], ['7', 'One week from now'], ['30', 'One month from now'], ['365', 'One year from now']];
    for (const [v, t] of choices) { const o = el('option', null, t); o.value = v; expiry.appendChild(o); }
    const sync = () => { site.hidden = scope.value !== 'site'; proj.hidden = scope.value !== 'project'; };
    scope.addEventListener('change', sync); sync();
    const msg = el('div', 'vex-platform-note'); msg.setAttribute('role', 'status');
    const bar = el('div'); bar.style.cssText = 'display:flex;gap:8px;margin-top:12px';
    bar.append(
      VexSettingsGroups.button('Save', () => {
        try {
          const patch = { text: text.value };
          if (scope.value === 'global') patch.scope = { kind: 'global' };
          else if (scope.value === 'site') patch.scope = { kind: 'site', value: this.hostOf('https://' + site.value.trim().replace(/^https?:\/\//, '')) };
          else {
            const sp = spaces.find(s => s.id === proj.value);
            if (!sp) throw new Error('Choose a project first. Projects are made in the project spaces panel.');
            patch.scope = { kind: 'project', value: sp.id, label: sp.name };
          }
          if (patch.scope.kind === 'site' && !patch.scope.value) throw new Error('Type the site, for example example.com.');
          if (expiry.value === 'never') patch.expires = null;
          else if (expiry.value !== 'keep') patch.expires = Date.now() + Number(expiry.value) * DAY;
          this.update(id, patch);
          close();
          if (after) after();
        } catch (err) { msg.textContent = err.message; }
      }, { primary: true }),
      VexSettingsGroups.button('Cancel', close),
    );
    body.append(lab('The fact'), text, lab('Where it applies'), scope, site, proj, lab('How long to use it'), expiry, msg, bar);
    text.focus({ preventScroll: true });
  },

  // ---- "Which facts did you use?" ---------------------------------------------------------------
  openWhy() {
    if (typeof VexSettingsGroups === 'undefined') { window.showToast?.('The list is unavailable', 'error'); return; }
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-memory-why', title: 'Which facts did you use?', sub: 'The facts put into the last AI chat request.' });
    const li = this.lastInjection;
    if (!this.data.enabled) { body.appendChild(VexSettingsGroups.note('AI memory is switched off, so no fact is put into any request. Turn it on in Settings › AI Memory.')); return; }
    if (!li) { body.appendChild(VexSettingsGroups.note('No chat request has been made since Vex started.')); return; }
    const when = new Date(li.at).toLocaleTimeString();
    body.appendChild(VexSettingsGroups.note('At ' + when + (li.where && li.where.host ? ' on ' + li.where.host : '') + (li.facts.length ? ': ' + li.facts.length + ' fact' + VexPlural.s(li.facts.length) + '.' : ': none applied.')
      + ' With the cloud backend these are left out unless you ticked "include memory".'));
    const ul = document.createElement('ul'); ul.style.margin = '8px 0 0 18px';
    for (const x of li.facts) {
      const item = document.createElement('li');
      const f = this.get(x.id);
      item.textContent = x.text + (f ? ' (' + this.describe(f) + ')' : ' (since forgotten)');
      ul.appendChild(item);
    }
    body.appendChild(ul);
    const hidden = this.data.facts.filter(f => !li.facts.some(x => x.id === f.id));
    if (hidden.length) body.appendChild(VexSettingsGroups.note(hidden.length + ' other fact' + (hidden.length === 1 ? ' was' : 's were') + ' not used: expired, or meant for another site or project.'));
    body.appendChild(VexSettingsGroups.button('Close', close, { primary: true }));
  },

  _registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    CommandBar.commands = CommandBar.commands.filter(c => c.id !== 'ai-memory-why');
    CommandBar.commands.push({ id: 'ai-memory-why', label: 'AI: Which facts did you use?', hint: 'The remembered facts put into the last chat request, and why the others were left out', icon: 'brain', action: () => this.openWhy() });
  },

  async promptAdd() {
    // Electron's renderer disables native prompt() — it always returned null, so
    // the old fallback silently did nothing. Say so instead.
    if (typeof vexPromptModal !== 'function') {
      window.showToast?.('The prompt dialog is unavailable', 'error');
      return;
    }
    const v = await vexPromptModal('Tell Vex something to remember', '');
    if (v && v.trim()) this.add(v.trim());
  },

  renderSettings(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(s);
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:8px">Facts the AI keeps in mind in every chat (local <em>and</em> cloud). On this device, and on your other devices if Sync is on. Great for your name, role, tone preferences, languages, stack…</p>
      <div class="setting-toggle-row"><span>Use my memory in AI chats</span><label class="toggle"><input type="checkbox" id="mem-enabled" aria-label="Use my memory in AI chats" ${this.data.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label></div>
      <div class="setting-toggle-row"><span>Include memory when the answer comes from the cloud</span><label class="toggle"><input type="checkbox" id="mem-cloud" aria-label="Include memory when the answer comes from the cloud" ${this.data.includeCloud ? 'checked' : ''}><span class="toggle-slider"></span></label></div>
      <p class="setting-info muted" style="margin:2px 0 8px">Off by default: with the cloud backend, your facts are left out of the request unless you tick this. The local model and on-device AI always get them while memory is on.</p>
      <div style="display:flex;gap:8px;margin:10px 0">
        <input id="mem-input" type="text" placeholder="e.g. I prefer concise answers with code examples" spellcheck="false" style="flex:1;padding:8px 11px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;font-family:'Outfit',sans-serif">
        <button id="mem-add" style="padding:8px 16px;background:var(--primary);color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600">Add</button>
      </div>
      <div id="mem-list"></div>
      <details style="margin-top:8px"><summary>Edit as plain text</summary>
        <p class="setting-info muted" style="margin:6px 0">One fact per line. Saving replaces the list with these lines.</p>
        <textarea id="mem-text" class="set-input" rows="6" spellcheck="false" aria-label="Memory as plain text" style="width:100%;box-sizing:border-box"></textarea>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button type="button" class="btn-secondary" id="mem-text-save">Save text</button>
          <button type="button" class="btn-danger" id="mem-clear">Clear all</button>
        </div>
      </details>`;
    const listEl = container.querySelector('#mem-list');
    const textEl = container.querySelector('#mem-text');
    const renderList = () => {
      textEl.value = this.asText();
      if (!this.data.facts.length) { listEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 2px">Nothing remembered yet.</div>'; return; }
      listEl.innerHTML = '';
      this.data.facts.forEach(f => {
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 9px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:6px';
        const expired = this.isExpired(f);
        if (expired) r.style.opacity = '.6';
        r.innerHTML = `<span style="flex:1;font-size:12.5px;color:var(--text)">${esc(f.text)}<span style="display:block;font-size:11px;color:var(--text-muted)">${esc(this.describe(f))}</span></span><button data-edit style="border:1px solid var(--border);background:none;color:var(--text);cursor:pointer;font-size:11.5px;border-radius:6px;padding:3px 8px" aria-label="Edit this fact">Edit</button><button data-x style="width:22px;height:22px;border:none;background:none;color:var(--text-muted);cursor:pointer;font-size:13px" title="Forget this" aria-label="Forget this">${window.VexIcons ? VexIcons.svg('x', { size: 13 }) : 'x'}</button>`;
        r.querySelector('[data-x]').addEventListener('click', () => { this.remove(f.id); renderList(); });
        r.querySelector('[data-edit]').addEventListener('click', () => this.openEditor(f.id, renderList));
        listEl.appendChild(r);
      });
    };
    renderList();
    container.querySelector('#mem-enabled').addEventListener('change', (e) => { this.setEnabled(e.target.checked); window.showToast?.(e.target.checked ? 'AI memory on' : 'AI memory off'); });
    container.querySelector('#mem-cloud').addEventListener('change', (e) => { this.setIncludeCloud(e.target.checked); window.showToast?.(e.target.checked ? 'Memory is included with cloud answers' : 'Memory is kept out of cloud answers'); });
    container.querySelector('#mem-text-save').addEventListener('click', () => {
      const n = this.setFromText(textEl.value);
      renderList();
      window.showToast?.(n ? 'Memory saved (' + n + ')' : 'Memory is empty');
    });
    container.querySelector('#mem-clear').addEventListener('click', async () => {
      if (!this.data.facts.length) return;
      if (typeof vexConfirm !== 'function') { window.showToast?.('The confirm dialog is unavailable', 'error'); return; }
      const ok = await vexConfirm({ title: 'Clear AI memory', message: 'Forget all ' + this.data.facts.length + ' remembered facts?', okLabel: 'Clear', danger: true });
      if (!ok) return;
      this.clear();
      renderList();
    });
    const input = container.querySelector('#mem-input');
    const addNow = () => { if (this.add(input.value)) { input.value = ''; renderList(); } };
    container.querySelector('#mem-add').addEventListener('click', addNow);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addNow(); });
  },
};

if (typeof window !== 'undefined') window.AIMemory = AIMemory;
if (typeof module !== 'undefined' && module.exports) module.exports = { AIMemory };
