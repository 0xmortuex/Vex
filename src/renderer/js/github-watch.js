// === "Tell me when the build finishes" — GitHub runs and releases ==========
//
// Waiting on a GitHub Actions run means leaving its tab open and looking back
// at it every few minutes; waiting on someone's release means checking the
// releases page. A page watch cannot do either well: the run page changes on
// every log line, and a release page's text changes with every edit.
//
// This asks GitHub's API instead, which says exactly the thing wanted:
//   a run      — its status; told once it is completed, with how it ended,
//                and then the watch ends by itself.
//   releases   — the latest release's tag; told when there is a new one.
// Public repositories only: Vex has no GitHub sign-in, and says so when a
// repository cannot be seen. Unsigned, GitHub allows 60 requests an hour, so
// runs are checked every two minutes and releases every half hour.
const GitHubWatch = {
  KEY: 'vex.githubWatches',
  API: 'https://api.github.com',
  EVERY: { run: 2 * 60000, release: 30 * 60000 },

  // github.com/<owner>/<repo>/actions/runs/<id>[/job/…] → a run;
  // github.com/<owner>/<repo>/releases[/…] or the repository itself → releases.
  parse(url) {
    let u;
    try { u = new URL(String(url || '')); } catch { return null; }
    if (u.hostname !== 'github.com') return null;
    const [owner, repo, ...rest] = u.pathname.split('/').filter(Boolean);
    if (!owner || !repo) return null;
    if (rest[0] === 'actions' && rest[1] === 'runs' && /^\d+$/.test(rest[2] || '')) return { kind: 'run', owner, repo, id: rest[2] };
    if (!rest.length || rest[0] === 'releases' || rest[0] === 'tags') return { kind: 'release', owner, repo };
    return null;
  },

  list() { try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  _save(list) { localStorage.setItem(this.KEY, JSON.stringify(list)); },

  add(url) {
    const p = this.parse(url);
    if (!p) throw new Error('Open a GitHub Actions run, or a repository or its releases page');
    const list = this.list();
    const key = p.kind === 'run' ? `${p.owner}/${p.repo}#${p.id}` : `${p.owner}/${p.repo}`;
    if (list.some(w => w.key === key && w.kind === p.kind)) throw new Error('That is already being watched');
    const watch = { id: vexId('gh'), key, ...p, url: String(url), addedAt: Date.now(), lastCheckedAt: 0, last: null, error: null };
    list.push(watch);
    this._save(list);
    return watch;
  },

  remove(id) { this._save(this.list().filter(w => w.id !== id)); },

  describe(w) {
    return w.kind === 'run' ? `run ${w.id} of ${w.owner}/${w.repo}` : `releases of ${w.owner}/${w.repo}`;
  },

  async _get(path) {
    const r = await (window.VexNet?.fetch || fetch)(this.API + path, { headers: { Accept: 'application/vnd.github+json' } });
    if (r.status === 404) throw new Error('GitHub cannot show it — private repositories are not visible to Vex');
    if (r.status === 403 || r.status === 429) throw new Error('GitHub asked Vex to slow down; it will try again later');
    if (!r.ok) throw new Error('GitHub answered ' + r.status);
    return r.json();
  },

  // One look. → { told: string|null, done: boolean }
  async checkOne(w) {
    if (w.kind === 'run') {
      const run = await this._get(`/repos/${w.owner}/${w.repo}/actions/runs/${w.id}`);
      if (run.status !== 'completed') return { told: null, done: false, last: run.status };
      const how = { success: 'passed', failure: 'failed', cancelled: 'was cancelled', timed_out: 'timed out', skipped: 'was skipped' }[run.conclusion] || 'finished (' + run.conclusion + ')';
      return { told: `${run.name || 'The run'} ${how} — ${w.owner}/${w.repo}${run.display_title ? ': ' + run.display_title : ''}`, done: true, last: run.conclusion, url: run.html_url };
    }
    const rel = await this._get(`/repos/${w.owner}/${w.repo}/releases/latest`);
    const tag = rel.tag_name;
    // The first look is the baseline, not news.
    if (w.last == null || w.last === tag) return { told: null, done: false, last: tag };
    return { told: `New release of ${w.owner}/${w.repo}: ${rel.name || tag}`, done: false, last: tag, url: rel.html_url };
  },

  async checkDue(now = Date.now()) {
    const out = [];
    for (const w of this.list()) {
      if (now - (w.lastCheckedAt || 0) < this.EVERY[w.kind]) continue;
      let r;
      try { r = await this.checkOne(w); }
      catch (err) { this._update(w.id, { lastCheckedAt: now, error: err.message }); out.push({ id: w.id, error: err.message }); continue; }
      if (r.done) this.remove(w.id);
      else this._update(w.id, { lastCheckedAt: now, last: r.last, error: null });
      if (r.told) this.announce(r.told, r.url);
      out.push({ id: w.id, ...r });
    }
    return out;
  },

  _update(id, patch) { this._save(this.list().map(w => (w.id === id ? { ...w, ...patch } : w))); },

  announce(text, url) {
    window.showToast?.(text, 'info', 10000);
    if (typeof window.vex?.notify === 'function') {
      window.vex.notify('Vex — GitHub', text).catch(err => window.VexProblems?.note('GitHub watch', 'Could not show the desktop notification', err));
    }
    document.dispatchEvent(new CustomEvent('vex:github-watch', { detail: { text, url } }));
  },

  start() {
    if (this._job) return;
    this._job = VexJobs.every('GitHub watches', 60000, () => this.checkDue(), { when: 'background' });
  },
};

if (typeof window !== 'undefined') window.GitHubWatch = GitHubWatch;
if (typeof module !== 'undefined' && module.exports) module.exports = { GitHubWatch };
