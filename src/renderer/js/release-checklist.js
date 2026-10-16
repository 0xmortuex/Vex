// === Release check: hand-check a release from its CHANGELOG entry =============
//
// Hand-checking a release used to be open-ended: ~150 features, no list. This
// turns one CHANGELOG entry into a list with one "do this, expect that" line
// per bullet, a Try it button that opens the feature, and a tick box. Ticks
// are kept per version on this computer only.
//
//   VexReleaseChecklist.parse(body)      -> [{ id, section, title, doThis, expect, route }]   (pure)
//   VexReleaseChecklist.markdown(entry)  -> the same as a markdown checklist (pure; used by
//                                           scripts/release-checklist.js)
//   Settings › Release check             opens the list for the running version (the
//                                        bundled CHANGELOG, through getReleaseNotes)
//
// Not built: keeping a new feature hidden until it is ticked. That would change
// what every release ships and needs the owner's decision (see the report).
//
// Pure parsing first, so tests and the release script load this file in Node.

const VexReleaseChecklist = {
  KEY: 'vex.releaseCheck',          // { "<version>": { "<item id>": ticked-at-ms } }
  PREF: 'vex.releaseCheck.enabled', // 'off' to hide the Settings section (Minimal Vex)
  AUTO: 'vex.releaseCheck.auto',    // { "<version>": { "<item id>": { at, how } } } what Vex saw happen itself
  MAX_EXPECT: 240,

  // ---- parsing (pure) -----------------------------------------------------------
  _plain(md) {
    return String(md || '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
      .replace(/\s+/g, ' ')
      .trim();
  },

  _clip(text, max) {
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const space = cut.lastIndexOf(' ');
    return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '') + '...';
  },

  _firstSentence(text) {
    const m = /^(.+?[.!?])(?:\s|$)/.exec(text);
    return m ? m[1] : text;
  },

  // "Settings › Privacy Hardening › Gaming and streaming" and Ctrl+K › Label.
  _routes(text) {
    const route = { settings: null, command: null };
    const s = /Settings\s*›\s*([^,;:)(\n]+?)(?=\s*(?:[,;:)(]|\.\s|\.$|—|$))/.exec(text);
    if (s) route.settings = s[1].split(/\s*›\s*/).map(p => p.trim()).filter(Boolean);
    const quoted = /Ctrl\+K\s*›\s*"([^"]+)"/.exec(text);
    const bare = /Ctrl\+K\s*›\s*([^,;:)("\n]+?)(?=\s*(?:[,;:)(]|\.\s|\.$|\sand\s|—|$))/.exec(text);
    if (quoted) route.command = quoted[1].trim();
    else if (bare) route.command = bare[1].trim();
    return route;
  },

  _slug(title, taken) {
    let base = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';
    let id = base, n = 2;
    while (taken.has(id)) id = base + '-' + (n++);
    taken.add(id);
    return id;
  },

  // body: the text under one "## vX.Y.Z" heading.
  parse(body) {
    const lines = String(body || '').replace(/\r/g, '').split('\n');
    const items = [];
    const taken = new Set();
    let section = '';
    let cur = null;
    const flush = () => {
      if (!cur) return;
      const raw = cur.text.trim();
      const m = /^\*\*(.+?)\*\*\s*(.*)$/.exec(raw);
      // A trailing "(Settings › X, off until...)" in the bold lead is where to go, not the name.
      const title = this._plain(m ? m[1] : this._firstSentence(raw)).replace(/\s*\((?:[^()]*(?:Settings\s*›|Ctrl\+K)[^()]*)\)\s*[.:;,]?\s*$/, '').replace(/[\s.:;,—-]+$/, '');
      const rest = this._plain(m ? m[2] : raw.slice(this._firstSentence(raw).length));
      const route = this._routes(this._plain(raw));
      const fixed = /^fix/i.test(cur.section);
      let doThis;
      if (route.command) doThis = 'Press Ctrl+K and run "' + route.command + '".';
      else if (route.settings) doThis = 'Open Settings › ' + route.settings.join(' › ') + '.';
      else doThis = 'Find "' + title.replace(/"/g, '') + '" (Settings, or Ctrl+K and type its name) and use it.';
      if (fixed) doThis = 'Repeat what used to go wrong. ' + doThis;
      const expectText = this._clip(this._firstSentence(rest) || title, this.MAX_EXPECT);
      items.push({
        id: this._slug(title, taken),
        section: cur.section || 'Changes',
        title,
        doThis,
        expect: fixed ? 'It no longer happens: ' + expectText : expectText,
        route,
        // Only a thing the app can SEE happen (a command ran, a feature or its Settings section opened) can be
        // ticked by the app, and then only as "opened": whether the result matches the Expect line is for you.
        // A fix ("repeat what went wrong") and an item with nowhere to go are manual only, always.
        manual: fixed || !(route.command || route.settings),
      });
      cur = null;
    };
    for (const line of lines) {
      const h = /^###\s+(.+?)\s*$/.exec(line);
      if (h) { flush(); section = h[1]; continue; }
      const b = /^[-*]\s+(.*)$/.exec(line);
      if (b) { flush(); cur = { section, text: b[1] }; continue; }
      if (cur && line.trim() && /^\s+\S/.test(line)) { cur.text += ' ' + line.trim(); continue; }
      if (!line.trim()) { flush(); }
    }
    flush();
    return items;
  },

  // entry: { version, name, body } as parseChangelogEntry returns it.
  build(entry) {
    if (!entry || !entry.version || !entry.body) throw new Error('There is no CHANGELOG entry to check');
    return { version: String(entry.version).replace(/^v/, ''), name: entry.name || entry.version, items: this.parse(entry.body) };
  },

  markdown(entry, ticked) { return this.markdownOf(this.build(entry), ticked); },

  // list: what build() returns.
  markdownOf(list, ticked, auto) {
    const done = ticked || {};
    const seen = auto || {};
    const out = [`# Release check: v${list.version}`, '', list.name ? `_${list.name}_` : '', '',
      `${list.items.length} item(s). Do the first line, compare with the second, tick the box.`, ''];
    let section = null;
    for (const it of list.items) {
      if (it.section !== section) { section = it.section; out.push('', `## ${section}`, ''); }
      out.push(`- [${done[it.id] || seen[it.id] ? 'x' : ' '}] **${it.title}**${!done[it.id] && seen[it.id] ? ' (opened; not checked by you)' : ''}`);
      out.push(`  - Do this: ${it.doThis}`);
      out.push(`  - Expect: ${it.expect}`);
    }
    return out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') + '\n';
  },

  // ---- ticks (this computer only) ---------------------------------------------------
  _readAll() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); }
    catch (err) { console.error('[ReleaseCheck] ticks could not be read:', err.message); return {}; }
    if (!raw) return {};
    try {
      const o = JSON.parse(raw);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch (err) { console.error('[ReleaseCheck] ticks are not readable and start again:', err.message); return {}; }
  },
  ticked(version) { return this._readAll()[version] || {}; },
  setTick(version, id, on) {
    const all = this._readAll();
    const mine = all[version] || {};
    if (on) mine[id] = Date.now(); else delete mine[id];
    all[version] = mine;
    // Only the five newest versions are kept.
    const keep = Object.keys(all).sort((a, b) => this._cmp(b, a)).slice(0, 5);
    for (const k of Object.keys(all)) if (!keep.includes(k)) delete all[k];
    localStorage.setItem(this.KEY, JSON.stringify(all));
    return mine;
  },
  _cmp(a, b) {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
    return 0;
  },
  progress(version, items) {
    const t = this.ticked(version), a = this.autoTicked(version);
    return { done: items.filter(i => t[i.id] || a[i.id]).length, total: items.length, auto: items.filter(i => !t[i.id] && a[i.id]).length };
  },

  // ---- what the app saw happen (T2-008) -------------------------------------------------
  _readAuto() {
    const raw = localStorage.getItem(this.AUTO);
    if (!raw) return {};
    try { const o = JSON.parse(raw); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
    catch (err) { throw new Error('The saved automatic ticks are not readable: ' + err.message); }
  },
  autoTicked(version) { return this._readAuto()[version] || {}; },
  // Records that the app saw `item` opened (how: 'command', 'feature' or 'settings'). A manual-only item is refused.
  autoTick(version, item, how) {
    if (!item || item.manual) throw new Error('"' + (item && item.title) + '" can only be ticked by you');
    if (!['command', 'feature', 'settings'].includes(how)) throw new Error('Unknown way of opening: ' + how);
    const all = this._readAuto();
    const mine = all[version] || {};
    if (!mine[item.id]) mine[item.id] = { at: Date.now(), how };
    all[version] = mine;
    const keep = Object.keys(all).sort((a, b) => this._cmp(b, a)).slice(0, 5);
    for (const k of Object.keys(all)) if (!keep.includes(k)) delete all[k];
    localStorage.setItem(this.AUTO, JSON.stringify(all));
    return mine[item.id];
  },
  clearAuto(version, id) {
    const all = this._readAuto();
    if (all[version] && all[version][id]) { delete all[version][id]; localStorage.setItem(this.AUTO, JSON.stringify(all)); }
  },

  // The list of the running version, kept for noteCommand (loaded on first use).
  _current: null,
  async current() {
    if (!this._current) this._current = this.build(await this._entry());
    return this._current;
  },
  // A Ctrl+K command ran (js/command.js): tick the item that names it, when there is one.
  async noteCommand(label) {
    if (!this.enabled() || !label) return false;
    let list;
    try { list = await this.current(); }
    catch (err) {
      // No CHANGELOG entry for this build (a development run): said once, then quiet.
      if (!this._warned) { this._warned = true; console.error('[ReleaseCheck] commands are not ticked automatically:', err.message); }
      return false;
    }
    const want = String(label).toLowerCase();
    let hit = false;
    for (const it of list.items) {
      if (!it.manual && it.route.command && it.route.command.toLowerCase() === want) { this.autoTick(list.version, it, 'command'); hit = true; }
    }
    return hit;
  },

  // ---- the Usage record's switch (Minimal Vex can hide the section) -------------
  enabled() {
    try { return localStorage.getItem(this.PREF) !== 'off'; }
    catch (err) { console.error('[ReleaseCheck] the switch could not be read:', err.message); return true; }
  },
  setEnabled(on) { localStorage.setItem(this.PREF, on ? 'on' : 'off'); },

  // ---- Try it -------------------------------------------------------------------------
  // The first thing that can open the item, most exact first: the Ctrl+K command it
  // names, a feature of the catalogue whose name is in the title, a Settings section.
  // Returns how it was opened, or null when nothing could be.
  tryIt(item) {
    if (item.route.command && typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) {
      const want = item.route.command.toLowerCase();
      const cmd = CommandBar.commands.find(c => String(c.label || '').toLowerCase() === want);
      if (cmd && typeof cmd.action === 'function') { cmd.action(); this._seen(item, 'command'); return 'command'; }
    }
    if (typeof VexFeatures !== 'undefined' && Array.isArray(VexFeatures.ITEMS) && typeof VexGuide !== 'undefined') {
      // The title without a trailing "(Settings > ...)" note, matched whole or as its first words.
      const title = item.title.replace(/\s*\(.*$/, '').trim().toLowerCase();
      const hit = VexFeatures.ITEMS.find(f => { const n = String(VexFeatures.nameOf(f) || '').toLowerCase(); return n.length > 3 && (title === n || title.startsWith(n + ' ')); });
      if (hit) { VexGuide.run(hit); this._seen(item, 'feature'); return 'feature'; }
    }
    if (item.route.settings && typeof SettingsUI !== 'undefined' && typeof SidebarManager !== 'undefined') {
      this._openSettings(item.route.settings[0]);
      this._seen(item, 'settings');
      return 'settings';
    }
    return null;
  },

  // Try it opened `item`: the app saw it, so it is marked (never a manual-only item).
  _seen(item, how) {
    if (item.manual || !this._current) return;
    this.autoTick(this._current.version, item, how);
  },

  _openSettings(heading) {
    SidebarManager.openPanel('settings');
    const want = heading.toLowerCase();
    let tries = 0;
    const attempt = () => {
      const groups = document.querySelectorAll('#panel-settings .setting-group');
      for (const g of groups) {
        const label = g.querySelector('.setting-label');
        if (label && label.textContent.trim().toLowerCase().startsWith(want)) {
          if (typeof SettingsUI.reveal === 'function') SettingsUI.reveal(g);
          g.scrollIntoView({ block: 'start' });
          return;
        }
      }
      if (++tries < 20) setTimeout(attempt, 100);
      else window.showToast?.('Could not find the Settings section "' + heading + '"', 'error');
    };
    attempt();
  },

  // ---- the screen ------------------------------------------------------------------------
  async _entry() {
    if (!window.vex || typeof window.vex.getAppVersion !== 'function' || typeof window.vex.getReleaseNotes !== 'function') throw new Error('Release notes are not available in this build');
    const version = await window.vex.getAppVersion();
    const entry = await window.vex.getReleaseNotes('v' + version);
    if (!entry || !entry.body) throw new Error('The CHANGELOG has no entry for v' + version);
    if (String(entry.version).replace(/^v/, '') !== String(version)) throw new Error('The CHANGELOG has no entry for v' + version + ' (the nearest is ' + entry.version + ')');
    return entry;
  },

  async open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('release-check');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-release-check', title: 'Release check', sub: 'Do the first line for each change, compare with the second, tick it. Kept on this computer only.' });
    let list;
    try { list = await this.current(); }
    catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
    const draw = () => {
      body.textContent = '';
      const p = this.progress(list.version, list.items);
      body.appendChild(VexSettingsGroups.note('v' + list.version + ': ' + p.done + ' of ' + p.total + ' ticked' + (p.auto ? ' (' + p.auto + ' of them only opened by Vex: you still compare the result)' : '') + '.'));
      const copy = VexSettingsGroups.button('Copy as a checklist', async () => {
        try { await navigator.clipboard.writeText(this.markdownOf(list, this.ticked(list.version), this.autoTicked(list.version))); window.showToast?.('Checklist copied'); }
        catch (err) { window.showToast?.('Could not copy: ' + (err && err.message), 'error'); }
      });
      body.appendChild(copy);
      const ticked = this.ticked(list.version);
      const seen = this.autoTicked(list.version);
      let section = null, wrap = null;
      for (const it of list.items) {
        if (it.section !== section) {
          section = it.section;
          const h = document.createElement('div');
          h.className = 'vexsr-sub';
          h.style.marginTop = '12px';
          h.textContent = section;
          body.appendChild(h);
          wrap = document.createElement('div');
          wrap.className = 'vexsr-list';
          body.appendChild(wrap);
        }
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        row.dataset.item = it.id;
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !!ticked[it.id] || !!seen[it.id];
        box.setAttribute('aria-label', 'Checked: ' + it.title);
        box.addEventListener('change', () => { this.setTick(list.version, it.id, box.checked); if (!box.checked) this.clearAuto(list.version, it.id); draw(); });
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        const t = document.createElement('div');
        t.textContent = it.title;
        const d = document.createElement('div');
        d.className = 'vexsr-mode';
        d.style.whiteSpace = 'normal';
        d.textContent = 'Do this: ' + it.doThis + (it.manual ? ' (only you can tick this one)' : '');
        const e = document.createElement('div');
        e.className = 'vexsr-mode';
        e.style.whiteSpace = 'normal';
        e.textContent = 'Expect: ' + it.expect;
        text.append(t, d, e);
        if (!ticked[it.id] && seen[it.id]) {
          const a = document.createElement('div');
          a.className = 'vexsr-mode';
          a.textContent = 'Vex saw this opened (' + seen[it.id].how + '). Compare the result with Expect, then tick it yourself.';
          text.appendChild(a);
        }
        const go = VexSettingsGroups.button('Try it', () => {
          let how = null;
          try { how = this.tryIt(it); }
          catch (err) { window.showToast?.('Could not open that: ' + (err && err.message), 'error'); return; }
          if (!how) window.showToast?.('There is nothing to open for that one; do it by hand.', 'info');
        }, { label: 'Try ' + it.title });
        row.append(box, text, go);
        wrap.appendChild(row);
      }
    };
    draw();
  },

  // Settings section (Minimal Vex hides it through the usage record).
  group(el) {
    el.appendChild(VexSettingsGroups.note('Turns this version\'s CHANGELOG into a hand-check list: what to do, what to expect, and a button that opens each change.'));
    el.appendChild(VexSettingsGroups.button('Open the release check', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexReleaseChecklist = VexReleaseChecklist;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'release-check',
      title: 'Release check',
      keywords: 'release check hand check changelog checklist test new version what changed try',
      before: 'about',
      build: (el) => VexReleaseChecklist.group(el),
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'release-check', label: 'Release check', hint: 'Hand-check this version from its CHANGELOG', icon: 'check', action: () => VexReleaseChecklist.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexReleaseChecklist };
