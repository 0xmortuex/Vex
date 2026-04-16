// === GitHub Panel ===

const GitHubPanel = {
  username: '0xmortuex',
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
    this.render();
    await this.loadData();
  },

  render() {
    const panel = document.getElementById('panel-github');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = 'true';

    panel.innerHTML = `
      <div class="panel-content">
        <div id="gh-panel-profile">
          <div class="gh-profile">
            <img class="gh-avatar" id="gh-panel-avatar" src="" alt="" style="display:none">
            <div class="gh-profile-info">
              <h3 id="gh-panel-name">Loading...</h3>
              <div class="gh-username" id="gh-panel-username">@${this.username}</div>
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
          <div class="panel-section-title">Contribution Graph</div>
          <div class="panel-placeholder" id="gh-contrib-placeholder">
            <p>Visit your GitHub profile to see contributions</p>
            <button class="panel-btn" id="gh-open-profile">\u{1F419} Open Profile</button>
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
          this.renderRepos(parsed.repos);
          return;
        }
      }
    } catch {}

    try {
      const [profileRes, reposRes] = await Promise.all([
        fetch(`https://api.github.com/users/${this.username}`),
        fetch(`https://api.github.com/users/${this.username}/repos?sort=updated&per_page=10`)
      ]);

      if (profileRes.ok && reposRes.ok) {
        const profile = await profileRes.json();
        const repos = await reposRes.json();

        this.cache = { profile, repos, timestamp: Date.now() };
        try { localStorage.setItem('vex-github-cache', JSON.stringify(this.cache)); } catch {}

        this.renderProfile(profile);
        this.renderRepos(repos);
      }
    } catch (e) {
      console.error('GitHub API error:', e);
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

  renderRepos(repos) {
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
          <div class="panel-list-item-title">${this._escapeHtml(repo.name)}</div>
          ${repo.description ? `<div class="panel-list-item-desc">${this._escapeHtml(repo.description)}</div>` : ''}
          <div class="panel-list-item-meta">
            ${repo.language ? `<span><span class="lang-dot" style="background:${langColor}"></span> ${repo.language}</span>` : ''}
            ${repo.stargazers_count > 0 ? `<span>\u{2B50} ${repo.stargazers_count}</span>` : ''}
            ${repo.forks_count > 0 ? `<span>\u{1F374} ${repo.forks_count}</span>` : ''}
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

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
};
