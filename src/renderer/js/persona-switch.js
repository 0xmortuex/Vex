// === Vex per-tab persona quick-switcher ===
// Personas can differ PER TAB (a hidden feature) but there was no quick way to
// set it. This is a fast picker: choose which AI persona the current tab uses.
// Ctrl+K → "Switch AI Persona (this tab)". Also shows which one is active.
const PersonaSwitch = {
  open() {
    if (typeof PersonasManager === 'undefined') { window.showToast?.('Personas unavailable'); return; }
    document.getElementById('vex-personaswitch')?.remove();
    const tabId = (typeof TabManager !== 'undefined') ? TabManager.activeTabId : null;
    let list = [], active = null;
    try { list = PersonasManager.getAll() || []; } catch {}
    try { active = tabId ? PersonasManager.getActiveForTab(tabId) : null; } catch {}
    const activeId = active && active.id;
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');

    const m = document.createElement('div');
    m.id = 'vex-personaswitch';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.5);display:flex;align-items:flex-start;justify-content:center;padding-top:14vh';
    m.innerHTML = `<div style="width:460px;max-width:94vw;max-height:70vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="padding:16px 18px 8px;font-size:14px;font-weight:700;color:var(--text)">🎭 AI persona for this tab</div>
      <div style="padding:0 18px 8px;font-size:11.5px;color:var(--text-muted)">Each tab can use a different persona — pick one, or mention it mid-chat with <code>@name</code>.</div>
      <div id="ps-list" style="overflow-y:auto;padding:6px 12px 14px">${list.map(p => `
        <button data-id="${esc(p.id)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 11px;margin-bottom:5px;border-radius:9px;cursor:pointer;font-family:'Outfit',sans-serif;border:1px solid ${p.id === activeId ? 'var(--primary,var(--accent))' : 'var(--border)'};background:${p.id === activeId ? 'color-mix(in srgb,var(--primary,#6366f1) 12%,transparent)' : 'var(--bg)'};color:var(--text)">
          <span style="font-size:16px">${esc(p.emoji || p.icon || '🎭')}</span>
          <span style="flex:1;min-width:0">
            <span style="display:block;font-size:13px;font-weight:600">${esc(p.name || 'Persona')}${p.id === activeId ? ' · <span style="color:var(--primary,var(--accent));font-weight:400">active</span>' : ''}</span>
            <span style="display:block;font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((p.description || p.systemPrompt || '').slice(0, 70))}</span>
          </span>
        </button>`).join('')}</div>
      <div style="padding:0 18px 16px;font-size:11px;color:var(--text-muted)"><a id="ps-manage" style="color:var(--primary,var(--accent));cursor:pointer">Manage personas…</a></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelectorAll('#ps-list [data-id]').forEach(b => b.addEventListener('click', () => {
      try { PersonasManager.setActiveForTab(tabId, b.dataset.id); } catch {}
      const p = list.find(x => x.id === b.dataset.id);
      window.showToast?.('🎭 This tab now uses ' + (p ? p.name : 'that persona'));
      m.remove();
    }));
    m.querySelector('#ps-manage')?.addEventListener('click', () => { m.remove(); try { const c = (window.CommandBar && CommandBar.commands || []).find(x => x.id === 'personas'); if (c) c.action(); } catch {} });
    document.addEventListener('keydown', function esc2(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', esc2); m.remove(); } });
  },
};

if (typeof window !== 'undefined') window.PersonaSwitch = PersonaSwitch;
