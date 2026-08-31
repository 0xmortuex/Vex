// === Vex Job Setup ===
// The picker UI behind Job Profiles: choose your profession, preview the theme
// it applies, and toggle which built-in tools you want (recommended ones are
// pre-selected; you can add or remove any). Used by the setup wizard, the
// Ctrl+K "Personalize for Your Job" command, and Settings.
const JobSetup = {
  _sel: null, // selected job id (view 2)
  _tools: null, // Set of enabled tool ids

  open() {
    document.getElementById('vex-jobsetup')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-jobsetup';
    m.style.cssText = 'position:fixed;inset:0;z-index:100061;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-family:\'Outfit\',sans-serif';
    m.innerHTML = `<div style="width:560px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,0.55);overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:18px 20px 10px"><span style="font-size:16px;font-weight:800;color:var(--text);flex:1">🧑‍💼 A Vex built for your work</span><button id="jsx-close" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px">✕</button></div>
      <div id="jsx-body" style="padding:6px 20px 20px;overflow:auto;flex:1"></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#jsx-close').addEventListener('click', () => m.remove());
    this._sel = null; this._tools = null;
    this._renderPick(m);
  },

  _esc(s) { return window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || ''); },

  // View 1 — search + category-grouped job grid.
  _renderPick(m, filter) {
    const body = m.querySelector('#jsx-body');
    const jobs = JobProfiles.list().filter(j => !filter || j.name.toLowerCase().includes(filter) || j.cat.toLowerCase().includes(filter));
    const cats = JobProfiles.CATEGORIES.filter(c => jobs.some(j => j.cat === c));
    body.innerHTML = `
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">Pick your profession and Vex applies a fitting theme + the tools you use daily. You choose exactly which tools.</div>
      <input id="jsx-search" placeholder="Search jobs…" value="${this._esc(filter || '')}" style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:13px;margin-bottom:12px;font-family:'Outfit',sans-serif">
      ${cats.map(c => `<div style="margin:12px 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);font-weight:700">${c}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${jobs.filter(j => j.cat === c).map(j => `<button class="jsx-job" data-id="${j.id}" style="text-align:left;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:9px;cursor:pointer;font-size:13px;color:var(--text);font-family:'Outfit',sans-serif">${this._esc(j.name)}</button>`).join('')}
        </div>`).join('') || '<div style="color:var(--text-muted);font-size:13px;padding:12px 0">No matching jobs.</div>'}`;
    const search = body.querySelector('#jsx-search');
    search.addEventListener('input', () => this._renderPick(m, search.value.trim().toLowerCase()));
    // keep focus + caret at end after re-render
    search.focus(); search.setSelectionRange(search.value.length, search.value.length);
    body.querySelectorAll('.jsx-job').forEach(b => b.addEventListener('click', () => { this._sel = b.dataset.id; this._renderConfig(m); }));
  },

  // View 2 — theme preview + tool toggles for the chosen job.
  _renderConfig(m) {
    const body = m.querySelector('#jsx-body');
    const job = JobProfiles.get(this._sel);
    if (!job) return this._renderPick(m);
    // Initialize the working tool set once per selected job; keep it across the
    // re-renders that toggling triggers.
    if (!this._tools || this._toolsForJob !== job.id) { this._tools = new Set(job.tools); this._toolsForJob = job.id; }
    const allTools = (window.Toolbox && Toolbox.TOOLS) || [];
    const themeMeta = (typeof ThemeManager !== 'undefined' && ThemeManager.getThemeMeta) ? ThemeManager.getThemeMeta(job.theme) : { label: job.theme, accent: '#6366f1' };
    body.innerHTML = `
      <button id="jsx-back" style="background:none;border:none;color:var(--text-muted);font-size:12.5px;cursor:pointer;padding:0;margin-bottom:10px;font-family:'Outfit',sans-serif">← All jobs</button>
      <div style="font-size:18px;font-weight:800;color:var(--text)">${this._esc(job.name)}</div>
      <div style="display:flex;align-items:center;gap:8px;margin:10px 0 4px;font-size:13px;color:var(--text)">
        <span style="width:16px;height:16px;border-radius:5px;background:${this._esc(themeMeta.accent || '#6366f1')};display:inline-block;border:1px solid var(--border)"></span>
        Theme: <b>${this._esc(themeMeta.label || job.theme)}</b>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin:12px 0 6px">Tools — recommended for ${this._esc(job.name)} are on. Toggle any you want:</div>
      <div id="jsx-tools" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"></div>
      <div style="display:flex;gap:8px;margin-top:16px;align-items:center">
        <span style="flex:1;font-size:11px;color:var(--text-muted)">Applies the theme + adds a 🧰 Toolbox button and quick tools by the Tor button.</span>
        <button id="jsx-apply" style="padding:10px 20px;background:var(--primary,var(--accent));color:#fff;border:none;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;font-family:'Outfit',sans-serif">Apply</button>
      </div>`;
    const grid = body.querySelector('#jsx-tools');
    allTools.forEach(t => {
      const on = this._tools.has(t.id);
      const rec = job.tools.includes(t.id);
      const el = document.createElement('button');
      el.className = 'jsx-tool';
      el.dataset.id = t.id;
      el.style.cssText = `text-align:left;padding:9px 11px;border-radius:9px;cursor:pointer;font-family:'Outfit',sans-serif;border:1px solid ${on ? 'var(--primary,var(--accent))' : 'var(--border)'};background:${on ? 'color-mix(in srgb, var(--primary,var(--accent)) 12%, var(--bg))' : 'var(--bg)'}`;
      el.innerHTML = `<div style="display:flex;align-items:center;gap:6px"><span>${on ? '✓' : '+'}</span><span style="font-size:12.5px;font-weight:600;color:var(--text)">${t.icon} ${this._esc(t.name)}</span></div><div style="font-size:10.5px;color:var(--text-muted);margin-top:2px">${this._esc(t.desc)}${rec ? ' · recommended' : ''}</div>`;
      el.addEventListener('click', () => {
        if (this._tools.has(t.id)) this._tools.delete(t.id); else this._tools.add(t.id);
        this._renderConfig(m); // simplest: re-render to reflect state (keeps _tools)
      });
      grid.appendChild(el);
    });
    body.querySelector('#jsx-back').addEventListener('click', () => this._renderPick(m));
    body.querySelector('#jsx-apply').addEventListener('click', () => {
      JobProfiles.apply(job.id, [...this._tools]);
      window.showToast?.(`Vex personalized for ${job.name}`, 'success', 3000);
      m.remove();
    });
  },
};

if (typeof window !== 'undefined') window.JobSetup = JobSetup;
if (typeof module !== 'undefined' && module.exports) module.exports = { JobSetup };
