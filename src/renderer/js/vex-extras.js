// === Vex extras: shared settings group + report page ========================
//
// Three small things the batch-4 modules (weekly-world.js, offline-pages.js,
// year-in-vex.js, achievement-badges.js) share, so index.html only needs
// script tags and none of them touches settings-ui.js, today.js or start.html:
//
//   VexExtras.get(key, def) / set(key, value)   one localStorage object,
//                                               'vex.extras', never synced
//   VexExtras.registerToggle({ key, label, hint, def })
//                                               a switch in ONE Settings group
//                                               that is built at runtime
//   VexExtras.registerCommand(cmd)              adds {id,label,hint,icon,action}
//                                               to CommandBar.commands
//   VexExtras.openReport({ id, title, icon, range, stats, sections })
//                                               the page the weekly and yearly
//                                               summaries are shown on
//
// Nothing here talks to the network.
const VexExtras = {
  KEY: 'vex.extras',
  _toggles: [],
  _commands: [],

  _read() {
    let raw;
    try { raw = localStorage.getItem(this.KEY); } catch { return {}; }
    if (!raw) return {};
    let o;
    try { o = JSON.parse(raw); }
    catch (err) { throw new Error('The extras settings could not be read', { cause: err }); }
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  },
  get(key, def) {
    const o = this._read();
    return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : def;
  },
  set(key, value) {
    const o = this._read();
    o[key] = value;
    localStorage.setItem(this.KEY, JSON.stringify(o));
    try { document.dispatchEvent(new CustomEvent('vex:extras-changed', { detail: { key, value } })); } catch { /* no document */ }
    return value;
  },

  registerToggle(t) {
    if (!t || !t.key || !t.label) throw new Error('A toggle needs a key and a label');
    if (this._toggles.some(x => x.key === t.key)) return;
    this._toggles.push({ def: false, hint: '', ...t });
    this.mountSettings();
  },

  // The group is created on first use, after the AI Memory group when that is
  // there (it is the closest neighbour), otherwise at the end of Settings.
  mountSettings() {
    if (typeof document === 'undefined') return null;
    const host = document.querySelector('#panel-settings .settings-content');
    if (!host) return null;
    let group = document.getElementById('vex-extras-settings');
    if (!group) {
      group = document.createElement('div');
      group.className = 'setting-group';
      group.id = 'vex-extras-settings';
      const label = document.createElement('label');
      label.className = 'setting-label';
      label.textContent = 'Weekly page, offline, year and badges';
      const body = document.createElement('div');
      body.id = 'vex-extras-settings-body';
      group.append(label, body);
      const mem = document.getElementById('ai-memory-panel-content');
      const after = mem && mem.closest ? mem.closest('.setting-group') : null;
      if (after && after.parentNode) after.parentNode.insertBefore(group, after.nextSibling);
      else host.appendChild(group);
    }
    this._renderToggles(group.querySelector('#vex-extras-settings-body'));
    return group;
  },

  _renderToggles(body) {
    body.textContent = '';
    for (const t of this._toggles) {
      const row = document.createElement('div');
      row.className = 'setting-toggle-row';
      const span = document.createElement('span');
      span.textContent = t.label;
      const lab = document.createElement('label');
      lab.className = 'toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('aria-label', t.label);
      input.checked = this.get(t.key, t.def) === true;
      input.addEventListener('change', () => {
        try { this.set(t.key, input.checked); }
        catch (err) { input.checked = !input.checked; window.showToast?.(err.message, 'error'); }
      });
      const slider = document.createElement('span');
      slider.className = 'toggle-slider';
      lab.append(input, slider);
      row.append(span, lab);
      body.appendChild(row);
      if (t.hint) {
        const p = document.createElement('p');
        p.className = 'setting-info muted';
        p.style.margin = '2px 0 10px';
        p.textContent = t.hint;
        body.appendChild(p);
      }
    }
  },

  // Commands are pushed into the command bar's own list (command.js), once.
  registerCommand(cmd) {
    if (!cmd || !cmd.id || typeof cmd.action !== 'function') throw new Error('A command needs an id and an action');
    if (this._commands.some(c => c.id === cmd.id)) return false;
    this._commands.push(cmd);
    if (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) {
      if (!CommandBar.commands.some(c => c.id === cmd.id)) CommandBar.commands.push(cmd);
    }
    return true;
  },
  // Called once the command bar exists (it is a lexical global, not on window).
  flushCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return 0;
    let n = 0;
    for (const c of this._commands) {
      if (!CommandBar.commands.some(x => x.id === c.id)) { CommandBar.commands.push(c); n++; }
    }
    return n;
  },

  fmtDay(ms) {
    return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  },

  // A page of numbers and lists. Everything is set with textContent.
  // sections: [{ title, empty, rows: [{ text, sub, url }] }]
  openReport({ id, title, icon = 'clipboard', range = '', stats = [], sections = [], footer = '' }) {
    if (typeof document === 'undefined') throw new Error('There is no window to show the page in');
    document.getElementById(id)?.remove();
    const svg = (n, sz) => (window.VexIcons && VexIcons.has && VexIcons.has(n)) ? VexIcons.svg(n, { size: sz }) : '';
    const wrap = document.createElement('div');
    wrap.id = id;
    wrap.className = 'qr-overlay';
    const dlg = document.createElement('div');
    dlg.className = 'qr-dialog rv';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', id + '-title');
    const head = document.createElement('div');
    head.className = 'qr-head';
    const hi = document.createElement('span'); hi.className = 'qr-head-icon'; hi.innerHTML = svg(icon, 16);
    const ht = document.createElement('span'); ht.className = 'qr-title'; ht.id = id + '-title'; ht.textContent = title;
    const hr = document.createElement('span'); hr.className = 'rv-range'; hr.textContent = range;
    const hx = document.createElement('button'); hx.className = 'qr-close'; hx.title = 'Close'; hx.setAttribute('aria-label', 'Close'); hx.innerHTML = svg('x', 14);
    head.append(hi, ht, hr, hx);
    dlg.appendChild(head);
    if (stats.length) {
      const st = document.createElement('div'); st.className = 'rv-stats';
      for (const s of stats) {
        const d = document.createElement('div'); d.className = 'rv-stat';
        const b = document.createElement('b'); b.textContent = String(s.n);
        const l = document.createElement('span'); l.textContent = s.label;
        d.append(b, l); st.appendChild(d);
      }
      dlg.appendChild(st);
    }
    const body = document.createElement('div'); body.className = 'rv-body';
    for (const sec of sections) {
      const s = document.createElement('section'); s.className = 'rv-sec';
      const h = document.createElement('h4'); h.textContent = sec.title; s.appendChild(h);
      if (!sec.rows.length) {
        const e = document.createElement('div'); e.className = 'rv-empty'; e.textContent = sec.empty || 'Nothing.'; s.appendChild(e);
      }
      for (const r of sec.rows) {
        const a = document.createElement(r.url || r.run ? 'a' : 'div'); a.className = 'rv-row';
        if (r.url || r.run) {
          a.href = '#';
          a.addEventListener('click', (ev) => {
            ev.preventDefault();
            if (typeof r.run === 'function') {
              Promise.resolve().then(() => r.run()).catch(err => window.showToast?.(err.message, 'error'));
              wrap.remove();
              return;
            }
            try { TabManager.createTab(r.url, true); } catch (err) { window.showToast?.('Could not open that page: ' + err.message, 'error'); return; }
            wrap.remove();
          });
        }
        const t = document.createElement('span'); t.className = 'rv-row-text'; t.textContent = r.text; a.appendChild(t);
        const u = document.createElement('span'); u.className = 'rv-row-sub'; u.textContent = r.sub || ''; a.appendChild(u);
        s.appendChild(a);
      }
      body.appendChild(s);
    }
    if (footer) { const f = document.createElement('div'); f.className = 'rv-empty'; f.textContent = footer; body.appendChild(f); }
    dlg.appendChild(body);
    const act = document.createElement('div'); act.className = 'qr-actions';
    const done = document.createElement('button'); done.className = 'qr-btn qr-primary'; done.textContent = 'Done';
    act.appendChild(done); dlg.appendChild(act);
    wrap.appendChild(dlg);
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    hx.addEventListener('click', close);
    done.addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    setTimeout(() => done.focus(), 40);
    return wrap;
  },
};

// After every script has loaded: put the commands in the command bar, build
// the Settings group, and start the two modules that listen for events. The
// modules are lexical globals (const at top level), so they are reached by
// bare name with typeof, never window.X.
VexExtras.boot = function () {
  try {
    if (typeof VexWeeklyWorld !== 'undefined') VexWeeklyWorld.init();
    if (typeof VexBadges !== 'undefined') VexBadges.start();
    this.flushCommands();
    this.mountSettings();
  } catch (err) {
    window.VexProblems?.note('Extras', 'Could not start the weekly, offline, year and badge modules', err);
  }
};
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.VexExtras = VexExtras;
  if (document.readyState === 'complete') VexExtras.boot();
  else window.addEventListener('load', () => VexExtras.boot(), { once: true });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexExtras };
