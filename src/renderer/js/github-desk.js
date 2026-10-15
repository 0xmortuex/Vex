// === Pull request and issue desk =============================================
//
// One list of what GitHub is waiting on you for: pull requests you opened,
// pull requests where your review is asked for, and issues assigned to you,
// each with the state of its checks and a button that opens its diff.
//
// It uses what Vex already has for GitHub and nothing more: the username in
// Settings (vex.githubUsername) and GitHub's public API, the same calls the
// GitHub panel makes. Vex has no GitHub sign-in or token, so private
// repositories are not visible, and GitHub allows 60 unsigned requests an
// hour: the checks are read for at most MAX_CI pull requests, and the answer is
// kept for CACHE_MS. When GitHub refuses, the desk says so.
const GitHubDesk = {
  API: 'https://api.github.com',
  CACHE_KEY: 'vex.githubDesk.cache',
  CACHE_MS: 10 * 60000,
  MAX_CI: 6,
  PER_LIST: 10,

  username() { try { return (localStorage.getItem('vex.githubUsername') || '').trim(); } catch { return ''; } },

  async _json(path) {
    const f = this._fetch || (window.VexNet && window.VexNet.fetch) || fetch;
    const r = await f(path.startsWith('http') ? path : this.API + path, { headers: { Accept: 'application/vnd.github+json' } });
    if (r.status === 403 || r.status === 429) throw new Error('GitHub asked Vex to slow down; try again in a while');
    if (r.status === 404) throw new Error('GitHub cannot show that (private repositories are not visible to Vex)');
    if (!r.ok) throw new Error('GitHub answered ' + r.status);
    return r.json();
  },

  // "owner/repo" from a search item.
  repoOf(item) { return String(item.repository_url || '').split('/').slice(-2).join('/'); },

  // A search item as the desk shows it. Pure.
  shape(item, kind) {
    const repo = this.repoOf(item);
    const isPr = !!item.pull_request;
    return {
      kind, repo, number: item.number, title: item.title || '(no title)', author: item.user && item.user.login || '',
      url: item.html_url, diffUrl: isPr ? item.html_url + '/files' : '', updated: item.updated_at || '',
      draft: !!item.draft, ci: null,
    };
  },

  // GitHub's combined status -> a word the desk shows.
  ciWord(state) {
    return { success: 'passing', failure: 'failing', error: 'failing', pending: 'running', unknown: 'checks unknown' }[state] || 'no checks';
  },

  async _checks(entry) {
    const pr = await this._json('/repos/' + entry.repo + '/pulls/' + entry.number);
    const sha = pr && pr.head && pr.head.sha;
    if (!sha) return 'none';
    // The combined status misses GitHub Actions; check-runs covers them.
    const [status, runs] = await Promise.all([
      this._json('/repos/' + entry.repo + '/commits/' + sha + '/status').catch(() => null),
      this._json('/repos/' + entry.repo + '/commits/' + sha + '/check-runs?per_page=30').catch(() => null),
    ]);
    const states = [];
    if (status && status.total_count > 0) states.push(status.state);
    for (const run of (runs && runs.check_runs) || []) {
      if (run.status !== 'completed') states.push('pending');
      else if (['failure', 'timed_out', 'cancelled', 'action_required'].includes(run.conclusion)) states.push('failure');
      else states.push('success');
    }
    if (!states.length) return 'none';
    if (states.includes('failure') || states.includes('error')) return 'failure';
    if (states.includes('pending')) return 'pending';
    return 'success';
  },

  // → { user, at, mine: [], review: [], issues: [], errors: [] }
  async load({ force = false, now = Date.now() } = {}) {
    const user = this.username();
    if (!user) throw new Error('Set your GitHub username in Settings first');
    if (!force) {
      try {
        const c = JSON.parse(localStorage.getItem(this.CACHE_KEY) || 'null');
        if (c && c.user === user && now - c.at < this.CACHE_MS) return c;
      } catch { /* a bad cache is just a miss */ }
    }
    const q = (s) => '/search/issues?per_page=' + this.PER_LIST + '&sort=updated&q=' + encodeURIComponent(s);
    const errors = [];
    const grab = async (label, query, kind) => {
      try { return ((await this._json(q(query))).items || []).map(i => this.shape(i, kind)); }
      catch (err) { errors.push(label + ': ' + err.message); return []; }
    };
    const [mine, review, issues] = await Promise.all([
      grab('Your pull requests', 'author:' + user + ' is:pr is:open', 'mine'),
      grab('Review requests', 'review-requested:' + user + ' is:pr is:open', 'review'),
      grab('Assigned issues', 'assignee:' + user + ' is:issue is:open', 'issue'),
    ]);
    // CI for the pull requests that matter most: yours, then review requests.
    const withCi = [...mine, ...review].slice(0, this.MAX_CI);
    await Promise.all(withCi.map(async (e) => {
      try { e.ci = await this._checks(e); }
      catch (err) { e.ci = 'unknown'; if (!errors.some(x => x.startsWith('Checks'))) errors.push('Checks: ' + err.message); }
    }));
    const out = { user, at: now, mine, review, issues, errors };
    try { localStorage.setItem(this.CACHE_KEY, JSON.stringify(out)); } catch (err) { window.VexProblems?.note('GitHub desk', 'Could not keep the desk for later', err); }
    return out;
  },

  // Failing first, then waiting-on-you, then the rest. Pure.
  attention(desk) {
    const all = [...desk.mine, ...desk.review];
    return {
      failing: all.filter(e => e.ci === 'failure'),
      review: desk.review,
      open: desk.mine.length,
      issues: desk.issues.length,
    };
  },

  _open(url) {
    if (typeof TabManager === 'undefined' || typeof TabManager.createTab !== 'function') throw new Error('Tabs are not loaded');
    TabManager.createTab(url, true);
  },

  // ---- the dialog ---------------------------------------------------------
  async open() {
    document.querySelector('.vex-ghdesk-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-ghdesk-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.4);display:grid;place-items:start center;padding-top:8vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Pull request and issue desk" style="width:min(680px,94vw);max-height:78vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="padding:12px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
          <div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:650;color:var(--text)">Pull requests and issues</div>
          <div data-summary style="font-size:10.5px;color:var(--text-muted)">Asking GitHub...</div></div>
          <button type="button" data-refresh class="btn-secondary" style="display:inline-flex;align-items:center;gap:5px">${VexIcons.svg('refresh', { size: 12 })} Refresh</button>
          <button type="button" data-close class="btn-secondary" aria-label="Close">${VexIcons.svg('x', { size: 12 })}</button>
        </div>
        <div data-body style="overflow-y:auto;padding:6px;flex:1"></div>
        <div style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">Public GitHub data for the username in Settings. Private repositories are not visible to Vex.</div>
      </div>`;
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    overlay.querySelector('[data-close]').addEventListener('click', close);
    const bodyEl = overlay.querySelector('[data-body]');
    const summaryEl = overlay.querySelector('[data-summary]');
    const draw = async (force) => {
      bodyEl.textContent = '';
      summaryEl.textContent = 'Asking GitHub...';
      let desk;
      try { desk = await this.load({ force }); }
      catch (err) {
        summaryEl.textContent = err.message;
        if (/username/.test(err.message) && typeof SettingsUI !== 'undefined') {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'btn-primary'; b.textContent = 'Open Settings';
          b.addEventListener('click', () => { close(); SettingsUI.openSection('setting-github-username'); });
          bodyEl.appendChild(b);
        }
        return;
      }
      if (!overlay.isConnected) return;
      const a = this.attention(desk);
      summaryEl.textContent = a.failing.length + ' failing, ' + a.review.length + ' awaiting your review, ' + a.open + ' of yours open, ' + a.issues + ' issues assigned.' + (desk.errors.length ? ' ' + desk.errors.join('; ') : '');
      const group = (title, list) => {
        if (!list.length) return '';
        return `<div style="padding:8px 9px 2px;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">${esc(title)}</div>` + list.map((e, i) => `
          <div data-row="${esc(e.kind)}:${i}" data-url="${esc(e.url)}" style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:8px">
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.title)}</div>
              <div style="font-size:10.5px;color:var(--text-muted)">${esc(e.repo)} #${esc(e.number)}${e.author ? ' · ' + esc(e.author) : ''}${e.draft ? ' · draft' : ''}</div>
            </div>
            ${e.ci ? `<span data-ci="${esc(e.ci)}" style="font-size:10.5px;color:${e.ci === 'failure' ? 'var(--danger,#e5534b)' : 'var(--text-muted)'}">${esc(this.ciWord(e.ci))}</span>` : ''}
            ${e.diffUrl ? `<button type="button" class="btn-secondary" data-act="diff" style="display:inline-flex;align-items:center;gap:4px">${VexIcons.svg('git', { size: 12 })} Diff</button>` : ''}
            <button type="button" class="btn-secondary" data-act="open" aria-label="Open">${VexIcons.svg('external', { size: 12 })}</button>
            <button type="button" class="btn-secondary" data-act="snooze" aria-label="Snooze">${VexIcons.svg('clock', { size: 12 })}</button>
          </div>`).join('');
      };
      bodyEl.innerHTML = group('Failing checks', a.failing) + group('Review requested', desk.review.filter(e => e.ci !== 'failure'))
        + group('Your pull requests', desk.mine.filter(e => e.ci !== 'failure')) + group('Assigned issues', desk.issues)
        || '<div style="padding:22px;text-align:center;font-size:12.5px;color:var(--text-muted)">Nothing open for you.</div>';
      const byUrl = new Map([...desk.mine, ...desk.review, ...desk.issues].map(e => [e.url, e]));
      bodyEl.querySelectorAll('[data-row]').forEach((row) => {
        const entry = byUrl.get(row.dataset.url);
        if (!entry) return;
        row.querySelector('[data-act="open"]').addEventListener('click', () => { close(); this._open(entry.url); });
        row.querySelector('[data-act="diff"]')?.addEventListener('click', () => { close(); this._open(entry.diffUrl); });
        row.querySelector('[data-act="snooze"]').addEventListener('click', async () => {
          try {
            const at = await VexSnooze.ask('Snooze "' + entry.title.slice(0, 40) + '" until when?');
            if (at == null) return;
            VexSnooze.snoozeLink('page', { title: entry.repo + ' #' + entry.number + ' ' + entry.title, url: entry.url }, at);
            window.showToast?.('Snoozed, it will be in your next brief');
          } catch (err) { window.showToast?.(err.message, 'error'); }
        });
      });
    };
    overlay.querySelector('[data-refresh]').addEventListener('click', () => draw(true));
    await draw(false);
    return overlay;
  },

  section: {
    id: 'github-desk',
    title: 'Pull requests and issues',
    icon: 'git',
    order: 40,
    ttlMs: 10 * 60000,
    maxItems: 6,
    defaultOn: true,
    isEnabled() { return typeof BriefActions === 'undefined' || BriefActions.isOn('github'); },
    async build(ctx = {}) {
      if (!GitHubDesk.username()) return { hint: 'Set your GitHub username in Settings to see your pull requests here.' };
      const desk = await GitHubDesk.load({ force: !!ctx.force, now: ctx.now || Date.now() });
      const a = GitHubDesk.attention(desk);
      const items = [...a.failing, ...desk.review.filter(e => e.ci !== 'failure'), ...desk.mine.filter(e => e.ci !== 'failure')]
        .slice(0, 6)
        .map(e => ({ text: e.title, sub: e.repo + ' #' + e.number, url: e.diffUrl || e.url, badge: e.ci === 'failure' ? 'failing' : e.kind === 'review' ? 'review' : 'open' }));
      return {
        summary: a.failing.length + ' failing, ' + a.review.length + ' awaiting your review, ' + a.open + ' open.',
        items, note: desk.errors.join('; '),
      };
    },
  },
};

if (typeof window !== 'undefined') window.GitHubDesk = GitHubDesk;
if (typeof module !== 'undefined' && module.exports) module.exports = { GitHubDesk };
