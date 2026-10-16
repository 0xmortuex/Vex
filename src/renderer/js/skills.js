// === Vex AI Skills — saved, reusable AI commands ===
//
// A Skill is a named prompt ("Summarize as 5 bullets", "Explain like I'm 5")
// that runs against the current page through the AI panel's chat pipeline
// (which already attaches page context). Skills appear in the command bar
// (Ctrl+K → type the skill name) and are managed from Settings → AI Skills.
// Stored in localStorage 'vex.skills'; ships with editable defaults.
//
// A skill's `icon` is a VexIcons name, not an emoji — skills saved by an older
// build carry an `emoji` instead, and _normalize() maps the five shipped ones
// to their icon and anything else to a neutral one.

const VexSkills = {
  KEY: 'vex.skills',
  skills: [],

  // The icons offered in the editor — a short, meaningful list rather than all
  // 146, since a skill is a kind of instruction, not an arbitrary object.
  ICONS: ['sparkles', 'pin', 'list', 'check', 'edit', 'search', 'bulb', 'brain', 'book-open',
    'message', 'clipboard', 'code', 'chart-bar', 'flag', 'target', 'wand', 'zap', 'type'],

  // Emoji from a pre-icons build -> the icon that replaced it.
  LEGACY_ICONS: { '📌': 'pin', '🧒': 'book-open', '✅': 'check', '✍️': 'edit', '🔍': 'search' },

  DEFAULTS: [
    { id: 'sk_bullets', name: 'Summarize in 5 bullets', icon: 'pin', prompt: 'Summarize this page in exactly 5 concise bullet points. No preamble.' },
    { id: 'sk_eli5', name: "Explain like I'm 5", icon: 'book-open', prompt: 'Explain what this page is about in very simple terms a child could understand. Short paragraphs, no jargon.' },
    { id: 'sk_actions', name: 'Extract action items', icon: 'check', prompt: 'Extract every action item, task, deadline, or commitment from this page as a checklist. If none, say so.' },
    { id: 'sk_reply', name: 'Draft a reply', icon: 'edit', prompt: 'Draft a clear, polite reply to the message or thread on this page. Match its language and tone. Give me only the reply text.' },
    { id: 'sk_critique', name: 'Find the weak points', icon: 'search', prompt: 'Critically evaluate the claims on this page. List the strongest points, the weakest/unsupported ones, and what is missing.' },
  ],

  init() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      this.skills = Array.isArray(saved) ? saved.map(sk => this._normalize(sk)) : this.DEFAULTS.slice();
    } catch { this.skills = this.DEFAULTS.slice(); }
    this._registerCommands();
  },

  // A stored skill from an older build carries `emoji`; give it an icon name
  // and drop the glyph. Returns the same object (skills are edited in place).
  _normalize(sk) {
    if (!sk || typeof sk !== 'object') return sk;
    if (!sk.icon && sk.emoji) sk.icon = this.LEGACY_ICONS[sk.emoji] || 'sparkles';
    if (!sk.icon) sk.icon = 'sparkles';
    delete sk.emoji;
    return sk;
  },

  // Returns false when the write failed — no caller may claim a save that did
  // not happen. The command bar is refreshed either way so it matches memory.
  save() {
    let ok = true;
    try { localStorage.setItem(this.KEY, JSON.stringify(this.skills)); } catch { ok = false; }
    this._registerCommands();
    return ok;
  },

  // ======================================================================================
  // Variables, typed outputs, per-site binding, a schedule and a version history (T2-012)
  //
  //   {{selection}} {{url}} {{title}} {{host}} {{date}} {{time}} {{ask:Question}}
  //       filled in when the skill runs. {{selection}} is the text selected on the
  //       page; {{ask:...}} asks you first. An unknown {{name}} is refused when you
  //       save, not guessed at run time.
  //   output      text (the chat, as before), checklist, table, note, reminder. A typed
  //       skill shows its answer as that thing, with the button that uses it
  //       (copy, save as a note, set the reminder). Nothing is saved or set until
  //       you press that button.
  //   sites       ["github.com"]: the skill is offered by "AI: Skills for this site".
  //       It is never started by itself.
  //   schedule    "remind me to run it every day / weekday / week at 09:00": it sets an
  //       ordinary Vex reminder. Vex does not run the AI unattended.
  //   versions    the last ten prompts, with the changes between them.
  // Skills can be exported and imported as plain text; an import shows the full
  // text of every prompt and only adds what you accept (prompts only, no code).
  // ======================================================================================
  OUTPUTS: ['text', 'checklist', 'table', 'note', 'reminder'],
  OUTPUT_LABEL: { text: 'Text in the chat', checklist: 'Checklist', table: 'Table', note: 'A note', reminder: 'A reminder' },
  VAR_RE: /\{\{\s*([a-z]+)(?::([^{}]{1,80}))?\s*\}\}/gi,
  VARS: ['selection', 'url', 'title', 'host', 'date', 'time', 'ask'],
  MAX_VERSIONS: 10,

  // Variables a prompt uses -> [{ name, arg, raw }]; throws on a name that does not exist.
  findVariables(prompt) {
    const out = [];
    for (const m of String(prompt || '').matchAll(this.VAR_RE)) {
      const name = m[1].toLowerCase();
      if (!this.VARS.includes(name)) throw new Error('Unknown variable {{' + m[1] + '}}. Use ' + this.VARS.map(v => '{{' + (v === 'ask' ? 'ask:Question' : v) + '}}').join(', ') + '.');
      if (name === 'ask' && !(m[2] || '').trim()) throw new Error('{{ask:}} needs a question, for example {{ask:Which language?}}.');
      if (name !== 'ask' && m[2]) throw new Error('{{' + m[1] + '}} takes no argument.');
      out.push({ name, arg: (m[2] || '').trim(), raw: m[0] });
    }
    return out;
  },

  // values: { selection, url, title, host, date, time, ask: { "<question>": answer } }
  fill(prompt, values) {
    return String(prompt).replace(this.VAR_RE, (raw, n, arg) => {
      const name = n.toLowerCase();
      if (name === 'ask') return String((values.ask || {})[(arg || '').trim()] ?? '');
      return String(values[name] ?? '');
    });
  },

  // What each typed output is asked to look like.
  formatSuffix(output) {
    switch (output) {
      case 'checklist': return '\n\nReply ONLY as a checklist: one item per line, each starting with "- [ ] ". No other text.';
      case 'table': return '\n\nReply ONLY as a markdown table with a header row and a separator row. No other text.';
      case 'note': return '\n\nReply as a short note: a first line with a title (no # sign), then the body. No other text.';
      case 'reminder': return '\n\nReply ONLY as JSON: {"message": "what to be reminded of, one line", "when": "when, like tomorrow 9am or in 2 hours or friday"}.';
      default: return '';
    }
  },

  // ---- reading a typed answer (pure) ------------------------------------------------------
  parseChecklist(text) {
    const items = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const m = /^\s*(?:[-*•]|\d+[.)])\s*(?:\[( |x|X)\]\s*)?(.+)$/.exec(line);
      if (m) items.push({ text: m[2].trim(), done: !!m[1] && m[1] !== ' ' });
    }
    if (!items.length) throw new Error('The answer was not a checklist. Run the skill again.');
    return items;
  },
  parseTable(text) {
    const rows = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('|') || /\|/.test(l));
    const cells = (l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    const sep = rows.findIndex(l => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(l));
    if (sep < 1) throw new Error('The answer was not a table. Run the skill again.');
    return { head: cells(rows[sep - 1]), rows: rows.slice(sep + 1).map(cells) };
  },
  parseNote(text) {
    const lines = String(text || '').split(/\r?\n/);
    const first = lines.findIndex(l => l.trim());
    if (first < 0) throw new Error('The answer was empty.');
    return { title: lines[first].replace(/^#+\s*/, '').trim().slice(0, 120), content: lines.slice(first + 1).join('\n').trim() };
  },
  parseReminder(text) {
    const raw = String(text || '');
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('The answer was not a reminder. Run the skill again.');
    let o;
    try { o = JSON.parse(raw.slice(a, b + 1)); } catch (err) { throw new Error('The answer was not a reminder. Run the skill again.', { cause: err }); }
    const message = String(o.message || '').trim();
    if (!message) throw new Error('The reminder had no words. Run the skill again.');
    return { message, when: String(o.when || '').trim() };
  },
  tableMarkdown(t) {
    const line = (c) => '| ' + c.join(' | ') + ' |';
    return [line(t.head), line(t.head.map(() => '---')), ...t.rows.map(line)].join('\n');
  },

  // ---- sites ------------------------------------------------------------------------------------
  hostOf(url) { try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },
  cleanHost(input) {
    const h = this.hostOf('https://' + String(input || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, ''));
    if (!h || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) throw new Error('"' + input + '" does not look like a site. Try something like github.com.');
    return h;
  },
  _hostMatches(host, bound) { return !!host && (host === bound || host.endsWith('.' + bound)); },

  // Skills bound to the site of this address.
  skillsForSite(url) {
    const host = this.hostOf(url);
    return this.skills.filter(s => Array.isArray(s.sites) && s.sites.some(b => this._hostMatches(host, b)));
  },

  // ---- versions ----------------------------------------------------------------------------------
  // Call before changing a skill's prompt: keeps the old one when it differs.
  pushVersion(sk, newPrompt, now = Date.now()) {
    if (sk.prompt === newPrompt) return false;
    sk.versions = [{ prompt: sk.prompt, at: now }, ...(Array.isArray(sk.versions) ? sk.versions : [])].slice(0, this.MAX_VERSIONS);
    return true;
  },
  diff(a, b) {
    if (typeof VexDraftField !== 'undefined' && VexDraftField.diff) return VexDraftField.diff(a, b);
    return [{ t: 'del', text: a }, { t: 'add', text: b }];
  },

  // ---- export / import (declarative text only) ------------------------------------------------------
  exportText() {
    return JSON.stringify({ vexSkills: 1, skills: this.skills.map(s => ({ name: s.name, icon: s.icon, prompt: s.prompt, output: s.output || 'text', sites: s.sites || [] })) }, null, 2);
  },
  // -> [{ name, icon, prompt, output, sites }] checked; throws a plain sentence on anything else.
  parseImport(text) {
    let o;
    try { o = JSON.parse(String(text || '')); } catch (err) { throw new Error('That is not an exported skills file: ' + err.message, { cause: err }); }
    if (!o || o.vexSkills !== 1 || !Array.isArray(o.skills)) throw new Error('That is not an exported skills file.');
    if (o.skills.length > 50) throw new Error('At most 50 skills can be imported at once.');
    return o.skills.map((s, i) => {
      const name = String((s && s.name) || '').trim().slice(0, 80);
      const prompt = String((s && s.prompt) || '').trim().slice(0, 4000);
      if (!name || !prompt) throw new Error('Skill ' + (i + 1) + ' has no name or prompt.');
      this.findVariables(prompt);
      const output = this.OUTPUTS.includes(s.output) ? s.output : 'text';
      const sites = (Array.isArray(s.sites) ? s.sites : []).slice(0, 10).map(h => this.cleanHost(h));
      const icon = this.ICONS.includes(s.icon) ? s.icon : 'sparkles';
      return { name, icon, prompt, output, sites };
    });
  },
  async importFrom(text) {
    const list = this.parseImport(text);
    if (typeof vexConfirm !== 'function') throw new Error('Vex could not ask you, so nothing was imported.');
    const esc = (s) => window.escapeHtml(s);
    const html = '<div style="max-height:320px;overflow:auto">' + list.map(s => '<p><b>' + esc(s.name) + '</b> (' + esc(this.OUTPUT_LABEL[s.output]) + (s.sites.length ? ', offered on ' + esc(s.sites.join(', ')) : '') + ')<br><span style="white-space:pre-wrap">' + esc(s.prompt) + '</span></p>').join('') + '</div>';
    const ok = await vexConfirm({ title: 'Add ' + list.length + ' skill' + (list.length === 1 ? '' : 's') + '?', message: 'These prompts will be added. Read them first: a skill is only text that is sent to your AI when you run it.', html, okLabel: 'Add them', wide: true });
    if (!ok) return 0;
    for (const s of list) this.skills.push({ id: vexId('sk_'), ...s, imported: true });
    if (!this.save()) throw new Error('The skills could not be saved.');
    return list.length;
  },

  // ---- schedule: an ordinary reminder ----------------------------------------------------------------
  async setSchedule(id, repeat, whenText) {
    const sk = this.skills.find(s => s.id === id);
    if (!sk) throw new Error('That skill is gone.');
    if (typeof VexQuickReminder === 'undefined') throw new Error('Reminders are not available here.');
    if (!['daily', 'weekdays', 'weekly'].includes(repeat)) throw new Error('A schedule is daily, weekdays or weekly.');
    const at = VexQuickReminder.parseWhen(whenText);
    const made = await VexQuickReminder.create('Run the skill "' + sk.name + '" (Ctrl+K, then its name)', at, { repeat });
    sk.schedule = { repeat, reminderId: made && made.id ? made.id : null, at: at.getTime() };
    if (!this.save()) throw new Error('The schedule could not be saved.');
    return sk.schedule;
  },
  async clearSchedule(id) {
    const sk = this.skills.find(s => s.id === id);
    if (!sk || !sk.schedule) return;
    if (sk.schedule.reminderId && typeof VexQuickReminder !== 'undefined') await VexQuickReminder.remove(sk.schedule.reminderId);
    delete sk.schedule;
    if (!this.save()) throw new Error('The change could not be saved.');
  },

  // ---- running --------------------------------------------------------------------------------------------
  _activeWebview() { return (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null; },

  async _values(sk) {
    const vars = this.findVariables(sk.prompt);
    const wv = this._activeWebview();
    const now = new Date();
    const values = { ask: {}, date: now.toLocaleDateString(), time: now.toLocaleTimeString() };
    const url = wv && wv.getURL ? wv.getURL() : '';
    values.url = url; values.host = this.hostOf(url); values.title = (wv && wv.getTitle && wv.getTitle()) || '';
    if (vars.some(v => v.name === 'selection')) {
      if (!wv) throw new Error('This skill needs selected text, but no page is open.');
      if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) throw new Error('This is a private, Tor or routed tab, so Vex does not read it.');
      values.selection = String(await wv.executeJavaScript('(function(){try{return String(window.getSelection().toString()||"")}catch(e){return ""}})()') || '').trim();
      if (!values.selection) throw new Error('Select some text on the page first, then run "' + sk.name + '".');
    }
    for (const v of vars.filter(x => x.name === 'ask')) {
      if (v.arg in values.ask) continue;
      if (typeof vexPromptModal !== 'function') throw new Error('The question dialog is unavailable.');
      const a = await vexPromptModal(v.arg, '');
      if (a == null) { const e = new Error('Cancelled.'); e.code = 'cancelled'; throw e; }
      values.ask[v.arg] = a;
    }
    return values;
  },

  async run(id) {
    const sk = this.skills.find(s => s.id === id);
    if (!sk) return;
    let message;
    try {
      const values = await this._values(sk);
      message = this.fill(sk.prompt, values);
    } catch (err) {
      if (err.code !== 'cancelled') window.showToast?.(err.message, 'warn');
      return;
    }
    const output = this.OUTPUTS.includes(sk.output) ? sk.output : 'text';
    if (output === 'text') {
      if (typeof AIPanel === 'undefined') return;
      if (!AIPanel.isOpen?.()) AIPanel.open();
      AIPanel.sendMessage('chat', { message });
      return;
    }
    try { await this.runTyped(sk, message, output); }
    catch (err) {
      window.showToast?.(err.message, 'error');
      VexProblems?.note('AI Skills', 'The skill "' + sk.name + '" failed', err);
    }
  },

  // A typed skill goes through the same router as the chat, so the cloud
  // sensitivity gate (js/ai-sensitivity.js) sees it like any other request.
  async runTyped(sk, message, output) {
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callAI !== 'function') throw new Error('The AI is not available here.');
    const wv = this._activeWebview();
    let pageContext = null;
    if (wv && typeof PageContext !== 'undefined' && !(window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv))) {
      pageContext = await PageContext.extractPageContext(wv);
    }
    const history = [];
    const site = this.siteInstructionMessage(pageContext && pageContext.url);
    if (site) history.push(site);
    if (typeof AIMemory !== 'undefined') { const m = AIMemory.historyMessage(); if (m) history.push(m); }
    window.showToast?.('Running "' + sk.name + '"…');
    const res = await AIRouter.callAI('chat', { message: message + this.formatSuffix(output), pageContext, conversationHistory: history });
    const text = typeof res.result === 'string' ? res.result : String((res.result && (res.result.reply || res.result.text)) || '');
    if (!text.trim()) throw new Error('The AI returned nothing. Try again.');
    this.showTyped(sk, output, text.trim());
  },

  showTyped(sk, output, text) {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('The result view is unavailable.');
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-skill-result', title: sk.name, sub: this.OUTPUT_LABEL[output] + ' · nothing is saved until you press a button' });
    const el = (tag, cls, t) => { const e = document.createElement(tag); if (cls) e.className = cls; if (t != null) e.textContent = t; return e; };
    const msg = el('div', 'vex-platform-note'); msg.setAttribute('role', 'status');
    const bar = el('div'); bar.style.cssText = 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap';
    const copyBtn = (label, getText) => VexSettingsGroups.button(label, async () => {
      try { await navigator.clipboard.writeText(getText()); msg.textContent = 'Copied.'; } catch (err) { msg.textContent = 'Could not copy: ' + err.message; }
    });
    const toNote = (title, content) => VexSettingsGroups.button('Save as a note', () => {
      try {
        if (typeof NotesPanel === 'undefined') throw new Error('Notes are not available here.');
        NotesPanel.createNote();
        const n = NotesPanel.notes[0];
        n.title = title; n.content = content; n.updatedAt = new Date().toISOString();
        NotesPanel._fillEditor(); NotesPanel.save();
        msg.textContent = 'Saved as a note.';
      } catch (err) { msg.textContent = err.message; }
    });
    try {
      if (output === 'checklist') {
        const items = this.parseChecklist(text);
        const ul = el('div');
        for (const it of items) {
          const lab = el('label'); lab.style.cssText = 'display:flex;gap:8px;margin:4px 0';
          const cb = el('input'); cb.type = 'checkbox'; cb.checked = it.done;
          lab.append(cb, el('span', null, it.text)); ul.appendChild(lab);
        }
        body.append(ul);
        const md = () => items.map(i => '- [ ] ' + i.text).join('\n');
        bar.append(copyBtn('Copy', md), toNote(sk.name, md()));
      } else if (output === 'table') {
        const t = this.parseTable(text);
        const table = el('table'); table.style.cssText = 'border-collapse:collapse;width:100%';
        const row = (cells, tag) => { const tr = el('tr'); for (const c of cells) { const td = el(tag, null, c); td.style.cssText = 'border:1px solid var(--border);padding:4px 8px;text-align:left'; tr.appendChild(td); } return tr; };
        table.appendChild(row(t.head, 'th')); for (const r of t.rows) table.appendChild(row(r, 'td'));
        body.append(table);
        bar.append(copyBtn('Copy as markdown', () => this.tableMarkdown(t)), toNote(sk.name, this.tableMarkdown(t)));
      } else if (output === 'note') {
        const n = this.parseNote(text);
        body.append(el('h3', null, n.title), Object.assign(el('div', null, n.content), { style: 'white-space:pre-wrap' }));
        bar.append(copyBtn('Copy', () => n.title + '\n\n' + n.content), toNote(n.title, n.content));
      } else if (output === 'reminder') {
        const r = this.parseReminder(text);
        const m = el('input', 'vexsr-input'); m.type = 'text'; m.value = r.message; m.setAttribute('aria-label', 'Reminder text');
        const w = el('input', 'vexsr-input'); w.type = 'text'; w.value = r.when; w.placeholder = 'tomorrow 9am'; w.setAttribute('aria-label', 'When');
        body.append(m, w);
        bar.append(VexSettingsGroups.button('Set the reminder', async () => {
          try {
            if (typeof VexQuickReminder === 'undefined') throw new Error('Reminders are not available here.');
            const at = VexQuickReminder.parseWhen(w.value);
            await VexQuickReminder.create(m.value, at, {});
            msg.textContent = 'Reminder set for ' + at.toLocaleString() + '.';
          } catch (err) { msg.textContent = err.message; }
        }, { primary: true }));
      }
    } catch (err) {
      // The answer did not have the shape: say so, and show what came back.
      msg.textContent = err.message;
      body.append(Object.assign(el('div', null, text), { style: 'white-space:pre-wrap;margin-top:8px' }));
      bar.append(copyBtn('Copy the answer', () => text));
    }
    bar.append(VexSettingsGroups.button('Close', close));
    body.append(msg, bar);
  },

  // ======================================================================================
  // Per-site standing instructions (T2-012)
  //
  // One instruction per site ("on github.com: answer as a code reviewer, short").
  // It is added to every AI chat request made while that site (or a page of it)
  // is in front. Kept in 'vex.siteInstructions'; edit, switch off, delete and
  // restore an earlier wording from Settings › Site instructions. With the cloud
  // backend an instruction is left out unless "include memory" is ticked for AI
  // memory (it is your own words, treated like a remembered fact).
  // ======================================================================================
  SITE_KEY: 'vex.siteInstructions',
  SITE_ENABLED_KEY: 'vex.siteInstructions.enabled',
  MAX_SITE_TEXT: 1000,
  MAX_SITES: 100,

  siteEnabled() { try { return localStorage.getItem(this.SITE_ENABLED_KEY) !== 'off'; } catch { return true; } },
  setSiteEnabled(on) {
    try { localStorage.setItem(this.SITE_ENABLED_KEY, on ? 'on' : 'off'); }
    catch (err) { throw new Error('The setting could not be saved: ' + err.message, { cause: err }); }
  },
  _siteLoad() {
    try {
      const raw = localStorage.getItem(this.SITE_KEY);
      if (raw == null) return {};
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not a record');
      return o;
    } catch (err) { throw new Error('The saved site instructions are damaged (' + err.message + ').', { cause: err }); }
  },
  _siteSave(o) {
    try { localStorage.setItem(this.SITE_KEY, JSON.stringify(o)); }
    catch (err) { throw new Error('The instruction could not be saved: ' + err.message, { cause: err }); }
  },
  siteInstructions() { return this._siteLoad(); },
  // The wording for this host, else for its parent domain: -> { host, text, enabled } | null
  siteInstructionFor(url) {
    const host = this.hostOf(url);
    if (!host) return null;
    const all = this._siteLoad();
    const keys = Object.keys(all).filter(h => this._hostMatches(host, h)).sort((a, b) => b.length - a.length);
    return keys.length ? { host: keys[0], ...all[keys[0]] } : null;
  },
  setSiteInstruction(hostInput, text, now = Date.now()) {
    const host = this.cleanHost(hostInput);
    const t = String(text == null ? '' : text).trim();
    if (!t) throw new Error('Write the instruction, or delete it.');
    if (t.length > this.MAX_SITE_TEXT) throw new Error('An instruction is at most ' + this.MAX_SITE_TEXT + ' characters.');
    const all = this._siteLoad();
    if (!all[host] && Object.keys(all).length >= this.MAX_SITES) throw new Error('At most ' + this.MAX_SITES + ' sites can have an instruction.');
    const prev = all[host];
    const versions = prev ? [{ text: prev.text, at: prev.at }, ...(prev.versions || [])].filter(v => v.text !== t).slice(0, this.MAX_VERSIONS) : [];
    all[host] = { text: t, enabled: prev ? prev.enabled !== false : true, at: now, versions };
    this._siteSave(all);
    return host;
  },
  setSiteInstructionOn(host, on) {
    const all = this._siteLoad();
    if (!all[host]) throw new Error('There is no instruction for ' + host + '.');
    all[host].enabled = !!on;
    this._siteSave(all);
  },
  removeSiteInstruction(host) {
    const all = this._siteLoad();
    const gone = all[host];
    delete all[host];
    this._siteSave(all);
    return gone || null;
  },
  // The system message for a chat request made on `url` (null when none applies or the feature is off).
  siteInstructionMessage(url) {
    if (!this.siteEnabled()) return null;
    const hit = this.siteInstructionFor(url);
    if (!hit || hit.enabled === false) return null;
    return { role: 'system', content: 'Standing instruction from the user for ' + hit.host + ' (follow it in this chat, while it does not conflict with the question):\n' + hit.text, vexMemory: true, vexSiteInstruction: hit.host };
  },

  async editSiteInstruction(hostInput) {
    if (typeof vexPromptModal !== 'function') { window.showToast?.('The prompt dialog is unavailable', 'error'); return; }
    try {
      const host = hostInput || this.hostOf(this._activeWebview()?.getURL?.() || '');
      if (!host) { window.showToast?.('Open a website first, or add the site in Settings › Site instructions.', 'warn'); return; }
      const cur = this.siteInstructionFor('https://' + host);
      const v = await vexPromptModal('Standing instruction for ' + host + ' (empty to remove)', cur && cur.host === host ? cur.text : '');
      if (v == null) return;
      if (!v.trim()) { if (cur && cur.host === host) { this.removeSiteInstruction(host); window.showToast?.('Instruction removed'); } return; }
      this.setSiteInstruction(host, v);
      window.showToast?.('Saved. It applies to AI chats while you are on ' + host + '.');
    } catch (err) { window.showToast?.(err.message, 'error'); }
  },

  async chooseForSite() {
    const wv = this._activeWebview();
    const list = this.skillsForSite(wv && wv.getURL ? wv.getURL() : '');
    if (!list.length) { window.showToast?.('No skill is set for this site. Edit a skill and add the site under "Offered on".', 'warn'); return; }
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-skill-site', title: 'Skills for this site', sub: 'Pick one to run it. Nothing starts by itself.' });
    for (const sk of list) body.appendChild(VexSettingsGroups.button(sk.name, () => { close(); this.run(sk.id); }, { primary: true }));
  },

  renderSiteSettings(el) {
    el.appendChild(VexSettingsGroups.note('A standing instruction is added to every AI chat made while you are on that site, for example: "answer as a code reviewer, short". Edit it with Ctrl+K › "AI: Instruction for this site".'));
    const row = document.createElement('label'); row.className = 'setting-toggle-row';
    const span = document.createElement('span'); span.textContent = 'Use site instructions';
    const wrap = document.createElement('span'); wrap.className = 'toggle';
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = this.siteEnabled(); box.setAttribute('aria-label', 'Use site instructions');
    const sl = document.createElement('span'); sl.className = 'toggle-slider'; wrap.append(box, sl); row.append(span, wrap);
    box.addEventListener('change', () => { try { this.setSiteEnabled(box.checked); } catch (err) { window.showToast?.(err.message, 'error'); } });
    el.appendChild(row);
    el.appendChild(VexSettingsGroups.note('With the cloud backend an instruction is left out unless "include memory" is ticked under AI Memory.'));
    let all;
    try { all = this._siteLoad(); } catch (err) { el.appendChild(VexSettingsGroups.note(err.message)); return; }
    const redraw = () => { const host = el.parentElement; if (host) { VexSettingsGroups.inject(); } };
    for (const [host, ins] of Object.entries(all)) {
      const r = document.createElement('div'); r.style.cssText = 'padding:8px 0;border-top:1px solid var(--border)';
      const t = document.createElement('div'); t.textContent = host + (ins.enabled === false ? ' (off)' : ''); t.style.fontWeight = '600';
      const d = document.createElement('div'); d.className = 'vex-platform-note'; d.textContent = ins.text;
      r.append(t, d);
      const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;margin-top:4px;flex-wrap:wrap';
      bar.append(
        VexSettingsGroups.button('Edit', async () => { await this.editSiteInstruction(host); redraw(); }),
        VexSettingsGroups.button(ins.enabled === false ? 'Turn on' : 'Turn off', () => { try { this.setSiteInstructionOn(host, ins.enabled === false); } catch (err) { window.showToast?.(err.message, 'error'); } redraw(); }),
        VexSettingsGroups.button('Delete', () => {
          try {
            const gone = this.removeSiteInstruction(host);
            redraw();
            if (gone && window.VexUndo) window.VexUndo.offer({ message: 'Deleted the instruction for ' + host, undo: () => { const a = this._siteLoad(); a[host] = gone; this._siteSave(a); redraw(); } });
          } catch (err) { window.showToast?.(err.message, 'error'); }
        }, { danger: true }),
      );
      if (ins.versions && ins.versions.length) {
        const prev = ins.versions[0];
        bar.append(VexSettingsGroups.button('Restore the earlier wording', () => {
          try { this.setSiteInstruction(host, prev.text); } catch (err) { window.showToast?.(err.message, 'error'); }
          redraw();
        }));
      }
      r.appendChild(bar);
      el.appendChild(r);
    }
    if (!Object.keys(all).length) el.appendChild(VexSettingsGroups.note('No site has an instruction yet.'));
    el.appendChild(VexSettingsGroups.button('Add one for a site…', async () => {
      if (typeof vexPromptModal !== 'function') return;
      const h = await vexPromptModal('Which site? For example github.com', '');
      if (!h) return;
      try { await this.editSiteInstruction(this.cleanHost(h)); } catch (err) { window.showToast?.(err.message, 'error'); }
      redraw();
    }));
  },

  // Surface every skill in the command bar (replacing stale entries on edit).
  _registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    CommandBar.commands = CommandBar.commands.filter(c => !String(c.id || '').startsWith('skill:'));
    CommandBar.commands = CommandBar.commands.filter(c => c.id !== 'site-instruction-edit' && c.id !== 'skills-for-site');
    CommandBar.commands.push(
      { id: 'site-instruction-edit', label: 'AI: Instruction for this site', hint: 'A standing instruction added to every AI chat on this site', icon: 'pin', action: () => this.editSiteInstruction() },
      { id: 'skills-for-site', label: 'AI: Skills for this site', hint: 'The skills you bound to this site', icon: 'sparkles', action: () => this.chooseForSite() },
    );
    this.skills.forEach(sk => {
      CommandBar.commands.push({
        id: 'skill:' + sk.id,
        label: sk.name,
        hint: 'AI Skill — ' + (sk.output && sk.output !== 'text' ? 'answers as ' + this.OUTPUT_LABEL[sk.output].toLowerCase() : 'run on the current page'),
        icon: sk.icon || 'sparkles',
        action: () => this.run(sk.id),
      });
    });
  },

  // --- Settings → AI Skills management UI ---
  renderPanel(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(s);
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:10px">Reusable AI commands you can run on any page from the command bar (<kbd>Ctrl</kbd>+<kbd>K</kbd> → type the skill's name).</p>
      <div class="skills-list"></div>
      <button class="skill-add" style="margin-top:10px;padding:8px 16px;background:var(--primary);color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">+ New Skill</button>`;
    const list = container.querySelector('.skills-list');

    this.skills.forEach(sk => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-top:1px solid var(--border)';
      row.innerHTML = `
        <span style="flex:0 0 auto;margin-top:2px;color:var(--primary,var(--accent))">${VexIcons.svg(sk.icon || 'sparkles', { size: 18 })}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13.5px;font-weight:600;color:var(--text)">${esc(sk.name)}</div>
          <div style="font-size:11.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(sk.prompt)}">${esc(sk.prompt)}</div>
        </div>
        <button data-run style="padding:5px 12px;background:var(--primary);color:var(--on-primary,#fff);border:none;border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Run</button>
        <button data-edit style="padding:5px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Edit</button>
        <button data-del aria-label="Delete skill ${esc(sk.name)}" title="Delete this skill" style="padding:5px 10px;background:var(--bg);color:var(--danger);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif;display:inline-flex;align-items:center">${VexIcons.svg('trash', { size: 13 })}</button>`;
      row.querySelector('[data-run]').addEventListener('click', () => { SidebarManager.hideActivePanel?.(); this.run(sk.id); });
      row.querySelector('[data-edit]').addEventListener('click', () => this._editModal(sk, container));
      // A skill is a prompt the user wrote: it goes at once with Undo on the
      // toast (js/vex-undo.js), and a save that fails says so.
      row.querySelector('[data-del]').addEventListener('click', () => {
        const previous = this.skills.slice();
        const removed = window.VexUndo.takeOut(this.skills, s => s.id === sk.id);
        if (!removed) return;
        if (!this.save()) {
          this.skills = previous; this.save();
          this.renderPanel(container);
          window.showToast?.('Could not save the change — the skill was kept', 'error');
          return;
        }
        this.renderPanel(container);
        window.VexUndo.offer({
          message: `Deleted the skill “${sk.name}”`,
          undo: () => {
            window.VexUndo.putBack(this.skills, removed);
            if (!this.save()) throw new Error('It could not be saved');
            if (container.isConnected) this.renderPanel(container);
          },
        });
      });
      list.appendChild(row);
    });

    container.querySelector('.skill-add').addEventListener('click', () => this._editModal(null, container));
    // Share skills as plain text; an import shows every prompt in full before anything is added.
    const tools = document.createElement('div');
    tools.style.cssText = 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap';
    const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-secondary'; b.textContent = label; b.addEventListener('click', fn); tools.appendChild(b); };
    mk('Copy all as text', async () => {
      try { await navigator.clipboard.writeText(this.exportText()); window.showToast?.('Copied'); } catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); }
    });
    mk('Import from text…', async () => {
      try {
        if (typeof vexPromptModal !== 'function') throw new Error('The prompt dialog is unavailable');
        const t = await vexPromptModal('Paste the exported skills', '');
        if (!t) return;
        const n = await this.importFrom(t);
        if (n) { window.showToast?.('Added ' + n + ' skill' + (n === 1 ? '' : 's')); this.renderPanel(container); }
      } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    container.appendChild(tools);
  },

  _editModal(sk, container) {
    document.getElementById('skill-edit-modal')?.remove();
    const esc = (s) => window.escapeHtml(s);
    let current = (sk && sk.icon) || 'sparkles';
    const m = document.createElement('div');
    m.id = 'skill-edit-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
    m.innerHTML = `<div style="width:440px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:22px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:14px">${sk ? 'Edit' : 'New'} Skill</div>
      <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:5px">Icon</label>
      <div id="skm-icons" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${this.ICONS.filter(n => VexIcons.has(n)).map(n => `<button type="button" class="skm-ico" data-icon="${n}" title="${n}" aria-label="${n}" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:var(--bg);border:1px solid ${n === current ? 'var(--primary,var(--accent))' : 'var(--border)'};border-radius:8px;cursor:pointer;color:${n === current ? 'var(--primary,var(--accent))' : 'var(--text)'}">${VexIcons.svg(n, { size: 17 })}</button>`).join('')}</div>
      <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:5px">Name</label>
      <input id="skm-name" type="text" value="${esc(sk?.name || '')}" placeholder="Summarize in 5 bullets" style="width:100%;box-sizing:border-box;padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;margin-bottom:12px;font-family:'Outfit',sans-serif">
      <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:5px">Prompt (runs against the current page)</label>
      <textarea id="skm-prompt" rows="4" placeholder="What should the AI do?" style="width:100%;box-sizing:border-box;padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;resize:vertical;font-family:'Outfit',sans-serif">${esc(sk?.prompt || '')}</textarea>
      <div style="font-size:11px;color:var(--text-muted);margin:4px 0 10px">Variables: {{selection}} {{url}} {{title}} {{host}} {{date}} {{time}} {{ask:Your question}}</div>
      <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:5px">Answer as</label>
      <select id="skm-output" style="width:100%;box-sizing:border-box;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;margin-bottom:10px">${this.OUTPUTS.map(o => `<option value="${o}"${(sk?.output || 'text') === o ? ' selected' : ''}>${esc(this.OUTPUT_LABEL[o])}</option>`).join('')}</select>
      <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:5px">Offered on (sites, comma separated)</label>
      <input id="skm-sites" type="text" value="${esc((sk?.sites || []).join(', '))}" placeholder="github.com, docs.google.com" style="width:100%;box-sizing:border-box;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;margin-bottom:10px">
      <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:5px">Remind me to run it${sk?.schedule ? ' (now ' + esc(sk.schedule.repeat) + ')' : ''}</label>
      <div style="display:flex;gap:8px;margin-bottom:10px"><select id="skm-repeat" aria-label="How often" style="flex:0 0 auto;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px"><option value="">${sk?.schedule ? 'Keep as it is' : 'Never'}</option>${sk?.schedule ? '<option value="off">Stop reminding me</option>' : ''}<option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Every week</option></select><input id="skm-when" type="text" aria-label="First reminder" placeholder="tomorrow 9am" style="flex:1;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px"></div>
      ${sk?.versions?.length ? `<details style="margin-bottom:6px"><summary style="font-size:12px;cursor:pointer">Earlier wordings (${sk.versions.length})</summary><div id="skm-versions"></div></details>` : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button id="skm-cancel" style="padding:8px 16px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Cancel</button>
        <button id="skm-save" style="padding:8px 18px;background:var(--primary);color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600">Save</button>
      </div></div>`;
    document.body.appendChild(m);
    m.querySelector('#skm-name').focus();
    m.querySelectorAll('.skm-ico').forEach(b => b.addEventListener('click', () => {
      current = b.dataset.icon;
      m.querySelectorAll('.skm-ico').forEach(o => {
        const on = o.dataset.icon === current;
        o.style.borderColor = on ? 'var(--primary,var(--accent))' : 'var(--border)';
        o.style.color = on ? 'var(--primary,var(--accent))' : 'var(--text)';
      });
    }));
    // Earlier wordings: what changed against the text in the box, and a way back.
    const vbox = m.querySelector('#skm-versions');
    if (vbox && sk) {
      for (const v of sk.versions) {
        const row = document.createElement('div'); row.style.cssText = 'padding:6px 0;border-top:1px solid var(--border);font-size:12px';
        const head = document.createElement('div'); head.textContent = new Date(v.at).toLocaleString();
        const d = document.createElement('div'); d.style.cssText = 'white-space:pre-wrap;color:var(--text-muted)';
        for (const seg of this.diff(v.prompt, m.querySelector('#skm-prompt').value)) {
          const sp = document.createElement('span'); sp.textContent = seg.text;
          if (seg.t === 'del') sp.style.textDecoration = 'line-through';
          if (seg.t === 'add') sp.style.background = 'color-mix(in srgb,var(--primary,#3b82f6) 22%,transparent)';
          d.appendChild(sp);
        }
        const back = document.createElement('button'); back.type = 'button'; back.textContent = 'Use this wording';
        back.style.cssText = 'margin-top:4px;padding:3px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer';
        back.addEventListener('click', () => { m.querySelector('#skm-prompt').value = v.prompt; });
        row.append(head, d, back); vbox.appendChild(row);
      }
    }
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#skm-cancel').addEventListener('click', () => m.remove());
    m.querySelector('#skm-save').addEventListener('click', async () => {
      const name = m.querySelector('#skm-name').value.trim();
      const prompt = m.querySelector('#skm-prompt').value.trim();
      let output, sites;
      try {
        this.findVariables(prompt);
        output = m.querySelector('#skm-output').value;
        sites = m.querySelector('#skm-sites').value.split(',').map(x => x.trim()).filter(Boolean).map(h => this.cleanHost(h));
      } catch (err) { window.showToast?.(err.message, 'warn'); return; }
      const repeat = m.querySelector('#skm-repeat').value;
      const whenText = m.querySelector('#skm-when').value.trim();
      if (repeat && repeat !== 'off' && !whenText) { window.showToast?.('Say when the first reminder should be, for example tomorrow 9am', 'warn'); return; }
      // Silently doing nothing taught people the button was broken. Say why.
      if (!name || !prompt) {
        window.showToast?.(!name ? 'Give the skill a name' : 'Write the prompt the skill should run', 'warn');
        m.querySelector(name ? '#skm-prompt' : '#skm-name').focus();
        return;
      }
      let target = sk;
      if (sk) { this.pushVersion(sk, prompt); sk.name = name; sk.prompt = prompt; sk.icon = current; sk.output = output; sk.sites = sites; delete sk.emoji; }
      else { target = { id: vexId('sk_'), name, prompt, icon: current, output, sites }; this.skills.push(target); }
      const saved = this.save();
      try {
        if (repeat === 'off') await this.clearSchedule(target.id);
        else if (repeat) { await this.clearSchedule(target.id); await this.setSchedule(target.id, repeat, whenText); }
      } catch (err) { window.showToast?.('The skill was saved, but the reminder was not: ' + err.message, 'error'); }
      m.remove();
      this.renderPanel(container);
      if (!saved) window.showToast?.('Available for now, but the skill could not be saved — it resets when you restart Vex', 'error');
    });
  },
};

if (typeof window !== 'undefined') window.VexSkills = VexSkills;
if (typeof VexSettingsGroups !== 'undefined') {
  VexSettingsGroups.register({ id: 'site-instructions', title: 'Site instructions', keywords: 'standing instruction per site ai skills variables', render: (el) => VexSkills.renderSiteSettings(el) });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSkills };
