// === "You always do this next" ===============================================
//
// Keeps which command or panel followed which, as counts of pairs ("after
// Mail you open GitHub, 9 of 11 times"), and offers the usual next step once
// the pair is certain enough. Only the pair counts and short names are kept:
// no pages, no text, no timestamps of single actions. A step only follows
// another within 30 minutes; a gap starts a fresh sequence.
//
// Sources, attached from outside when started:
//   CommandBar._execute(item)         -> "cmd:<id>"
//   SidebarManager.openPanel(name)    -> "panel:<name>"
// Off until turned on in Settings > Brief actions.
const VexNextAction = {
  KEY: 'vex.nextAction',
  MAX_PREV: 150,
  GAP_MS: 30 * 60000,
  MIN_COUNT: 3,
  MIN_SHARE: 0.5,
  // These happen constantly and say nothing about a routine.
  IGNORE: new Set(['cmd:url', 'cmd:search']),

  _read() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { raw = null; }
    if (!raw || typeof raw !== 'object' || typeof raw.p !== 'object' || raw.p === null) return { v: 1, p: {}, names: {}, last: '', lastAt: 0 };
    return { v: 1, p: raw.p, names: raw.names && typeof raw.names === 'object' ? raw.names : {}, last: String(raw.last || ''), lastAt: Number(raw.lastAt) || 0 };
  },
  _write(m) {
    try { localStorage.setItem(this.KEY, JSON.stringify(m)); return true; }
    catch (err) { window.VexProblems?.note('Next action', 'Could not save the action sequence', err); return false; }
  },

  record(id, name = '', now = Date.now()) {
    if (typeof id !== 'string' || !id || this.IGNORE.has(id)) return false;
    const m = this._read();
    if (name) m.names[id] = String(name).slice(0, 60);
    if (m.last && m.last !== id && now - m.lastAt <= this.GAP_MS) {
      const row = m.p[m.last] || (m.p[m.last] = {});
      row[id] = Math.min(999, (row[id] || 0) + 1);
    }
    m.last = id; m.lastAt = now;
    const prevs = Object.keys(m.p);
    if (prevs.length > this.MAX_PREV) {
      const total = (k) => Object.values(m.p[k]).reduce((a, b) => a + b, 0);
      prevs.sort((a, b) => total(a) - total(b)).slice(0, prevs.length - this.MAX_PREV).forEach(k => { delete m.p[k]; });
    }
    return this._write(m);
  },

  // What usually follows `after` (default: the last thing done, if recent).
  // → { id, name, count, of, share } or null when nothing is certain enough.
  suggest(after, now = Date.now()) {
    const m = this._read();
    let from = after;
    if (!from) { if (!m.last || now - m.lastAt > this.GAP_MS) return null; from = m.last; }
    const row = m.p[from];
    if (!row) return null;
    const entries = Object.entries(row).sort((a, b) => b[1] - a[1]);
    const of = entries.reduce((a, [, n]) => a + n, 0);
    const [id, count] = entries[0] || [];
    if (!id || count < this.MIN_COUNT || count / of < this.MIN_SHARE) return null;
    return { id, name: m.names[id] || id.replace(/^(cmd|panel):/, ''), from, count, of, share: count / of };
  },

  summary() { const m = this._read(); return { pairs: Object.values(m.p).reduce((a, r) => a + Object.keys(r).length, 0) }; },
  reset() { try { localStorage.removeItem(this.KEY); } catch (err) { throw new Error('Could not clear the sequence: ' + err.message); } },

  // Do the suggestion. A panel opens; a command is named in the command bar
  // (Vex cannot know what an arbitrary command needs, so it is not run blind).
  run(s) {
    if (!s || !s.id) throw new Error('Nothing to run');
    if (s.id.startsWith('panel:')) {
      if (typeof SidebarManager === 'undefined' || typeof SidebarManager.openPanel !== 'function') throw new Error('Panels are not loaded');
      SidebarManager.openPanel(s.id.slice(6));
      return true;
    }
    if (typeof CommandBar !== 'undefined' && typeof CommandBar.open === 'function') CommandBar.open();
    window.showToast?.('Usually next: ' + s.name);
    return true;
  },

  _attached: false,
  start() {
    if (this._attached) return;
    this._attached = true;
    const on = () => typeof BriefActions !== 'undefined' && BriefActions.isOn('nextAction');
    if (typeof CommandBar !== 'undefined' && typeof CommandBar._execute === 'function') {
      const exec = CommandBar._execute.bind(CommandBar);
      CommandBar._execute = function (item) {
        try { if (on() && item && item.id) VexNextAction.record('cmd:' + item.id, item.title || item.label || item.name || ''); }
        catch (err) { window.VexProblems?.note('Next action', 'Could not record a command', err); }
        return exec(item);
      };
    }
    if (typeof SidebarManager !== 'undefined' && typeof SidebarManager.openPanel === 'function') {
      const open = SidebarManager.openPanel.bind(SidebarManager);
      SidebarManager.openPanel = function (name, ...rest) {
        try { if (on() && typeof name === 'string') VexNextAction.record('panel:' + name, name); }
        catch (err) { window.VexProblems?.note('Next action', 'Could not record a panel', err); }
        return open(name, ...rest);
      };
    }
  },

  renderSettings(container) {
    if (!container) return;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    container.querySelector('[data-nextaction]')?.remove();
    const box = el('div', 'setting-info');
    box.setAttribute('data-nextaction', '');
    box.appendChild(el('div', '', 'Action sequence: ' + this.summary().pairs + ' step pairs remembered on this PC.'));
    const btn = el('button', 'btn-secondary', 'Forget the action sequence');
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      const ok = await window.vexConfirm({ title: 'Forget your action sequence?', message: 'Vex stops suggesting what you usually do next until it learns again.', okLabel: 'Forget', danger: true });
      if (!ok) return;
      try { this.reset(); } catch (err) { window.showToast?.(err.message, 'error'); return; }
      this.renderSettings(container);
    });
    box.appendChild(btn);
    container.appendChild(box);
  },

  section: {
    id: 'next-action',
    title: 'Usually next',
    icon: 'zap',
    order: 96,
    defaultOn: false,
    isEnabled() { return typeof BriefActions !== 'undefined' && BriefActions.isOn('nextAction'); },
    build(ctx = {}) {
      const s = VexNextAction.suggest(null, ctx.now || Date.now());
      if (!s) return null;
      return { summary: 'After ' + (VexNextAction._read().names[s.from] || s.from.replace(/^(cmd|panel):/, '')) + ' you usually do ' + s.name + ' (' + s.count + ' of ' + s.of + ' times).' };
    },
  },
};

if (typeof window !== 'undefined') window.VexNextAction = VexNextAction;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexNextAction };
