// === Vex agent tools that are not page actions ===
//
// The agent could only act on the page in front: click, type, navigate. So
// "research X" meant driving a search engine's page one click at a time, and
// anything about Vex itself — a note, a reminder, a bookmark, a tab group —
// was out of reach. These tools work without touching the visible page:
//
//   research   webSearch(query)      results from a keyless HTML endpoint
//              readUrl(url)          a page's readable text, no tab opened
//   Vex        saveNote, createReminder, addBookmark, searchHistory, groupTabs
//
// Fetching goes through main's bounded, CORS-free window.vex.apiRequest.
// Everything a tool returns is DATA for the model, never instructions — the
// agent's guidance says so, because a page can say anything.
// Public API: AgentTools. Depends on window.vex.apiRequest, TabManager,
// VexQuickReminder, Bookmarks, NotesPanel (each only by the tool that uses it).

const AgentTools = {
  UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  MAX_TEXT: 12000,

  // ------------------------------------------------------------- fetching --
  // The agent is steered by text it reads, so it must not be talked into
  // fetching the user's router or a service on this machine.
  isPrivateHost(host) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return true;
    const m = h.match(/^172\.(\d+)\./);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
    if (h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
    return false;
  },

  _checkUrl(url) {
    let u;
    try { u = new URL(String(url || '')); } catch { throw new Error('Not a valid URL: ' + url); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https pages can be read');
    if (this.isPrivateHost(u.hostname)) throw new Error('Pages on this machine or the local network are not read by the agent');
    return u;
  },

  async _get(url) {
    if (!window.vex || typeof window.vex.apiRequest !== 'function') throw new Error('Web access is not available in this build');
    const r = await window.vex.apiRequest({ url, headers: { 'User-Agent': this.UA, 'Accept-Language': 'en-US,en;q=0.9' } });
    if (!r || !r.ok) throw new Error((r && r.error) || 'The request failed');
    if (r.status >= 400) throw new Error('HTTP ' + r.status + ' from ' + new URL(url).hostname);
    return r;
  },

  // --------------------------------------------------------------- search --
  parseDuckDuckGo(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const out = [];
    for (const node of doc.querySelectorAll('.result')) {
      if (node.classList.contains('result--ad')) continue;
      const a = node.querySelector('a.result__a');
      if (!a) continue;
      let href = a.getAttribute('href') || '';
      // Results are wrapped: //duckduckgo.com/l/?uddg=<the real url>&rut=…
      try {
        const wrapped = new URL(href, 'https://duckduckgo.com');
        const real = wrapped.searchParams.get('uddg');
        href = real || wrapped.href;
      } catch { continue; }
      if (!/^https?:\/\//i.test(href) || /duckduckgo\.com\/y\.js/.test(href)) continue;
      out.push({ title: a.textContent.trim(), url: href, snippet: (node.querySelector('.result__snippet')?.textContent || '').trim() });
    }
    return out;
  },

  parseBing(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const out = [];
    for (const node of doc.querySelectorAll('li.b_algo')) {
      const a = node.querySelector('h2 a');
      const href = a && a.getAttribute('href');
      if (!href || !/^https?:\/\//i.test(href)) continue;
      out.push({ title: a.textContent.trim(), url: href, snippet: (node.querySelector('.b_caption p, p')?.textContent || '').trim() });
    }
    return out;
  },

  async webSearch(query, count) {
    const q = String(query || '').trim();
    if (!q) throw new Error('web_search needs a query');
    const n = Math.max(1, Math.min(Number(count) || 8, 10));
    const engines = [
      ['DuckDuckGo', 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), (h) => this.parseDuckDuckGo(h)],
      ['Bing', 'https://www.bing.com/search?q=' + encodeURIComponent(q), (h) => this.parseBing(h)],
    ];
    const failures = [];
    for (const [name, url, parse] of engines) {
      try {
        const results = parse((await this._get(url)).body);
        if (results.length) return { query: q, engine: name, results: results.slice(0, n) };
        failures.push(name + ': no results parsed');
      } catch (err) { failures.push(name + ': ' + err.message); }
    }
    throw new Error('Search failed — ' + failures.join('; '));
  },

  // -------------------------------------------------------------- reading --
  htmlToText(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const title = (doc.querySelector('title')?.textContent || '').trim();
    doc.querySelectorAll('script, style, noscript, svg, iframe, template, nav, header, footer, aside, form, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]').forEach(n => n.remove());
    // A parsed document has no layout, so textContent runs every block
    // together; a line break after each block keeps paragraphs apart.
    doc.querySelectorAll('p, br, li, h1, h2, h3, h4, h5, h6, tr, div, section, article, blockquote, pre').forEach(n => n.after(doc.createTextNode('\n')));
    const candidates = [...doc.querySelectorAll('article, main, [role="main"]')];
    const best = candidates.sort((a, b) => b.textContent.length - a.textContent.length)[0];
    const root = (best && best.textContent.trim().length > 400) ? best : (doc.body || doc.documentElement);
    const text = (root ? root.textContent : '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { title, text };
  },

  // The video id, for any of the shapes YouTube uses.
  youtubeId(url) {
    try {
      const u = new URL(String(url));
      if (/(^|\.)youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1).split('/')[0] || null;
      if (!/(^|\.)youtube(-nocookie)?\.com$/i.test(u.hostname)) return null;
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/);
      return m ? m[2] : null;
    } catch { return null; }
  },

  // What was SAID in a video. The page itself is an app shell with no words in
  // it, so a YouTube link used to be a dead end for research — the agent read
  // the shell, found nothing, and said so.
  //
  // The caption track is listed in the watch page's own JSON and fetched from
  // YouTube's timedtext endpoint. No key, no third party; if a video has no
  // captions there is nothing to get and that is said plainly.
  async youtubeTranscript(url) {
    const id = this.youtubeId(url);
    if (!id) throw new Error('That is not a YouTube address');
    const page = await this._get('https://www.youtube.com/watch?v=' + encodeURIComponent(id));
    const html = String(page.body || '');
    const title = (html.match(/<meta name="title" content="([^"]*)"/) || [])[1] || (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const tracks = [...html.matchAll(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/g)].map(m => JSON.parse('"' + m[1] + '"'));
    if (!tracks.length) throw new Error('This video has no captions, so there is nothing to read. Watch it, or find a page about it.');
    // Prefer one in the page's language; otherwise the first, which is usually
    // the original.
    const chosen = tracks.find(t => /[?&]lang=en/.test(t)) || tracks[0];
    const xml = String((await this._get(chosen)).body || '');
    const lines = [...xml.matchAll(/<text[^>]*start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)].map(m => ({
      at: Number(m[1]),
      text: m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;#39;/g, "'").replace(/&amp;quot;/g, '"').replace(/&amp;amp;/g, '&').replace(/&amp;#[0-9]+;/g, ' ').replace(/\s+/g, ' ').trim(),
    })).filter(l => l.text);
    if (!lines.length) throw new Error('The captions came back empty');
    const stamp = (sec) => Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');
    // Timestamps every couple of minutes, so an answer can point at a moment.
    let out = '', next = 0;
    for (const l of lines) {
      if (l.at >= next) { out += `\n[${stamp(l.at)}] `; next = l.at + 120; }
      out += l.text + ' ';
    }
    return { url: 'https://www.youtube.com/watch?v=' + id, title: title.replace(/ - YouTube$/, ''), kind: 'video transcript', text: out.trim().slice(0, this.MAX_TEXT), truncated: out.length > this.MAX_TEXT };
  },

  async readUrl(url) {
    // A video: read what was said in it, not the page around it.
    if (this.youtubeId(url)) return this.youtubeTranscript(url);
    const u = this._checkUrl(url);
    const r = await this._get(u.href);
    const type = String((r.headers && (r.headers['content-type'] || r.headers['Content-Type'])) || '').toLowerCase();
    // A PDF is where half of anything official lives. It used to be refused.
    if (/pdf/.test(type) || /\.pdf($|[?#])/i.test(u.pathname + u.search)) return this.readPdf(u.href, r);
    if (/octet-stream|image\/|video\/|audio\/|zip/.test(type)) throw new Error('That address is a ' + (type.split(';')[0] || 'file') + ', not a page — open it in a tab instead');
    const body = String(r.body || '');
    if (/html|xml/.test(type) || /^\s*</.test(body)) {
      const { title, text } = this.htmlToText(body);
      if (text.length < 200) return { url: u.href, title, text, note: 'Very little readable text — the page probably builds itself with JavaScript. Open it with new_tab and use extract_text.' };
      return { url: u.href, title, text: text.slice(0, this.MAX_TEXT), truncated: text.length > this.MAX_TEXT };
    }
    return { url: u.href, title: '', text: body.slice(0, this.MAX_TEXT), truncated: body.length > this.MAX_TEXT };
  },

  // The words out of a PDF, without opening it.
  //
  // A PDF stores text in compressed streams, so this is not a full reader: it
  // takes what is in the UNcompressed text objects, which for a report or a
  // form is usually most of it. When that comes to nothing, it says so and
  // suggests the tab — where Vex's own viewer can read it properly.
  async readPdf(href, fetched) {
    const r = fetched || await this._get(href);
    const raw = String(r.body || '');
    const chunks = [];
    for (const m of raw.matchAll(/BT([\s\S]{0,20000}?)ET/g)) {
      const text = [...m[1].matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj|\[((?:[^\]])*)\]\s*TJ/g)]
        .map(t => (t[1] || t[2] || '').replace(/\)\s*-?\d+(\.\d+)?\s*\(/g, '').replace(/\\([()\\])/g, '$1').replace(/^\(|\)$/g, ''))
        .join('');
      const clean = text.replace(/\s+/g, ' ').trim();
      if (clean.length > 1) chunks.push(clean);
    }
    const text = chunks.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    // Nothing readable at all means the whole file is compressed streams.
    if (text.length < 80) {
      throw new Error('That PDF keeps its text compressed, so it cannot be read this way — open it with new_tab and use extract_text.');
    }
    return {
      url: href, title: (raw.match(/\/Title\s*\(([^)]{1,200})\)/) || [])[1] || '', kind: 'pdf',
      text: text.slice(0, this.MAX_TEXT), truncated: text.length > this.MAX_TEXT,
      // Some of it read, but not much: the rest is probably compressed, and a
      // partial read presented as the whole document would be worse than a note.
      ...(text.length < 400 ? { note: 'Only part of this PDF is stored as plain text; the rest is compressed. Open it with new_tab and use extract_text to be sure of the whole thing.' } : {}),
    };
  },

  // ---------------------------------------------------------- Vex features --
  saveNote(title, content, sourceUrl) {
    const body = String(content || '').trim();
    const name = String(title || '').trim();
    if (!body && !name) throw new Error('A note needs a title or some content');
    const now = new Date().toISOString();
    const note = { id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), title: name.slice(0, 200), content: body, pinned: false, tags: ['agent'], sourceUrl: String(sourceUrl || ''), sourceTitle: '', createdAt: now, updatedAt: now };
    let notes = [];
    try { const a = JSON.parse(localStorage.getItem('vex.notes') || '[]'); if (Array.isArray(a)) notes = a; } catch { notes = []; }
    notes.unshift(note);
    localStorage.setItem('vex.notes', JSON.stringify(notes));
    try { if (typeof NotesPanel !== 'undefined' && NotesPanel.reloadSyncedState) NotesPanel.reloadSyncedState(); } catch {}
    return note;
  },

  async createReminder(message, when) {
    if (typeof VexQuickReminder === 'undefined') throw new Error('Reminders are not available');
    const trigger = VexQuickReminder.parseTrigger(String(when || '').trim());
    const at = trigger && trigger.at instanceof Date ? trigger.at : trigger;
    const made = await VexQuickReminder.create(message, (trigger && trigger.site) ? { site: trigger.site } : at, (trigger && trigger.repeat) ? { repeat: trigger.repeat } : undefined);
    return { id: made && made.id, message: String(message), when: (trigger && trigger.site) ? 'next visit to ' + trigger.site : (at instanceof Date ? at.toLocaleString() : String(when)) };
  },

  addBookmark(url, title) {
    if (typeof Bookmarks === 'undefined') throw new Error('Bookmarks are not available');
    const u = this._checkUrlLoose(url);
    if (Bookmarks.has(u)) return { url: u, already: true };
    Bookmarks.items.unshift({ id: (typeof vexId === 'function' ? vexId('bm') : 'bm_' + Date.now()), url: u, title: String(title || u).slice(0, 200), folder: '', at: Date.now() });
    Bookmarks.save();
    return { url: u, already: false };
  },

  _checkUrlLoose(url) {
    try { const u = new URL(String(url || '')); if (/^https?:$/.test(u.protocol)) return u.href; } catch {}
    throw new Error('Not a web address: ' + url);
  },

  searchHistory(query, limit) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) throw new Error('search_history needs a query');
    let hist = [];
    try { const a = JSON.parse(localStorage.getItem('vex.history') || '[]'); hist = Array.isArray(a) ? a : (a && Array.isArray(a.entries) ? a.entries : []); } catch { hist = []; }
    const words = q.split(/\s+/).filter(Boolean);
    const hits = hist.filter(h => h && h.url).filter(h => this._hasWords((h.title || '') + ' ' + h.url + ' ' + (h.summary || ''), words));
    return hits.slice(0, Math.max(1, Math.min(Number(limit) || 10, 25))).map(h => ({ title: h.title || h.url, url: h.url, visited: h.time ? new Date(h.time).toLocaleString() : '' }));
  },

  groupTabs(name, tabIds, color) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('A group needs a name');
    const ids = (Array.isArray(tabIds) ? tabIds : []).filter(id => TabManager.tabs.some(t => t.id === id));
    if (!ids.length) throw new Error('None of those tab ids exist — list_tabs gives the ids');
    const id = 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const palette = (typeof TabManager._themeGroupPalette === 'function' ? TabManager._themeGroupPalette() : []) || [];
    TabManager.groups.push({ id, name: clean.slice(0, 60), color: String(color || (palette[0] && palette[0].ref) || '#5b8def'), collapsed: false });
    for (const tabId of ids) TabManager._setTabGroup(tabId, id);
    VexStorage.saveGroups(TabManager.groups);
    TabManager.rebuildAllTabs();
    TabManager.persistTabs();
    return { id, name: clean, tabs: ids.length };
  },

  // Seen live: the agent searched its own notes for "monitors" and found
  // nothing, because the note says "Monitor" — it then repeated the same
  // search, tripped the loop detector, and recovered two steps later. Words
  // match across a plural either way; nothing more clever than that.
  _hasWords(hay, words) {
    const text = String(hay || '').toLowerCase();
    return words.every(w => text.includes(w)
      || (w.endsWith('s') && w.length > 3 && text.includes(w.slice(0, -1)))
      || text.includes(w + 's'));
  },

  // --------------------------------------------- what the user already kept --
  //
  // The agent could WRITE a note and never read one, so "what did I note about
  // the monitors?" or "add this to my shopping note" simply failed. These are
  // read-only and stay inside Vex: nothing here reaches a page or the network.
  searchNotes(query, limit) {
    let notes = [];
    try { const a = JSON.parse(localStorage.getItem('vex.notes') || '[]'); notes = Array.isArray(a) ? a : []; } catch { notes = []; }
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length
      ? notes.filter(n => this._hasWords((n.title || '') + ' ' + (n.content || '') + ' ' + (n.tags || []).join(' '), words))
      : notes.slice();
    return hits.slice(0, Math.max(1, Math.min(Number(limit) || 8, 20))).map(n => ({
      id: n.id, title: n.title || 'Untitled', tags: n.tags || [],
      updated: n.updatedAt ? new Date(n.updatedAt).toLocaleString() : '',
      preview: String(n.content || '').slice(0, 300),
    }));
  },

  readNote(id) {
    let notes = [];
    try { const a = JSON.parse(localStorage.getItem('vex.notes') || '[]'); notes = Array.isArray(a) ? a : []; } catch { notes = []; }
    const note = notes.find(n => n.id === id) || notes.find(n => (n.title || '').toLowerCase() === String(id || '').toLowerCase());
    if (!note) throw new Error('No note with that id or title — search_notes gives the ids');
    return { id: note.id, title: note.title || 'Untitled', content: String(note.content || '').slice(0, this.MAX_TEXT), tags: note.tags || [], sourceUrl: note.sourceUrl || '' };
  },

  // Adds to the end of a note that already exists — "put this on my list".
  appendNote(id, text) {
    const body = String(text || '').trim();
    if (!body) throw new Error('There is nothing to add');
    let notes = [];
    try { const a = JSON.parse(localStorage.getItem('vex.notes') || '[]'); notes = Array.isArray(a) ? a : []; } catch { notes = []; }
    const note = notes.find(n => n.id === id) || notes.find(n => (n.title || '').toLowerCase() === String(id || '').toLowerCase());
    if (!note) throw new Error('No note with that id or title — search_notes gives the ids');
    note.content = (note.content ? note.content.replace(/\s+$/, '') + '\n' : '') + body;
    note.updatedAt = new Date().toISOString();
    localStorage.setItem('vex.notes', JSON.stringify(notes));
    try { if (typeof NotesPanel !== 'undefined' && NotesPanel.reloadSyncedState) NotesPanel.reloadSyncedState(); } catch {}
    return { id: note.id, title: note.title || 'Untitled', added: body.length };
  },

  searchBookmarks(query, limit) {
    if (typeof Bookmarks === 'undefined' || !Array.isArray(Bookmarks.items)) throw new Error('Bookmarks are not available');
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length
      ? Bookmarks.items.filter(b => this._hasWords((b.title || '') + ' ' + b.url + ' ' + (b.folder || ''), words))
      : Bookmarks.items.slice();
    return hits.slice(0, Math.max(1, Math.min(Number(limit) || 10, 25))).map(b => ({ title: b.title || b.url, url: b.url, folder: b.folder || '' }));
  },

  async listReminders() {
    const bridge = window.vex && window.vex.reminders;
    if (!bridge) throw new Error('Reminders are not available');
    const all = await bridge.list();
    return all.filter(r => !r.firedAt).slice(0, 25).map(r => ({
      id: r.id, message: r.message, kind: r.kind || 'reminder',
      when: r.site ? 'next visit to ' + r.site : (r.at ? new Date(r.at).toLocaleString() : 'unknown'),
      repeats: Array.isArray(r.repeat) ? r.repeat.length + ' days a week' : (r.repeat || 'once'),
    }));
  },

  // ------------------------------------------------ Vex's clock and commands --
  //
  // Asked for a 20 minute timer, the agent opened a timer WEBSITE and left it
  // unstarted: it had no timer tool and nothing told it Vex has a clock. These
  // are Vex's own features, reached the way the command bar reaches them.
  async startTimer(duration, label) {
    if (typeof VexClock === 'undefined') throw new Error('The Clock is not available');
    const t = await VexClock.addTimer(String(duration || ''), label);
    return { id: t.id, label: t.label, length: VexClock.fmtLeft(t.total), endsAt: new Date(t.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
  },

  listTimers() {
    if (typeof VexClock === 'undefined') throw new Error('The Clock is not available');
    return VexClock._timers.map(t => ({ id: t.id, label: t.label, left: VexClock.fmtLeft(t.endAt - Date.now()) }));
  },

  async cancelTimer(id) {
    if (typeof VexClock === 'undefined') throw new Error('The Clock is not available');
    const t = VexClock._timers.find(x => x.id === id) || (VexClock._timers.length === 1 && !id ? VexClock._timers[0] : null);
    if (!t) throw new Error('No timer with that id — list_timers gives the ids');
    await VexClock.removeTimer(t.id);
    return { id: t.id, label: t.label };
  },

  // What Vex can do by itself, from the catalogue Discover shows. Any word of
  // the query may match; the most matching words come first.
  vexFeatures(query) {
    if (typeof VexFeatures === 'undefined') throw new Error('The feature catalogue is not loaded');
    const words = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
    if (!words.length) throw new Error('vex_features needs a query — a few words about what you want to do');
    const scored = [];
    for (const f of VexFeatures.ITEMS) {
      const cmd = VexFeatures.command(f) || {};
      const hay = [VexFeatures.nameOf(f), f.id, f.what, cmd.label, cmd.hint].join(' ').toLowerCase();
      const n = words.filter(w => hay.includes(w)).length;
      if (n) scored.push({ n, f, cmd });
    }
    scored.sort((a, b) => b.n - a.n);
    return scored.slice(0, 8).map(({ f, cmd }) => ({
      feature: VexFeatures.nameOf(f), what: f.what,
      ...(f.cmd ? { command: f.cmd } : {}),
      ...(VexFeatures.keysOf(f) ? { shortcut: VexFeatures.keysOf(f) } : {}),
      ...(f.manual ? { note: 'Done by hand — tell the user how; there is no command to run' } : {}),
    }));
  },

  // The feature list in one paragraph, so the agent knows what exists before it
  // reaches for a website. vex_features has the details.
  featureDigest() {
    if (typeof VexFeatures === 'undefined') return '';
    return VexFeatures.CATS.map(c => c.name + ': ' + VexFeatures.ITEMS.filter(f => f.cat === c.id).map(f => VexFeatures.nameOf(f)).join(', ')).join('. ');
  },

  // Runs what the user would type into Ctrl+K: a sentence the command bar
  // understands ("alarm 7am weekdays", "stopwatch", "what time is it in
  // Tokyo", "free memory"), or a command id from vex_features.
  async vexCommand(text) {
    const q = String(text || '').trim();
    if (!q) throw new Error('vex_command needs the command: a sentence like "alarm 7am weekdays", or a command id from vex_features');
    // Seen live: vex_command("start_timer 45s Tea"). A tool's name is not a command.
    const first = q.split(/[\s(]/)[0];
    if (typeof AGENT_TOOLS !== 'undefined' && first !== 'vex_command' && AGENT_TOOLS.some(t => t.name === first)) throw new Error(first + ' is one of your tools, not a Vex command — call it directly: {"tool":"' + first + '","parameters":{...}}');
    if (typeof VexQuickCommands !== 'undefined') {
      const quick = VexQuickCommands.results(q);
      const hit = quick.find(r => r.id !== 'quick-error');
      if (hit) { await hit.action(); return { ran: hit.label, detail: hit.hint || '' }; }
      if (quick.length) throw new Error(quick[0].label);
    }
    if (typeof CommandBar === 'undefined') throw new Error('The command bar is not available');
    const lower = q.toLowerCase();
    const cmd = CommandBar.commands.find(c => c.id === q) || CommandBar.commands.find(c => String(c.label || '').toLowerCase() === lower);
    if (!cmd) throw new Error('Vex has no command "' + q + '" — call vex_features to find the right command id');
    await cmd.action();
    return { ran: cmd.label, detail: cmd.hint || '' };
  },

  // ------------------------------------------------------------ what it sees --
  // The page as the user sees it, small enough to hand to a model: 1024 px
  // wide, JPEG. Returns a data URL.
  async pageImage(wv) {
    const img = await wv.capturePage();
    if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) throw new Error('The page could not be captured (is the tab visible?)');
    const size = img.getSize();
    const small = size.width > 1024 ? img.resize({ width: 1024 }) : img;
    const out = small.getSize();
    return { image: await this._toJpeg(small.toDataURL(), out.width, out.height), width: out.width, height: out.height };
  },

  _toJpeg(dataUrl, width, height) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = width; c.height = height;
          c.getContext('2d').drawImage(im, 0, 0, width, height);
          resolve(c.toDataURL('image/jpeg', 0.72));
        } catch (err) { reject(err); }
      };
      im.onerror = () => reject(new Error('The screenshot could not be decoded'));
      im.src = dataUrl;
    });
  },
};

if (typeof window !== 'undefined') window.AgentTools = AgentTools;
if (typeof module !== 'undefined' && module.exports) module.exports = { AgentTools };
