// === GitHub Panel ===

const GitHubPanel = {
  // Configurable — set in Settings (localStorage 'vex.githubUsername'). Empty
  // by default so a fresh install shows a setup hint instead of anyone's profile.
  username: '',
  cache: { profile: null, repos: null, timestamp: 0 },
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes

  // Standard GitHub language colors
  langColors: {
    'JavaScript': '#f1e05a', 'TypeScript': '#3178c6', 'Python': '#3572A5',
    'HTML': '#e34c26', 'CSS': '#563d7c', 'Rust': '#dea584',
    'Go': '#00ADD8', 'Java': '#b07219', 'C++': '#f34b7d',
    'C': '#555555', 'C#': '#178600', 'Ruby': '#701516',
    'Shell': '#89e051', 'Lua': '#000080', 'Vue': '#41b883',
    'SCSS': '#c6538c', 'Svelte': '#ff3e00', 'Dart': '#00B4AB'
  },

  async init() {
    try { this.username = (localStorage.getItem('vex.githubUsername') || '').trim(); } catch { this.username = ''; }
    // Re-render each open so a username set in Settings takes effect without restart.
    const panelEl = document.getElementById('panel-github');
    if (panelEl) panelEl.dataset.rendered = '';
    this.render();
    if (this.username) await this.loadData();
  },

  render() {
    const panel = document.getElementById('panel-github');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = 'true';

    // No username configured yet — show a setup hint instead of a profile.
    if (!this.username) {
      panel.innerHTML = `
        <div class="panel-content">
          <div class="panel-section">
            <div class="panel-section-title">GitHub</div>
            <div class="panel-placeholder">
              <p>Set your GitHub username in Settings to see your profile, repositories, and activity here.</p>
              <button class="panel-btn" id="gh-open-settings">Open Settings</button>
            </div>
          </div>
        </div>
      `;
      panel.querySelector('#gh-open-settings')?.addEventListener('click', () => {
        SidebarManager.openPanel('settings');
      });
      return;
    }

    panel.innerHTML = `
      <div class="panel-content">
        <div id="gh-panel-profile">
          <div class="gh-profile">
            <img class="gh-avatar" id="gh-panel-avatar" src="" alt="" style="display:none">
            <div class="gh-profile-info">
              <h3 id="gh-panel-name">Loading...</h3>
              <div class="gh-username" id="gh-panel-username">@${this._escapeHtml(this.username)}</div>
              <div class="gh-bio" id="gh-panel-bio"></div>
              <div class="gh-stats-row" id="gh-panel-stats"></div>
            </div>
          </div>
        </div>

        <div class="panel-section">
          <div class="panel-section-title">Recent Repositories</div>
          <div class="panel-list" id="gh-panel-repos">
            <div class="panel-placeholder"><p>Loading repositories...</p></div>
          </div>
          <div style="margin-top: 12px; text-align: center;">
            <button class="panel-btn" id="gh-see-all" style="display:none">See All Repos</button>
          </div>
        </div>

        <div class="panel-section">
          <div class="panel-section-title">Your open pull requests and issues</div>
          <div class="panel-list" id="gh-panel-work">
            <div class="panel-placeholder"><p>Loading...</p></div>
          </div>
          <div style="margin-top: 12px; text-align: center;">
            <button class="panel-btn" id="gh-open-profile">Open Profile</button>
          </div>
        </div>
      </div>
    `;

    panel.querySelector('#gh-see-all').addEventListener('click', () => {
      SidebarManager.hideActivePanel();
      TabManager.createTab(`https://github.com/${this.username}?tab=repositories`, true);
    });
    panel.querySelector('#gh-open-profile').addEventListener('click', () => {
      SidebarManager.hideActivePanel();
      TabManager.createTab(`https://github.com/${this.username}`, true);
    });
  },

  isCacheValid() {
    return this.cache.timestamp && (Date.now() - this.cache.timestamp < this.CACHE_TTL);
  },

  async loadData() {
    // Try localStorage cache first
    try {
      const cached = localStorage.getItem('vex-github-cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < this.CACHE_TTL) {
          this.cache = parsed;
          this.renderProfile(parsed.profile);
          this.renderRepos(parsed.repos, parsed.ci || {});
          this.renderWork(parsed.work || null, parsed.workError || null);
          return;
        }
      }
    } catch {}

    try {
      const [profileRes, reposRes] = await Promise.all([
        (window.VexNet?.fetch || fetch)(`https://api.github.com/users/${this.username}`),
        (window.VexNet?.fetch || fetch)(`https://api.github.com/users/${this.username}/repos?sort=updated&per_page=10`)
      ]);

      if (profileRes.ok && reposRes.ok) {
        const profile = await profileRes.json();
        const repos = await reposRes.json();
        const [work, ci] = await Promise.all([this._work(), this._ci(repos)]);

        this.cache = { profile, repos, ci, work: work.items, workError: work.error, timestamp: Date.now() };
        try { localStorage.setItem('vex-github-cache', JSON.stringify(this.cache)); } catch {}

        this.renderProfile(profile);
        this.renderRepos(repos, ci);
        this.renderWork(work.items, work.error);
      } else {
        const why = profileRes.status === 404 ? 'GitHub has no user called "' + this.username + '"' : profileRes.status === 403 ? 'GitHub asked Vex to slow down — try again in a while' : 'GitHub answered ' + profileRes.status;
        this.renderWork(null, why);
      }
    } catch (e) {
      console.error('GitHub API error:', e);
    }
  },

  // Open pull requests and issues you wrote, anywhere on GitHub (public only:
  // Vex has no GitHub sign-in). → { items, error }
  async _work() {
    try {
      const r = await (window.VexNet?.fetch || fetch)('https://api.github.com/search/issues?q=' + encodeURIComponent('author:' + this.username + ' is:open') + '&sort=updated&per_page=15');
      if (!r.ok) return { items: null, error: 'GitHub answered ' + r.status };
      const j = await r.json();
      return { items: (j.items || []).map(i => ({ pr: !!i.pull_request, title: i.title, url: i.html_url, repo: String(i.repository_url || '').split('/').slice(-2).join('/'), updated: i.updated_at })), error: null };
    } catch (err) { return { items: null, error: (err && err.message) || 'could not be reached' }; }
  },

  // The last CI run of the five repositories changed most recently.
  // → { 'owner/repo': 'success' | 'failure' | 'running' | … }
  async _ci(repos) {
    const out = {};
    const recent = [...repos].sort((a, b) => new Date(b.pushed_at || b.updated_at) - new Date(a.pushed_at || a.updated_at)).slice(0, 5);
    await Promise.all(recent.map(async (repo) => {
      try {
        const r = await (window.VexNet?.fetch || fetch)('https://api.github.com/repos/' + repo.full_name + '/actions/runs?per_page=1');
        if (!r.ok) return;
        const run = ((await r.json()).workflow_runs || [])[0];
        if (run) out[repo.full_name] = run.status === 'completed' ? run.conclusion : 'running';
      } catch (err) { window.VexProblems?.note('GitHub panel', 'Could not read CI for ' + repo.full_name, err); }
    }));
    return out;
  },

  renderWork(items, error) {
    const box = document.getElementById('gh-panel-work');
    if (!box) return;
    if (error) { box.innerHTML = `<div class="panel-placeholder"><p>${this._escapeHtml(error)}</p></div>`; return; }
    if (!items || !items.length) { box.innerHTML = '<div class="panel-placeholder"><p>Nothing open that you wrote.</p></div>'; return; }
    box.innerHTML = '';
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'panel-list-item';
      row.innerHTML = `<div class="panel-list-item-info">
          <div class="panel-list-item-title">${VexIcons.svg(it.pr ? 'git' : 'flag', { size: 12 })} ${this._escapeHtml(it.title)}</div>
          <div class="panel-list-item-meta"><span>${it.pr ? 'Pull request' : 'Issue'} · ${this._escapeHtml(it.repo)}</span><span>${this.timeAgo(new Date(it.updated))}</span></div>
        </div>`;
      row.addEventListener('click', () => { SidebarManager.hideActivePanel(); TabManager.createTab(it.url, true); });
      box.appendChild(row);
    }
  },

  renderProfile(profile) {
    if (!profile) return;

    const avatar = document.getElementById('gh-panel-avatar');
    if (profile.avatar_url) {
      avatar.src = profile.avatar_url;
      avatar.style.display = 'block';
    }

    document.getElementById('gh-panel-name').textContent = profile.name || this.username;
    document.getElementById('gh-panel-username').textContent = `@${profile.login}`;
    document.getElementById('gh-panel-bio').textContent = profile.bio || '';

    const stats = document.getElementById('gh-panel-stats');
    stats.innerHTML = `
      <span class="gh-stat"><strong>${profile.followers || 0}</strong> followers</span>
      <span class="gh-stat"><strong>${profile.following || 0}</strong> following</span>
      <span class="gh-stat"><strong>${profile.public_repos || 0}</strong> repos</span>
    `;
  },

  renderRepos(repos, ci = {}) {
    if (!repos || !repos.length) return;

    const container = document.getElementById('gh-panel-repos');
    container.innerHTML = '';

    // Sort by stars descending for pinned section, then show all
    const sorted = [...repos].sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));

    sorted.forEach(repo => {
      const item = document.createElement('div');
      item.className = 'panel-list-item';

      const langColor = this.langColors[repo.language] || '#6b7482';
      const updated = this.timeAgo(new Date(repo.updated_at));

      item.innerHTML = `
        <div class="panel-list-item-info">
          <div class="panel-list-item-title">${ci[repo.full_name] ? `<span class="gh-ci gh-ci-${this._escapeHtml(ci[repo.full_name])}" title="Last CI run: ${this._escapeHtml(ci[repo.full_name])}"></span>` : ''}${this._escapeHtml(repo.name)}</div>
          ${repo.description ? `<div class="panel-list-item-desc">${this._escapeHtml(repo.description)}</div>` : ''}
          <div class="panel-list-item-meta">
            ${repo.language ? `<span><span class="lang-dot" style="background:${langColor}"></span> ${this._escapeHtml(repo.language)}</span>` : ''}
            ${repo.stargazers_count > 0 ? `<span>${VexIcons.svg('star', { size: 11 })} ${repo.stargazers_count}</span>` : ''}
            ${repo.forks_count > 0 ? `<span>${VexIcons.svg('git', { size: 11 })} ${repo.forks_count}</span>` : ''}
            <span>${updated}</span>
          </div>
        </div>
      `;

      item.addEventListener('click', () => {
        SidebarManager.hideActivePanel();
        TabManager.createTab(repo.html_url, true);
      });

      container.appendChild(item);
    });

    document.getElementById('gh-see-all').style.display = 'inline-flex';
  },

  timeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  },

  _escapeHtml(str) { return window.escapeHtml(str); }
};
