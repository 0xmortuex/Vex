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
    const list = VexUpdateNotes.localizedList(await window.vex.getReleaseList());
    if (!Array.isArray(list)) throw new Error('The release list could not be read');
    const from = this.seen();
    const entries = from ? VexUpdateNotes.between(list, from, to) : list.filter(e => e && VexUpdateNotes.cmp(e.version, to) === 0);
    const releases = entries.slice(0, this.MAX_RELEASES).map(e => ({
      version: e.version, title: VexUpdateNotes.title(e),
      points: (() => {
        const items = VexUpdateNotes.items(e.body);
        return VexUpdateNotes.points(e.body).slice(0, this.MAX_POINTS).map(text => {
          const it = items.find(i => i.lead === text) || {};
          return { text, section: this.tryItFor(text), feature: it.feature || '', detail: it.detail || '' };
        });
      })(),
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
    const switched = new Set();   // one switch for a feature, even when two points name it
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
        // A feature the release names, with a real switch in this build: turned on or off right here.
        if (pt.feature && !switched.has(pt.feature) && window.VexUpdateFeatureSwitch && window.VexUpdateFeatureSwitch.usable(pt.feature)) { switched.add(pt.feature); row.appendChild(window.VexUpdateFeatureSwitch.control(pt.feature)); }
        body.appendChild(row);
      }
    }
    body.appendChild(VexSettingsGroups.button('Mark all as seen', () => { try { this.markSeen(p.to); close(); window.showToast?.('Marked as seen'); } catch (err) { window.showToast?.(err.message, 'error'); } }, { primary: true }));
    return p;
  },

  // ---- Welcome back: "which version did you use last?" ----------------------------------------------------
  // For someone coming back after a long time, or to a new computer, where nothing is remembered: they say which version
  // they last used and get what changed since, with a Try it button where there is a Settings section to open. It also
  // OFFERS, and never forces, Simple mode and Turkish. js/update-log.js hands over to it when an update skips GAP or more
  // releases; Ctrl+K "Welcome back" opens it any time. Nothing changes until a button is pressed.
  GAP: 8,       // releases skipped before the update card gives way to this guide
  NEWEST: 10,   // when they do not remember: the newest releases

  TR: {
    'Welcome back': 'Tekrar hoş geldiniz',
    'Tell me which version of Vex you used last and I will show what changed since. Nothing is changed until you press a button.': 'Vex’in en son hangi sürümünü kullandığınızı söyleyin, o zamandan beri neyin değiştiğini göstereyim. Bir düğmeye basmadan hiçbir şey değişmez.',
    'The version I used last': 'En son kullandığım sürüm', 'I do not remember': 'Hatırlamıyorum', 'Show what changed': 'Neyin değiştiğini göster',
    'Nothing new since v{from}.': 'v{from} sürümünden beri yeni bir şey yok.',
    'Since v{from}: {n} releases. The most important changes:': 'v{from} sürümünden beri {n} sürüm yayımlandı. En önemli değişiklikler:',
    'The {n} newest releases. The most important changes:': 'En yeni {n} sürüm. En önemli değişiklikler:',
    'The release notes are written in English.': 'Sürüm notları İngilizce yazılmıştır.',
    'Try it': 'Dene', 'See everything since v{from}': 'v{from} sürümünden beri her şeyi gör',
    'Simple mode hides the extra panels and buttons and keeps the basics. Nothing is deleted, and you can switch back in Settings.': 'Basit mod, ek panelleri ve düğmeleri gizler, temel şeyleri bırakır. Hiçbir şey silinmez; Ayarlar’dan geri dönebilirsiniz.',
    'Use Simple mode': 'Basit modu kullan', 'Simple mode is on': 'Basit mod açık',
    'Vex can be shown in Turkish (Türkçe). Some parts are still in English.': 'Vex Türkçe gösterilebilir. Bazı bölümler hâlâ İngilizce.',
    'Use Turkish': 'Türkçe kullan', 'Done': 'Tamam',
  },
  _t(en, vars) {
    const turkish = typeof VexI18nUI !== 'undefined' && VexI18nUI.locale() === 'tr';
    let s = turkish && Object.prototype.hasOwnProperty.call(this.TR, en) ? this.TR[en] : en;
    for (const k of Object.keys(vars || {})) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  },
  // True when an update skipped enough releases that the guide should take the update card's place. It does not depend on this
  // feature's own switch: a profile that predates the feature starts with it off, and that is exactly who comes back after a
  // long time. (The update card's own Settings > About switch still decides whether either is shown.)
  wantsGuide(missed) { return missed >= this.GAP; },

  // opts.from: a version to start from. opts.automatic: opened by the update card, not asked for, so the feature's switch is not consulted.
  async welcomeBack(opts = {}) {
    if (!opts.automatic && !this.enabled()) { window.showToast?.("What's new for me is switched off in Settings", 'info'); return null; }
    if (typeof VexUpdateNotes === 'undefined') throw new Error('The release notes reader is not loaded');
    if (!window.vex || typeof window.vex.getReleaseList !== 'function') throw new Error('The release notes are not available in this window');
    const to = String(await this._version()).replace(/^v/i, '');
    const list = VexUpdateNotes.localizedList(await window.vex.getReleaseList());
    if (!Array.isArray(list)) throw new Error('The release list could not be read');
    const releases = list.filter(e => e && e.version);
    const t = (en, vars) => this._t(en, vars);
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-welcome-back', title: t('Welcome back'), sub: t('Tell me which version of Vex you used last and I will show what changed since. Nothing is changed until you press a button.') });

    const ask = document.createElement('div');
    ask.className = 'vexsr-rule';
    const label = document.createElement('label');
    label.htmlFor = 'vex-welcome-back-version';
    label.textContent = t('The version I used last');
    const sel = document.createElement('select');
    sel.id = 'vex-welcome-back-version';
    sel.className = 'set-input';
    // The titles are long: the picker fills its row instead of pushing the dialog wider.
    sel.style.width = '100%'; sel.style.maxWidth = '100%'; sel.style.minWidth = '0'; sel.style.textOverflow = 'ellipsis';
    ask.style.flexDirection = 'column'; ask.style.alignItems = 'stretch'; ask.style.gap = '6px';
    sel.appendChild(new Option(t('I do not remember'), ''));
    for (const e of releases) {
      const v = String(e.version).replace(/^v/i, '');
      const title = VexUpdateNotes.title(e);
      sel.appendChild(new Option('v' + v + (title ? ' — ' + title : ''), v));
    }
    if (opts.from) sel.value = String(opts.from).replace(/^v/i, '');
    ask.append(label, sel);
    body.appendChild(ask);

    const results = document.createElement('div');
    results.setAttribute('aria-live', 'polite');
    const render = () => {
      results.textContent = '';
      const from = sel.value;
      const entries = from ? VexUpdateNotes.between(releases, from, to) : releases.slice(0, this.NEWEST);
      if (!entries.length) { results.appendChild(VexSettingsGroups.note(t('Nothing new since v{from}.', { from }))); return; }
      results.appendChild(VexSettingsGroups.note(from ? t('Since v{from}: {n} releases. The most important changes:', { from, n: entries.length }) : t('The {n} newest releases. The most important changes:', { n: entries.length })));
      // The release notes are written in English only; say so rather than leave a Turkish reader wondering.
      if (typeof VexI18nUI !== 'undefined' && VexI18nUI.locale() === 'tr') results.appendChild(VexSettingsGroups.note(t('The release notes are written in English.')));
      const switched = new Set();   // one switch for a feature, even when two points name it
      const byLead = new Map();
      for (const e of entries) for (const it of VexUpdateNotes.items(e.body)) if (!byLead.has(it.lead)) byLead.set(it.lead, it);
      for (const g of VexUpdateNotes.highlights(entries, 14)) {
        const h = document.createElement('div');
        h.className = 'vexsr-rule';
        const strong = document.createElement('strong');
        strong.textContent = 'v' + String(g.version).replace(/^v/i, '') + (g.title ? ' · ' + g.title : '');
        h.appendChild(strong);
        results.appendChild(h);
        for (const text of g.points) {
          const row = document.createElement('div');
          row.className = 'vexsr-rule';
          const span = document.createElement('span');
          span.className = 'vexsr-host';
          span.style.wordBreak = 'normal';
          span.textContent = text;
          row.appendChild(span);
          const section = this.tryItFor(text);
          if (section) row.appendChild(VexSettingsGroups.button(t('Try it'), () => { close(); if (typeof SettingsUI !== 'undefined') SettingsUI.openSection(section); }, { label: t('Try it') + ': ' + text }));
          const named = byLead.get(text);
          if (named && named.feature && !switched.has(named.feature) && window.VexUpdateFeatureSwitch && window.VexUpdateFeatureSwitch.usable(named.feature)) { switched.add(named.feature); row.appendChild(window.VexUpdateFeatureSwitch.control(named.feature)); }
          results.appendChild(row);
        }
      }
      if (from && window.VexWhatsNew && typeof window.VexWhatsNew.open === 'function') {
        results.appendChild(VexSettingsGroups.button(t('See everything since v{from}', { from }), () => { close(); window.VexWhatsNew.open({ from, to }); }));
      }
    };
    body.append(VexSettingsGroups.button(t('Show what changed'), render, { primary: true }), results);

    // Offered, never forced.
    if (typeof VexSimpleMode !== 'undefined' && VexSimpleMode.mode() !== 'simple') {
      body.append(
        VexSettingsGroups.note(t('Simple mode hides the extra panels and buttons and keeps the basics. Nothing is deleted, and you can switch back in Settings.')),
        VexSettingsGroups.button(t('Use Simple mode'), () => { VexSimpleMode.set('simple'); window.showToast?.(t('Simple mode is on')); }),
      );
    }
    const computerLanguage = String((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase();
    if (computerLanguage.startsWith('tr') && typeof Onboarding !== 'undefined' && typeof VexI18nUI !== 'undefined' && VexI18nUI.locale() !== 'tr') {
      body.append(
        VexSettingsGroups.note(t('Vex can be shown in Turkish (Türkçe). Some parts are still in English.')),
        VexSettingsGroups.button('Türkçe kullan', () => { Onboarding.setLanguage('tr'); }),
      );
    }
    body.appendChild(VexSettingsGroups.button(t('Done'), () => { try { this.markSeen(to); } catch (err) { window.showToast?.(err.message, 'error'); } close(); }));
    if (opts.from) render();
    return { releases: releases.length, to };
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
    VexExtras.registerCommand({ id: 'welcome-back', label: 'Welcome back: what changed since I last used Vex', hint: 'Say which version you used last and see what changed since, with an offer of Simple mode', icon: 'gift', action: () => { VexWhatsNewMe.welcomeBack().catch(err => window.showToast?.(err.message, 'error')); } });
    VexExtras.registerCommand({ id: 'whatsnew-me', label: "What's new for me", hint: 'Only the changes since the build you last looked at, with a Try it button for each', icon: 'gift', action: () => { VexWhatsNewMe.open().catch(err => window.showToast?.(err.message, 'error')); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexWhatsNewMe };
