// === Extension update diff and "pause extensions for this site" (T3-120) ====
//
// Two small, read-mostly helpers on top of what Vex already knows about extensions
// (main/extension-audit.js says what each can read and do; main/extension-updates.js
// holds an update that asks for more and says what it added).
//
//   What changed   For every installed extension, what its powers and the sites it
//                  can read were the last time you looked, against now: the version
//                  step, powers gained or lost, sites gained or lost, in plain words.
//                  A held update (one that asks for more and waits for your approval)
//                  is listed with the words the updater already wrote. "Mark as
//                  reviewed" stores today's picture as the new baseline. Read-only:
//                  nothing is installed, approved or removed from here.
//
//   Pause here     For a bank or an email page: the extensions that can read THIS site,
//                  each with a tick; "Pause" switches the ticked ones off with the
//                  existing Settings > Extensions switch (extensions:set-enabled), and
//                  "Put them back" switches exactly those on again. Pausing is a global
//                  switch for those extensions while paused: Vex has no way to stop one
//                  extension's scripts on one page only.
//
//   Always on this site  (Wave 5) A per-site RULE built on that switch: "always pause the
//                  ticked extensions while I am on this site". When the page in front is on
//                  that site they are switched off, and when you go to another site they are
//                  switched back on, by the same switch. The honest cost is that those
//                  extensions are off in your other tabs too while you are on that site.
//                  Rules are yours alone, off until you make one, and removable.
//
//   Suggestion     On a bank or mail page (the list below, plus the bank and mail words the AI
//                  sensitivity gate already knows), a quiet card offers the dialog once.
//
// What it does not do: it compares what the manifest declares, not the extension's
// files (Vex does not keep the old package), and it cannot see what an extension does with
// the access it has. docs/security-tier3-threat-notes.md.
const VexExtDiff = {
  ENABLED_KEY: 'vex.extDiff.enabled',
  SNAP_KEY: 'vex.extDiff.snapshots',
  PAUSE_KEY: 'vex.extSitePause',
  RULES_KEY: 'vex.extSiteRules',   // { host: [folders] }: pause these while a tab is on that host
  FEATURE: 'extension-diff',
  // Hosts a person usually does not want a stranger's extension to read. A hint for the
  // suggestion only; the dialog works on any site.
  SENSITIVE: /(^|\.)(paypal\.com|stripe\.com|wise\.com|revolut\.com|ziraatbank\.com\.tr|isbank\.com\.tr|garanti(bbva)?\.com\.tr|akbank\.com|yapikredi\.com\.tr|qnb\.com\.tr|denizbank\.com|chase\.com|bankofamerica\.com|wellsfargo\.com|mail\.google\.com|outlook\.(live|office)\.com|mail\.yahoo\.com|proton\.me|login\.live\.com|accounts\.google\.com|e-?devlet\.gov\.tr|turkiye\.gov\.tr)$/i,

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) === 'true'; }
    catch (err) { console.error('[ExtDiff] the switch could not be read:', err); return false; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); this.registerCommands(); },

  // ---- pure ---------------------------------------------------------------------------------
  // What a list entry (extensions:list) says about reach and powers, kept small.
  snapshotOf(ext) {
    const a = (ext && ext.audit) || {};
    const reach = a.reach || { level: 'none', hosts: [] };
    return {
      name: String(ext.name || ext.folder || ''),
      version: String(ext.version || ''),
      level: String(reach.level || 'none'),
      hosts: Array.isArray(reach.hosts) ? reach.hosts.map(String).sort() : [],
      powers: (a.powers || []).map(p => ({ id: String(p.id), says: String(p.says || p.id), heavy: !!p.heavy })).sort((x, y) => x.id.localeCompare(y.id)),
    };
  },
  LEVELS: { none: 0, click: 1, some: 2, all: 3 },
  LEVEL_WORDS: { none: 'no pages', click: 'the page you click it on', some: 'a few named sites', all: 'every page you open' },
  // prev, cur: snapshots. -> { changed, version:[a,b]|null, gained:[{id,says,heavy}], lost:[...], reach:{from,to,wider}|null, hostsAdded:[], hostsRemoved:[] }
  diff(prev, cur) {
    const out = { changed: false, version: null, gained: [], lost: [], reach: null, hostsAdded: [], hostsRemoved: [] };
    if (!prev || !cur) return out;
    if (prev.version !== cur.version) { out.version = [prev.version, cur.version]; out.changed = true; }
    const had = new Set(prev.powers.map(p => p.id)), has = new Set(cur.powers.map(p => p.id));
    out.gained = cur.powers.filter(p => !had.has(p.id));
    out.lost = prev.powers.filter(p => !has.has(p.id));
    if (prev.level !== cur.level) {
      out.reach = { from: prev.level, to: cur.level, wider: (this.LEVELS[cur.level] || 0) > (this.LEVELS[prev.level] || 0) };
    }
    const hadH = new Set(prev.hosts), hasH = new Set(cur.hosts);
    out.hostsAdded = cur.hosts.filter(h => !hadH.has(h));
    out.hostsRemoved = prev.hosts.filter(h => !hasH.has(h));
    if (out.gained.length || out.lost.length || out.reach || out.hostsAdded.length || out.hostsRemoved.length) out.changed = true;
    return out;
  },
  // The diff as short plain lines.
  lines(d) {
    const L = [];
    if (d.version) L.push('Version ' + d.version[0] + ' to ' + d.version[1]);
    for (const p of d.gained) L.push('Now can: ' + p.says);
    for (const p of d.lost) L.push('No longer can: ' + p.says);
    if (d.reach) L.push((d.reach.wider ? 'Can now read more: ' : 'Can now read less: ') + (this.LEVEL_WORDS[d.reach.from] || d.reach.from) + ' to ' + (this.LEVEL_WORDS[d.reach.to] || d.reach.to));
    if (d.hostsAdded.length) L.push('Sites added: ' + d.hostsAdded.join(', '));
    if (d.hostsRemoved.length) L.push('Sites removed: ' + d.hostsRemoved.join(', '));
    return L;
  },
  // Can this extension read pages on `host`? ('all' reads everything; 'some' reads the named hosts and their subdomains.)
  readsHost(snap, host) {
    const h = String(host || '').toLowerCase().replace(/^www\./, '');
    if (!h) return false;
    if (snap.level === 'all') return true;
    if (snap.level !== 'some') return false;
    return snap.hosts.some(x => { const y = String(x).toLowerCase(); return h === y || h.endsWith('.' + y); });
  },
  // The host list above, or the bank and mail words the AI sensitivity gate uses.
  looksSensitive(host) {
    const h = String(host || '').toLowerCase();
    if (!h) return false;
    if (this.SENSITIVE.test(h)) return true;
    return typeof VexSensitivity !== 'undefined' && !!VexSensitivity.MAIL_HOSTS && !!VexSensitivity.BANK_HEALTH_WORDS
      && (VexSensitivity.MAIL_HOSTS.test(h) || VexSensitivity.BANK_HEALTH_WORDS.test(h));
  },
  hostOf(url) {
    try { const u = new URL(String(url)); return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase() : ''; }
    catch { return ''; }
  },

  // ---- stored baseline ------------------------------------------------------------------------
  _snaps() {
    const raw = localStorage.getItem(this.SNAP_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('The saved extension baseline is not readable, so it was not changed');
    return v;
  },
  _saveSnaps(s) { localStorage.setItem(this.SNAP_KEY, JSON.stringify(s)); },
  _pauses() {
    const raw = localStorage.getItem(this.PAUSE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('The saved list of paused extensions is not readable, so it was not changed');
    return v;
  },

  async _list() {
    if (!window.vex || typeof window.vex.extensionsList !== 'function') throw new Error('The extension list is not available in this window');
    return window.vex.extensionsList();
  },

  // -> [{ ext, snap, change: diff|null (null: no baseline yet), held: pending|null }] for every installed extension.
  // The first time an extension is seen, its picture is stored as the baseline and it is not reported.
  async review({ list } = {}) {
    const exts = list || await this._list();
    const snaps = this._snaps();
    const rows = [];
    let wrote = false;
    for (const ext of exts) {
      const snap = this.snapshotOf(ext);
      const prev = snaps[ext.folder];
      if (!prev) { snaps[ext.folder] = { ...snap, at: Date.now() }; wrote = true; }
      const change = prev ? this.diff(prev, snap) : null;
      const pend = ext.update && ext.update.pending ? ext.update.pending : null;
      rows.push({ ext, snap, change, held: pend });
    }
    if (wrote) this._saveSnaps(snaps);
    return rows;
  },
  markReviewed(rows) {
    const snaps = this._snaps();
    for (const r of rows) snaps[r.ext.folder] = { ...r.snap, at: Date.now() };
    this._saveSnaps(snaps);
  },

  // ---- pause for a site -------------------------------------------------------------------------
  async candidatesFor(host) {
    const list = await this._list();
    return list.filter(e => e.enabled && e.loaded !== false && this.readsHost(this.snapshotOf(e), host));
  },
  async _setEnabled(folder, on) {
    const r = await window.vex.extensionsSetEnabled(folder, on);
    if (!r || r.ok === false) throw new Error((r && r.error) || 'The extension could not be switched');
  },
  // folders: the ones to switch off. Remembered per host so exactly they are put back.
  async pause(host, folders, { auto = false } = {}) {
    if (!this.enabled()) throw new Error('Extension tools are switched off in Settings');
    if (!folders.length) throw new Error('Tick at least one extension');
    const done = [];
    try { for (const f of folders) { await this._setEnabled(f, false); done.push(f); } }
    finally {
      if (done.length) {
        const all = this._pauses();
        const cur = all[host] || { folders: [] };
        all[host] = { folders: [...new Set([...cur.folders, ...done])], at: Date.now(), ...(auto || cur.auto ? { auto: true } : {}) };
        localStorage.setItem(this.PAUSE_KEY, JSON.stringify(all));
      }
    }
    return done;
  },
  async restore(host) {
    const all = this._pauses();
    const entry = all[host];
    if (!entry) throw new Error('Nothing is paused for ' + host);
    const failed = [];
    for (const f of entry.folders) { try { await this._setEnabled(f, true); } catch (err) { failed.push(f + ' (' + err.message + ')'); } }
    if (failed.length) throw new Error('Could not switch back on: ' + failed.join('; '));
    delete all[host];
    localStorage.setItem(this.PAUSE_KEY, JSON.stringify(all));
  },
  // ---- always pause on a site (a rule) -----------------------------------------------------------------
  _rules() {
    const raw = localStorage.getItem(this.RULES_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('The saved site rules are not readable, so they were not changed');
    return v;
  },
  rules() { return this._rules(); },
  setRule(host, folders) {
    if (!host) throw new Error('A rule needs a site');
    const r = this._rules();
    if (folders && folders.length) r[host] = [...new Set(folders.map(String))].slice(0, 20);
    else delete r[host];
    localStorage.setItem(this.RULES_KEY, JSON.stringify(r));
    this.registerCommands();
    return r[host] || [];
  },
  // The tab in front changed. Pause what a rule says for its site, and put back what a rule paused
  // for a site we have left. Only what a rule paused is put back (entries made by hand are left to the person).
  async applyRules(tab) {
    if (!this.enabled()) return { paused: [], restored: [] };
    const rules = this._rules();
    const host = tab && tab.url ? this.hostOf(tab.url) : '';
    const out = { paused: [], restored: [] };
    const pauses = this._pauses();
    for (const h of Object.keys(pauses)) {
      if (pauses[h] && pauses[h].auto && h !== host && !(host && host.endsWith('.' + h))) { await this.restore(h); out.restored.push(h); }
    }
    const match = Object.keys(rules).find(h => host === h || host.endsWith('.' + h));
    if (match && !(this._pauses()[match] && this._pauses()[match].auto)) {
      const live = (await this._list()).filter(e => e.enabled && e.loaded !== false && rules[match].includes(e.folder)).map(e => e.folder);
      if (live.length) {
        const done = await this.pause(match, live, { auto: true });
        out.paused = done;
        if (done.length && typeof VexLedger !== 'undefined') VexLedger.note({ feature: this.FEATURE, what: 'Paused ' + done.length + ' extension' + VexPlural.s(done.length) + ' while you are on ' + match, why: 'You made a rule for this site; they come back when you leave it' });
      }
    }
    return out;
  },
  // After a restart: whatever a rule paused is put back first, then the rule is applied to the tab in front.
  async restoreStale() {
    const pauses = this._pauses();
    for (const h of Object.keys(pauses)) if (pauses[h] && pauses[h].auto) await this.restore(h);
  },
  pausedHosts() { try { return Object.keys(this._pauses()); } catch (err) { console.error('[ExtDiff]', err.message); return []; } },

  // ---- screens --------------------------------------------------------------------------------------
  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  _fail(err) { window.showToast?.((err && err.message) || String(err), 'error'); },

  async openChanges() {
    if (!this.enabled()) throw new Error('Extension tools are switched off in Settings');
    const { body } = VexSettingsGroups.dialog({ id: 'ext-diff', title: 'Extension changes', sub: 'What each extension can read and do, against the last time you reviewed. Read-only.' });
    if (typeof VexUsage !== 'undefined') VexUsage.touch('extension-diff');
    await this._drawChanges(body);
  },
  async _drawChanges(body) {
    body.textContent = '';
    const rows = await this.review();
    let any = false;
    for (const r of rows) {
      const lines = r.change && r.change.changed ? this.lines(r.change) : [];
      const held = r.held;
      if (!lines.length && !held) continue;
      any = true;
      const card = this._el('div', 'ad-page');
      card.appendChild(this._el('strong', '', r.snap.name + ' ' + r.snap.version));
      if (held) {
        card.appendChild(this._el('div', 'ad-result', 'Held update ' + held.version + ' asks for more and waits for your approval in Settings > Extensions:'));
        const ul = this._el('ul', 'ad-new');
        for (const a of held.added || []) ul.appendChild(this._el('li', '', a.says));
        card.appendChild(ul);
      }
      if (lines.length) {
        const ul = this._el('ul', 'ad-new');
        for (const l of lines) ul.appendChild(this._el('li', '', l));
        card.appendChild(ul);
      }
      body.appendChild(card);
    }
    if (!any) body.appendChild(this._el('p', 'setting-info', 'No extension changed what it can read or do since you last reviewed.'));
    const row = this._el('div', 'ad-actions');
    const b = this._el('button', 'btn-secondary', 'Mark all as reviewed'); b.type = 'button';
    b.addEventListener('click', () => { try { this.markReviewed(rows); this._drawChanges(body).catch((e) => this._fail(e)); } catch (err) { this._fail(err); } });
    row.appendChild(b);
    body.appendChild(row);
  },

  async openPause(host) {
    if (!this.enabled()) throw new Error('Extension tools are switched off in Settings');
    let h = host;
    if (!h) {
      const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
      h = this.hostOf(tab && tab.url);
    }
    if (!h) throw new Error('Open a web page first');
    const { body, close } = VexSettingsGroups.dialog({ id: 'ext-pause', title: 'Pause extensions on ' + h, sub: 'The extensions below can read this site. Pausing switches them off everywhere until you put them back.' });
    if (typeof VexUsage !== 'undefined') VexUsage.touch('extension-diff');
    const cands = await this.candidatesFor(h);
    const paused = this._pauses()[h];
    if (paused) {
      body.appendChild(this._el('p', 'setting-info', 'Paused for this site: ' + paused.folders.length + ' extension' + VexPlural.s(paused.folders.length) + '.'));
      const back = this._el('button', 'btn-primary', 'Put them back'); back.type = 'button';
      back.addEventListener('click', () => { this.restore(h).then(() => { window.showToast?.('Extensions switched back on'); close(); }).catch((e) => this._fail(e)); });
      body.appendChild(back);
    }
    if (!cands.length) { body.appendChild(this._el('p', 'setting-info', 'No running extension can read ' + h + '.')); return; }
    const boxes = [];
    for (const e of cands) {
      const lab = this._el('label', 'setting-toggle-row');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
      cb.setAttribute('aria-label', 'Pause ' + e.name);
      boxes.push({ cb, folder: e.folder });
      const snap = this.snapshotOf(e);
      lab.append(cb, this._el('span', '', ' ' + e.name + ' (' + (this.LEVEL_WORDS[snap.level] || snap.level) + ')'));
      body.appendChild(lab);
    }
    const rule = this._rules()[h];
    const always = this._el('label', 'setting-toggle-row');
    const acb = document.createElement('input'); acb.type = 'checkbox'; acb.checked = !!rule; acb.setAttribute('aria-label', 'Always pause the ticked extensions on ' + h);
    always.append(acb, this._el('span', '', ' Always pause the ticked ones on ' + h + ' (they are off in your other tabs while you are here, and back when you leave)'));
    body.appendChild(always);
    const go = this._el('button', 'btn-primary', 'Pause the ticked ones'); go.type = 'button';
    go.addEventListener('click', () => {
      const chosen = boxes.filter(b => b.cb.checked).map(b => b.folder);
      Promise.resolve().then(() => { this.setRule(h, acb.checked ? chosen : []); return this.pause(h, chosen); })
        .then((done) => { window.showToast?.('Paused ' + done.length + (done.length === 1 ? ' extension' : ' extensions') + (acb.checked ? ' and made a rule for ' + h : '')); close(); }).catch((e) => this._fail(e));
    });
    body.appendChild(go);
  },

  // ---- a quiet suggestion on a sensitive site -------------------------------------------------------
  _suggested: new Set(),
  _pendingHost: new Map(),
  async suggestFor(tab) {
    if (!this.enabled() || !tab || !tab.url || typeof VexAttention === 'undefined') return false;
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return false;
    const host = this.hostOf(tab.url);
    if (!host || !this.looksSensitive(host) || this._suggested.has(host)) return false;
    this._suggested.add(host);
    const cands = await this.candidatesFor(host);
    if (!cands.length) return false;
    return VexAttention.suggest({
      feature: this.FEATURE, label: 'Extension tools', id: 'site:' + host,
      title: cands.length + (cands.length === 1 ? ' extension can' : ' extensions can') + ' read ' + host,
      body: 'Pause them while you are here? Nothing changes unless you choose.',
      action: { label: 'Choose', key: 'pause:' + host },
    });
  },
  _onAction(key) {
    const m = /^pause:(.+)$/.exec(String(key));
    if (!m) throw new Error('Unknown extension action ' + key);
    return this.openPause(m[1]);
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    const fail = (e) => this._fail(e);
    VexModuleCommands.set('extdiff:', this.enabled() ? [
      { id: 'extdiff:changes', label: 'Extension changes', icon: 'puzzle', hint: 'What extensions can read or do now, against your last review', action: () => { this.openChanges().catch(fail); } },
      { id: 'extdiff:pause', label: 'Pause extensions on this site', icon: 'puzzle', hint: 'Switch off the extensions that can read this page, and put them back', action: () => { this.openPause().catch(fail); } },
    ] : []);
    return true;
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('See what an extension can read or do now against the last time you reviewed (an update that asks for more is held anyway and listed here), and pause the extensions that can read a bank or email page. It reads the extensions\' declared permissions, not their files, and pausing switches an extension off everywhere until you put it back.'));
    body.appendChild(S.toggle('Extension tools', this.enabled(), (on) => { this.setEnabled(on); if (typeof VexUsage !== 'undefined') VexUsage.touch('extension-diff'); }, 'Ctrl+K > Extension changes'));
    if (this.enabled()) {
      body.appendChild(S.button('Extension changes...', () => { this.openChanges().catch((e) => this._fail(e)); }));
      for (const h of this.pausedHosts()) body.appendChild(S.button('Put back the extensions paused on ' + h, () => { this.restore(h).then(() => window.showToast?.('Extensions switched back on')).catch((e) => this._fail(e)); }));
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexExtDiff = VexExtDiff;
  VexExtDiff.registerCommands();
  document.addEventListener('DOMContentLoaded', () => VexExtDiff.registerCommands());
  const check = () => {
    try {
      if (typeof TabManager !== 'undefined' && TabManager.getActiveTab) {
        const tab = TabManager.getActiveTab();
        VexExtDiff.suggestFor(tab).catch((err) => console.error('[ExtDiff] could not check the tab:', err));
        VexExtDiff.applyRules(tab).catch((err) => window.VexProblems?.note('Extension tools', 'A site rule could not be applied', err));
      }
    } catch (err) { console.error('[ExtDiff] could not check the tab:', err); }
  };
  document.addEventListener('DOMContentLoaded', () => { VexExtDiff.restoreStale().catch((err) => window.VexProblems?.note('Extension tools', 'Extensions paused by a site rule could not be put back', err)); });
  window.addEventListener('vex:tab-activated', check);
  if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle(VexExtDiff.FEATURE, (key) => { VexExtDiff._onAction(key).catch((e) => VexExtDiff._fail(e)); });
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'extension-diff', title: 'Extension changes and pause', keywords: 'extension update diff permissions pause site bank email', before: 'about', render: (body) => VexExtDiff.settingsRows(body) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexExtDiff };
