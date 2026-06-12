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
  data: { enabled: true, facts: [] },

  init() {
    try { const d = JSON.parse(localStorage.getItem(this.KEY) || 'null'); if (d && typeof d === 'object') this.data = { enabled: d.enabled !== false, facts: Array.isArray(d.facts) ? d.facts : [] }; } catch {}
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch {} },

  list() { return this.data.facts; },
  add(text) {
    text = (text || '').trim();
    if (!text) return false;
    if (this.data.facts.some(f => f.text.toLowerCase() === text.toLowerCase())) { window.showToast?.('Already remembered'); return false; }
    this.data.facts.unshift({ id: 'm' + Date.now().toString(36), text: text.slice(0, 400), at: Date.now() });
    if (this.data.facts.length > 100) this.data.facts.length = 100;
    this.save();
    window.showToast?.('🧠 Vex will remember that');
    return true;
  },
  remove(id) { this.data.facts = this.data.facts.filter(f => f.id !== id); this.save(); },
  setEnabled(v) { this.data.enabled = !!v; this.save(); },

  // The system message injected into chat history (null when off/empty).
  historyMessage() {
    if (!this.data.enabled || !this.data.facts.length) return null;
    const body = 'The user has asked you to remember these facts and preferences about them. Honor them whenever relevant:\n' +
      this.data.facts.map(f => '- ' + f.text).join('\n');
    return { role: 'system', content: body };
  },

  async promptAdd() {
    const v = typeof vexPromptModal === 'function' ? await vexPromptModal('Tell Vex something to remember', '') : prompt('Remember:');
    if (v && v.trim()) this.add(v.trim());
  },

  renderSettings(container) {
    if (!container) return;
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:8px">Facts the AI keeps in mind in every chat (local <em>and</em> cloud). Stored only on this device. Great for your name, role, tone preferences, languages, stack…</p>
      <div class="setting-toggle-row"><span>Use my memory in AI chats</span><label class="toggle"><input type="checkbox" id="mem-enabled" ${this.data.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label></div>
      <div style="display:flex;gap:8px;margin:10px 0">
        <input id="mem-input" type="text" placeholder="e.g. I prefer concise answers with code examples" spellcheck="false" style="flex:1;padding:8px 11px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;font-family:'Outfit',sans-serif">
        <button id="mem-add" style="padding:8px 16px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600">Add</button>
      </div>
      <div id="mem-list"></div>`;
    const listEl = container.querySelector('#mem-list');
    const renderList = () => {
      if (!this.data.facts.length) { listEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 2px">Nothing remembered yet.</div>'; return; }
      listEl.innerHTML = '';
      this.data.facts.forEach(f => {
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 9px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:6px';
        r.innerHTML = `<span style="flex:1;font-size:12.5px;color:var(--text)">${esc(f.text)}</span><button data-x style="width:22px;height:22px;border:none;background:none;color:var(--text-muted);cursor:pointer;font-size:13px">✕</button>`;
        r.querySelector('[data-x]').addEventListener('click', () => { this.remove(f.id); renderList(); });
        listEl.appendChild(r);
      });
    };
    renderList();
    container.querySelector('#mem-enabled').addEventListener('change', (e) => { this.setEnabled(e.target.checked); window.showToast?.(e.target.checked ? 'AI memory on' : 'AI memory off'); });
    const input = container.querySelector('#mem-input');
    const addNow = () => { if (this.add(input.value)) { input.value = ''; renderList(); } };
    container.querySelector('#mem-add').addEventListener('click', addNow);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addNow(); });
  },
};

if (typeof window !== 'undefined') window.AIMemory = AIMemory;
if (typeof module !== 'undefined' && module.exports) module.exports = { AIMemory };
