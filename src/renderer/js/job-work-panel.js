// === Vex Work panel ===
// A dedicated sidebar panel for the profession picked in Job Setup: your enabled
// Toolbox tools one click away, the current job + theme, quick actions, and a
// link back to the picker (job-setup.js) to change job or toggle tools. The
// picker and registry already exist (job-profiles.js / job-setup.js / toolbox.js)
// — this is the always-available home for them.
const WorkPanel = {
  renderPanel(container) {
    if (!container) return;
    const esc = (s) => (window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || ''));
    const jobId = (window.JobProfiles && JobProfiles.current && JobProfiles.current()) || null;
    const job = jobId && window.JobProfiles ? JobProfiles.get(jobId) : null;

    // Not set up yet — a clear call to action into the existing picker.
    if (!job) {
      container.innerHTML = `
        <style>#panel-work .wp-tool{transition:transform .12s ease,border-color .12s ease,background .12s ease}#panel-work .wp-tool:hover{transform:translateY(-2px);border-color:var(--primary,var(--accent))}#panel-work .wp-tool:active{transform:translateY(0)}#panel-work .wp-act:hover{border-color:var(--primary,var(--accent))}#panel-work .wp-tool .wp-ic{font-size:16px}</style><div class="panel-header"><h2>Work</h2></div>
        <div style="padding:24px 18px;text-align:center;color:var(--text)">
          <div style="font-size:34px;margin-bottom:8px">🧑‍💼</div>
          <div style="font-size:14px;font-weight:700;margin-bottom:6px">A Vex built for your work</div>
          <div style="font-size:12.5px;color:var(--text-muted);line-height:1.6;margin-bottom:16px">Pick your profession and Vex applies a fitting theme and the built-in tools you use daily — regex, JSON, color, word count, and more. You choose exactly which.</div>
          <button id="wp-setup" style="padding:11px 20px;background:var(--primary,var(--accent));color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;font-family:'Outfit',sans-serif">Choose my job →</button>
        </div>`;
      container.querySelector('#wp-setup')?.addEventListener('click', () => { try { window.JobSetup && JobSetup.open(); } catch {} });
      return;
    }

    const enabled = (() => { try { const a = JSON.parse(localStorage.getItem('vex.jobTools') || 'null'); return Array.isArray(a) ? a : job.tools.slice(); } catch { return job.tools.slice(); } })();
    const tools = (window.Toolbox ? Toolbox.TOOLS.filter(t => enabled.includes(t.id)) : []);
    const themeMeta = (typeof ThemeManager !== 'undefined' && ThemeManager.getThemeMeta) ? ThemeManager.getThemeMeta(job.theme) : { label: job.theme, accent: '#6366f1' };

    const toolCard = (t) => `<button class="wp-tool" data-id="${esc(t.id)}" title="${esc(t.desc)}" style="text-align:left;padding:11px 12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-family:'Outfit',sans-serif">
        <div style="font-size:15px">${esc(t.icon)}</div>
        <div style="font-size:12.5px;font-weight:600;color:var(--text);margin-top:4px">${esc(t.name)}</div>
      </button>`;

    container.innerHTML = `
      <style>#panel-work .wp-tool{transition:transform .12s ease,border-color .12s ease,background .12s ease}#panel-work .wp-tool:hover{transform:translateY(-2px);border-color:var(--primary,var(--accent))}#panel-work .wp-tool:active{transform:translateY(0)}#panel-work .wp-act:hover{border-color:var(--primary,var(--accent))}#panel-work .wp-tool .wp-ic{font-size:16px}</style><div class="panel-header"><h2>Work</h2></div>
      <div style="padding:0 16px 16px;overflow-y:auto;max-height:calc(100vh - 120px)">
        <div style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:11px;margin-bottom:14px">
          <span style="width:20px;height:20px;border-radius:6px;background:${esc(themeMeta.accent || '#6366f1')};border:1px solid var(--border);flex:none"></span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px"><div style="font-size:14px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(job.name)}</div><span style="font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted);border:1px solid var(--border);border-radius:5px;padding:1px 5px;flex:none">${esc(job.cat)}</span></div>
            <div style="font-size:11px;color:var(--text-muted)">Theme: ${esc(themeMeta.label || job.theme)}</div>
          </div>
          <button id="wp-change" style="padding:6px 10px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:11.5px;font-family:'Outfit',sans-serif">Change</button>
        </div>

        <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin:0 2px 8px">Your tools</div>
        <div id="wp-tools" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">${tools.map(toolCard).join('') || '<div style="grid-column:1/-1;font-size:12px;color:var(--text-muted);padding:6px 2px">No tools enabled — add some below.</div>'}</div>
        <button id="wp-manage" style="width:100%;padding:9px;background:none;border:1px dashed var(--border);border-radius:9px;color:var(--text-muted);cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif;margin-bottom:16px">＋ Manage tools</button>

        <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin:0 2px 8px">Quick actions</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="wp-act" data-act="toolbox" style="text-align:left;padding:9px 11px;background:var(--bg);border:1px solid var(--border);border-radius:9px;color:var(--text);cursor:pointer;font-size:12.5px;font-family:'Outfit',sans-serif">🧰  Open the full Toolbox</button>
          <button class="wp-act" data-act="note" style="text-align:left;padding:9px 11px;background:var(--bg);border:1px solid var(--border);border-radius:9px;color:var(--text);cursor:pointer;font-size:12.5px;font-family:'Outfit',sans-serif">📝  Sticky note for this page</button>
        </div>
      </div>`;

    container.querySelectorAll('.wp-tool').forEach(b => b.addEventListener('click', () => { try { window.Toolbox && Toolbox.openTool(b.dataset.id); } catch {} }));
    container.querySelector('#wp-change')?.addEventListener('click', () => { try { window.JobSetup && JobSetup.open(); } catch {} });
    container.querySelector('#wp-manage')?.addEventListener('click', () => { try { window.JobSetup && JobSetup.open(); } catch {} });
    container.querySelectorAll('.wp-act').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      try {
        if (a === 'toolbox') { window.Toolbox && Toolbox.open(); }
        else if (a === 'note') { window.StickyNotes && StickyNotes.open(); }
      } catch {}
    }));
  },

  // Re-render if the panel is currently open (e.g. after the job changes).
  refresh() {
    try {
      if (typeof SidebarManager !== 'undefined' && SidebarManager.activePanel === 'work') {
        const el = document.getElementById('panel-work');
        if (el) this.renderPanel(el);
      }
    } catch {}
  },
};

if (typeof window !== 'undefined') window.WorkPanel = WorkPanel;
if (typeof module !== 'undefined' && module.exports) module.exports = { WorkPanel };
