// === Vex Automations (if-this-then-that for the browser) ===
// Simple rules: WHEN a page URL contains X (or at a time each day) → DO an action
// (open a URL, open a panel, or run a command). Builds on the command palette +
// a light background poller. Rules live in localStorage 'vex.automations'.
// Ctrl+K → "Automations".
const Automations = {
  KEY: 'vex.automations',
  _lastUrl: '', _started: false,

  _load() { try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  _save(a) { try { localStorage.setItem(this.KEY, JSON.stringify(a)); } catch {} },

  // ---- Background engine ----
  start() {
    if (this._started) return;
    this._started = true;
    setInterval(() => this._tickUrl(), 3000);
    setInterval(() => this._tickTime(), 30000);
  },
  _activeUrl() { try { const t = TabManager.getActiveTab(); return (t && t.url) || ''; } catch { return ''; } },
  _tickUrl() {
    const url = this._activeUrl();
    if (url === this._lastUrl) return;
    this._lastUrl = url;
    if (!/^https?:/i.test(url)) return;
    this._load().forEach((r) => {
      if (!r.enabled || !r.trigger || r.trigger.type !== 'url') return;
      const pat = (r.trigger.value || '').toLowerCase();
      if (pat && url.toLowerCase().includes(pat) && r._firedUrl !== url) {
        r._firedUrl = url;  // in-memory (avoid re-firing on the same page)
        this._runAction(r);
      }
    });
  },
  _tickTime() {
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const today = now.toDateString();
    const rules = this._load(); let changed = false;
    rules.forEach((r) => {
      if (!r.enabled || !r.trigger || r.trigger.type !== 'time') return;
      if (r.trigger.value === hhmm && r._firedDate !== today) { r._firedDate = today; changed = true; this._runAction(r); }
    });
    if (changed) this._save(rules);
  },
  _runAction(r) {
    try {
      const a = r.action || {};
      if (a.type === 'open' && a.value) TabManager.createTab(/^https?:/i.test(a.value) ? a.value : 'https://' + a.value, true);
      else if (a.type === 'panel' && a.value) SidebarManager.openPanel(a.value);
      else if (a.type === 'command' && a.value) { const c = (typeof CommandBar !== 'undefined' ? CommandBar.commands : []).find((x) => x.id === a.value); if (c && c.action) c.action(); }
      window.showToast?.('⚙️ Automation: ' + (r.name || 'ran'));
    } catch {}
  },

  // ---- UI ----
  open() {
    document.getElementById('vex-automations')?.remove();
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');
    const rules = this._load();
    const m = document.createElement('div');
    m.id = 'vex-automations';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:540px;max-width:95vw;max-height:86vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;padding:16px 18px 8px"><span style="font-size:14px;font-weight:700;color:var(--text);flex:1">⚙️ Automations</span><button id="au-close" style="${this._chip()}">✕</button></div>
      <div style="padding:0 18px 8px;font-size:11.5px;color:var(--text-muted)">Run an action automatically when a page opens, or at a set time each day.</div>
      <div id="au-list" style="overflow-y:auto;padding:4px 16px">${rules.length ? rules.map((r, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--border);border-radius:9px;margin-bottom:6px;background:var(--bg)">
          <input type="checkbox" data-tog="${i}" ${r.enabled ? 'checked' : ''} style="cursor:pointer">
          <span style="flex:1;min-width:0">
            <span style="display:block;font-size:12.5px;font-weight:600;color:var(--text)">${esc(r.name || 'Rule')}</span>
            <span style="display:block;font-size:11px;color:var(--text-muted)">${esc(this._describe(r))}</span>
          </span>
          <button data-del="${i}" style="${this._chip()}">✕</button>
        </div>`).join('') : '<div style="color:var(--text-muted);padding:8px 2px;font-size:12px">No automations yet.</div>'}</div>
      <div id="au-builder" style="padding:12px 18px;border-top:1px solid var(--border)">
        <input id="au-name" placeholder="Name (e.g. Morning routine)" style="${this._inp()};margin-bottom:8px">
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <select id="au-trig" style="${this._inp()};flex:0 0 44%">
            <option value="url">When a page URL contains…</option>
            <option value="time">At a time each day…</option>
          </select>
          <input id="au-trigval" placeholder="gmail.com" style="${this._inp()};flex:1">
        </div>
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <select id="au-act" style="${this._inp()};flex:0 0 44%">
            <option value="open">Open a URL</option>
            <option value="panel">Open a panel</option>
            <option value="command">Run a command</option>
          </select>
          <input id="au-actval" placeholder="https://calendar.google.com" list="au-cmds" style="${this._inp()};flex:1">
          <datalist id="au-cmds">${(typeof CommandBar !== 'undefined' ? CommandBar.commands : []).map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</datalist>
        </div>
        <button id="au-add" style="${this._primary()};width:100%">Add automation</button>
      </div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#au-close').addEventListener('click', () => m.remove());
    const trig = m.querySelector('#au-trig'), act = m.querySelector('#au-act');
    trig.addEventListener('change', () => { m.querySelector('#au-trigval').placeholder = trig.value === 'time' ? '08:30 (24h)' : 'gmail.com'; });
    act.addEventListener('change', () => { m.querySelector('#au-actval').placeholder = act.value === 'panel' ? 'discord / spotify / notes…' : act.value === 'command' ? 'a command id (see suggestions)' : 'https://calendar.google.com'; });
    m.querySelector('#au-add').addEventListener('click', () => {
      const name = (m.querySelector('#au-name').value || '').trim();
      const tv = (m.querySelector('#au-trigval').value || '').trim();
      const av = (m.querySelector('#au-actval').value || '').trim();
      if (!tv || !av) { window.showToast?.('Fill in the trigger and action'); return; }
      const list = this._load();
      list.push({ id: 'a' + Date.now(), name: name || (trig.value === 'time' ? 'At ' + tv : 'On ' + tv), enabled: true, trigger: { type: trig.value, value: tv }, action: { type: act.value, value: av } });
      this._save(list); this.open();
    });
    m.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { const list = this._load(); list.splice(parseInt(b.dataset.del, 10), 1); this._save(list); this.open(); }));
    m.querySelectorAll('[data-tog]').forEach((b) => b.addEventListener('change', () => { const list = this._load(); const i = parseInt(b.dataset.tog, 10); if (list[i]) { list[i].enabled = b.checked; this._save(list); } }));
  },

  _describe(r) {
    const t = r.trigger || {}, a = r.action || {};
    const when = t.type === 'time' ? ('at ' + t.value) : ('when a URL contains "' + t.value + '"');
    const doo = a.type === 'open' ? ('open ' + a.value) : a.type === 'panel' ? ('open the ' + a.value + ' panel') : ('run "' + a.value + '"');
    return when + ' → ' + doo;
  },
  _chip() { return "padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif"; },
  _primary() { return "padding:8px 14px;background:var(--primary,var(--accent,#d4a574));color:#111;border:1px solid transparent;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:600;font-family:'Outfit',sans-serif"; },
  _inp() { return "padding:8px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;font-size:12.5px;font-family:'Outfit',sans-serif;box-sizing:border-box"; },
};

if (typeof window !== 'undefined') {
  window.Automations = Automations;
  const boot = () => { try { Automations.start(); } catch {} };
  if (document.readyState !== 'loading') setTimeout(boot, 2000);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 2000));
}
