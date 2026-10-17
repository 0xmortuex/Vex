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
// The same dialog has a Pre-flight part (VexReleasePreflight, below): GitHub-proven ticks ("Actions on main =
// success", "latest tag == package.json version"), a checklist of your own lines per repository, and
// "Open the remaining pages".
// Hold until ticked (Wave 6, the owner approved it; OFF by default): with "Hold this version's new features until I tick
// them" on, a feature that this version's list names (matched by its name in the Features catalogue, never a fix) is
// switched off through the usual switch (VexRegistry.switchOff) while its line is unticked, and switched back on, if it
// was on, when you tick the line yourself. Vex's own "opened" mark does not release it: only your tick does. It never
// touches a feature that is already off, never turns on one you switched off, and every hold is a ledger line with Undo.
// It is meant for the profile you hand-check releases on, not for everyone.
//
// Pure parsing first, so tests and the release script load this file in Node.

const VexReleaseChecklist = {
  KEY: 'vex.releaseCheck',          // { "<version>": { "<item id>": ticked-at-ms } }
  PREF: 'vex.releaseCheck.enabled', // 'off' to hide the Settings section (Minimal Vex)
  AUTO: 'vex.releaseCheck.auto',    // { "<version>": { "<item id>": { at, how } } } what Vex saw happen itself
  HOLD: 'vex.releaseCheck.hold',    // 'on' = hold this version's new features until ticked (default off)
  HELD: 'vex.releaseCheck.held',    // { "<version>": { "<feature id>": { item, at } } } what Vex switched off for the hold
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
    // Ticking releases the feature held for that line; unticking holds it again (when the hold is on).
    if (typeof VexRegistry !== 'undefined') {
      const p = on ? this.releaseHeld(version, id) : this.applyHold(version);
      p.catch((err) => {
        console.error('[ReleaseCheck] the hold could not be updated:', err);
        if (typeof VexProblems !== 'undefined') VexProblems.note('Release check', 'Could not update the held features', err);
      });
    }
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

  // ---- hold until ticked ---------------------------------------------------------------
  holdOn() {
    try { return localStorage.getItem(this.HOLD) === 'on'; }
    catch (err) { console.error('[ReleaseCheck] the hold switch could not be read:', err.message); return false; }
  },
  _readHeld() {
    const raw = localStorage.getItem(this.HELD);
    if (!raw) return {};
    try { const o = JSON.parse(raw); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
    catch (err) { throw new Error('The list of held features is not readable: ' + err.message); }
  },
  _writeHeld(all) {
    const keep = Object.keys(all).sort((a, b) => this._cmp(b, a)).slice(0, 5);
    for (const k of Object.keys(all)) if (!keep.includes(k) || !Object.keys(all[k]).length) delete all[k];
    localStorage.setItem(this.HELD, JSON.stringify(all));
  },
  held(version) { return this._readHeld()[version] || {}; },
  // The catalogue entry a line is about: its name is the line's title or its first words (the same match Try it uses).
  _catalogHit(item) {
    if (typeof VexFeatures === 'undefined' || !Array.isArray(VexFeatures.ITEMS)) return null;
    const title = item.title.replace(/\s*\(.*$/, '').trim().toLowerCase();
    return VexFeatures.ITEMS.find(f => { const n = String(VexFeatures.nameOf(f) || '').toLowerCase(); return n.length > 3 && (title === n || title.startsWith(n + ' ')); }) || null;
  },
  // The feature (manifest id) a line is about, or '' when it is a fix, names no feature, or the feature has no switch.
  featureOf(item) {
    if (/^fix/i.test(item.section) || typeof VexRegistry === 'undefined') return '';
    const hit = this._catalogHit(item);
    const id = hit ? (hit.feature || hit.id) : '';
    if (!id || !VexRegistry.has(id)) return '';
    return VexRegistry.get(id).killSwitch === 'usage' ? id : '';
  },
  // Switch off the features of the unticked lines of this version. -> the ids it held now.
  async applyHold(version) {
    if (!this.holdOn() || !this.enabled()) return [];
    if (typeof VexRegistry === 'undefined' || typeof VexUsage === 'undefined') throw new Error('The feature registry is not loaded, so nothing can be held');
    const list = await this.current();
    if (version && String(version) !== list.version) return [];
    const ticked = this.ticked(list.version);
    const all = this._readHeld();
    const mine = all[list.version] || {};
    const now = [];
    for (const it of list.items) {
      if (ticked[it.id]) continue;
      const fid = this.featureOf(it);
      if (!fid || mine[fid]) continue;
      if (!VexUsage.get(fid) || !VexUsage.isEnabled(fid)) continue;          // already off: nothing of ours to hold or restore
      await VexRegistry.switchOff(fid);
      mine[fid] = { item: it.id, at: Date.now() };
      all[list.version] = mine;
      this._writeHeld(all);
      now.push(fid);
      if (typeof VexLedger !== 'undefined') {
        VexLedger.note({ feature: 'release-check', what: 'Kept "' + (VexRegistry.get(fid).title || fid) + '" off until you tick it', why: 'You asked the release check to hold v' + list.version + ' features until they are ticked', undo: { kind: 'release-hold-release', version: list.version, feature: fid } });
      }
    }
    return now;
  },
  // Put back the feature held for a line the person ticked. Without `feature`, by the item id.
  async releaseHeld(version, itemId, feature) {
    const all = this._readHeld();
    const mine = all[version] || {};
    const ids = feature ? [feature] : Object.keys(mine).filter(f => mine[f].item === itemId);
    const out = [];
    for (const fid of ids) {
      if (!mine[fid]) continue;
      if (typeof VexUsage !== 'undefined' && VexUsage.get(fid) && !VexUsage.isEnabled(fid)) await VexRegistry.switchOn(fid);
      delete mine[fid];
      out.push(fid);
    }
    all[version] = mine;
    this._writeHeld(all);
    return out;
  },
  async releaseAllHeld() {
    const all = this._readHeld();
    const out = [];
    for (const version of Object.keys(all)) for (const fid of Object.keys(all[version])) out.push(...await this.releaseHeld(version, null, fid));
    return out;
  },
  async setHold(on) {
    localStorage.setItem(this.HOLD, on ? 'on' : 'off');
    if (on) return this.applyHold();
    return this.releaseAllHeld();
  },

  // ---- the Usage record's switch (Minimal Vex can hide the section) -------------
  enabled() {
    try { return localStorage.getItem(this.PREF) !== 'off'; }
    catch (err) { console.error('[ReleaseCheck] the switch could not be read:', err.message); return true; }
  },
  setEnabled(on) {
    localStorage.setItem(this.PREF, on ? 'on' : 'off');
    // Minimal Vex switching this off must not leave features held.
    if (!on && typeof VexRegistry !== 'undefined') {
      this.releaseAllHeld().catch((err) => { if (typeof VexProblems !== 'undefined') VexProblems.note('Release check', 'Could not put back the held features', err); else throw err; });
    }
  },

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
    if (typeof VexGuide !== 'undefined') {
      // The title without a trailing "(Settings > ...)" note, matched whole or as its first words.
      const hit = this._catalogHit(item);
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
        try { await navigator.clipboard.writeText(this.markdownOf(list, this.ticked(list.version), this.autoTicked(list.version)) + '\n' + VexReleasePreflight.repos().map(r => VexReleasePreflight.markdown(r)).join('\n')); window.showToast?.('Checklist copied'); }
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
      VexReleasePreflight.draw(body, draw);
    };
    draw();
  },

  // Settings section (Minimal Vex hides it through the usage record).
  group(el) {
    el.appendChild(VexSettingsGroups.note('Turns this version\'s CHANGELOG into a hand-check list: what to do, what to expect, and a button that opens each change.'));
    el.appendChild(VexSettingsGroups.button('Open the release check', () => this.open(), { primary: true }));
    const label = document.createElement('label');
    label.className = 'vex-platform-note';
    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = this.holdOn();
    box.setAttribute('aria-label', 'Hold this version\'s new features until I tick them');
    box.addEventListener('change', () => {
      this.setHold(box.checked).catch((err) => { box.checked = this.holdOn(); window.showToast?.('Could not change the hold: ' + ((err && err.message) || err), 'error'); });
    });
    label.append(box, document.createTextNode(' Hold this version\'s new features until I tick them (off by default; for the profile you hand-check releases on)'));
    el.appendChild(label);
    el.appendChild(VexSettingsGroups.note('While it is on, a new feature named in this version\'s list stays off until you tick its line yourself. Vex opening a feature does not count. Untick or switch this off and the features come back as they were.'));
  },
};

// === Pre-flight: the checks GitHub can answer, and a checklist per repository (T2-008) ====================
//
// The release check above ticks what the app SAW opened. This part ticks what GitHub can prove, read-only
// through the GitHub vault (js/github-vault.js; the token stays in the main process):
//
//   Actions on main = success       the newest run of EVERY workflow on branch main finished with "success"
//                                    (a run still going is not a pass)
//   latest tag == package.json      the highest version tag of the repository equals the "version" in the
//                                    package.json on main
//
// plus a short checklist of your own lines per repository (kept here, ticked by you). It runs only when you press
// "Run pre-flight"; nothing is read in the background. "Open the remaining pages" opens, in tabs, the GitHub
// pages of the checks that did not pass (Actions on main, the tags). Hiding a feature until it is ticked is not
// built (it would change what a release ships).
const VexReleasePreflight = {
  KEY: 'vex.releaseCheck.repos',            // { "owner/repo": { custom: [{ id, text }], ticks: { "<id>": at-ms } } }
  RESULT: 'vex.releaseCheck.preflight',     // { "owner/repo": { at, results: { "<check id>": { ok, detail, url } } } }
  DEFAULT_REPO: '0xmortuex/Vex',
  MAX_REPOS: 10,
  MAX_CUSTOM: 20,
  CHECKS: [
    { id: 'actions-main', title: 'Actions on main = success' },
    { id: 'tag-matches', title: 'Latest tag = package.json version' },
  ],

  _read(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The saved pre-flight data (' + key + ') is not readable: ' + err.message, { cause: err }); }
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  },
  _write(key, v) { localStorage.setItem(key, JSON.stringify(v)); },

  parseRepo(input) {
    const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?(?:[/?#].*)?$/.exec(String(input == null ? '' : input).trim());
    if (!m || m[1] === '.' || m[1] === '..' || m[2] === '.' || m[2] === '..') return null;
    return m[1] + '/' + m[2];
  },
  repos() {
    const stored = Object.keys(this._read(this.KEY));
    return stored.length ? stored : [this.DEFAULT_REPO];
  },
  addRepo(input) {
    const repo = this.parseRepo(input);
    if (!repo) throw new Error('Use owner/repo, or a github.com address');
    const all = this._read(this.KEY);
    if (!Object.keys(all).length) all[this.DEFAULT_REPO] = { custom: [], ticks: {} };
    if (all[repo]) throw new Error(repo + ' is already listed');
    if (Object.keys(all).length >= this.MAX_REPOS) throw new Error('At most ' + this.MAX_REPOS + ' repositories');
    all[repo] = { custom: [], ticks: {} };
    this._write(this.KEY, all);
    return repo;
  },
  removeRepo(repo) {
    const all = this._read(this.KEY);
    delete all[repo];
    this._write(this.KEY, all);
    const res = this._read(this.RESULT); delete res[repo]; this._write(this.RESULT, res);
  },
  _entry(all, repo) {
    if (!all[repo]) all[repo] = { custom: [], ticks: {} };
    if (!Array.isArray(all[repo].custom)) all[repo].custom = [];
    if (!all[repo].ticks || typeof all[repo].ticks !== 'object') all[repo].ticks = {};
    return all[repo];
  },
  custom(repo) { return this._entry(this._read(this.KEY), repo).custom; },
  addCustom(repo, text) {
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!t) throw new Error('Write the line first');
    const all = this._read(this.KEY);
    const e = this._entry(all, repo);
    if (e.custom.length >= this.MAX_CUSTOM) throw new Error('At most ' + this.MAX_CUSTOM + ' lines per repository');
    const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    e.custom.push({ id, text: t });
    this._write(this.KEY, all);
    return id;
  },
  removeCustom(repo, id) {
    const all = this._read(this.KEY);
    const e = this._entry(all, repo);
    e.custom = e.custom.filter(c => c.id !== id);
    delete e.ticks[id];
    this._write(this.KEY, all);
  },
  setCustomTick(repo, id, on) {
    const all = this._read(this.KEY);
    const e = this._entry(all, repo);
    if (!e.custom.some(c => c.id === id)) throw new Error('That line is not on the list');
    if (on) e.ticks[id] = Date.now(); else delete e.ticks[id];
    this._write(this.KEY, all);
  },
  customTicked(repo) { return this._entry(this._read(this.KEY), repo).ticks; },
  results(repo) { return this._read(this.RESULT)[repo] || null; },

  // ---- the checks (read-only GitHub) ----------------------------------------------------------
  _vault() {
    if (typeof GitHubVault === 'undefined') throw new Error('The GitHub vault is not loaded');
    return GitHubVault;
  },
  _semver(tag) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(tag || ''));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  },
  _cmpv(a, b) { return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; },

  // The newest run of every workflow on main. -> { ok, detail, url }
  async checkActions(repo) {
    const j = await this._vault().json('/repos/' + repo + '/actions/runs?branch=main&per_page=30');
    const runs = Array.isArray(j && j.workflow_runs) ? j.workflow_runs : [];
    if (!runs.length) return { ok: false, detail: 'There are no workflow runs on main', url: 'https://github.com/' + repo + '/actions' };
    const newest = new Map();
    for (const r of runs) {
      const key = r.workflow_id != null ? r.workflow_id : r.name;
      const prev = newest.get(key);
      if (!prev || Number(r.id) > Number(prev.id)) newest.set(key, r);
    }
    const bad = [], running = [];
    for (const r of newest.values()) {
      if (r.status !== 'completed') running.push(r.name || 'a workflow');
      else if (r.conclusion !== 'success') bad.push((r.name || 'a workflow') + ' ' + r.conclusion);
    }
    const url = 'https://github.com/' + repo + '/actions?query=branch%3Amain';
    if (bad.length) return { ok: false, detail: 'Not green on main: ' + bad.join(', '), url };
    if (running.length) return { ok: false, detail: 'Still running on main: ' + running.join(', '), url };
    return { ok: true, detail: newest.size + ' workflow(s), all green on main', url };
  },

  // The highest version tag against the version in package.json on main. -> { ok, detail, url }
  async checkTag(repo) {
    const v = this._vault();
    const tags = await v.json('/repos/' + repo + '/tags?per_page=30');
    const versions = (Array.isArray(tags) ? tags : []).map(t => ({ name: t.name, v: this._semver(t.name) })).filter(t => t.v).sort((a, b) => this._cmpv(b.v, a.v));
    const url = 'https://github.com/' + repo + '/tags';
    if (!versions.length) return { ok: false, detail: 'The repository has no version tag (vX.Y.Z)', url };
    const file = await v.json('/repos/' + repo + '/contents/package.json?ref=main');
    if (!file || file.encoding !== 'base64' || typeof file.content !== 'string') throw new Error('package.json of ' + repo + ' could not be read');
    const bin = atob(file.content.replace(/\s/g, ''));
    let pkg;
    try { pkg = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))); }
    catch (err) { throw new Error('package.json of ' + repo + ' is not valid JSON', { cause: err }); }
    const want = this._semver(pkg.version);
    if (!want) return { ok: false, detail: 'package.json has no version like X.Y.Z (it says "' + String(pkg.version).slice(0, 20) + '")', url };
    const latest = versions[0];
    const same = this._cmpv(latest.v, want) === 0;
    return { ok: same, detail: same ? 'Tag ' + latest.name + ' = package.json ' + pkg.version : 'Latest tag is ' + latest.name + ' but package.json says ' + pkg.version, url };
  },

  // Runs both checks for one repository and keeps the answers. A failed read is kept as a failed check with its
  // reason (never as a pass); it does not stop the other check. -> { at, results }
  async run(repo) {
    if (!this.parseRepo(repo)) throw new Error('That is not a repository');
    const results = {};
    for (const [id, fn] of [['actions-main', () => this.checkActions(repo)], ['tag-matches', () => this.checkTag(repo)]]) {
      try { results[id] = await fn(); }
      catch (err) { results[id] = { ok: false, detail: 'Could not check: ' + err.message, url: 'https://github.com/' + repo, error: true }; }
    }
    const all = this._read(this.RESULT);
    all[repo] = { at: Date.now(), results };
    this._write(this.RESULT, all);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('release-check');
    return all[repo];
  },

  // The GitHub pages of the checks that have not passed (at most 4).
  remainingPages(repo) {
    const r = this.results(repo);
    const out = [];
    for (const c of this.CHECKS) {
      const x = r && r.results[c.id];
      out.push(x && x.ok ? null : (x && x.url) || 'https://github.com/' + repo + (c.id === 'tag-matches' ? '/tags' : '/actions?query=branch%3Amain'));
    }
    return out.filter(Boolean).slice(0, 4);
  },
  openRemaining(repo) {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    const pages = this.remainingPages(repo);
    if (!pages.length) return 0;
    for (const u of pages) TabManager.createTab(u, true);
    return pages.length;
  },

  // Everything for one repository as a markdown checklist (for Copy as a checklist).
  markdown(repo) {
    const r = this.results(repo);
    const ticks = this.customTicked(repo);
    const lines = ['## Pre-flight: ' + repo, ''];
    for (const c of this.CHECKS) {
      const x = r && r.results[c.id];
      lines.push('- [' + (x && x.ok ? 'x' : ' ') + '] ' + c.title + (x ? ' (' + x.detail + ')' : ' (not run)'));
    }
    for (const c of this.custom(repo)) lines.push('- [' + (ticks[c.id] ? 'x' : ' ') + '] ' + c.text);
    return lines.join('\n') + '\n';
  },

  // ---- the block in the Release check dialog -----------------------------------------------------
  draw(host, redraw) {
    const S = VexSettingsGroups;
    const fail = (err) => { console.error('[ReleasePreflight]', err); window.showToast?.(err.message || String(err), 'error'); };
    const wrap = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'vexsr-sub';
    head.style.marginTop = '16px';
    head.textContent = 'Pre-flight (GitHub, read-only)';
    wrap.append(head, S.note('Asks GitHub whether the Actions on main are green and the latest tag matches package.json, and keeps a checklist of your own lines per repository. Runs only when you press the button. Uses your GitHub token if you entered one (Settings > GitHub access).'));
    for (const repo of this.repos()) {
      const box = document.createElement('div');
      box.className = 'vexsr-list';
      box.style.marginTop = '8px';
      const title = document.createElement('div');
      title.textContent = repo;
      title.style.fontWeight = '600';
      box.appendChild(title);
      const r = this.results(repo);
      for (const c of this.CHECKS) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        const x = r && r.results[c.id];
        const mark = document.createElement('input');
        mark.type = 'checkbox'; mark.checked = !!(x && x.ok); mark.disabled = true;
        mark.setAttribute('aria-label', c.title + (x ? (x.ok ? ': passed' : ': not passed') : ': not run'));
        const t = document.createElement('span');
        t.className = 'vexsr-host';
        t.style.wordBreak = 'normal';
        const a = document.createElement('div'); a.textContent = c.title;
        const b = document.createElement('div'); b.className = 'vexsr-mode'; b.style.whiteSpace = 'normal';
        b.textContent = x ? x.detail : 'Not run yet';
        t.append(a, b);
        row.append(mark, t);
        box.appendChild(row);
      }
      const ticks = this.customTicked(repo);
      for (const c of this.custom(repo)) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = !!ticks[c.id];
        cb.setAttribute('aria-label', 'Checked: ' + c.text);
        cb.addEventListener('change', () => { try { this.setCustomTick(repo, c.id, cb.checked); } catch (err) { fail(err); } });
        const t = document.createElement('span'); t.className = 'vexsr-host'; t.textContent = c.text;
        row.append(cb, t, S.button('Remove', () => { try { this.removeCustom(repo, c.id); redraw(); } catch (err) { fail(err); } }, { danger: true, label: 'Remove the line ' + c.text }));
        box.appendChild(row);
      }
      const add = document.createElement('input');
      add.type = 'text'; add.className = 'set-input'; add.placeholder = 'Add a line for ' + repo; add.setAttribute('aria-label', 'A line for the checklist of ' + repo);
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px';
      bar.append(
        S.button('Run pre-flight', async () => { try { await this.run(repo); redraw(); } catch (err) { fail(err); } }, { primary: true, label: 'Run the pre-flight of ' + repo }),
        S.button('Open the remaining pages', () => { try { const n = this.openRemaining(repo); window.showToast?.(n ? 'Opened ' + n + ' page(s)' : 'Everything passed; nothing to open'); } catch (err) { fail(err); } }),
        S.button('Add line', () => { try { this.addCustom(repo, add.value); redraw(); } catch (err) { fail(err); } }),
        S.button('Copy', async () => { try { await navigator.clipboard.writeText(this.markdown(repo)); window.showToast?.('Copied'); } catch (err) { fail(err); } }, { label: 'Copy the pre-flight of ' + repo }),
        S.button('Stop listing', () => { try { this.removeRepo(repo); redraw(); } catch (err) { fail(err); } }, { danger: true, label: 'Stop listing ' + repo }),
      );
      box.append(add, bar);
      wrap.appendChild(box);
    }
    const repoIn = document.createElement('input');
    repoIn.type = 'text'; repoIn.className = 'set-input'; repoIn.placeholder = 'owner/repo'; repoIn.setAttribute('aria-label', 'Another repository for the pre-flight');
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;margin-top:10px';
    bar.append(repoIn, S.button('Add repository', () => { try { this.addRepo(repoIn.value); redraw(); } catch (err) { fail(err); } }));
    wrap.appendChild(bar);
    host.appendChild(wrap);
  },
};

if (typeof window !== 'undefined') {
  window.VexReleaseChecklist = VexReleaseChecklist;
  window.VexReleasePreflight = VexReleasePreflight;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'release-check',
      title: 'Release check',
      keywords: 'release check hand check changelog checklist test new version what changed try',
      before: 'about',
      build: (el) => VexReleaseChecklist.group(el),
    });
  }
  if (typeof VexLedger !== 'undefined' && typeof VexLedger.registerUndo === 'function') {
    VexLedger.registerUndo('release-hold-release', async (token) => { await VexReleaseChecklist.releaseHeld(token.version, null, token.feature); });
  }
  // Holding happens when this late module arrives (after the staged enablement of app start).
  if (typeof VexRegistry !== 'undefined' && VexReleaseChecklist.holdOn()) {
    VexReleaseChecklist.applyHold().catch((err) => {
      console.error('[ReleaseCheck] the hold could not be applied:', err);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Release check', 'Could not hold this version\'s features', err);
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'release-check', label: 'Release check', hint: 'Hand-check this version from its CHANGELOG', icon: 'check', action: () => VexReleaseChecklist.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexReleaseChecklist, VexReleasePreflight };
