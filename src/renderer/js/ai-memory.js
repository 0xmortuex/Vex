// === Vex AI Memory: facts the assistant remembers across sessions ===
//
// A small store of user-stated facts/preferences ("I'm a TypeScript dev",
// "always answer concisely", "I live in Istanbul"). When enabled, they're
// injected as a system message at the FRONT of the chat history on every AI
// request — so it works on BOTH the local (Ollama) and cloud (worker) backends
// without any server change, and it's additive (never replaces the tuned
// default/persona prompt). Stored in localStorage 'vex.aiMemory'.

const AIMemory = {
  KEY: 'vex.aiMemory',
  // Off until the user switches it on; and, even then, not sent to a cloud
  // backend until they tick "include memory" for it (includeCloud).
  data: { enabled: false, includeCloud: false, facts: [] },

  init() {
    try { const d = JSON.parse(localStorage.getItem(this.KEY) || 'null'); if (d && typeof d === 'object') this.data = { enabled: d.enabled === true, includeCloud: d.includeCloud === true, facts: Array.isArray(d.facts) ? d.facts : [] }; } catch {}
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch {} },

  list() { return this.data.facts; },
  add(text) {
    text = (text || '').trim();
    if (!text) return false;
    if (this.data.facts.some(f => f.text.toLowerCase() === text.toLowerCase())) { window.showToast?.('Already remembered'); return false; }
    this.data.facts.unshift({ id: vexId('m'), text: text.slice(0, 400), at: Date.now() });
    if (this.data.facts.length > 100) this.data.facts.length = 100;
    this.save();
    window.showToast?.('Vex will remember that');
    return true;
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
      facts.push(old.get(t.toLowerCase()) || { id: vexId('m'), text: t, at: Date.now() });
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
  historyMessage(backend = 'local') {
    if (!this.allowsBackend(backend) || !this.data.facts.length) return null;
    const body = 'The user has asked you to remember these facts and preferences about them. Honor them whenever relevant:\n' +
      this.data.facts.map(f => '- ' + f.text).join('\n');
    // vexMemory lets the router take it back out before a request goes to the
    // cloud when the user has not ticked it (ai-router.js callBackend).
    return { role: 'system', content: body, vexMemory: true };
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
        r.innerHTML = `<span style="flex:1;font-size:12.5px;color:var(--text)">${esc(f.text)}</span><button data-x style="width:22px;height:22px;border:none;background:none;color:var(--text-muted);cursor:pointer;font-size:13px" title="Forget this" aria-label="Forget this">${window.VexIcons ? VexIcons.svg('x', { size: 13 }) : 'x'}</button>`;
        r.querySelector('[data-x]').addEventListener('click', () => { this.remove(f.id); renderList(); });
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
