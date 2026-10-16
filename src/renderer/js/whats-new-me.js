// === "What's new for me": what changed since the build you last looked at (T3-026) ===
//
// The release notes card (js/update-log.js) shows the last update once, and "What's New" in Ctrl+K
// reopens only the current version's notes. This keeps a note of the version you last LOOKED AT HERE
// (vex.whatsNewMe.seen) and lists every point released after it, newest first, each with a "Try it"
// button that opens the Settings section of that feature when Vex can tell which one it is. A point
// whose feature cannot be matched to a Settings section simply has no button: there are no buttons
// that do nothing (a section is only offered if it is on the page).
//
//   VexWhatsNewMe.pending()       -> { from, to, releases: [{ version, title, points: [{ text, section }] }] }
//   VexWhatsNewMe.open()          the dialog; "Mark all as seen" moves the note up to this version
//                                 (closing it any other way keeps the list for next time)
//   VexWhatsNewMe.tryItFor(text)  -> a Settings section id, or ''
//
// First time (nothing remembered): the current version alone is shown, not the whole history.
// Local only; the notes are the CHANGELOG that ships inside the app.

const VexWhatsNewMe = {
  SEEN_KEY: 'vex.whatsNewMe.seen',
  MAX_RELEASES: 12,
  MAX_POINTS: 40,

  // Words in a release point -> the Settings section that holds the feature. A section is offered only
  // when its element exists, so an out-of-date row here costs a missing button, never a dead one.
  KEYWORDS: [
    ['battery', 'settings-battery'], ['page watch', 'settings-pagewatch'], ['watch this page', 'settings-pagewatch'], ['ai news', 'settings-ainews'],
    ['morning brief', 'settings-brief'], ['daily brief', 'settings-brief'], ['brief', 'settings-brief'], ['tab sleep', 'settings-memtools'], ['memory', 'settings-memtools'],
    ['passkey', 'settings-passkeys'], ['userscript', 'userscripts-panel'], ['game mode', 'game-mode-settings'], ['ad block', 'setting-adblocker'], ['adblock', 'setting-adblocker'],
    ['extension', 'extensions-panel-content'], ['sync', 'sync-panel-content'], ['password', 'passwords-panel-content'], ['persona', 'personas-panel-content'],
    ['mcp', 'mcp-panel-content'], ['on-device', 'webllm-panel-content'], ['webllm', 'webllm-panel-content'], ['ai memory', 'ai-memory-panel-content'],
    ['shortcut', 'shortcuts-editor-content'], ['workflow', 'workflow-settings'], ['distraction', 'settings-distraction-budget'], ['site settings', 'setting-site-settings'],
    ['developer helper', 'setting-dev-helpers'], ['dev helper', 'setting-dev-helpers'], ['alias', 'settings-aliases'], ['time of day', 'settings-timeofday'],
  ],

  PREF: 'vex.whatsNewMe.enabled',
  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  _words(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, ' ').trim(); },

  // The Settings section for one release point. The feature registry is read first (a manifest's title
  // in the point's words, and a module group that exists for it), then the keyword table.
  tryItFor(text, doc = (typeof document !== 'undefined' ? document : null)) {
    if (!doc) return '';
    const have = (id) => !!id && !!doc.getElementById(id);
    const t = ' ' + this._words(text) + ' ';
    if (typeof VexRegistry !== 'undefined') {
      let best = null;
      for (const m of VexRegistry.all()) {
        const title = this._words(m.title);
        if (title.length < 6 || !t.includes(' ' + title + ' ')) continue;
        const id = [`vex-sg-${m.id}`, `setting-${m.id}`].find(have);
        if (id && (!best || title.length > best.len)) best = { id, len: title.length };
      }
      if (best) return best.id;
    }
    for (const [raw, id] of this.KEYWORDS) {
      const word = this._words(raw);
      if (t.includes(' ' + word + ' ') || t.includes(' ' + word + 's ') || (word.length > 6 && t.includes(word))) { if (have(id)) return id; }
    }
    return '';
  },

  _version() { return window.vex && typeof window.vex.getAppVersion === 'function' ? window.vex.getAppVersion() : Promise.reject(new Error('The app version is not available')); },

  seen() { try { return localStorage.getItem(this.SEEN_KEY) || ''; } catch { return ''; } },
  markSeen(version) {
    try { localStorage.setItem(this.SEEN_KEY, String(version)); }
    catch (err) { throw new Error('Could not remember what you have seen: ' + err.message); }
  },

  async pending() {
    if (typeof VexUpdateNotes === 'undefined') throw new Error('The release notes reader is not loaded');
    if (!window.vex || typeof window.vex.getReleaseList !== 'function') throw new Error('The release notes are not available in this window');
    const to = String(await this._version()).replace(/^v/i, '');
    const list = await window.vex.getReleaseList();
    if (!Array.isArray(list)) throw new Error('The release list could not be read');
    const from = this.seen();
    const entries = from ? VexUpdateNotes.between(list, from, to) : list.filter(e => e && VexUpdateNotes.cmp(e.version, to) === 0);
    const releases = entries.slice(0, this.MAX_RELEASES).map(e => ({
      version: e.version, title: VexUpdateNotes.title(e),
      points: VexUpdateNotes.points(e.body).slice(0, this.MAX_POINTS).map(text => ({ text, section: this.tryItFor(text) })),
    })).filter(r => r.points.length);
    return { from, to, releases };
  },

  async open() {
    if (!this.enabled()) { window.showToast?.("What's new for me is switched off in Settings", 'info'); return null; }
    const p = await this.pending();
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-whatsnew-me', title: "What's new for me", sub: p.from ? 'Changes since v' + p.from + ', the last build you looked at here.' : 'You have not looked here before, so this is the current version only.' });
    if (!p.releases.length) {
      body.appendChild(VexSettingsGroups.note('Nothing new since v' + (p.from || p.to) + '.'));
      this.markSeen(p.to);
      return p;
    }
    for (const r of p.releases) {
      const h = document.createElement('div');
      h.className = 'vexsr-rule';
      const strong = document.createElement('strong');
      strong.textContent = 'v' + String(r.version).replace(/^v/i, '') + (r.title ? ' · ' + r.title : '');
      h.appendChild(strong);
      body.appendChild(h);
      for (const pt of r.points) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        text.textContent = pt.text;
        row.appendChild(text);
        if (pt.section) {
          row.appendChild(VexSettingsGroups.button('Try it', () => { close(); if (typeof SettingsUI !== 'undefined') SettingsUI.openSection(pt.section); }, { label: 'Try it: ' + pt.text }));
        }
        body.appendChild(row);
      }
    }
    body.appendChild(VexSettingsGroups.button('Mark all as seen', () => { try { this.markSeen(p.to); close(); window.showToast?.('Marked as seen'); } catch (err) { window.showToast?.(err.message, 'error'); } }, { primary: true }));
    return p;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Lists only what changed since the build you last looked at here, each with a Try it button that opens its Settings section. Ctrl+K › What\'s new for me.'));
    el.appendChild(VexSettingsGroups.button("Show what's new for me", () => { this.open().catch(err => window.showToast?.(err.message, 'error')); }, { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexWhatsNewMe = VexWhatsNewMe;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'whats-new-me', title: "What's new for me", keywords: 'whats new changes since update release notes try it', before: 'about', build: (el) => VexWhatsNewMe.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'whatsnew-me', label: "What's new for me", hint: 'Only the changes since the build you last looked at, with a Try it button for each', icon: 'gift', action: () => { VexWhatsNewMe.open().catch(err => window.showToast?.(err.message, 'error')); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexWhatsNewMe };
