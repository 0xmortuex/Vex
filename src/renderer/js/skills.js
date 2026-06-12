// === Vex AI Skills — saved, reusable AI commands ===
//
// A Skill is a named prompt ("Summarize as 5 bullets", "Explain like I'm 5")
// that runs against the current page through the AI panel's chat pipeline
// (which already attaches page context). Skills appear in the command bar
// (Ctrl+K → type the skill name) and are managed from Settings → AI Skills.
// Stored in localStorage 'vex.skills'; ships with editable defaults.

const VexSkills = {
  KEY: 'vex.skills',
  skills: [],

  DEFAULTS: [
    { id: 'sk_bullets', name: 'Summarize in 5 bullets', emoji: '📌', prompt: 'Summarize this page in exactly 5 concise bullet points. No preamble.' },
    { id: 'sk_eli5', name: "Explain like I'm 5", emoji: '🧒', prompt: 'Explain what this page is about in very simple terms a child could understand. Short paragraphs, no jargon.' },
    { id: 'sk_actions', name: 'Extract action items', emoji: '✅', prompt: 'Extract every action item, task, deadline, or commitment from this page as a checklist. If none, say so.' },
    { id: 'sk_reply', name: 'Draft a reply', emoji: '✍️', prompt: 'Draft a clear, polite reply to the message or thread on this page. Match its language and tone. Give me only the reply text.' },
    { id: 'sk_critique', name: 'Find the weak points', emoji: '🔍', prompt: 'Critically evaluate the claims on this page. List the strongest points, the weakest/unsupported ones, and what is missing.' },
  ],

  init() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      this.skills = Array.isArray(saved) ? saved : this.DEFAULTS.slice();
    } catch { this.skills = this.DEFAULTS.slice(); }
    this._registerCommands();
  },

  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.skills)); } catch {}
    this._registerCommands();
  },

  run(id) {
    const sk = this.skills.find(s => s.id === id);
    if (!sk) return;
    if (typeof AIPanel === 'undefined') return;
    if (!AIPanel.isOpen?.()) AIPanel.open();
    AIPanel.sendMessage('chat', { message: sk.prompt });
  },

  // Surface every skill in the command bar (replacing stale entries on edit).
  _registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    CommandBar.commands = CommandBar.commands.filter(c => !String(c.id || '').startsWith('skill:'));
    this.skills.forEach(sk => {
      CommandBar.commands.push({
        id: 'skill:' + sk.id,
        label: sk.name,
        hint: 'AI Skill — run on the current page',
        icon: sk.emoji || '✦',
        action: () => this.run(sk.id),
      });
    });
  },

  // --- Settings → AI Skills management UI ---
  renderPanel(container) {
    if (!container) return;
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:10px">Reusable AI commands you can run on any page from the command bar (<kbd>Ctrl</kbd>+<kbd>K</kbd> → type the skill's name).</p>
      <div class="skills-list"></div>
      <button class="skill-add" style="margin-top:10px;padding:8px 16px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">+ New Skill</button>`;
    const list = container.querySelector('.skills-list');

    this.skills.forEach(sk => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-top:1px solid var(--border)';
      row.innerHTML = `
        <span style="font-size:18px;flex:0 0 auto;margin-top:1px">${esc(sk.emoji || '✦')}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13.5px;font-weight:600;color:var(--text)">${esc(sk.name)}</div>
          <div style="font-size:11.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(sk.prompt)}">${esc(sk.prompt)}</div>
        </div>
        <button data-run style="padding:5px 12px;background:var(--primary);color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Run</button>
        <button data-edit style="padding:5px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Edit</button>
        <button data-del style="padding:5px 10px;background:var(--bg);color:var(--danger);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">✕</button>`;
      row.querySelector('[data-run]').addEventListener('click', () => { SidebarManager.hideActivePanel?.(); this.run(sk.id); });
      row.querySelector('[data-edit]').addEventListener('click', () => this._editModal(sk, container));
      row.querySelector('[data-del]').addEventListener('click', () => {
        this.skills = this.skills.filter(s => s.id !== sk.id);
        this.save(); this.renderPanel(container);
      });
      list.appendChild(row);
    });

    container.querySelector('.skill-add').addEventListener('click', () => this._editModal(null, container));
  },

  _editModal(sk, container) {
    document.getElementById('skill-edit-modal')?.remove();
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    const m = document.createElement('div');
    m.id = 'skill-edit-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
    m.innerHTML = `<div style="width:440px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:22px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:14px">${sk ? 'Edit' : 'New'} Skill</div>
      <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:5px">Emoji</label>
      <input id="skm-emoji" type="text" maxlength="4" value="${esc(sk?.emoji || '✦')}" style="width:70px;padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:15px;outline:none;margin-bottom:12px">
      <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:5px">Name</label>
      <input id="skm-name" type="text" value="${esc(sk?.name || '')}" placeholder="Summarize in 5 bullets" style="width:100%;box-sizing:border-box;padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;margin-bottom:12px;font-family:'Outfit',sans-serif">
      <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:5px">Prompt (runs against the current page)</label>
      <textarea id="skm-prompt" rows="4" placeholder="What should the AI do?" style="width:100%;box-sizing:border-box;padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;resize:vertical;font-family:'Outfit',sans-serif">${esc(sk?.prompt || '')}</textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button id="skm-cancel" style="padding:8px 16px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Cancel</button>
        <button id="skm-save" style="padding:8px 18px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600">Save</button>
      </div></div>`;
    document.body.appendChild(m);
    m.querySelector('#skm-name').focus();
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#skm-cancel').addEventListener('click', () => m.remove());
    m.querySelector('#skm-save').addEventListener('click', () => {
      const name = m.querySelector('#skm-name').value.trim();
      const prompt = m.querySelector('#skm-prompt').value.trim();
      const emoji = m.querySelector('#skm-emoji').value.trim() || '✦';
      if (!name || !prompt) return;
      if (sk) { sk.name = name; sk.prompt = prompt; sk.emoji = emoji; }
      else this.skills.push({ id: 'sk_' + Date.now(), name, prompt, emoji });
      this.save();
      m.remove();
      this.renderPanel(container);
    });
  },
};

if (typeof window !== 'undefined') window.VexSkills = VexSkills;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSkills };
