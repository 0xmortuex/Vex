// === Log tailer: follow one file or one local websocket, read-only ================
//
// For a QEMU serial log, a build log or a dev server's output. You grant ONE thing:
// a file chosen in the file picker, or a websocket on this computer that you type
// (ws://localhost:PORT). Vex reads it, never writes, never starts a program and
// never sends a byte down the socket (src/main/log-tail.js keeps the last 2 MB).
//
// This side draws it: ANSI colours become coloured text, a search box filters or
// highlights, repeated lines fold into "line (x N)", and lines that look like a
// crash (PANIC, #PF, #GP, triple fault, Oops, BUG:) are marked, with "Copy panic as
// issue" putting the crash and its surroundings in a fenced block.
const VexLogTailer = {
  ENABLED_KEY: 'vex.logTailer.enabled',
  MAX_LINES: 20000,
  RENDER_LINES: 2000,
  PANIC: /(\bkernel panic\b|\bpanic\b|#PF\b|#GP\b|#DF\b|triple fault|\bOops\b|\bBUG:|\bSegmentation fault\b|\bunhandled (?:exception|trap)\b)/i,
  _view: null,

  enabled() { return VexBench.flag(this.ENABLED_KEY); },
  setEnabled(on) {
    VexBench.setFlag(this.ENABLED_KEY, on);
    if (!on) this.close();
    this.registerCommands();
  },

  // ---- pure helpers (tested) -----------------------------------------------------
  ANSI_COLOURS: { 30: '#6e7681', 31: '#f85149', 32: '#3fb950', 33: '#d29922', 34: '#58a6ff', 35: '#bc8cff', 36: '#39c5cf', 37: '#e6edf3',
    90: '#8b949e', 91: '#ff7b72', 92: '#56d364', 93: '#e3b341', 94: '#79c0ff', 95: '#d2a8ff', 96: '#56d4dd', 97: '#ffffff' },

  // One line -> [{ text, color, bold }]. Colour and bold from SGR codes; every other escape is dropped.
  ansiSegments(line) {
    const out = [];
    let color = '', bold = false, last = 0;
    const re = /\x1b\[([0-9;]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]/g; // eslint-disable-line no-control-regex
    const emit = (text) => { if (text) out.push({ text, color, bold }); };
    let m;
    while ((m = re.exec(line)) !== null) {
      emit(line.slice(last, m.index));
      last = re.lastIndex;
      if (m[2] === 'm') {
        const codes = (m[1] === '' ? '0' : m[1]).split(';').map(Number);
        for (let i = 0; i < codes.length; i++) {
          const c = codes[i];
          if (c === 0) { color = ''; bold = false; }
          else if (c === 1) bold = true;
          else if (c === 22) bold = false;
          else if (c === 39) color = '';
          else if (this.ANSI_COLOURS[c]) color = this.ANSI_COLOURS[c];
          else if (c === 38 || c === 48) i += codes[i + 1] === 5 ? 2 : (codes[i + 1] === 2 ? 4 : 0);   // 256 / true colour: skipped, not drawn
        }
      }
    }
    emit(line.slice(last));
    return out;
  },
  stripAnsi(line) { return this.ansiSegments(line).map(s => s.text).join(''); },
  isPanic(line) { return this.PANIC.test(this.stripAnsi(line)); },

  // Consecutive identical lines -> one entry with a count.
  fold(lines) {
    const out = [];
    for (const raw of lines) {
      const prev = out[out.length - 1];
      if (prev && prev.raw === raw) prev.count++;
      else out.push({ raw, count: 1 });
    }
    return out;
  },
  // Entries that contain the query (case-insensitive); an empty query keeps all.
  filter(entries, query) {
    const q = String(query || '').toLowerCase();
    return q ? entries.filter(e => this.stripAnsi(e.raw).toLowerCase().includes(q)) : entries;
  },
  // The first (or `index`-th) crash with its surroundings, as an issue block, or null.
  panicBlock(lines, name, index = 0, before = 5, after = 25) {
    const hits = [];
    lines.forEach((l, i) => { if (this.isPanic(l)) hits.push(i); });
    if (!hits.length) return null;
    const at = hits[Math.min(index, hits.length - 1)];
    const slice = lines.slice(Math.max(0, at - before), Math.min(lines.length, at + after + 1)).map(l => this.stripAnsi(l));
    return '**Crash found in `' + String(name).replace(/`/g, "'") + '`**\n\n```\n' + slice.join('\n').replace(/```/g, "'''") + '\n```\n';
  },
  // New text -> complete lines, keeping a trailing partial line for the next piece.
  splitLines(carry, text) {
    const parts = (carry + text).split(/\r?\n/);
    return { lines: parts.slice(0, -1), carry: parts[parts.length - 1] };
  },

  // ---- the window --------------------------------------------------------------------
  async followFile() {
    const r = await this._ok(window.vex.devbenchLogPickFile());
    if (r.canceled) return null;
    return this._start(r);
  },
  async followSocket() {
    const url = await vexPrompt({ title: 'Follow a websocket on this computer', message: 'ws://localhost:PORT or ws://127.0.0.1:PORT. Receive only: nothing is ever sent.', label: 'Address', value: 'ws://localhost:' });
    if (url == null) return null;
    return this._start(await this._ok(window.vex.devbenchLogFollowSocket(url.trim())));
  },
  async _ok(p) {
    const r = await p;
    if (!r || !r.ok) throw new Error((r && r.error) || 'That did not work');
    return r;
  },

  _start(grant) {
    this.close();
    const dlg = VexSettingsGroups.dialog({ id: 'vex-log-tailer', title: 'Log: ' + grant.name, sub: grant.kind === 'file' ? 'Following a file, read-only' : 'Following a local websocket, receive-only' });
    const v = { id: grant.id, name: grant.name, dlg, lines: [], carry: '', pos: 0, query: '', folded: true, onlyMatches: false, paused: false, job: null };
    this._view = v;
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px';
    const search = document.createElement('input');
    search.type = 'search'; search.placeholder = 'Search'; search.setAttribute('aria-label', 'Search the log');
    search.addEventListener('input', () => { v.query = search.value; this._draw(); });
    const mkCheck = (text, key) => {
      const l = document.createElement('label'); l.style.cssText = 'font-size:12px;display:flex;gap:4px;align-items:center';
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!v[key];
      c.addEventListener('change', () => { v[key] = c.checked; this._draw(); });
      l.append(c, document.createTextNode(text)); return l;
    };
    bar.append(search, mkCheck('Only matching lines', 'onlyMatches'), mkCheck('Fold repeated lines', 'folded'), mkCheck('Pause', 'paused'),
      VexSettingsGroups.button('Copy panic as issue', () => {
        const block = this.panicBlock(v.lines, v.name);
        if (!block) { VexBench.toast('No crash line found'); return; }
        VexBench.copy(block, 'Crash copied').catch(e => VexBench.fail(e));
      }),
      VexSettingsGroups.button('Stop following', () => this.close(), { danger: true }));
    const status = document.createElement('div'); status.style.cssText = 'font-size:11.5px;color:var(--text-muted);margin-bottom:6px';
    const out = document.createElement('div');
    out.style.cssText = 'font-family:"JetBrains Mono",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:62vh;overflow:auto;background:#0d1117;color:#e6edf3;padding:8px;border-radius:8px';
    out.setAttribute('role', 'log'); out.setAttribute('aria-label', 'Log output');
    dlg.body.append(bar, status, out);
    v.out = out; v.status = status;
    v.job = VexJobs.every('Log tailer', 1000, () => this._poll().catch(e => { status.textContent = 'Stopped: ' + ((e && e.message) || e); v.job.stop(); }), { feature: 'log-tailer' });
    this._poll().catch(e => { status.textContent = 'Stopped: ' + ((e && e.message) || e); });
    return v;
  },

  async _poll() {
    const v = this._view;
    if (!v) return;
    // The window was closed with its X or Escape: stop following.
    if (v.dlg.overlay && !v.dlg.overlay.isConnected) { this.close(); return; }
    const r = await this._ok(window.vex.devbenchLogPoll(v.id, v.pos));
    v.pos = r.position;
    if (r.text) {
      const s = this.splitLines(v.carry, r.text);
      v.carry = s.carry;
      for (const l of s.lines) v.lines.push(l);
      if (v.lines.length > this.MAX_LINES) v.lines.splice(0, v.lines.length - this.MAX_LINES);
    }
    v.status.textContent = r.name + ' - ' + r.kind + (r.note ? ' - ' + r.note : '') + ' - ' + v.lines.length + ' lines';
    if (!v.paused) this._draw();
  },

  _draw() {
    const v = this._view;
    if (!v || !v.out) return;
    let entries = v.folded ? this.fold(v.lines) : v.lines.map(raw => ({ raw, count: 1 }));
    if (v.query) entries = v.onlyMatches ? this.filter(entries, v.query) : entries;
    entries = entries.slice(-this.RENDER_LINES);
    const q = v.query.toLowerCase();
    const frag = document.createDocumentFragment();
    for (const e of entries) {
      const row = document.createElement('div');
      const panic = this.isPanic(e.raw);
      if (panic) row.style.cssText = 'background:rgba(248,81,73,.22);border-left:3px solid #f85149;padding-left:4px';
      else if (q && this.stripAnsi(e.raw).toLowerCase().includes(q)) row.style.cssText = 'background:rgba(210,153,34,.22)';
      for (const seg of this.ansiSegments(e.raw)) {
        const s = document.createElement('span');
        s.textContent = seg.text;
        if (seg.color) s.style.color = seg.color;
        if (seg.bold) s.style.fontWeight = '700';
        row.appendChild(s);
      }
      if (e.count > 1) { const n = document.createElement('span'); n.style.color = '#8b949e'; n.textContent = '  (x' + e.count + ')'; row.appendChild(n); }
      if (!row.firstChild) row.textContent = ' ';
      frag.appendChild(row);
    }
    const atEnd = v.out.scrollHeight - v.out.scrollTop - v.out.clientHeight < 40;
    v.out.textContent = '';
    v.out.appendChild(frag);
    if (atEnd) v.out.scrollTop = v.out.scrollHeight;
  },

  close() {
    const v = this._view;
    if (!v) return;
    this._view = null;
    if (v.job) v.job.stop();
    Promise.resolve(window.vex.devbenchLogStop(v.id)).catch(e => VexProblems?.note('Log tailer', 'could not stop following', e));
    v.dlg.overlay.remove();
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('logtail:', this.enabled() ? [
      { id: 'logtail:file', label: 'Follow a log file', icon: 'terminal', hint: 'Pick one file; read-only, colours, search, fold, crash lines marked', action: VexBench.safe(() => this.followFile()) },
      { id: 'logtail:socket', label: 'Follow a local websocket log', icon: 'terminal', hint: 'ws://localhost only; receive-only', action: VexBench.safe(() => this.followSocket()) },
    ] : []);
    return true;
  },
  settingsRows(box) {
    box.appendChild(VexSettingsGroup.note('Follows ONE file you pick, or one websocket on this computer. Read-only: Vex never writes, never starts a program and never sends on the socket. Keeps the last 2 MB.'));
    box.appendChild(VexSettingsGroup.button('Follow a file...', () => this.followFile().catch(e => VexBench.fail(e))));
    box.appendChild(VexSettingsGroup.button('Follow a local websocket...', () => this.followSocket().catch(e => VexBench.fail(e))));
  },
};

if (typeof window !== 'undefined') {
  window.VexLogTailer = VexLogTailer;
  VexBench.register({
    id: 'log-tailer', title: 'Serial / QEMU log tailer', hint: 'one file or local websocket, read-only',
    enabled: () => VexLogTailer.enabled(), setEnabled: (on) => VexLogTailer.setEnabled(on), settingsRows: (box) => VexLogTailer.settingsRows(box),
  });
  VexLogTailer.registerCommands();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLogTailer };
