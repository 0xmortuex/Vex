// === A new build is live: offer to refresh the site's tab (T2-075) =============
//
// After a push, the person waits for GitHub Actions and then reloads their own
// site to see it. GitHub watch (js/github-watch.js) already says when a run
// finishes; with this on, a run that SUCCEEDED for a repo whose deployed site is
// open in a tab also offers "Refresh". Nothing is reloaded without the person
// pressing it (a tab can hold something unsaved), and nothing happens for a run
// that failed.
//
// Which tab belongs to which repo: the person's own list (owner/repo -> hosts,
// edited here) plus the usual hosts a repo is served from: <owner>.github.io,
// a repo named like a domain, and <repo>.vercel.app / .netlify.app / .pages.dev /
// .onrender.com / .up.railway.app. Only tabs already open are offered; sleeping
// tabs reload when they wake and are left alone.
const RefreshOnDeploy = {
  KEYS: { on: 'vex.refreshOnDeploy.enabled', sites: 'vex.refreshOnDeploy.sites' },
  SERVED: ['vercel.app', 'netlify.app', 'pages.dev', 'onrender.com', 'up.railway.app'],
  MAX_REPOS: 50,
  MAX_HOSTS: 10,

  _note(what, err) { window.VexProblems?.note('Refresh on deploy', what, err); },

  enabled() { return localStorage.getItem(this.KEYS.on) === 'on'; },
  setEnabled(on) { localStorage.setItem(this.KEYS.on, on ? 'on' : 'off'); },

  repoKey(owner, repo) {
    const key = String(owner || '').toLowerCase() + '/' + String(repo || '').toLowerCase();
    if (!/^[a-z0-9-_.]+\/[a-z0-9-_.]+$/.test(key)) throw new Error('A repository is written owner/name');
    return key;
  },
  hostOf(url) { try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },
  cleanHost(input) {
    const h = String(input || '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0].replace(/^www\./, '').replace(/:\d+$/, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : '';
  },

  // ---- the person's list ------------------------------------------------------------
  sites() {
    const raw = localStorage.getItem(this.KEYS.sites);
    if (raw === null) return {};
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The sites kept for your repositories could not be read', { cause: err }); }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out = {};
    for (const [k, v] of Object.entries(o)) if (Array.isArray(v)) out[k] = v.filter(h => typeof h === 'string' && h);
    return out;
  },
  setSites(repo, hosts) {
    const [owner, name] = String(repo).split('/');
    const key = this.repoKey(owner, name);
    const clean = [...new Set((hosts || []).map(h => this.cleanHost(h)))];
    if (clean.some(h => !h)) throw new Error('Each site is written like example.com');
    if (clean.length > this.MAX_HOSTS) throw new Error('At most ' + this.MAX_HOSTS + ' sites for one repository');
    const all = this.sites();
    if (!clean.length) delete all[key];
    else {
      if (!(key in all) && Object.keys(all).length >= this.MAX_REPOS) throw new Error('At most ' + this.MAX_REPOS + ' repositories');
      all[key] = clean;
    }
    localStorage.setItem(this.KEYS.sites, JSON.stringify(all));
    return key;
  },

  // Where this repo is served from.
  hostsFor(owner, repo) {
    const key = this.repoKey(owner, repo);
    const o = String(owner).toLowerCase(), r = String(repo).toLowerCase();
    const guess = [o + '.github.io', ...this.SERVED.map(s => r + '.' + s)];
    if (r.includes('.') && r !== o + '.github.io') guess.push(r);
    return { kept: this.sites()[key] || [], guessed: guess };
  },
  matches(host, hosts) { return hosts.some(h => host === h || host.endsWith('.' + h)); },

  // Open tabs that show the repo's site: [{ id, title, url }]
  tabsFor(owner, repo) {
    if (typeof TabManager === 'undefined' || !Array.isArray(TabManager.tabs)) return [];
    const { kept, guessed } = this.hostsFor(owner, repo);
    const all = [...kept, ...guessed];
    const owner_io = String(owner).toLowerCase() + '.github.io';
    const pathOf = (u) => { try { return new URL(u).pathname.toLowerCase(); } catch { return ''; } };
    return TabManager.tabs.filter(t => t && !t.sleeping && /^https?:/i.test(t.url || '') && this.matches(this.hostOf(t.url), all))
      // <owner>.github.io serves every repo of the owner: only the repo's own folder (or a repo named <owner>.github.io) is its site.
      .filter(t => this.hostOf(t.url) !== owner_io || kept.includes(owner_io) || String(repo).toLowerCase() === owner_io || pathOf(t.url).startsWith('/' + String(repo).toLowerCase()))
      .map(t => ({ id: t.id, title: t.title || t.url, url: t.url }));
  },

  // ---- the event ---------------------------------------------------------------------------
  // detail comes from GitHubWatch.announce: { kind, owner, repo, success, ... }.
  onWatch(detail) {
    if (!this.enabled() || !detail || detail.kind !== 'run' || !detail.success) return null;
    const tabs = this.tabsFor(detail.owner, detail.repo);
    if (!tabs.length) return null;
    const key = this.repoKey(detail.owner, detail.repo);
    const title = 'A new build of ' + detail.owner + '/' + detail.repo + ' is live';
    const body = tabs.length === 1 ? 'Refresh ' + (tabs[0].title || tabs[0].url) + '?' : 'Refresh ' + tabs.length + ' open tabs of the site?';
    if (typeof VexAttention === 'undefined') throw new Error('VexAttention is not loaded');
    return VexAttention.notify({ feature: 'refresh-on-deploy', urgency: 'useful', id: key, title, body, action: { label: 'Refresh', key: 'refresh' } },
      () => window.showToast?.(title + '. ' + body, 'info', 12000, { action: { label: 'Refresh', title: 'Reload the tab', run: () => this.refresh(key) } }));
  },

  // Reloads the open tabs of the repo's site. -> how many were reloaded.
  refresh(key) {
    const [owner, repo] = String(key).split('/');
    const tabs = this.tabsFor(owner, repo);
    if (typeof WebviewManager === 'undefined') throw new Error('Pages are not available right now');
    let n = 0;
    for (const t of tabs) {
      const wv = WebviewManager.webviews.get(t.id);
      if (!wv) continue;
      try { wv.reload(); n++; } catch (err) { this._note('Could not reload ' + t.url, err); }
    }
    if (typeof VexLedger !== 'undefined' && n) VexLedger.record({ feature: 'refresh-on-deploy', what: 'Reloaded ' + n + ' tab' + (n === 1 ? '' : 's') + ' of ' + key, why: 'You pressed Refresh after its build succeeded' });
    window.showToast?.(n ? 'Refreshed ' + n + ' tab' + (n === 1 ? '' : 's') : 'That tab is not open any more', n ? 'info' : 'warn');
    return n;
  },

  // ---- Settings ----------------------------------------------------------------------------
  group(section) {
    const el = document.createElement('div');
    section.appendChild(el);
    const mk = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
    const draw = () => {
      el.textContent = '';
      el.appendChild(mk('p', 'setting-info muted', 'When a GitHub watch sees a run succeed and the repository\'s site is open in a tab, Vex offers to refresh it. It never reloads a tab by itself. Add a site here when the repository is not served from github.io, vercel.app, netlify.app, pages.dev, onrender.com or railway.app.'));
      const row = mk('div', 'setting-toggle-row');
      row.appendChild(mk('span', null, 'Offer to refresh after a successful build'));
      const sw = document.createElement('label');
      sw.className = 'toggle';
      sw.innerHTML = '<input type="checkbox" aria-label="Offer to refresh after a successful build"><span class="toggle-slider"></span>';
      const box = sw.querySelector('input');
      box.checked = this.enabled();
      box.addEventListener('change', () => { try { this.setEnabled(box.checked); } catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); } });
      row.appendChild(sw);
      el.appendChild(row);
      let sites = {};
      try { sites = this.sites(); } catch (err) { el.appendChild(mk('p', 'setting-info muted', err.message)); }
      for (const [repo, hosts] of Object.entries(sites)) {
        const line = mk('div', 'setting-toggle-row');
        line.appendChild(mk('span', null, repo + ' → ' + hosts.join(', ')));
        const rm = mk('button', 'btn-secondary', 'Remove'); rm.type = 'button';
        rm.addEventListener('click', () => { try { this.setSites(repo, []); } catch (err) { window.showToast?.(err.message, 'error'); } draw(); });
        line.appendChild(rm);
        el.appendChild(line);
      }
      const add = mk('div', 'setting-toggle-row');
      const repo = mk('input'); repo.type = 'text'; repo.placeholder = 'owner/repository'; repo.className = 'setting-input'; repo.setAttribute('aria-label', 'Repository');
      const host = mk('input'); host.type = 'text'; host.placeholder = 'example.com'; host.className = 'setting-input'; host.setAttribute('aria-label', 'Its site');
      const go = mk('button', 'btn-secondary', 'Add'); go.type = 'button';
      go.addEventListener('click', () => {
        try {
          const key = this.repoKey(...String(repo.value).trim().split('/'));
          this.setSites(key, [...(this.sites()[key] || []), host.value]);
          draw();
        } catch (err) { window.showToast?.(err.message, 'error'); }
      });
      add.append(repo, host, go);
      el.appendChild(add);
    };
    draw();
  },

  init() {
    if (this._wired || typeof document === 'undefined') return false;
    this._wired = true;
    document.addEventListener('vex:github-watch', (e) => {
      try { this.onWatch(e.detail); } catch (err) { this._note('Could not offer a refresh', err); }
    });
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle('refresh-on-deploy', (key, row) => { this.refresh(row.sub); });
    }
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.RefreshOnDeploy = RefreshOnDeploy;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'refresh-on-deploy', title: 'Refresh after a build',
      keywords: 'deploy refresh reload github actions build live site vercel netlify pages',
      before: 'about',
      build: (el) => RefreshOnDeploy.group(el),
    });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => RefreshOnDeploy.init());
    else RefreshOnDeploy.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { RefreshOnDeploy };
