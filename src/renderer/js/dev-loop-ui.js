// === The developer loop: the screen, the Settings section, the commands ======
//
// One full-screen card (the platform tools' look) with a row of sections:
// Repositories, CI failures, Devlog, Endpoints, Dependencies, Deploy desk.
// The logic is in js/dev-loop.js; every action here is read-only.

const DevLoopUI = {
  ID: 'vex-dev-loop',
  SECTIONS: [
    ['repos', 'Repositories'], ['ci', 'CI failures'], ['devlog', 'Devlog'],
    ['endpoints', 'Endpoints'], ['deps', 'Dependencies'], ['deploy', 'Deploy desk'],
  ],
  FEATURE_OF: { repos: 'dev-loop-repos', ci: 'ci-fix-loop', devlog: 'devlog-drafter', endpoints: 'endpoint-board', deps: 'dependency-radar', deploy: 'deploy-desk' },

  _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  },
  _fail(what, err) {
    console.error('[DevLoop] ' + what + ':', err);
    window.showToast?.(what + ': ' + ((err && err.message) || err), 'error');
  },
  // A button whose handler may throw: the failure is shown, never swallowed.
  _btn(text, fn, opts) {
    return VexSettingsGroups.button(text, async () => { try { await fn(); } catch (err) { this._fail(text, err); } }, opts);
  },
  _row(...kids) { const r = this._el('div', 'vexsr-rule'); r.append(...kids); return r; },
  _text(title, ...lines) {
    const t = this._el('span', 'vexsr-host');
    t.style.wordBreak = 'normal';
    t.appendChild(this._el('div', '', title));
    for (const l of lines) if (l) { const d = this._el('div', 'vexsr-mode', l); d.style.whiteSpace = 'normal'; t.appendChild(d); }
    return t;
  },
  _ago(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
  },

  open(section = 'repos') {
    this._section = section;
    const { body } = VexSettingsGroups.dialog({ id: this.ID, title: 'Developer loop', sub: 'Your repositories, services and deploys. Read-only: nothing here pushes, commits, edits or deploys.' });
    this._body = body;
    this.draw();
  },

  draw() {
    const body = this._body;
    if (!body || !body.isConnected) return;
    body.textContent = '';
    const nav = this._el('div', '');
    nav.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px';
    for (const [id, label] of this.SECTIONS) {
      const b = VexSettingsGroups.button(label, () => { this._section = id; this.draw(); }, { primary: id === this._section });
      b.setAttribute('aria-pressed', String(id === this._section));
      nav.appendChild(b);
    }
    body.appendChild(nav);
    const feature = this.FEATURE_OF[this._section];
    if (typeof VexUsage !== 'undefined') VexUsage.touch(feature);
    const host = this._el('div', '');
    body.appendChild(host);
    const draw = { repos: this.repos, ci: this.ci, devlog: this.devlog, endpoints: this.endpoints, deps: this.deps, deploy: this.deploy }[this._section];
    try { draw.call(this, host); }
    catch (err) { host.appendChild(VexSettingsGroups.note('This section could not be shown: ' + err.message)); this._fail('Developer loop', err); }
  },

  _off(host, feature, name) {
    if (typeof VexUsage !== 'undefined' && typeof VexUsage.isEnabled === 'function' && VexUsage.get && VexUsage.get(feature) && !VexUsage.isEnabled(feature)) {
      host.appendChild(VexSettingsGroups.note(name + ' is switched off (Settings > Developer loop, or Minimal Vex).'));
      return true;
    }
    return false;
  },

  // ---- Repositories ------------------------------------------------------------
  repos(host) {
    host.appendChild(VexSettingsGroups.note('The repositories the CI, devlog and dependency features look at. Use owner/repo or a github.com address.'));
    const input = this._el('input', 'set-input');
    input.type = 'text'; input.placeholder = 'owner/repo'; input.spellcheck = false;
    input.setAttribute('aria-label', 'Repository to add');
    const add = this._btn('Add', () => { DevLoopRepos.add(input.value); this.draw(); }, { primary: true });
    host.appendChild(this._row(input, add));
    const wrap = this._el('div', 'vexsr-list');
    const own = DevLoopRepos._own();
    for (const repo of DevLoopRepos.list()) {
      const rm = own.includes(repo) ? this._btn('Remove', () => { DevLoopRepos.remove(repo); this.draw(); }, { danger: true, label: 'Remove ' + repo }) : this._el('span', 'vexsr-mode', 'from the repo registry');
      wrap.appendChild(this._row(this._text(repo), rm));
    }
    if (!wrap.children.length) wrap.appendChild(VexSettingsGroups.note('No repositories yet.'));
    host.appendChild(wrap);
  },

  // ---- CI failures -------------------------------------------------------------
  ci(host) {
    if (this._off(host, 'ci-fix-loop', 'The CI failure loop')) return;
    host.appendChild(VexSettingsGroups.note('When a repository in the list has a failed GitHub Actions run, Vex reads the failing job and shows the first failing step and error. It never re-runs, pushes or edits anything. Reading private repositories and logs needs the GitHub token (Settings > GitHub access).'));
    const repos = DevLoopRepos.list();
    const bar = this._row();
    bar.append(
      this._btn('Check now', async () => { const r = await CiFixLoop.checkAll(); window.showToast?.(r.length ? r.length + ' new failed run(s)' : 'No new failed runs'); this.draw(); }),
      ...repos.slice(0, 6).map(repo => this._btn('Latest failure of ' + repo.split('/')[1], async () => {
        const c = await CiFixLoop.inspectLatest(repo);
        window.showToast?.(c ? 'Read the latest failed run of ' + repo : repo + ' has no failed runs');
        this.draw();
      }, { label: 'Read the latest failed run of ' + repo })),
    );
    host.appendChild(bar);
    const errs = CiFixLoop.state().errors;
    for (const [repo, msg] of Object.entries(errs)) host.appendChild(VexSettingsGroups.note(repo + ': ' + msg));
    const wrap = this._el('div', 'vexsr-list');
    for (const c of CiFixLoop.cards()) {
      const card = this._el('div', 'vexsr-rule');
      card.style.flexWrap = 'wrap';
      const t = this._text(c.repo + (c.branch ? ' (' + c.branch + ')' : '') + ' failed', c.workflow + (c.sha ? ' at ' + c.sha : '') + ' - ' + this._ago(c.at),
        'Failing step: ' + (c.step || c.job || 'unknown'), c.errorLine ? 'First error: ' + c.errorLine : '', c.logNote);
      const fix = this._el('div', '');
      fix.style.cssText = 'width:100%;white-space:pre-wrap';
      fix.setAttribute('role', 'status');
      const actions = this._el('div', '');
      actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      actions.append(
        this._btn('Open run', () => devLoopOpen(c.runUrl), { label: 'Open the run of ' + c.repo }),
        this._btn('Copy log excerpt', () => { if (!c.excerpt) throw new Error('There is no log excerpt for this run'); return devLoopCopy(c.excerpt, 'Log excerpt'); }),
        this._btn('Draft a fix prompt', async () => {
          fix.textContent = 'Asking the local model...';
          try { const p = await CiFixLoop.draftFixPrompt(c); fix.textContent = p; await devLoopCopy(p, 'Fix prompt'); }
          catch (err) { fix.textContent = ''; throw err; }
        }, { label: 'Draft a fix prompt with the local model' }),
        this._btn('Dismiss', () => { CiFixLoop.forget(c.id); this.draw(); }, { danger: true, label: 'Dismiss this card' }),
      );
      card.append(t, actions, fix);
      wrap.appendChild(card);
    }
    if (!wrap.children.length) wrap.appendChild(VexSettingsGroups.note(repos.length ? 'No failed runs seen.' : 'Add a repository first.'));
    host.appendChild(wrap);
  },

  // ---- Devlog -----------------------------------------------------------------
  devlog(host) {
    if (this._off(host, 'devlog-drafter', 'The devlog drafter')) return;
    host.appendChild(VexSettingsGroups.note('Drafts today\'s devlog or a standup note from the commits in your repositories. The local model can tidy the wording; the commits never go to a cloud model. Saved to Notes; nothing is committed.'));
    const author = this._el('input', 'set-input');
    author.type = 'text'; author.placeholder = 'GitHub user name (blank = all commits)'; author.value = DevlogDrafter.author(); author.spellcheck = false;
    author.setAttribute('aria-label', 'Only commits by this GitHub user');
    const out = this._el('textarea', 'set-input');
    out.rows = 14; out.style.cssText = 'width:100%;font-family:inherit';
    out.setAttribute('aria-label', 'The drafted note');
    const status = VexSettingsGroups.note('');
    status.setAttribute('role', 'status');
    let last = null;
    const make = (style, polish) => async () => {
      DevlogDrafter.setAuthor(author.value);
      status.textContent = 'Reading commits...';
      try {
        last = await DevlogDrafter.draft({ style, polish });
        out.value = last.markdown;
        const errs = Object.entries(last.errors).map(([r, m]) => r + ': ' + m);
        status.textContent = 'Made with: ' + last.method + '. ' + last.repos + ' repo(s) read.' + (errs.length ? ' Not read: ' + errs.join('; ') : '');
      } catch (err) { status.textContent = ''; throw err; }
    };
    host.append(
      this._row(author),
      this._row(
        this._btn('Draft devlog', make('devlog', false), { primary: true }),
        this._btn('Draft standup', make('standup', false)),
        this._btn('Tidy with local model', make('devlog', true), { label: 'Draft the devlog and tidy it with the local model' }),
      ),
      status, out,
      this._row(
        this._btn('Save to Notes', () => { if (!last) throw new Error('Draft something first'); DevlogDrafter.saveToNotes({ ...last, markdown: out.value }); window.showToast?.('Saved to Notes'); }),
        this._btn('Copy', () => { if (!out.value) throw new Error('There is nothing to copy yet'); return devLoopCopy(out.value, 'Note'); }),
      ),
    );
  },

  // ---- Endpoints ------------------------------------------------------------------
  endpoints(host) {
    if (this._off(host, 'endpoint-board', 'The endpoint board')) return;
    host.appendChild(VexSettingsGroups.note('Your own workers and bots, asked with one GET every five minutes (a game pauses it). Only https addresses; no credentials in the address; private networks are refused. You are told through the Attention budget when one is down for two looks in a row.'));
    const name = this._el('input', 'set-input'), url = this._el('input', 'set-input'), field = this._el('input', 'set-input'), value = this._el('input', 'set-input'), ver = this._el('input', 'set-input');
    for (const [e, p, l] of [[name, 'Name (optional)', 'Endpoint name'], [url, 'https://...', 'Endpoint address'], [field, 'JSON field to expect, e.g. status', 'Expected JSON field'], [value, 'its value, e.g. ok', 'Expected value'], [ver, 'version field, e.g. version', 'Version field']]) {
      e.type = 'text'; e.placeholder = p; e.spellcheck = false; e.setAttribute('aria-label', l);
    }
    host.append(this._row(name, url), this._row(field, value, ver), this._row(this._btn('Add endpoint', async () => {
      const item = EndpointBoard.add({ name: name.value, url: url.value, expectField: field.value, expectValue: value.value, versionField: ver.value });
      await EndpointBoard.checkOne(item);
      this.draw();
    }, { primary: true }), this._btn('Check all now', async () => { await EndpointBoard.checkAll(); this.draw(); })));
    const s = EndpointBoard.state();
    const wrap = this._el('div', 'vexsr-list');
    for (const it of s.items) {
      const r = s.results[it.id];
      const word = !r ? 'not checked yet' : r.state === 'up' ? 'up' : r.state === 'slow' ? 'slow' : 'down';
      const spark = r && r.history.length ? ' | ' + r.history.slice(-10).map(n => n + 'ms').join(' ') : '';
      wrap.appendChild(this._row(
        this._text(it.name + ': ' + word, it.url, r ? ((r.why ? r.why + '. ' : '') + 'Answered ' + r.status + ' in ' + r.ms + ' ms, ' + this._ago(r.at) + (r.version ? ', version ' + r.version : '')) : '', spark),
        this._btn('Remove', () => { EndpointBoard.remove(it.id); this.draw(); }, { danger: true, label: 'Remove ' + it.name }),
      ));
    }
    if (!wrap.children.length) wrap.appendChild(VexSettingsGroups.note('Nothing on the board yet.'));
    host.appendChild(wrap);
  },

  // ---- Dependencies -----------------------------------------------------------------
  deps(host) {
    if (this._off(host, 'dependency-radar', 'The dependency radar')) return;
    host.appendChild(VexSettingsGroups.note('Reads package.json (or pyproject.toml) from each repository and compares the key packages with the newest release (npm, PyPI, castLabs for Electron) and known advisories. Checked twice a day.'));
    const keys = this._el('input', 'set-input');
    keys.type = 'text'; keys.value = DependencyRadar.state().keys.join(', '); keys.spellcheck = false;
    keys.setAttribute('aria-label', 'Key packages, separated by commas');
    host.append(
      this._row(keys, this._btn('Save packages', () => { DependencyRadar.setKeys(keys.value.split(',')); window.showToast?.('Saved'); })),
      this._row(this._btn('Scan now', async () => { await DependencyRadar.scanAll(); this.draw(); }, { primary: true }), this._el('span', 'vexsr-mode', DependencyRadar.summaryText())),
    );
    const wrap = this._el('div', 'vexsr-list');
    for (const r of Object.values(DependencyRadar.state().results)) {
      if (r.error) { wrap.appendChild(this._row(this._text(r.repo, r.error))); continue; }
      wrap.appendChild(this._row(this._text(r.repo + (DependencyRadar.isBehind(r) ? ': behind' : ': up to date'),
        ...r.deps.map(d => d.name + ' ' + (d.have || '?') + (d.latest ? ' -> ' + d.latest : '') + (d.gap !== 'current' && d.gap !== 'unknown' ? ' (' + d.gap + ')' : '') + (d.advisories ? ', ' + d.advisories + ' advisories' : '') + (d.castlabs ? ' [castLabs]' : '')))));
    }
    if (!wrap.children.length) wrap.appendChild(VexSettingsGroups.note('Not scanned yet.'));
    host.appendChild(wrap);
  },

  // ---- Deploy desk -----------------------------------------------------------------
  deploy(host) {
    if (this._off(host, 'deploy-desk', 'The deploy desk')) return;
    host.appendChild(VexSettingsGroups.note('The deploy hosts you actually use, built only from this computer\'s history (how often, and the pages you were last on). Nothing is fetched.'));
    const s = DeployDesk.state();
    if (s.finishedAt) host.appendChild(VexSettingsGroups.note('A watched run finished ' + this._ago(s.finishedAt) + (s.finished ? ': ' + s.finished : '') + '. The links below are worth a look.'));
    const groups = DeployDesk.groups();
    const wrap = this._el('div', 'vexsr-list');
    for (const g of groups) {
      const pins = s.pins[g.id] || [];
      const links = this._el('div', '');
      links.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      for (const u of pins) links.appendChild(this._btn('Pinned: ' + new URL(u).pathname.slice(0, 30), () => devLoopOpen(u), { label: 'Open pinned page ' + u }));
      for (const l of g.links) {
        links.appendChild(this._btn(l.title ? l.title.slice(0, 32) : new URL(l.url).pathname.slice(0, 32), () => devLoopOpen(l.url), { label: 'Open ' + (l.title || l.url) }));
        if (!pins.includes(l.url)) links.appendChild(this._btn('Pin', () => { DeployDesk.pin(g.id, l.url); this.draw(); }, { label: 'Pin ' + (l.title || l.url) }));
      }
      const row = this._el('div', 'vexsr-rule');
      row.style.flexWrap = 'wrap';
      row.append(this._text(g.label, g.count + ' visits in 60 days, last ' + (g.lastAt ? this._ago(g.lastAt) : 'unknown')), links);
      wrap.appendChild(row);
    }
    if (!wrap.children.length) wrap.appendChild(VexSettingsGroups.note('No deploy hosts in your history yet (a host needs two visits in 60 days).'));
    host.appendChild(wrap);
  },

  // ---- Settings section -----------------------------------------------------------------
  group(el) {
    const S = VexSettingsGroups;
    el.appendChild(S.note('Read-only tools for your repositories, services and deploys. Each can be switched off; they use the GitHub token if you entered one (Settings > GitHub access).'));
    el.appendChild(S.button('Open the developer loop', () => this.open(), { primary: true }));
    const feats = [['ci-fix-loop', 'CI failure loop', CiFixLoop], ['devlog-drafter', 'Devlog drafter', DevlogDrafter], ['endpoint-board', 'Endpoint health board', EndpointBoard], ['dependency-radar', 'Dependency radar', DependencyRadar], ['deploy-desk', 'Deploy desk', DeployDesk]];
    for (const [, label, mod] of feats) {
      const l = document.createElement('label');
      l.className = 'vex-platform-note';
      const box = document.createElement('input');
      box.type = 'checkbox'; box.checked = mod.enabled();
      box.addEventListener('change', () => { try { mod.setEnabled(box.checked); } catch (err) { this._fail(label, err); } });
      l.append(box, document.createTextNode(' ' + label));
      el.appendChild(l);
    }
  },
};

function devLoopStart() {
  CiFixLoop.start();
  EndpointBoard.start();
  DependencyRadar.start();
  DeployDesk.start();
}

if (typeof window !== 'undefined') {
  window.DevLoopUI = DevLoopUI;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'dev-loop', title: 'Developer loop',
      keywords: 'developer ci failure actions devlog commit standup endpoint health worker bot dependency radar deploy desk railway vercel supabase cloudflare pypi',
      before: 'about',
      build: (el) => DevLoopUI.group(el),
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    const cmd = (id, label, hint, section) => VexExtras.registerCommand({ id, label, hint, icon: 'toolbox', action: () => DevLoopUI.open(section) });
    cmd('dev-loop', 'Developer loop', 'Your repositories, CI, endpoints, dependencies and deploys', 'repos');
    cmd('ci-failures', 'CI failures', 'Failed GitHub Actions runs of your repositories', 'ci');
    cmd('devlog-draft', 'Draft today\'s devlog', 'A devlog or standup note from today\'s commits', 'devlog');
    cmd('endpoint-board', 'Endpoint health board', 'Are your workers and bots up?', 'endpoints');
    cmd('dependency-radar', 'Dependency radar', 'Which repositories are behind on key packages', 'deps');
    cmd('deploy-desk', 'Open deploy desk', 'The deploy hosts you use, from your history', 'deploy');
  }
  if (typeof VexJobs !== 'undefined') devLoopStart();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { DevLoopUI, devLoopStart };
