// === Command chain steps with arguments =====================================
//
// Command chains (CommandChains in js/compose-chains.js) already run several
// command-bar actions in order from one name. Their steps could only be
// command-bar entries, so "open the standup tabs, 15 minute timer, mute
// Discord" could not be said: a timer needs its length, a mute its tab.
//
// This adds steps that carry an argument, kept in the same list of strings a
// chain already has (so storage, the Chains panel, sync and the command bar
// need no change):
//
//   open:<address>        open a page in the background
//   session:<name>        open a saved session, beside the open tabs
//   focus:<name>          start a Focus Flow
//   timer:<length>        start a timer  ("timer:15 min")
//   mute:<text> unmute:<text>   tabs whose address or title has the text
//   wait:<seconds>        pause (1-60)
//
// …and a way to write a chain as plain lines, one step each, which is checked
// as a whole before anything is saved: a line that means nothing is named.
const VexChainSteps = {
  KINDS: ['open', 'session', 'focus', 'timer', 'mute', 'unmute', 'wait'],

  _tabsMatching(text) {
    const q = String(text || '').trim().toLowerCase();
    if (!q || typeof TabManager === 'undefined') return [];
    return TabManager.tabs.filter(t => String(t.url || '').toLowerCase().includes(q) || String(t.title || '').toLowerCase().includes(q));
  },

  _setMuted(text, muted) {
    const hits = this._tabsMatching(text);
    if (!hits.length) throw new Error('No open tab matches “' + text + '”');
    let n = 0;
    for (const t of hits) {
      const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(t.id) : null;
      if (!wv || typeof wv.setAudioMuted !== 'function') continue;
      wv.setAudioMuted(muted);
      t.muted = muted;
      try { TabManager.renderTabUpdate(t); } catch { /* the strip redraws on its own */ }
      n++;
    }
    if (!n) throw new Error('The tab matching “' + text + '” is not loaded, so it cannot be ' + (muted ? 'muted' : 'unmuted'));
    return n;
  },

  // "kind:arg" → { kind, arg } or null when it is a plain command id.
  split(step) {
    const m = /^([a-z]+):([\s\S]*)$/.exec(String(step || ''));
    if (!m || !this.KINDS.includes(m[1])) return null;
    return { kind: m[1], arg: m[2].trim() };
  },

  // → { label, run } or null (not an argument step).
  resolve(step) {
    const s = this.split(step);
    if (!s) return null;
    const { kind, arg } = s;
    const need = (what) => { if (!arg) throw new Error(kind + ' needs ' + what); };
    switch (kind) {
      case 'open': return { label: 'Open ' + arg, run: () => {
        need('an address');
        if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
        TabManager.createTab(arg, false);
      } };
      case 'session': return { label: 'Open session ' + arg, run: async () => {
        need('a session name');
        const sess = (typeof SessionManager !== 'undefined' ? SessionManager.sessions : []).find(x => String(x.name).toLowerCase() === arg.toLowerCase());
        if (!sess) throw new Error('No saved session is called “' + arg + '”');
        await SessionManager.restoreSession(sess.id, false);
      } };
      case 'focus': return { label: 'Focus: ' + arg, run: () => {
        need('a flow name');
        const flow = (typeof FocusFlows !== 'undefined' ? FocusFlows._load() : []).find(f => String(f.name).toLowerCase() === arg.toLowerCase());
        if (!flow) throw new Error('No focus flow is called “' + arg + '”');
        FocusFlows.activate(flow);
      } };
      case 'timer': return { label: 'Timer ' + arg, run: async () => {
        need('a length, like 15 min');
        if (typeof VexClock === 'undefined' || typeof VexClock.addTimer !== 'function') throw new Error('Timers are not available');
        await VexClock.addTimer(arg, '');
      } };
      case 'mute': return { label: 'Mute ' + arg, run: () => { need('what to mute'); this._setMuted(arg, true); } };
      case 'unmute': return { label: 'Unmute ' + arg, run: () => { need('what to unmute'); this._setMuted(arg, false); } };
      case 'wait': return { label: 'Wait ' + arg + ' s', run: () => new Promise((r) => setTimeout(r, Math.max(1, Math.min(60, parseInt(arg, 10) || 1)) * 1000)) };
      default: return null;
    }
  },

  // One written line → a step string, or throws saying what is wrong with it.
  parseLine(line, commands = (typeof CommandBar !== 'undefined' ? CommandBar.commands : [])) {
    const t = String(line || '').trim();
    if (!t) throw new Error('empty');
    let m;
    if ((m = /^open\s+(\S+)$/i.exec(t))) {
      let u;
      try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(m[1]) ? m[1] : 'https://' + m[1]); } catch { throw new Error('“' + m[1] + '” is not an address'); }
      if (!/^https?:$/.test(u.protocol)) throw new Error('only http and https addresses can be opened');
      return 'open:' + u.href;
    }
    if ((m = /^session\s+(.+)$/i.exec(t))) {
      const sess = (typeof SessionManager !== 'undefined' ? SessionManager.sessions : []).find(x => String(x.name).toLowerCase() === m[1].trim().toLowerCase());
      if (!sess) throw new Error('no saved session is called “' + m[1].trim() + '”');
      return 'session:' + sess.name;
    }
    if ((m = /^focus\s+(.+)$/i.exec(t))) {
      const flow = (typeof FocusFlows !== 'undefined' ? FocusFlows._load() : []).find(f => String(f.name).toLowerCase() === m[1].trim().toLowerCase());
      if (!flow) throw new Error('no focus flow is called “' + m[1].trim() + '”');
      return 'focus:' + flow.name;
    }
    if ((m = /^(?:timer|countdown)\s+(.+)$/i.exec(t))) {
      if (!/\d/.test(m[1])) throw new Error('a timer needs a length, like “timer 15 min”');
      return 'timer:' + m[1].trim();
    }
    if ((m = /^(mute|unmute)\s+(.+)$/i.exec(t))) return m[1].toLowerCase() + ':' + m[2].trim();
    if ((m = /^wait\s+(\d{1,2})(?:\s*s(?:ec(?:onds?)?)?)?$/i.exec(t))) {
      const n = parseInt(m[1], 10);
      if (n < 1 || n > 60) throw new Error('wait takes 1 to 60 seconds');
      return 'wait:' + n;
    }
    // A command-bar entry, by its id or its name.
    const low = t.toLowerCase();
    const base = commands.filter(c => !String(c.id || '').startsWith('chain:'));
    const hit = base.find(c => String(c.id).toLowerCase() === low) || base.find(c => String(c.label || '').toLowerCase() === low);
    if (hit) return hit.id;
    throw new Error('“' + t + '” is not a command, or one of: open, session, focus, timer, mute, unmute, wait');
  },

  // Many lines → { steps, errors: [{ line, text, message }] }.
  parseText(text) {
    const steps = [], errors = [];
    String(text || '').split(/\r?\n/).forEach((raw, i) => {
      if (!raw.trim() || raw.trim().startsWith('#')) return;
      try { steps.push(this.parseLine(raw)); } catch (err) { errors.push({ line: i + 1, text: raw.trim(), message: err.message }); }
    });
    return { steps, errors };
  },

  // The steps back as lines, so a chain can be edited as written.
  toText(steps) {
    return (steps || []).map((s) => {
      const p = this.split(s);
      if (!p) { const c = typeof CommandBar !== 'undefined' ? CommandBar.commands.find(x => x.id === s) : null; return c ? c.label : s; }
      return p.kind + ' ' + p.arg;
    }).join('\n');
  },

  // ---- the editor ----------------------------------------------------------------
  // `prefill` ({ name, steps }) fills a NEW chain's form, so a suggestion can be reviewed and saved.
  async open(existing, prefill) {
    if (typeof CommandChains === 'undefined') throw new Error('Command chains are not available');
    document.getElementById('vex-chainedit')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-chainedit';
    m.style.cssText = 'position:fixed;inset:0;z-index:100060;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    m.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Command chain" style="width:520px;max-width:94vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;box-shadow:0 24px 60px var(--vex-shadow-color,rgba(0,0,0,.5));color:var(--text);font-size:12.5px">
      <div style="display:flex;align-items:center;gap:7px;font-size:15px;font-weight:700;margin-bottom:10px">${VexIcons.svg('link', { size: 16 })}${existing ? 'Edit chain' : 'New chain'}</div>
      <input id="cs-name" class="set-input" style="width:100%;box-sizing:border-box;margin-bottom:8px" placeholder="Name, e.g. Standup" value="${esc(existing ? existing.name : (prefill ? prefill.name : ''))}">
      <textarea id="cs-text" class="set-input" rows="8" spellcheck="false" style="width:100%;box-sizing:border-box;font-family:monospace;resize:vertical" placeholder="open https://example.com/board&#10;session Standup&#10;timer 15 min&#10;mute discord&#10;Reading mode">${esc(existing ? this.toText(existing.steps) : (prefill ? this.toText(prefill.steps) : ''))}</textarea>
      <div style="color:var(--text-muted);font-size:11.5px;margin:6px 0">One step a line, run in order: <b>open</b> address, <b>session</b> name, <b>focus</b> name, <b>timer</b> 15 min, <b>mute</b> or <b>unmute</b> text in a tab, <b>wait</b> seconds, or the name of any Ctrl+K command.</div>
      <div id="cs-err" style="color:var(--danger,#e5484d);min-height:16px;white-space:pre-wrap"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button type="button" class="btn-secondary" id="cs-cancel">Cancel</button>
        <button type="button" class="btn-primary" id="cs-save">Save chain</button>
      </div></div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    m.querySelector('#cs-cancel').addEventListener('click', close);
    m.querySelector('#cs-save').addEventListener('click', () => {
      const name = m.querySelector('#cs-name').value.trim();
      const err = (s) => { m.querySelector('#cs-err').textContent = s; };
      if (!name) { err('Give the chain a name'); return; }
      const r = this.parseText(m.querySelector('#cs-text').value);
      if (r.errors.length) { err(r.errors.map(e => 'Line ' + e.line + ': ' + e.message).join('\n')); return; }
      if (r.steps.length < 1) { err('Add at least one step'); return; }
      if (existing) { existing.name = name; existing.steps = r.steps; }
      else CommandChains.chains.push({ id: typeof vexId === 'function' ? vexId('ch') : 'ch' + Date.now(), name, steps: r.steps });
      const ok = CommandChains.save();
      close();
      window.showToast?.(ok ? 'Chain “' + name + '” saved — run it from Ctrl+K' : 'Available for now, but the chain could not be saved', ok ? undefined : 'error');
      const box = document.getElementById('workflow-panel-content');
      if (box && !!window.VexWorkflow) window.VexWorkflow.renderSettings(box);
      const old = document.getElementById('chains-panel-content');
      if (old) CommandChains.renderPanel(old);
    });
    m.querySelector('#cs-name').focus({ preventScroll: true });
  },

  render(box) {
    const p = document.createElement('div');
    p.className = 'setting-info muted';
    p.style.cssText = 'font-size:11.5px;margin-bottom:6px';
    p.textContent = 'Write a chain as lines: open a page, open a session, start a timer, mute a tab, then any command. Run it from Ctrl+K by its name.';
    box.appendChild(p);
    const chains = typeof CommandChains !== 'undefined' ? CommandChains.chains : [];
    for (const ch of chains) {
      const row = document.createElement('div');
      row.className = 'setting-toggle-row';
      const sp = document.createElement('span');
      sp.textContent = ch.name + ' · ' + ch.steps.length + ' step' + VexPlural.s(ch.steps.length);
      const bt = document.createElement('button');
      bt.type = 'button'; bt.className = 'btn-secondary'; bt.textContent = 'Edit';
      bt.addEventListener('click', () => this.open(ch).catch(err => window.showToast?.(err.message, 'error')));
      row.append(sp, bt);
      box.appendChild(row);
    }
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'btn-secondary'; add.style.marginTop = '6px';
    add.textContent = 'New chain…';
    add.addEventListener('click', () => this.open().catch(err => window.showToast?.(err.message, 'error')));
    box.appendChild(add);
  },

  snapshot() {
    const chains = typeof CommandChains !== 'undefined' ? CommandChains.chains : [];
    return { chains: chains.map(c => ({ id: c.id, name: c.name, steps: c.steps.length })) };
  },

  init() {
    window.VexWorkflow.addCommand({ id: 'chain-new', label: 'New command chain…', hint: 'Name a sequence of steps (open tabs, timer, mute…) and run it from Ctrl+K', icon: 'link', action: () => this.open().catch(err => window.showToast?.(err.message, 'error')) });
  },
};

window.VexWorkflow.register({
  id: 'chains', title: 'Command chains', icon: 'link',
  render: (box) => VexChainSteps.render(box),
  snapshot: () => VexChainSteps.snapshot(),
});

if (typeof window !== 'undefined') window.VexChainSteps = VexChainSteps;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexChainSteps };
