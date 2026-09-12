// === Vex Work panel ===
//
// The home for the profession picked in Job Setup: who you are set up as, the
// AI one click away, the tools you chose, and the way back to the picker.
//
// The layout is in css/work-panel.css rather than inline styles. What changed
// is the weighting: everything used to be the same size and colour, competing
// for attention — a cramped two-column grid of icon-and-name tiles told you
// nothing about what a tool did. Now the job identifies itself, the AI is the
// one prominent action, tools are a readable list with their descriptions, and
// the secondary actions sit quietly underneath.
const WorkPanel = {
  _icon(name, size) {
    return (window.VexIcons && VexIcons.has(name)) ? VexIcons.svg(name, { size: size || 15 }) : '';
  },

  renderPanel(container) {
    if (!container) return;
    const esc = (s) => (window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || ''));
    const jobId = (window.JobProfiles && JobProfiles.current && JobProfiles.current()) || null;
    const job = jobId && window.JobProfiles ? JobProfiles.get(jobId) : null;

    if (!job) { this._renderSetup(container); return; }

    const enabled = this._enabledTools(job);
    const tools = (window.Toolbox ? Toolbox.all().filter(t => enabled.includes(t.id)) : []);
    const themeMeta = (typeof ThemeManager !== 'undefined' && ThemeManager.getThemeMeta)
      ? ThemeManager.getThemeMeta(job.theme) : { label: job.theme, accent: '#6366f1' };

    container.innerHTML = `
      <div class="panel-header"><h2>Work</h2></div>
      <div class="wp-body">
        <div class="wp-identity">
          <span class="wp-swatch" style="background:${esc(themeMeta.accent || '#6366f1')}">${this._icon('briefcase', 17)}</span>
          <span class="wp-identity-text">
            <span class="wp-job">${esc(job.name)}</span>
            <span class="wp-meta"><span class="wp-tag">${esc(job.cat)}</span>${esc(themeMeta.label || job.theme)}</span>
          </span>
          <button class="wp-change" id="wp-change">Change</button>
        </div>

        <button class="wp-ai" id="wp-ai" title="Chat with Vex AI about your work">
          <span class="wp-ai-icon">${this._icon('sparkles', 19)}</span>
          <span class="wp-ai-text">
            <span class="wp-ai-title">Ask Vex AI</span>
            <span class="wp-ai-where" id="wp-ai-where">Checking where AI runs…</span>
          </span>
        </button>

        <section class="wp-section">
          <div class="wp-section-head">
            Your tools <span class="wp-section-count">${tools.length}</span>
            <button class="wp-section-action" id="wp-manage">Manage</button>
          </div>
          <div class="wp-tools" id="wp-tools"></div>
        </section>

        <section class="wp-section">
          <div class="wp-section-head">Quick actions</div>
          <div class="wp-actions">
            <button class="wp-act" data-act="toolbox"><span class="wp-act-icon">${this._icon('toolbox', 15)}</span>Open the full Toolbox</button>
            <button class="wp-act" data-act="note"><span class="wp-act-icon">${this._icon('note', 15)}</span>Sticky note for this page</button>
          </div>
        </section>
      </div>`;

    const list = container.querySelector('#wp-tools');
    if (!tools.length) {
      const empty = document.createElement('div');
      empty.className = 'wp-empty';
      empty.textContent = 'No tools chosen yet. Manage adds the ones you use from all ' + (window.Toolbox ? Toolbox.all().length : 'the') + ' in the Toolbox.';
      list.appendChild(empty);
    }
    for (const t of tools) {
      const b = document.createElement('button');
      b.className = 'wp-tool';
      b.title = t.desc || t.name;
      b.innerHTML = `<span class="wp-tool-icon">${window.Toolbox ? Toolbox.iconMarkup(t, 14) : ''}</span>
        <span class="wp-tool-text"><span class="wp-tool-name"></span><span class="wp-tool-desc"></span></span>`;
      b.querySelector('.wp-tool-name').textContent = t.name;
      b.querySelector('.wp-tool-desc').textContent = t.desc || '';
      b.addEventListener('click', () => {
        try { window.Toolbox && Toolbox.openTool(t.id); }
        catch (err) { window.showToast?.('Could not open ' + t.name + ': ' + ((err && err.message) || ''), 'error'); }
      });
      list.appendChild(b);
    }

    this._wireAI(container, job);
    const openSetup = () => { try { window.JobSetup && JobSetup.open(); } catch (err) { window.showToast?.('Could not open job setup', 'error'); } };
    container.querySelector('#wp-change')?.addEventListener('click', openSetup);
    container.querySelector('#wp-manage')?.addEventListener('click', openSetup);
    container.querySelectorAll('.wp-act').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      try {
        if (a === 'toolbox') { window.Toolbox && Toolbox.open(); }
        else if (a === 'note') { window.StickyNotes && StickyNotes.open(); }
      } catch (err) { window.showToast?.('That did not open: ' + ((err && err.message) || ''), 'error'); }
    }));
  },

  // Not set up yet — a clear way into the existing picker.
  _renderSetup(container) {
    container.innerHTML = `
      <div class="panel-header"><h2>Work</h2></div>
      <div class="wp-setup">
        <div class="wp-setup-icon">${this._icon('briefcase', 34)}</div>
        <div class="wp-setup-title">A Vex built for your work</div>
        <div class="wp-setup-body">Pick your profession and Vex applies a fitting theme and the built-in tools you use daily — regex, JSON, colour, word count and more. You choose exactly which.</div>
        <button class="wp-setup-btn" id="wp-setup">Choose my job</button>
      </div>`;
    container.querySelector('#wp-setup')?.addEventListener('click', () => {
      try { window.JobSetup && JobSetup.open(); } catch (err) { window.showToast?.('Could not open job setup', 'error'); }
    });
  },

  // Which tools this panel shows.
  //
  // New profiles get the job's recommended set. A profile saved before tools
  // outlived their tab keeps whatever it holds.
  MIGRATION_KEY: 'vex.jobToolsIconMigrated',

  _enabledTools(job) {
    const recommended = () => (job.tools || []).slice();
    let saved = null;
    try { const a = JSON.parse(localStorage.getItem('vex.jobTools') || 'null'); if (Array.isArray(a)) saved = a; } catch { saved = null; }
    return saved || recommended();
  },

  // Open the AI chat from the Work panel.
  //
  // AIPanel is a top-level `const`, not a property of window, so it has to be
  // reached by bare identifier — `window.AIPanel?.open()` is undefined and
  // would make this button do nothing at all, silently.
  _wireAI(container, job) {
    const btn = container.querySelector('#wp-ai');
    if (!btn) return;
    const where = container.querySelector('#wp-ai-where');
    if (where) {
      where.textContent = this._aiWhere();
      // `available` is null until the first ping, and reporting that as "not
      // running" would state a guess as fact. Ask, then say what came back.
      const r = window.AIRouter;
      if (r && typeof r.refreshOllamaStatus === 'function' && r.getOllamaStatus
          && r.getOllamaStatus().available === null) {
        Promise.resolve(r.refreshOllamaStatus())
          .then(() => { if (where.isConnected) where.textContent = this._aiWhere(); })
          .catch((err) => { if (where.isConnected) where.textContent = 'Could not check for a local model: ' + ((err && err.message) || 'unknown error'); });
      }
    }
    btn.addEventListener('click', () => {
      const panel = (typeof AIPanel !== 'undefined' && AIPanel) || null;
      if (!panel || typeof panel.open !== 'function') {
        window.showToast?.('The AI panel is not available', 'error');
        return;
      }
      panel.open();
      if (job && job.name && typeof panel.sendMessage === 'function') {
        panel.sendMessage('chat', { message: `I work as a ${job.name}. Help me with my current page.` });
      }
    });
  },

  // Say honestly where a message would go: the local model when Ollama is up
  // and preferred, otherwise the cloud worker, otherwise nothing configured.
  _aiWhere() {
    try {
      const r = window.AIRouter;
      if (!r || typeof r.getOllamaStatus !== 'function') return 'Chat about your work';
      const s = r.getOllamaStatus();
      if (s.available === null) return 'Checking for a local model…';
      if (s.available && !s.forceCloud) return `Local — ${s.model || 'Ollama'}, private to this machine`;
      if (s.available) return 'Local model ready, but Vex is set to use the cloud';
      if (s.online) return 'Cloud — no local model is running';
      return 'Offline, and no local model is running';
    } catch { return 'Chat about your work'; }
  },

  refresh() {
    const el = document.getElementById('panel-work');
    if (el && getComputedStyle(el).display !== 'none') this.renderPanel(el);
  },
};

if (typeof window !== 'undefined') window.WorkPanel = WorkPanel;
if (typeof module !== 'undefined' && module.exports) module.exports = { WorkPanel };
