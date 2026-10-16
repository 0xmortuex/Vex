// === GitHub page helpers and branch / commit text =============================
//
// On a github.com page, the Page menu (right-click > Page) gets a few rows that put
// text on the clipboard. They only COPY: nothing runs git, nothing is sent, no
// GitHub sign-in or token is used.
//
//   Issue or pull request page:
//     Copy branch name         12-fix-login-crash-on-start
//     Copy git switch command  git switch -c 12-fix-login-crash-on-start
//     Copy commit message      Fix login crash on start (#12)
//   File or folder page:
//     Copy permalink           the address with the commit SHA in place of the branch
//                              name, plus the line range in the address (#L10-L20)
//     Copy local file path     the file's path inside the folder you gave for this
//                              repository (Settings > Developer helpers). It is text
//                              only; the folder is never read or opened.
//   Selected text anywhere:
//     Create GitHub issue from this text   opens github.com/owner/repo/issues/new with the
//                              title and body filled in. You press "Submit" yourself.
//
// The commit SHA is the only thing read from the page. That is done by one FIXED script
// (PAGE_SCRIPT below) run in the page by the window; it takes no input, reads a few
// attributes and returns plain strings, which are checked here (40 hex characters).
// The script's result is never run. Page text is not interpolated into any script.
//
// The branch name of a file page is taken to be one path segment (main, v2); with a slash
// in the branch name use the permalink instead.
//
// Pure functions are tested in tests/renderer/githubHelpers.test.js.
const VexGithubHelpers = {
  ENABLED_KEY: 'vex.githubHelpers.enabled',
  MAX_SLUG: 40,
  MAX_ISSUE_URL: 6000,

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) !== 'false'; }
    catch (err) { console.error('[GithubHelpers] the switch could not be read:', err); return true; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); },

  // The fixed script. No placeholders, no input.
  PAGE_SCRIPT: '(function(){var o={sha:"",hash:String(location.hash||""),title:String(document.title||"")};'
    + 'var re=/\\/(?:blob|tree|commit)\\/([0-9a-f]{40})(?:[\\/?#]|$)/;'
    + 'var a=document.querySelectorAll("a[href]");'
    + 'for(var i=0;i<a.length&&i<4000;i++){var m=re.exec(a[i].getAttribute("href")||"");if(m){o.sha=m[1];break;}}'
    + 'if(!o.sha){var s=document.querySelectorAll("script[data-target=\\"react-app.embeddedData\\"]");'
    + 'for(var j=0;j<s.length;j++){var t=s[j].textContent||"";var n=/"(?:currentOid|commitOid)"\\s*:\\s*"([0-9a-f]{40})"/.exec(t);if(n){o.sha=n[1];break;}}}'
    + 'return o;})()',

  _repos() { return typeof VexRepos !== 'undefined' ? VexRepos : require('./repo-registry.js').VexRepos; },

  // ---- pure --------------------------------------------------------------------------------
  // A github.com address (and the page's title) -> { owner, repo, kind, number, ref, path, title } or null.
  // kind: repo | issue | pull | file | folder | commit | other
  parsePage(url, docTitle) {
    const p = this._repos().parseUrl(url);
    if (!p || p.host !== 'github') return null;
    const out = { owner: p.owner, repo: p.repo, kind: 'other', number: 0, ref: '', path: '', title: '' };
    const sec = p.section, rest = p.rest;
    if (!sec) out.kind = 'repo';
    else if ((sec === 'issues' || sec === 'pull') && /^\d+$/.test(rest[0] || '')) {
      out.kind = sec === 'pull' ? 'pull' : 'issue';
      out.number = Number(rest[0]);
      out.title = this.titleOf(docTitle, out.kind);
    } else if ((sec === 'blob' || sec === 'tree') && rest.length) {
      out.kind = sec === 'blob' ? 'file' : 'folder';
      out.ref = decodeURIComponent(rest[0]);
      out.path = rest.slice(1).map(decodeURIComponent).join('/');
    } else if (sec === 'commit' && /^[0-9a-f]{7,40}$/i.test(rest[0] || '')) { out.kind = 'commit'; out.ref = rest[0]; }
    return out;
  },
  // "Fix login crash · Issue #12 · owner/repo" -> "Fix login crash"; a pull request title also ends "by user".
  titleOf(docTitle, kind) {
    const parts = String(docTitle == null ? '' : docTitle).split(' · ');
    let t = (parts.length >= 2 ? parts[0] : String(docTitle || '')).trim();
    if (kind === 'pull') t = t.replace(/\s+by\s+\S+$/, '');
    return t;
  },
  slug(text, max = this.MAX_SLUG) {
    let s = String(text == null ? '' : text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/\u0131/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (s.length > max) { s = s.slice(0, max); const cut = s.lastIndexOf('-'); if (cut > max * 0.5) s = s.slice(0, cut); s = s.replace(/-+$/, ''); }
    return s;
  },
  branchName({ number, title }) {
    if (!Number.isInteger(number) || number < 1) throw new Error('This is not an issue or pull request page');
    const s = this.slug(title);
    return s ? number + '-' + s : String(number);
  },
  switchCommand(branch) {
    if (!/^[A-Za-z0-9._\/-]{1,100}$/.test(branch) || branch.startsWith('-')) throw new Error('"' + branch + '" is not a branch name that is safe to put in a command');
    return 'git switch -c ' + branch;
  },
  commitMessage({ number, title }) {
    const t = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
    if (!t) throw new Error('The page has no title to build a commit message from');
    return t + ' (#' + number + ')';
  },
  permalink(page, sha, hash) {
    if (page.kind !== 'file' && page.kind !== 'folder') throw new Error('Open a file or folder page first');
    if (!/^[0-9a-f]{40}$/.test(String(sha))) throw new Error('The commit SHA could not be read from this page');
    const line = /^#L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?$/.test(String(hash || '')) ? hash : '';
    const path = page.path.split('/').map(encodeURIComponent).join('/');
    return 'https://github.com/' + page.owner + '/' + page.repo + '/' + (page.kind === 'file' ? 'blob' : 'tree') + '/' + sha + (path ? '/' + path : '') + line;
  },
  // The file's path inside the folder given for the repository. Text only.
  localPath(page, entry) {
    if (page.kind !== 'file' && page.kind !== 'folder') throw new Error('Open a file or folder page first');
    if (!entry || !entry.path) throw new Error(page.owner + '/' + page.repo + ' has no folder yet - add one in Settings > Developer helpers');
    if (page.path.split('/').some(s => s === '..' || s === '.')) throw new Error('That path is not valid');
    return entry.path.replace(/[\\/]+$/, '') + '\\' + page.path.split('/').join('\\');
  },
  newIssueUrl(repoName, title, body, sourceUrl) {
    const m = /^([\w.-]+)\/([\w.-]+)$/.exec(String(repoName));
    if (!m) throw new Error('Write the repository as owner/name');
    const t = String(title == null ? '' : title).replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!t) throw new Error('The issue needs a title');
    let b = String(body == null ? '' : body).trim() + (sourceUrl ? '\n\nSource: ' + sourceUrl : '');
    const build = (text) => { const u = new URL('https://github.com/' + m[1] + '/' + m[2] + '/issues/new'); u.searchParams.set('title', t); if (text) u.searchParams.set('body', text); return u.toString(); };
    let url = build(b);
    while (url.length > this.MAX_ISSUE_URL && b.length > 20) { b = b.slice(0, Math.floor(b.length * 0.8)); url = build(b + '...'); }
    if (url.length > this.MAX_ISSUE_URL) throw new Error('The title is too long to put in an address');
    return url;
  },
  // First line (up to 80 chars) of a selection as the issue title; the rest is the body.
  splitSelection(sel) {
    const lines = String(sel == null ? '' : sel).trim().split(/\r?\n/);
    const first = lines[0].trim();
    if (first.length <= 80) return { title: first, body: lines.slice(1).join('\n').trim() };
    return { title: first.slice(0, 77).replace(/\s+\S*$/, '') + '...', body: String(sel).trim() };
  },

  // ---- acting on the page ---------------------------------------------------------------------------
  _copy: async function (text, what) {
    await navigator.clipboard.writeText(text);
    window.showToast?.('Copied ' + what);
  },
  _fail(err) { window.showToast?.((err && err.message) || 'That did not work', 'error'); },
  async _facts(webview) {
    if (!webview || typeof webview.executeJavaScript !== 'function') throw new Error('This page cannot be read');
    const r = await webview.executeJavaScript(this.PAGE_SCRIPT, true);
    if (!r || typeof r !== 'object') throw new Error('The page did not answer');
    return { sha: /^[0-9a-f]{40}$/.test(String(r.sha)) ? String(r.sha) : '', hash: String(r.hash || '').slice(0, 40), title: String(r.title || '').slice(0, 300) };
  },

  // Rows for the Page submenu of a github.com page. [] elsewhere or when switched off.
  pageItems(webview) {
    if (!this.enabled()) return [];
    let url = '', title = '';
    try { url = webview.getURL(); title = (webview.getTitle && webview.getTitle()) || ''; } catch { return []; }
    const page = this.parsePage(url, title);
    if (!page) return [];
    if (typeof VexUsage !== 'undefined') VexUsage.touch('github-helpers');
    const run = (fn) => () => { Promise.resolve().then(fn).catch((e) => this._fail(e)); };
    const items = [{ sep: true }];
    if (page.kind === 'issue' || page.kind === 'pull') {
      const branch = () => this.branchName(page);
      items.push({ label: 'GitHub: copy branch name', action: run(() => this._copy(branch(), 'the branch name')) });
      items.push({ label: 'GitHub: copy git switch command', action: run(() => this._copy(this.switchCommand(branch()), 'the command (nothing was run)')) });
      items.push({ label: 'GitHub: copy commit message', action: run(() => this._copy(this.commitMessage(page), 'the commit message')) });
    }
    if (page.kind === 'file' || page.kind === 'folder') {
      items.push({
        label: 'GitHub: copy permalink', action: run(async () => {
          let sha = /^[0-9a-f]{40}$/.test(page.ref) ? page.ref : '';
          let hash = '';
          const f = await this._facts(webview);
          hash = f.hash;
          if (!sha) sha = f.sha;
          await this._copy(this.permalink(page, sha, hash), 'the permalink');
        }),
      });
      items.push({ label: 'GitHub: copy local file path', action: run(() => this._copy(this.localPath(page, this._repos().get(page.owner + '/' + page.repo)), 'the local path')) });
    }
    if (!this._repos().get(page.owner + '/' + page.repo)) {
      items.push({ label: 'GitHub: add ' + page.owner + '/' + page.repo + ' to my repositories', action: run(() => { this._repos().add(page.owner + '/' + page.repo); window.showToast?.('Added ' + page.owner + '/' + page.repo); }) });
    }
    return items.length > 1 ? items : [];
  },

  // "Create GitHub issue from this text": one row for a selection.
  issueItem(selection, webview) {
    if (!this.enabled() || !selection || String(selection).trim().length < 3) return [];
    return [{ label: 'Create GitHub issue from this text...', action: () => { this.createIssueFrom(selection, webview).catch((e) => this._fail(e)); } }];
  },
  async createIssueFrom(selection, webview) {
    let url = '';
    try { url = webview.getURL(); } catch { url = ''; }
    const here = this.parsePage(url, '');
    const repos = this._repos().list();
    const start = here ? here.owner + '/' + here.repo : (repos[0] ? repos[0].name : '');
    const repo = await window.vexPrompt({ title: 'Create an issue in which repository?', message: 'Vex opens GitHub\'s "new issue" page with the text filled in. You read it and press Submit yourself.', label: 'owner/name', value: start });
    if (repo == null) return;
    const name = this._repos().normalize(repo);
    const { title, body } = this.splitSelection(selection);
    const target = this.newIssueUrl(name, title, body, /^https?:/i.test(url) ? url : '');
    TabManager.createTab(target, true);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('github-helpers');
  },

  settingsRows(body) {
    body.appendChild(VexSettingsGroup.toggle('GitHub page helpers', this.enabled(), (on) => this.setEnabled(on), 'copy a permalink, branch name or commit message on github.com'));
  },
};

if (typeof window !== 'undefined') window.VexGithubHelpers = VexGithubHelpers;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexGithubHelpers };
