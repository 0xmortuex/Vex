// === Actions board: the last run of every repository you list ================
//
// One table: for each repository, the newest GitHub Actions run on its default
// branch, how old it is, and whether it passed. A row is red only when it is
// CHANGED SINCE YOU LAST LOOKED (a new run that failed), so a repository that has
// been red for a week and that you already know about stops shouting.
// "Mark all seen" is what "looked" means; opening the board does not.
//
// READ-ONLY: it reads through the GitHub token vault (js/github-vault.js, a
// fine-grained read-only token that never leaves the main process) and never
// re-runs, cancels or edits anything. Without a token it reads public repositories
// (60 requests an hour), and says so.
//
// The repositories are the Repository registry's (VexRepos), the developer loop's
// (DevLoopRepos) and a list of its own. Off until switched on.
//
// Not built: the winget-pkgs PR validation labels (they need GitHub's search
// endpoint, which the vault does not allow).
const ActionsBoard = {
  KEY: 'vex.actionsBoard',
  FEATURE: 'actions-board',
  EVERY_MS: 15 * 60000,
  MAX_OWN: 25,
  ...DevDeskUtil.switchFor('vex.actionsBoard.enabled'),

  // ---- pure parts (tested) ----------------------------------------------------------
  parseRepo(input) {
    const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?(?:[/?#].*)?$/.exec(String(input == null ? '' : input).trim());
    if (!m || m[1] === '.' || m[1] === '..' || m[2] === '.' || m[2] === '..') return null;
    return m[1] + '/' + m[2];
  },
  // A run from the Actions API -> the few fields the board keeps.
  summarize(run) {
    if (!run || typeof run !== 'object') throw new Error('GitHub sent a run in a form Vex does not know');
    return {
      id: Number(run.id) || 0,
      status: String(run.status || ''),
      conclusion: String(run.conclusion || ''),
      name: String(run.name || run.display_title || 'workflow').slice(0, 80),
      branch: String(run.head_branch || ''),
      at: Date.parse(run.updated_at || run.created_at || '') || 0,
      url: /^https:\/\/github\.com\//.test(String(run.html_url || '')) ? String(run.html_url) : '',
    };
  },
  // 'running' | 'passed' | 'failed' | 'other'
  verdict(r) {
    if (!r) return 'other';
    if (r.status && r.status !== 'completed') return 'running';
    if (r.conclusion === 'success') return 'passed';
    if (r.conclusion === 'failure' || r.conclusion === 'timed_out' || r.conclusion === 'startup_failure') return 'failed';
    return 'other';
  },
  // Red: a failed run whose id is not the one the owner last marked as seen.
  isRed(repo, run, seen) {
    return this.verdict(run) === 'failed' && !(seen && seen[repo] && seen[repo] === run.id);
  },

  // ---- state ----------------------------------------------------------------------------
  state() {
    const s = DevDeskUtil.read(this.KEY, () => ({ repos: [], seen: {}, rows: {}, branches: {}, at: 0 }));
    for (const k of ['seen', 'rows', 'branches']) if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = {};
    if (!Array.isArray(s.repos)) s.repos = [];
    return s;
  },
  save(s) { DevDeskUtil.write(this.KEY, s); },

  repos() {
    const out = new Set();
    const take = (list) => { for (const e of list) { const p = this.parseRepo(typeof e === 'string' ? e : (e && (e.name || e.full || (e.owner && e.repo ? e.owner + '/' + e.repo : '')))); if (p) out.add(p); } };
    if (typeof VexRepos !== 'undefined') take(VexRepos.list());
    if (typeof DevLoopRepos !== 'undefined') take(DevLoopRepos.list());
    take(this.state().repos);
    return [...out];
  },
  addRepo(input) {
    const p = this.parseRepo(input);
    if (!p) throw new Error('Use owner/repo, or a github.com address');
    const s = this.state();
    if (s.repos.includes(p) || this.repos().includes(p)) throw new Error(p + ' is already on the board');
    if (s.repos.length >= this.MAX_OWN) throw new Error('At most ' + this.MAX_OWN + ' repositories of its own');
    s.repos.push(p);
    this.save(s);
    return p;
  },
  removeRepo(repo) {
    const s = this.state();
    if (!s.repos.includes(repo)) throw new Error(repo + ' is listed by another feature; remove it there');
    s.repos = s.repos.filter(r => r !== repo);
    delete s.rows[repo]; delete s.seen[repo];
    this.save(s);
  },
  markSeen() {
    const s = this.state();
    for (const [repo, run] of Object.entries(s.rows)) if (run && run.id) s.seen[repo] = run.id;
    this.save(s);
  },

  // ---- reading --------------------------------------------------------------------------
  async refresh() {
    if (typeof GitHubVault === 'undefined') throw new Error('The GitHub vault is not loaded (js/github-vault.js)');
    if (!this.enabled()) throw new Error('The Actions board is switched off (Settings > Developer desk)');
    DevDeskUtil.touch(this.FEATURE);
    const s = this.state();
    const errors = {};
    const before = { ...Object.fromEntries(Object.entries(s.rows).map(([r, v]) => [r, v && v.id])) };
    for (const repo of this.repos()) {
      try {
        if (!s.branches[repo]) {
          const info = await GitHubVault.json('/repos/' + repo);
          s.branches[repo] = String(info.default_branch || 'main');
        }
        const q = '?branch=' + encodeURIComponent(s.branches[repo]) + '&per_page=1';
        const data = await GitHubVault.json('/repos/' + repo + '/actions/runs' + q);
        const run = data && Array.isArray(data.workflow_runs) && data.workflow_runs[0];
        s.rows[repo] = run ? this.summarize(run) : null;
        if (run && this.isRed(repo, s.rows[repo], s.seen) && before[repo] !== s.rows[repo].id) this._tell(repo, s.rows[repo]);
      } catch (err) {
        errors[repo] = err.message;
      }
    }
    s.at = Date.now();
    s.errors = errors;
    this.save(s);
    document.dispatchEvent(new CustomEvent('vex:actions-board'));
    return s;
  },
  _tell(repo, run) {
    if (typeof VexAttention === 'undefined') return;
    VexAttention.suggest({ feature: this.FEATURE, label: 'Actions board', id: repo + '#' + run.id, title: repo + ': ' + run.name + ' failed on ' + run.branch, body: 'Open the board to see it. Nothing was re-run.' });
  },

  start() {
    if (this._job || typeof VexJobs === 'undefined') return;
    this._job = VexJobs.every('Actions board', this.EVERY_MS, () => (this.enabled() ? this.refresh() : Promise.resolve()).catch((err) => DevDeskUtil.fail('Actions board', err)), { feature: this.FEATURE });
  },
  stop() { if (this._job) { this._job.stop(); this._job = null; } },
  sync() { if (this.enabled()) this.start(); else this.stop(); },
  // Runs on every route that flips the switch (DevDeskUtil.switchFor).
  followEnabled() { this.sync(); this.registerCommands(); },

  // ---- the board --------------------------------------------------------------------------
  open() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('Settings sections are not available');
    DevDeskUtil.touch(this.FEATURE);
    const { body } = VexSettingsGroups.dialog({ id: 'vex-actions-board', title: 'Actions board', sub: 'The newest run on each repository\'s default branch. Read-only. Red = failed and new since you last marked them seen.' });
    this._body = body;
    this.draw();
  },
  draw() {
    const body = this._body;
    if (!body || !body.isConnected) return;
    body.textContent = '';
    const S = VexSettingsGroups;
    const s = this.state();
    const bar = DevDeskUtil.el('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px';
    bar.append(
      S.button('Refresh', async () => { try { await this.refresh(); this.draw(); } catch (err) { DevDeskUtil.fail('Actions board', err); } }, { primary: true }),
      S.button('Mark all seen', () => { this.markSeen(); this.draw(); }),
    );
    body.appendChild(bar);
    const repos = this.repos();
    if (!repos.length) body.appendChild(S.note('No repositories yet. Add some in Settings > Developer desk, or in the repository registry.'));
    for (const repo of repos) {
      const run = s.rows[repo];
      const verdict = this.verdict(run);
      const red = run && this.isRed(repo, run, s.seen);
      const row = DevDeskUtil.el('div', 'vexsr-rule');
      const text = DevDeskUtil.el('span', 'vexsr-host');
      text.appendChild(DevDeskUtil.el('div', '', repo));
      const line = !run ? (s.errors && s.errors[repo] ? 'Could not read: ' + s.errors[repo] : 'No run yet - press Refresh')
        : verdict + ' - ' + run.name + ' on ' + run.branch + ' - ' + DevDeskUtil.ago(run.at) + (verdict === 'failed' && !red ? ' (already seen)' : '');
      const sub = DevDeskUtil.el('div', 'vexsr-mode', line);
      if (red) sub.style.color = 'var(--danger, #e5484d)';
      text.appendChild(sub);
      row.appendChild(text);
      if (run && run.url) row.appendChild(S.button('Open', () => TabManager.createTab(run.url, true)));
      body.appendChild(row);
    }
    if (s.at) body.appendChild(S.note('Last read ' + DevDeskUtil.ago(s.at) + (typeof GitHubVault !== 'undefined' && GitHubVault.quotaText() ? ' - ' + GitHubVault.quotaText() : '') + '.'));
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('actionsboard:', this.enabled() ? [{
      id: 'actionsboard:open', label: 'Actions board', icon: 'code', hint: 'Last CI run of each of your repositories',
      action: () => { try { this.open(); } catch (err) { DevDeskUtil.fail('Actions board', err); } },
    }] : []);
    return true;
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    const redraw = () => VexSettingsGroup.refresh('setting-dev-desk');
    const fail = (err) => DevDeskUtil.fail('Actions board', err);
    body.appendChild(S.note('Actions board: the last CI run of each listed repository, red only when it changed since you looked. Uses the GitHub read-only token (Settings > GitHub access) or public data without one.'));
    body.appendChild(S.toggle('Actions board', this.enabled(), (on) => { this.setEnabled(on); redraw(); }));
    if (!this.enabled()) return;
    body.appendChild(S.button('Open the board', () => { try { this.open(); } catch (err) { fail(err); } }));
    for (const r of this.state().repos) {
      const row = DevDeskUtil.el('div', 'setting-toggle-row');
      row.append(DevDeskUtil.el('span', '', r), S.button('Remove', () => { try { this.removeRepo(r); redraw(); } catch (err) { fail(err); } }, 'danger'));
      body.appendChild(row);
    }
    body.appendChild(S.button('Add a repository...', () => {
      (async () => {
        const v = await vexPrompt({ title: 'Add a repository to the board', label: 'owner/name, or its github.com address', placeholder: '0xmortuex/vex' });
        if (v == null) return;
        this.addRepo(v);
        redraw();
      })().catch(fail);
    }));
  },
};

if (typeof window !== 'undefined') {
  window.ActionsBoard = ActionsBoard;
  ActionsBoard.sync();
  ActionsBoard.registerCommands();
  document.addEventListener('DOMContentLoaded', () => { ActionsBoard.sync(); ActionsBoard.registerCommands(); });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ActionsBoard };
