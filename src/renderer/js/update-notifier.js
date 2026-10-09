// === Vex Update Notifier: the full-screen update cover ===
//
// When Vex starts and a newer version is out, a cover over the whole window
// says which version, shows what is new, and offers three choices:
//   Update now          download the installer inside Vex (with progress and
//                       Cancel), check it against the release's checksum, then
//                       close Vex (tabs saved) and install quietly; Vex opens
//                       again on the new version by itself (src/main/updates.js);
//   Later               nothing is remembered: asked again at the next check
//                       (the next start, or six hours on while Vex stays open);
//   Skip this version   silent until a version newer than this one is out.
// Settings › About › Check for Updates opens the same cover, and its "Check
// for updates automatically" switch turns both automatic checks off.
// Only the main window shows it: a private window never checks.

const UpdateNotifier = {
  // Snooze is no longer set by "Later" (Later means the next start); the
  // safe-mode roll-back still uses it so the older version does not offer
  // the update straight back (js/safe-mode-banner.js).
  SNOOZE_KEY: 'vex.updateSnoozeUntil',
  SKIP_KEY: 'vex.updateSkipVersion',
  SNOOZE_MS: 24 * 3600 * 1000,
  // Channels. Latest: every release, as it comes out. Stable: only once the
  // newest release has stood for two days — Vex can ship several a day, and
  // a copy on Stable hears about the one they settle on, not each one.
  CHANNEL_KEY: 'vex.updateChannel',
  STABLE_MS: 2 * 24 * 3600 * 1000,

  // Settings › About › Check for updates automatically. On unless turned
  // off; off, nothing is asked of GitHub until Check for Updates is pressed.
  // The key keeps its old name (it was "when Vex starts") so a saved choice
  // still holds.
  ON_START_KEY: 'vex.updateCheckOnStart',

  // Vex is often left open for days: the owner's copy sat on 2.36.4 while
  // 2.37.0, 2.38.0 and 2.38.1 shipped, because the only automatic check ran
  // at start (found 2026-10-09). So it is asked again every six hours.
  EVERY_MS: 6 * 3600 * 1000,
  JOB_NAME: 'Update check',

  init() {
    if (window.VexTabPolicy?.isPrivateWindow) return;
    window.vex.updates?.onProgress?.((p) => this._progress(p));
    window.vex.updates?.onInstallFailed?.((p) => this._fail((p && p.error) || 'Vex did not close to install the update.'));
    // On the shared job timer as a 'ui' job: held while Vex is hidden or a
    // game is running, then run once when Vex is back on screen, so the cover
    // never comes up where nobody sees it. Registered whatever the switch
    // says; each run reads it, so turning it on or off applies at once.
    if (typeof VexJobs === 'undefined') window.VexProblems?.note('Updates', 'The update check while Vex stays open could not start: the job timer is not loaded', new Error('VexJobs is missing'));
    else VexJobs.every(this.JOB_NAME, this.EVERY_MS, () => this.checkWhileOpen());
    if (!this.checksOnStart()) return;
    // A few seconds after launch, so the window and its tabs are up first.
    setTimeout(() => this.checkOnStartup(), 4000);
  },

  checksOnStart() { return localStorage.getItem(this.ON_START_KEY) !== 'off'; },
  setChecksOnStart(on) { localStorage.setItem(this.ON_START_KEY, on ? 'on' : 'off'); },

  snoozedUntil() { const n = Number(localStorage.getItem(this.SNOOZE_KEY)); return Number.isFinite(n) ? n : 0; },
  skippedVersion() { return localStorage.getItem(this.SKIP_KEY) || ''; },
  channel() { try { return localStorage.getItem(this.CHANNEL_KEY) === 'stable' ? 'stable' : 'latest'; } catch { return 'latest'; } },
  setChannel(c) { localStorage.setItem(this.CHANNEL_KEY, c === 'stable' ? 'stable' : 'latest'); },

  cmpVersion(a, b) {
    const pa = String(a).split(/[.\-+]/).map(n => parseInt(n, 10) || 0);
    const pb = String(b).split(/[.\-+]/).map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  },

  // Should the cover come up by itself for this check result?
  shouldAnnounce(info, now = Date.now()) {
    if (!info || !info.ok || !info.hasUpdate) return false;
    if (this.channel() === 'stable' && info.releasedAt && now - info.releasedAt < this.STABLE_MS) return false;
    const skipped = this.skippedVersion();
    if (skipped && info.latest && this.cmpVersion(info.latest, skipped) <= 0) return false;
    if (now < this.snoozedUntil()) return false;
    return true;
  },

  _remember(key, value) {
    try { localStorage.setItem(key, String(value)); return true; }
    catch (err) { VexProblems?.note('Updates', 'Could not remember the update choice', err); return false; }
  },

  async checkOnStartup() {
    let r;
    try { r = await window.vex.checkForUpdates(); }
    catch (err) { VexProblems?.note('Updates', 'Could not check for updates', err); return; }
    if (this.shouldAnnounce(r)) this.showCover(r);
  },

  // The six-hourly check. Same rules as the one at start (channel, skipped
  // version, roll-back pause), and it leaves a cover that is already up
  // alone: one asking, downloading or installing stays exactly as it is.
  async checkWhileOpen() {
    if (window.VexTabPolicy?.isPrivateWindow || !this.checksOnStart() || this._el) return;
    let r;
    try { r = await window.vex.checkForUpdates(); }
    catch (err) { VexProblems?.note('Updates', 'Could not check for updates', err); return; }
    // A cover opened from Settings while the check was out wins.
    if (this._el) return;
    if (this.shouldAnnounce(r)) this.showCover(r);
  },

  // Settings › About. Asked for, so the channel and a skipped version do not
  // hold it back.
  async checkManually() {
    if (window.VexTabPolicy?.isPrivateWindow) {
      window.showToast?.('Updates are installed from the main Vex window', 'info', 4000);
      return null;
    }
    let result;
    try { result = await window.vex.checkForUpdates(); }
    catch (err) { result = { ok: false, error: err.message }; }
    if (result?.ok && result.hasUpdate) this.showCover(result);
    else if (result?.ok) window.showToast?.('You\'re running the latest version');
    else window.showToast?.('Couldn\'t check for updates: ' + (result?.error || 'network error'), 'error', 5000);
    return result;
  },

  // ---- the cover -----------------------------------------------------------

  _el: null,
  _keyHandler: null,
  _focusHandler: null,
  _info: null,
  _phase: null,
  _returnFocus: null,

  showCover(info) {
    // Already downloading or installing: that cover stays as it is.
    if (this._el && this._phase !== 'choose' && this._phase !== 'error') return this._el;
    this.close();
    this._info = info;
    this._returnFocus = document.activeElement;
    const icon = (name, size) => (window.VexIcons ? VexIcons.svg(name, { size }) : '');
    const el = document.createElement('div');
    el.id = 'update-cover';
    el.className = 'update-cover';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'update-cover-title');
    el.setAttribute('aria-describedby', 'update-cover-sub');
    el.innerHTML = `
      <div class="update-cover-panel">
        <div class="update-cover-head">
          <div class="update-cover-icon" aria-hidden="true">${icon('download', 28)}</div>
          <div class="update-cover-heading">
            <h1 class="update-cover-title" id="update-cover-title"></h1>
            <p class="update-cover-sub" id="update-cover-sub"></p>
          </div>
        </div>
        <section class="update-cover-notes" aria-labelledby="update-cover-notes-title">
          <div class="update-cover-notes-head">
            <h2 class="update-cover-notes-title" id="update-cover-notes-title">What's new</h2>
            <button type="button" class="update-cover-link" data-act="page">${icon('globe', 14)}<span>Release page</span></button>
          </div>
          <div class="update-cover-notes-body" tabindex="0" aria-label="Release notes"><p class="update-cover-muted">Loading the release notes…</p></div>
        </section>
        <div class="update-cover-status" role="status" aria-live="polite">
          <div class="update-cover-bar" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><div class="update-cover-fill"></div></div>
          <p class="update-cover-status-text"></p>
        </div>
        <div class="update-cover-actions"></div>
      </div>`;
    el.querySelector('.update-cover-title').textContent = `Vex ${info.latest} is available`;
    el.querySelector('.update-cover-sub').textContent = `You have ${info.current}` + (info.size ? ` · download ${this._mb(info.size)}` : '');
    el.querySelector('[data-act="page"]').addEventListener('click', () => {
      const url = info.releaseUrl || info.url;
      if (/^https:\/\//i.test(String(url || ''))) window.vex.openExternal?.(url);
    });
    // On the window, in the capture phase: ahead of every document-level
    // shortcut handler Vex has, so none of them acts behind the cover.
    this._keyHandler = (e) => this._onKey(e);
    window.addEventListener('keydown', this._keyHandler, true);
    // Focus that lands behind the cover (Vex's own start-up code focuses
    // the toolbar, a page may focus itself) comes back to it.
    this._focusHandler = (e) => {
      if (!this._el || !(e.target instanceof Element)) return;
      if (this._el.contains(e.target) || e.target.closest('.vex-dialog-overlay')) return;
      (this._el.querySelector('.update-cover-actions button') || this._el.querySelector('.update-cover-notes-body')).focus();
    };
    window.addEventListener('focusin', this._focusHandler, true);
    this._el = el;
    document.body.appendChild(el);
    document.body.classList.add('update-cover-open');
    this._setPhase('choose');
    this._loadNotes(info);
    return el;
  },

  close() {
    const el = this._el || document.getElementById('update-cover');
    if (!el) return;
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler, true);
    if (this._focusHandler) window.removeEventListener('focusin', this._focusHandler, true);
    this._keyHandler = null; this._focusHandler = null;
    el.remove();
    document.body.classList.remove('update-cover-open');
    this._el = null; this._phase = null; this._info = null;
    const back = this._returnFocus;
    this._returnFocus = null;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus();
  },

  async _loadNotes(info) {
    const body = this._el?.querySelector('.update-cover-notes-body');
    if (!body) return;
    let r;
    try { r = await window.vex.updates.upcomingNotes(info.latest); }
    catch (err) { r = { ok: false, error: err.message }; }
    if (!this._el || this._info !== info) return;
    body.textContent = '';
    if (!r?.ok || !r.entries?.length) {
      const p = document.createElement('p');
      p.className = 'update-cover-muted';
      p.textContent = r?.ok ? 'This release has no notes. The release page has the details.' : 'The release notes could not be loaded (' + (r?.error || 'unknown error') + '). The release page has them.';
      body.appendChild(p);
      return;
    }
    for (const entry of r.entries) {
      if (r.entries.length > 1) {
        const h = document.createElement('h3');
        h.className = 'update-cover-version';
        h.textContent = entry.name || entry.version;
        body.appendChild(h);
      }
      body.appendChild(this.renderNotes(entry.body));
    }
  },

  // Release notes are text from the network: a small Markdown subset
  // (headings, list items, paragraphs, **bold**, `code`, [text](link) shown
  // as its text) built as DOM nodes with textContent. Nothing in them is ever
  // parsed as HTML.
  renderNotes(md) {
    const frag = document.createDocumentFragment();
    const inline = (parent, text) => {
      const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)\s]+\)/g;
      let last = 0, m;
      while ((m = re.exec(text))) {
        if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
        let node;
        if (m[1] != null) { node = document.createElement('strong'); node.textContent = m[1]; }
        else if (m[2] != null) { node = document.createElement('code'); node.textContent = m[2]; }
        else node = document.createTextNode(m[3]);
        parent.appendChild(node);
        last = re.lastIndex;
      }
      if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
      return parent;
    };
    let list = null;
    for (const raw of String(md || '').replace(/\r/g, '').split('\n')) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { list = null; continue; }
      if ((m = line.match(/^#{1,6}\s+(.*)$/))) { list = null; frag.appendChild(inline(document.createElement('h4'), m[1])); }
      else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
        if (!list) { list = document.createElement('ul'); frag.appendChild(list); }
        list.appendChild(inline(document.createElement('li'), m[1]));
      } else { list = null; frag.appendChild(inline(document.createElement('p'), line.trim())); }
    }
    return frag;
  },

  _button(label, act, kind) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'update-cover-btn' + (kind ? ' ' + kind : '');
    b.dataset.act = act;
    b.textContent = label;
    b.addEventListener('click', () => this._act(act));
    return b;
  },

  // choose | downloading | verifying | backing-up | backup-failed | installing | error
  _setPhase(phase, message) {
    const el = this._el;
    if (!el) return;
    this._phase = phase;
    el.dataset.phase = phase;
    const actions = el.querySelector('.update-cover-actions');
    const bar = el.querySelector('.update-cover-bar');
    const text = el.querySelector('.update-cover-status-text');
    const status = el.querySelector('.update-cover-status');
    actions.textContent = '';
    const bad = phase === 'error' || phase === 'backup-failed';
    status.classList.toggle('is-error', bad);
    status.setAttribute('role', bad ? 'alert' : 'status');
    bar.hidden = !(phase === 'downloading' || phase === 'verifying');
    bar.classList.toggle('is-busy', phase === 'verifying');
    text.textContent = message || '';
    if (phase === 'choose' || phase === 'error') {
      actions.append(
        this._button(phase === 'error' ? 'Try again' : 'Update now', 'update', 'primary'),
        this._button('Later', 'later'),
        this._button('Skip this version', 'skip', 'quiet'));
    } else if (phase === 'downloading') {
      actions.append(this._button('Cancel', 'cancel'));
    } else if (phase === 'backup-failed') {
      // Cancel has the focus: installing without a backup is a choice made
      // on purpose, not by pressing Enter.
      actions.append(this._button('Install anyway', 'install-anyway'), this._button('Cancel', 'backup-cancel', 'primary'));
      actions.querySelector('[data-act="backup-cancel"]').focus();
      return;
    }
    const first = actions.querySelector('button');
    if (first) first.focus();
    else el.querySelector('.update-cover-notes-body')?.focus();
  },

  async _act(act) {
    const info = this._info;
    if (!info) return;
    if (act === 'later') { this.close(); return; }
    if (act === 'skip') {
      const saved = this._remember(this.SKIP_KEY, info.latest || '');
      this.close();
      if (saved) window.showToast?.(`Vex ${info.latest} will not be offered again. Settings › About › Check for Updates still finds it.`, 'info', 6000);
      return;
    }
    if (act === 'cancel') {
      try { await window.vex.updates.cancel(); }
      catch (err) { this._fail('The download could not be cancelled: ' + err.message); }
      return;
    }
    if (act === 'update') await this._update(info);
    if (act === 'install-anyway') await this._install(info, false);
    if (act === 'backup-cancel') this._setPhase('choose', 'The update was not installed.');
  },

  async _update(info) {
    this._setPhase('downloading', `Downloading Vex ${info.latest}…`);
    let r;
    try { r = await window.vex.updates.download(info.latest); }
    catch (err) { r = { ok: false, error: err.message }; }
    if (this._info !== info) return;
    if (!r?.ok) {
      if (r?.code === 'cancelled') { this._setPhase('choose', 'Download cancelled.'); return; }
      this._fail(r?.error || 'The update could not be downloaded.');
      return;
    }
    if (!(await this._backup(info))) return;
    await this._install(info, true);
  },

  // Before Vex closes to install: the same backup Settings › Backup saves
  // (js/backup.js), kept in userData/backups by Vex itself (newest three) and
  // listed in Settings › Backup with a Restore button. If it cannot be made,
  // nothing installs until the person chooses.
  async _backup(info) {
    this._setPhase('backing-up', 'Backing up your data…');
    let error = null;
    try {
      if (!window.VexBackup || typeof window.VexBackup.snapshot !== 'function') throw new Error('the backup feature is not loaded');
      const data = await window.VexBackup.snapshot([]);
      const r = await window.vex.updates.saveBackup(info.latest, JSON.stringify(data, null, 2));
      if (!r?.ok) throw new Error(r?.error || 'unknown error');
    } catch (err) { error = (err && err.message) || String(err); }
    if (this._info !== info) return false;
    if (error == null) return true;
    this._setPhase('backup-failed', `Vex could not back up your data (${error.replace(/\.$/, '')}), so it has not installed the update. Install anyway, or cancel and try again later.`);
    return false;
  },

  async _install(info, backedUp) {
    this._setPhase('installing', 'Closing Vex to install the update. Your tabs are saved, and Vex opens again by itself when it is done.'
      + (backedUp ? ' Your data was backed up first: Settings › Backup lists it.' : ''));
    // vex.lastSeenVersion is left as it is: on the new version, the short
    // "What's new" card (update-log.js) names the highlights once the
    // features are there to try. It used to be set here, so an update from
    // this cover never showed anything afterwards.
    let done;
    try { done = await window.vex.updates.install(info.latest); }
    catch (err) { done = { ok: false, error: err.message }; }
    if (!done?.ok) {
      if (this._info === info) this._fail(done?.error || 'The update could not be installed.');
    }
  },

  _fail(message) {
    if (!this._el) { window.showToast?.('Update failed: ' + message, 'error', 8000); return; }
    this._setPhase('error', message);
  },

  _progress(p) {
    if (!this._el || !(this._phase === 'downloading' || this._phase === 'verifying')) return;
    const pct = Math.max(0, Math.min(100, Math.round(Number(p && p.percent) || 0)));
    const bar = this._el.querySelector('.update-cover-bar');
    bar.setAttribute('aria-valuenow', String(pct));
    bar.querySelector('.update-cover-fill').style.width = pct + '%';
    if (p && p.verifying) { this._setPhase('verifying', 'Checking the download against the release\'s checksum…'); return; }
    // A smaller download that did not check out goes on as the whole
    // installer: back to downloading, with Cancel.
    if (this._phase === 'verifying') this._setPhase('downloading', '');
    const text = this._el.querySelector('.update-cover-status-text');
    // A smaller download: only the changed part comes over the network.
    if (p && p.reused) text.textContent = `Downloading ${this._mb(p.total)} of ${this._mb(p.full)} (the rest is reused)… ${pct}%`;
    else text.textContent = `Downloading Vex ${this._info.latest}… ${pct}%` + (p && p.total ? ` (${this._mb(p.received)} of ${this._mb(p.total)})` : '');
  },

  _mb(n) {
    const v = Number(n) || 0;
    if (v < 1024 * 1024) return Math.max(1, Math.round(v / 1024)) + ' KB';
    return (v / (1024 * 1024)).toFixed(v < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
  },

  // Focus stays in the cover; Enter is the main choice, Escape is Later (or
  // Cancel while downloading). Keys do not reach Vex's own shortcuts behind it.
  _onKey(e) {
    if (!this._el) return;
    // A Vex dialog opened above the cover (vexConfirm) handles its own keys.
    if (e.target instanceof Element && e.target.closest('.vex-dialog-overlay')) return;
    if (e.key === 'Tab') {
      const items = [...this._el.querySelectorAll('button, [tabindex="0"]')].filter(x => !x.disabled && x.getClientRects().length);
      if (!items.length) { e.preventDefault(); return; }
      const i = items.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === -1 || i === items.length - 1 ? 0 : i + 1);
      e.preventDefault();
      items[next].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (this._phase === 'choose' || this._phase === 'error') this._act('later');
      else if (this._phase === 'downloading') this._act('cancel');
      else if (this._phase === 'backup-failed') this._act('backup-cancel');
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      if (this._phase === 'choose' || this._phase === 'error') this._act('update');
    }
    e.stopPropagation();
  },
};

// Exported the same way every other renderer module is, so the update flow can
// be exercised from tests instead of only existing as a script-scoped const.
if (typeof window !== 'undefined') window.UpdateNotifier = UpdateNotifier;
if (typeof module !== 'undefined' && module.exports) module.exports = { UpdateNotifier };
