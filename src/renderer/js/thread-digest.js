// === Long-thread digest with "since I last read" (T2-031) =====================
//
// A GitHub issue, a forum thread, a mail conversation or a chat that grew while
// you were away: Vex turns the part you have NOT read into decisions, open
// questions and what is new, with a model on this PC (js/longdoc-engine.js).
//
// What it reads is only ever what you hand it, at the moment you ask:
//   - text you selected on the page, or
//   - the text of the page you are looking at, after you say yes. For a chat or
//     mail site (Discord, WhatsApp, Slack, Telegram, webmail) it always asks,
//     naming the site; a private, Tor or routed tab is never read.
// It never reads a chat or mail panel in the background, never on a timer, and
// never from a tab you are not looking at. Nothing is sent to the cloud.
//
// "Last read" is remembered per address as short fingerprints of the paragraphs
// you were shown (no text is stored): next time only paragraphs it has not seen
// are summarised. Stored in 'vex.threadDigest' (200 addresses at most, oldest
// dropped). "Forget" removes one address or all of them.
//
// Pure helpers (blocks, fingerprints, split, parseSections) have no DOM and are
// tested directly (tests/renderer/threadDigest.test.js).

const VexThreadDigest = {
  FEATURE: 'thread-digest',
  KEY: 'vex.threadDigest',
  KEY_ENABLED: 'vex.threadDigest.enabled',
  MAX_KEYS: 200,
  MAX_HASHES: 800,
  MAX_TEXT: 120000,
  // Sites where the page is somebody else's private conversation: always ask first.
  PRIVATE_HOSTS: /(^|\.)(discord\.com|discordapp\.com|web\.whatsapp\.com|whatsapp\.com|app\.slack\.com|slack\.com|web\.telegram\.org|telegram\.org|messenger\.com|teams\.microsoft\.com|mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|mail\.yahoo\.com|mail\.proton\.me|proton\.me|fastmail\.com|icloud\.com|webmail\.[a-z0-9.-]+)$/i,

  enabled() { try { return localStorage.getItem(this.KEY_ENABLED) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.KEY_ENABLED, on ? 'on' : 'off'); }
    catch (err) { throw new Error('The setting could not be saved: ' + err.message, { cause: err }); }
    this._registerCommands();
  },

  // ---- pure helpers -----------------------------------------------------------------
  _hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  },

  // The paragraphs of a thread, with where each one starts: [{ text, start, end, h }].
  blocks(text) {
    const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const parts = [];
    const re = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
    let m;
    while ((m = re.exec(s))) parts.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    // One long run of lines with no blank line: each line is a message.
    if (parts.length === 1 && parts[0].text.includes('\n')) {
      parts.length = 0;
      const lre = /[^\n]+/g;
      while ((m = lre.exec(s))) parts.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    }
    return parts
      .map(p => ({ ...p, norm: p.text.replace(/\s+/g, ' ').trim().toLowerCase() }))
      .filter(p => p.norm.length > 1)
      .map(p => ({ text: p.text, start: p.start, end: p.end, h: this._hash(p.norm) }));
  },

  // The address a thread is remembered under: no query and no fragment, so
  // "?page=2" and "#comment-5" are the same thread. A selection with no page
  // is remembered under the key the caller gives.
  keyOf(url) {
    try {
      const u = new URL(String(url));
      if (!/^https?:$/.test(u.protocol)) throw new Error('not a web address');
      return u.origin + u.pathname.replace(/\/+$/, '');
    } catch (err) { throw new Error('A thread needs a web address to be remembered under: ' + err.message, { cause: err }); }
  },

  // -> { fresh: [blocks not seen before], seen: n, first: bool }
  split(text, record) {
    const all = this.blocks(text);
    const seen = new Set(record && Array.isArray(record.hashes) ? record.hashes : []);
    const fresh = all.filter(b => !seen.has(b.h));
    return { all, fresh, seen: all.length - fresh.length, first: !record || !seen.size };
  },

  // The new paragraphs as one text, in order, and where each ended in that text:
  // the engine can then say which paragraphs it really covered.
  joinFresh(fresh) {
    let text = '';
    const ends = [];
    for (const b of fresh) { text += (text ? '\n\n' : '') + b.text; ends.push(text.length); }
    return { text, ends };
  },

  // The headed sections out of the model's plain-text answer.
  parseSections(answer) {
    const names = { decisions: 'Decisions', questions: 'Open questions', fresh: 'What is new' };
    const out = { decisions: [], questions: [], fresh: [], other: '' };
    let cur = null;
    for (const raw of String(answer || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const h = /^[#*\s]*(decisions?|open questions?|questions?|what(?:'|’)?s new|what is new|new comments?|new)\b[^:\n]*:?\**\s*(.*)$/i.exec(line);
      if (h && (/:/.test(line) || /^#/.test(line))) {
        const k = /decision/i.test(h[1]) ? 'decisions' : (/question/i.test(h[1]) ? 'questions' : 'fresh');
        cur = k;
        if (h[2]) out[k].push(h[2].replace(/^[-*•\s]+/, ''));
        continue;
      }
      const item = line.replace(/^[-*•\d.)\s]+/, '');
      if (cur) out[cur].push(item); else out.other += (out.other ? '\n' : '') + line;
    }
    out.names = names;
    return out;
  },

  instruction() {
    return 'Write three short headed lists, exactly with these headings on their own lines: "Decisions:" (what was decided or agreed), "Open questions:" (what is still unanswered or needs somebody), "What is new:" (the other new points, one line each). Write "none" under a heading with nothing. Use plain lines starting with "-". Do not invent anything.';
  },

  // ---- the record of what was read ------------------------------------------------
  _load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw == null) return {};
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not a record');
      return o;
    } catch (err) { throw new Error('The record of what you have read is damaged (' + err.message + '). Forget it in Settings › Thread digest.', { cause: err }); }
  },
  _save(o) {
    const keys = Object.keys(o);
    if (keys.length > this.MAX_KEYS) {
      keys.sort((a, b) => (o[a].at || 0) - (o[b].at || 0)).slice(0, keys.length - this.MAX_KEYS).forEach(k => { delete o[k]; });
    }
    try { localStorage.setItem(this.KEY, JSON.stringify(o)); }
    catch (err) { throw new Error('The read point could not be saved: ' + err.message, { cause: err }); }
  },
  record(key) { return this._load()[key] || null; },
  markRead(key, blocks, now = Date.now()) {
    const o = this._load();
    const prev = o[key] && Array.isArray(o[key].hashes) ? o[key].hashes : [];
    const merged = Array.from(new Set(prev.concat(blocks.map(b => b.h))));
    o[key] = { at: now, hashes: merged.slice(-this.MAX_HASHES) };
    this._save(o);
    return o[key];
  },
  forget(key) {
    const o = this._load();
    if (key) delete o[key]; else for (const k of Object.keys(o)) delete o[k];
    this._save(o);
  },
  count() { return Object.keys(this._load()).length; },

  // ---- the digest ---------------------------------------------------------------------
  /**
   * text: what the person handed over; key: where to remember it (keyOf(url)).
   * -> { empty, sections, answer, coverage, line, newCount, seenCount, first }
   * Marks as read only the paragraphs the engine actually covered, and only
   * when opts.remember !== false.
   */
  async digest(text, key, opts = {}) {
    if (!this.enabled()) throw new Error('Thread digest is switched off (Settings › Thread digest).');
    if (typeof VexLongDoc === 'undefined') throw new Error('The long-document engine is not loaded.');
    const body = String(text == null ? '' : text).slice(0, this.MAX_TEXT);
    if (!body.trim()) throw new Error('There is no text to digest.');
    const rec = key ? this.record(key) : null;
    const sp = this.split(body, opts.all ? null : rec);
    if (!sp.fresh.length) return { empty: true, newCount: 0, seenCount: sp.seen, first: false, line: 'Nothing new since you last read this thread (' + sp.seen + ' paragraphs already seen).' };
    const joined = this.joinFresh(sp.fresh);
    const r = await VexLongDoc.run(joined.text, { instruction: this.instruction(), call: opts.call, signal: opts.signal, onProgress: opts.onProgress, allowDuringGame: opts.allowDuringGame });
    // Paragraphs inside the part the engine really read.
    const covered = sp.fresh.filter((b, i) => joined.ends[i] <= r.coveredTo);
    if (key && opts.remember !== false && covered.length) this.markRead(key, covered);
    return {
      empty: false, answer: r.summary, sections: this.parseSections(r.summary), coverage: r.coverage,
      line: VexLongDoc.coverageLine(r), newCount: sp.fresh.length, coveredCount: covered.length, seenCount: sp.seen, first: sp.first,
      remaining: sp.fresh.length - covered.length,
    };
  },

  // ---- getting the text, only on a person's action ---------------------------------------
  _webview() { return (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null; },

  isPrivateHost(url) {
    try { return this.PRIVATE_HOSTS.test(new URL(String(url)).hostname); } catch { return false; }
  },

  async _readSelection(wv) {
    const sel = await wv.executeJavaScript('(function(){try{return String(window.getSelection().toString()||"")}catch(e){return ""}})()');
    return String(sel || '').trim();
  },

  /** -> { text, url, title, from: 'selection' | 'page' }; throws a plain sentence when it may not read. */
  async collect() {
    const wv = this._webview();
    if (!wv) throw new Error('No page is open.');
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) throw new Error('This is a private, Tor or routed tab, so Vex does not read it.');
    const url = wv.getURL ? wv.getURL() : '';
    const selected = await this._readSelection(wv);
    if (selected.length > 40) return { text: selected, url, title: (wv.getTitle && wv.getTitle()) || '', from: 'selection' };
    if (typeof PageContext === 'undefined') throw new Error('The page reader is not available here.');
    let host = '';
    try { host = new URL(url).hostname; } catch { host = ''; }
    const ask = typeof vexConfirm === 'function' ? vexConfirm : null;
    if (!ask) throw new Error('Vex could not ask you, so the page was not read.');
    const priv = this.isPrivateHost(url);
    const ok = await ask({
      title: priv ? 'Read this ' + (host || 'page') + ' conversation?' : 'Read this page to digest it?',
      message: (priv ? 'This is somebody else\'s conversation or your mail. ' : '') + 'Vex will read the text of the page you are looking at, once, and summarise it on this PC. Nothing is sent anywhere. Tip: select just the part you want and run this again to read only that.',
      okLabel: 'Read this page',
    });
    if (!ok) throw new Error('Cancelled. Nothing was read.');
    const ctx = await PageContext.extractPageContext(wv);
    if (!ctx || !ctx.text) throw new Error('This page has no readable text yet.');
    return { text: ctx.text, url: ctx.url || url, title: ctx.title || '', from: 'page' };
  },

  // ---- the dialog ------------------------------------------------------------------------------
  async open() {
    if (!this.enabled()) { window.showToast?.('Thread digest is switched off in Settings', 'warn'); return null; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    let got;
    try { got = await this.collect(); }
    catch (err) { window.showToast?.(err.message, 'error'); return null; }
    const key = got.from === 'selection' && !got.url ? null : this.keyOf(got.url);
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-thread-digest', title: 'Thread digest', sub: (got.title || got.url || 'Selected text') + ' · read ' + (got.from === 'selection' ? 'from your selection' : 'from the page, once') });
    const status = document.createElement('div');
    status.className = 'vex-platform-note';
    status.setAttribute('role', 'status');
    status.textContent = 'Reading…';
    const out = document.createElement('div');
    body.append(status, out);
    const ctl = new AbortController();
    const stop = VexSettingsGroups.button('Stop', () => ctl.abort(), {});
    body.appendChild(stop);
    const closeAll = () => { ctl.abort(); close(); };
    const render = (r) => {
      out.textContent = '';
      if (r.empty) { status.textContent = r.line; return; }
      status.textContent = (r.first ? 'First time on this thread. ' : r.newCount + ' new paragraph' + (r.newCount === 1 ? '' : 's') + ' since you last read. ') + r.line + (r.remaining ? ' ' + r.remaining + ' new paragraphs were not read, so they stay unread.' : '');
      const section = (title, items) => {
        const h = document.createElement('h4');
        h.textContent = title;
        h.style.margin = '12px 0 4px';
        out.appendChild(h);
        const ul = document.createElement('ul');
        ul.style.margin = '0 0 0 18px';
        const list = items.length ? items : ['none'];
        for (const t of list) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }
        out.appendChild(ul);
      };
      if (typeof VexProvenance !== 'undefined') out.appendChild(VexProvenance.chip({ kind: 'local', read: 'the thread text you chose' }));
      const s = r.sections;
      if (s.other && !s.decisions.length && !s.questions.length && !s.fresh.length) {
        const p = document.createElement('div'); p.style.whiteSpace = 'pre-wrap'; p.textContent = r.answer; out.appendChild(p);
      } else {
        section('Decisions', s.decisions); section('Open questions', s.questions); section('What is new', s.fresh);
      }
    };
    try {
      const r = await this.digest(got.text, key, {
        signal: ctl.signal,
        onProgress: (p) => { status.textContent = (p.phase === 'map' ? 'Reading part ' + Math.min(p.done + 1, p.total) + ' of ' + p.total : 'Putting it together') + '…'; },
      });
      stop.remove();
      render(r);
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;margin-top:14px;flex-wrap:wrap';
      bar.appendChild(VexSettingsGroups.button('Copy', async () => {
        try { await navigator.clipboard.writeText(r.empty ? r.line : r.answer); window.showToast?.('Copied'); }
        catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); }
      }));
      if (key) bar.appendChild(VexSettingsGroups.button('Forget what I read here', () => { this.forget(key); window.showToast?.('Forgotten: the next digest covers all of it'); }));
      bar.appendChild(VexSettingsGroups.button('Close', closeAll, { primary: true }));
      body.appendChild(bar);
    } catch (err) {
      stop.remove();
      status.textContent = err.code === 'cancelled' ? 'Stopped. Nothing was marked as read.' : err.message;
      if (err.code !== 'cancelled') VexProblems?.note('Thread digest', 'The digest failed', err);
      body.appendChild(VexSettingsGroups.button('Close', closeAll, { primary: true }));
    }
    return true;
  },

  // ---- command bar and Settings ----------------------------------------------------------------
  _registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    CommandBar.commands = CommandBar.commands.filter(c => c.id !== 'thread-digest');
    if (!this.enabled()) return;
    CommandBar.commands.push({
      id: 'thread-digest', label: 'Digest this thread (since I last read)',
      hint: 'Decisions, open questions and what is new, from your selection or this page. Local model.',
      icon: 'list', action: () => this.open(),
    });
  },

  init() { this._registerCommands(); },

  renderSettings(el) {
    el.appendChild(VexSettingsGroups.note('Turns a long thread (an issue, a forum, a mail conversation, a chat) into decisions, open questions and what is new since you last read it. It reads only the text you select, or the page you are looking at after you say yes, and never reads a chat or mail panel in the background. Done on this PC with your local model.'));
    const row = document.createElement('label');
    row.className = 'setting-toggle-row';
    const span = document.createElement('span');
    span.textContent = 'Thread digest';
    const wrap = document.createElement('span');
    wrap.className = 'toggle';
    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = this.enabled(); box.setAttribute('aria-label', 'Thread digest');
    const sl = document.createElement('span'); sl.className = 'toggle-slider';
    wrap.append(box, sl);
    row.append(span, wrap);
    box.addEventListener('change', () => { try { this.setEnabled(box.checked); } catch (err) { window.showToast?.(err.message, 'error'); } });
    el.appendChild(row);
    let n = 0;
    try { n = this.count(); } catch (err) { el.appendChild(VexSettingsGroups.note(err.message)); }
    el.appendChild(VexSettingsGroups.note('Remembers ' + n + ' thread' + (n === 1 ? '' : 's') + ' (short fingerprints only, no text).'));
    el.appendChild(VexSettingsGroups.button('Forget all read points', async () => {
      if (typeof vexConfirm !== 'function') { window.showToast?.('The confirm dialog is unavailable', 'error'); return; }
      if (!(await vexConfirm({ title: 'Forget what you have read?', message: 'The next digest of any thread covers all of it again.', okLabel: 'Forget', danger: true }))) return;
      try { this.forget(null); window.showToast?.('Forgotten'); } catch (err) { window.showToast?.(err.message, 'error'); }
    }, { danger: true }));
  },
};

if (typeof window !== 'undefined') window.VexThreadDigest = VexThreadDigest;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexThreadDigest };
if (typeof VexSettingsGroups !== 'undefined') {
  VexSettingsGroups.register({ id: 'thread-digest', title: 'Thread digest', keywords: 'long thread digest since last read decisions open questions summary', render: (el) => VexThreadDigest.renderSettings(el) });
}
