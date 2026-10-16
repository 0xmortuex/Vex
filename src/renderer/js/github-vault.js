// === GitHub read-only token vault: the window's side ========================
//
// The token itself lives in the main process only (src/main/github-vault.js,
// sealed by the operating system). This file never holds it for longer than
// the moment it is typed: vexPrompt({ password: true }) -> one IPC call -> gone.
// It is not kept in localStorage, in a DOM field, in a log or in an error, and
// nothing here (or anywhere in the window) can read it back.
//
//   GitHubVault.get(path)        a read-only GET of an api.github.com endpoint
//                                -> { status, ok, authed, text, capped, quota }
//                                (with the token when there is one, else public)
//   GitHubVault.json(path)       the same, parsed; throws for a status that is not 2xx
//   GitHubVault.status()         { has, savedAt, quota }
//   GitHubVault.enter()/test()/revoke()   the Settings buttons
//
// Off means off: while the feature is switched off (Minimal Vex, or here)
// every call refuses, and the sealed token stays where it is.
const GitHubVault = {
  PREF: 'vex.githubVault.enabled',
  FEATURE: 'github-vault',
  _quota: null,

  enabled() {
    try { return localStorage.getItem(this.PREF) !== 'off'; }
    catch (err) { console.error('[GitHubVault] the switch could not be read:', err.message); return true; }
  },
  setEnabled(on) { localStorage.setItem(this.PREF, on ? 'on' : 'off'); this._changed(); },

  _bridge() {
    const v = typeof window !== 'undefined' ? window.vex : null;
    if (!v || typeof v.githubGet !== 'function' || typeof v.githubStatus !== 'function') throw new Error('The GitHub vault is not available in this build');
    return v;
  },
  _need() {
    if (!this.enabled()) throw new Error('GitHub access is switched off (Settings > GitHub access)');
    return this._bridge();
  },
  _changed() { try { document.dispatchEvent(new CustomEvent('vex:github-vault')); } catch (err) { console.error('[GitHubVault] could not announce a change:', err); } },

  async status() {
    const s = await this._bridge().githubStatus();
    if (s && s.quota) this._quota = s.quota;
    return s;
  },

  async get(path, opts) {
    const v = this._need();
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const r = await v.githubGet(String(path), opts);
    if (r && r.quota) { this._quota = r.quota; this._changed(); }
    return r;
  },

  async json(path, opts) {
    const r = await this.get(path, opts);
    if (r.status === 404) throw new Error('GitHub cannot show that' + (r.authed ? ' (the token may not have access to it)' : ' (a private repository needs the token)'));
    if (r.status === 401) throw new Error('GitHub rejected the token');
    if (r.status === 403 || r.status === 429) throw new Error('GitHub is limiting requests' + (this.quotaText() ? ' (' + this.quotaText() + ')' : ''));
    if (!r.ok) throw new Error('GitHub answered ' + r.status);
    return JSON.parse(r.text);
  },

  quotaText(q = this._quota) {
    if (!q) return '';
    const when = q.resetAt ? ', resets ' + new Date(q.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return q.remaining + ' of ' + q.limit + ' requests left' + when;
  },

  // ---- Settings -------------------------------------------------------------
  async enter() {
    const v = this._bridge();
    const token = await vexPrompt({
      title: 'GitHub token', message: 'Paste a fine-grained personal access token with read-only access (it starts with github_pat_). It is sealed by Windows, kept in the main process, used only for api.github.com and never shown again.',
      label: 'Token', password: true, okLabel: 'Save',
    });
    if (token == null || !String(token).trim()) return false;
    try { await v.githubTokenSet(String(token)); }
    catch (err) { window.showToast?.('Token not saved: ' + err.message, 'error'); throw err; }
    this._changed();
    window.showToast?.('GitHub token saved. Press Test token to check it.');
    return true;
  },

  async test() {
    const r = await this._bridge().githubTokenTest();
    this._quota = r.quota || this._quota;
    this._changed();
    return r;
  },

  async revoke() {
    const ok = await vexConfirm({ title: 'Remove the GitHub token?', message: 'Vex forgets the token on this computer. To make it stop working everywhere, also delete it on github.com (Settings > Developer settings).', okLabel: 'Remove', danger: true });
    if (!ok) return false;
    await this._bridge().githubTokenClear();
    this._quota = null;
    this._changed();
    return true;
  },

  group(el) {
    const S = VexSettingsGroups;
    el.appendChild(S.note('A fine-grained, read-only GitHub token lets the developer features read private repositories and use 5,000 requests an hour instead of 60. It is kept sealed by Windows in the main process and sent only to api.github.com. Off until you enter one.'));
    const line = document.createElement('div');
    line.className = 'vex-platform-note';
    line.setAttribute('role', 'status');
    line.textContent = 'Checking...';
    const detail = document.createElement('div');
    detail.className = 'vex-platform-note';
    detail.setAttribute('role', 'status');
    const draw = async () => {
      try {
        const s = await this.status();
        line.textContent = s.has ? 'A token is saved' + (s.savedAt ? ' (' + new Date(s.savedAt).toLocaleDateString() + ')' : '') + '.' : 'No token. Public data only (60 requests an hour).';
        const q = this.quotaText(s.quota);
        if (q && !detail.dataset.test) detail.textContent = q;
      } catch (err) { line.textContent = 'Could not read the vault: ' + err.message; }
    };
    const row = document.createElement('div');
    row.style.display = 'flex'; row.style.gap = '8px'; row.style.flexWrap = 'wrap';
    const guarded = (fn, errPrefix) => async () => {
      try { await fn(); await draw(); }
      catch (err) { window.showToast?.(errPrefix + err.message, 'error'); }
    };
    row.append(
      S.button('Enter token', guarded(() => this.enter(), 'Could not save: '), { primary: true }),
      S.button('Test token', guarded(async () => {
        const r = await this.test();
        detail.dataset.test = '1';
        detail.textContent = 'Token works (' + r.kind + '). ' + (r.scopes.length ? 'Scopes: ' + r.scopes.join(', ') + '. ' : '') + (r.expires ? 'Expires ' + r.expires + '. ' : '') + (r.quota ? this.quotaText(r.quota) + '. ' : '') + r.note;
      }, 'Test failed: ')),
      S.button('Revoke', guarded(() => this.revoke(), 'Could not remove: '), { danger: true }),
    );
    const sw = document.createElement('label');
    sw.className = 'vex-platform-note';
    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = this.enabled();
    box.addEventListener('change', () => this.setEnabled(box.checked));
    sw.append(box, document.createTextNode(' Use GitHub access (the developer features read GitHub through it)'));
    el.append(line, detail, row, sw);
    draw();
  },
};

if (typeof window !== 'undefined') {
  window.GitHubVault = GitHubVault;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'github-access', title: 'GitHub access',
      keywords: 'github token pat personal access token read-only quota rate limit api private repositories actions',
      before: 'about',
      build: (el) => GitHubVault.group(el),
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { GitHubVault };
