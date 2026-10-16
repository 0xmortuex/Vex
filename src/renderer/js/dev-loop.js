// === The developer loop: CI failures, devlog, endpoints, dependencies, deploys ===
//
// Six small features for the owner's own repositories and services. All of
// them are READ-ONLY: nothing here pushes, commits, edits, re-runs or deploys.
// Everything GitHub says arrives through the token vault (js/github-vault.js);
// everything about a package or an endpoint through the bounded feeds in the
// main process (src/main/dev-feeds.js). Every one is off unless switched on
// (staged for existing profiles) and registered with the usage record.
//
//   DevLoopRepos      the list of repositories the features look at (plain list,
//                     plus a repo registry when one exists)
//   CiFixLoop         T1-002  a watched repo's failed Actions run -> a card
//   DevlogDrafter     T1-029  today's commits -> a devlog / standup note
//   EndpointBoard     T1-030  workers and bots pinged, status board
//   DependencyRadar   T1-031  key dependencies behind their latest release
//   DeployDesk        T1-036  the deploy hosts you use, from history counts
//
// The screens are in js/dev-loop-ui.js.

const DevLoopStore = {
  read(key, fallback) {
    let raw = null;
    try { raw = localStorage.getItem(key); }
    catch (err) { console.error('[DevLoop] ' + key + ' could not be read:', err.message); return fallback(); }
    if (raw == null) return fallback();
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
      throw new Error('not an object');
    } catch (err) {
      console.error('[DevLoop] ' + key + ' is not readable and is started again:', err.message);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Developer loop', key + ' was not readable and was started again', err);
      return fallback();
    }
  },
  write(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
};

// The local model, and only the local one. Used wherever a log or a commit list
// is turned into words: that text is never sent to a cloud model.
const DevLoopLocalAI = {
  model() {
    if (typeof Ollama === 'undefined' || typeof AIRouter === 'undefined') return '';
    return AIRouter.isOllamaAvailable() ? String(AIRouter.getModel() || '') : '';
  },
  async generate(system, prompt, { maxTokens = 700 } = {}) {
    const model = this.model();
    if (!model) throw new Error('No local model is set up (Ollama), and this text is never sent to a cloud model');
    return String(await Ollama.generate(model, prompt, { systemPrompt: system, temperature: 0.2, maxTokens }) || '').trim();
  },
};

// Takes anything that looks like a secret out of text before it is shown, copied
// or handed to the local model.
function devLoopRedact(text) {
  return String(text == null ? '' : text)
    .replace(/github_pat_[A-Za-z0-9_]{10,}/g, '[redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [redacted]')
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[redacted]')
    .replace(/\b(password|passwd|secret|token|api[_-]?key|apikey|authorization)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1$2[redacted]')
    .replace(/(?<![A-Za-z0-9])[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9])/g, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) && !/^[a-f0-9]{40}$/.test(m) ? '[redacted]' : m));
}

// ---------------------------------------------------------------------------------
const DevLoopRepos = {
  KEY: 'vex.devLoop.repos',
  MAX: 25,

  // owner/repo from "owner/repo" or a github.com address.
  parse(input) {
    const s = String(input == null ? '' : input).trim();
    const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?(?:[/?#].*)?$/.exec(s);
    if (!m || m[1] === '.' || m[1] === '..' || m[2] === '.' || m[2] === '..') return null;
    return m[1] + '/' + m[2];
  },

  _own() {
    const v = DevLoopStore.read(this.KEY, () => ({ list: [] }));
    return Array.isArray(v.list) ? v.list.filter(x => typeof x === 'string' && this.parse(x) === x) : [];
  },

  // Other modules (the repo registry, T1-003) hand over their list with
  //   DevLoopRepos.addSource(() => VexRepoRegistry.list())
  // so this file never has to name a module that may not exist. A source returns
  // 'owner/repo' strings or objects with owner+repo / full / slug.
  _sources: [],
  addSource(fn) {
    if (typeof fn !== 'function') throw new Error('A repository source is a function that returns a list');
    this._sources.push(fn);
  },
  _registry() {
    const out = [];
    for (const src of this._sources) {
      for (const e of src()) {
        const raw = typeof e === 'string' ? e : (e && (e.full || e.slug || (e.owner && e.repo ? e.owner + '/' + e.repo : '')));
        const p = this.parse(raw);
        if (p) out.push(p);
      }
    }
    return out;
  },

  list() { return Array.from(new Set([...this._registry(), ...this._own()])); },

  add(input) {
    const p = this.parse(input);
    if (!p) throw new Error('Use owner/repo, or a github.com address');
    const own = this._own();
    if (own.includes(p) || this._registry().includes(p)) throw new Error(p + ' is already in the list');
    if (own.length >= this.MAX) throw new Error('At most ' + this.MAX + ' repositories');
    own.push(p);
    DevLoopStore.write(this.KEY, { list: own });
    return p;
  },
  remove(repo) { DevLoopStore.write(this.KEY, { list: this._own().filter(r => r !== repo) }); },
};

// A switch kept in a feature's own record: { enabled: true|false, ... }, on by default.
function devLoopSwitch(key, fallback) {
  return {
    enabled() { return DevLoopStore.read(key, fallback).enabled !== false; },
    setEnabled(on) { const s = DevLoopStore.read(key, fallback); s.enabled = !!on; DevLoopStore.write(key, s); },
  };
}

// A problem that is reported (never swallowed): the console always, the problems list when it exists.
function devLoopNote(area, message, err) {
  console.error('[DevLoop] ' + message + ':', err);
  if (typeof VexProblems !== 'undefined') VexProblems.note(area, message, err);
}

function devLoopAttention() {
  if (typeof VexAttention === 'undefined') throw new Error('VexAttention is not loaded: js/vex-attention.js must come before the developer features');
  return VexAttention;
}
function devLoopOpen(url) {
  if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
  TabManager.createTab(String(url), true);
}
async function devLoopCopy(text, what) {
  await navigator.clipboard.writeText(String(text));
  window.showToast?.(what + ' copied');
}

// ---------------------------------------------------------------------------------
// T1-002  CI-failure to fix loop
const CiFixLoop = {
  KEY: 'vex.ciLoop',
  FEATURE: 'ci-fix-loop',
  EVERY_MS: 10 * 60000,
  MAX_CARDS: 20,
  MAX_AGE_MS: 3 * 24 * 3600 * 1000,
  ...devLoopSwitch('vex.ciLoop', () => ({ enabled: true, seen: {}, cards: [], errors: {} })),

  state() {
    const s = DevLoopStore.read(this.KEY, () => ({ enabled: true, seen: {}, cards: [], errors: {} }));
    if (!s.seen || typeof s.seen !== 'object') s.seen = {};
    if (!Array.isArray(s.cards)) s.cards = [];
    if (!s.errors || typeof s.errors !== 'object') s.errors = {};
    return s;
  },
  save(s) { DevLoopStore.write(this.KEY, s); },
  cards() { return this.state().cards; },

  // The text of a job's log with the noise taken off: colours, time stamps.
  clean(log) {
    return String(log == null ? '' : log)
      .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
      .split(/\r?\n/)
      .map(l => l.replace(/^﻿?\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ''));
  },

  // First error line of a log, or ''.
  errorLine(log) {
    const lines = Array.isArray(log) ? log : this.clean(log);
    const strict = lines.find(l => /##\[error\]/.test(l));
    const loose = strict || lines.find(l => /\b(error|failed|failure|exception|FAIL)\b/i.test(l) && !/^\s*(?:at |\[command\])/.test(l));
    return devLoopRedact(String(loose || '').replace(/##\[error\]/, '').trim()).slice(0, 240);
  },

  // Some lines around the first error, redacted, at most 3,000 characters.
  excerpt(log) {
    const lines = Array.isArray(log) ? log : this.clean(log);
    let at = lines.findIndex(l => /##\[error\]/.test(l));
    if (at < 0) at = lines.findIndex(l => /\b(error|failed|failure|exception|FAIL)\b/i.test(l));
    if (at < 0) return '';
    const from = Math.max(0, at - 8), to = Math.min(lines.length, at + 12);
    return devLoopRedact(lines.slice(from, to).join('\n')).slice(0, 3000);
  },

  async _runs(repo) {
    const j = await GitHubVault.json('/repos/' + repo + '/actions/runs?status=failure&per_page=5');
    return Array.isArray(j.workflow_runs) ? j.workflow_runs : [];
  },

  // One failed run -> a card. A log that cannot be read (it needs the token)
  // is said on the card; it does not stop the card.
  async inspect(repo, run) {
    const jobsJson = await GitHubVault.json('/repos/' + repo + '/actions/runs/' + run.id + '/jobs?per_page=30');
    const jobs = Array.isArray(jobsJson.jobs) ? jobsJson.jobs : [];
    const job = jobs.find(j => j.conclusion === 'failure') || jobs.find(j => j.conclusion === 'timed_out') || null;
    const step = job && Array.isArray(job.steps) ? job.steps.find(s => s.conclusion === 'failure') : null;
    let log = '', logNote = '';
    if (job) {
      const r = await GitHubVault.get('/repos/' + repo + '/actions/jobs/' + job.id + '/logs');
      if (r.ok) log = r.text;
      else if (r.status === 404 || r.status === 403 || r.status === 401) logNote = r.authed ? 'GitHub would not give the log to this token' : 'The log needs a GitHub token (Settings > GitHub access)';
      else logNote = 'GitHub answered ' + r.status + ' for the log';
    } else logNote = 'The run failed before any job started';
    const lines = this.clean(log);
    const card = {
      id: repo + '#' + run.id, repo, runId: run.id, runUrl: String(run.html_url || 'https://github.com/' + repo + '/actions/runs/' + run.id),
      workflow: String(run.name || ''), branch: String(run.head_branch || ''), sha: String(run.head_sha || '').slice(0, 7), title: String(run.display_title || '').slice(0, 160),
      job: job ? String(job.name || '') : '', step: step ? String(step.name || '') : '',
      errorLine: this.errorLine(lines), excerpt: this.excerpt(lines), logNote, at: Date.now(),
    };
    return card;
  },

  async checkRepo(repo, { baseline = true } = {}) {
    const s = this.state();
    const runs = await this._runs(repo);
    const newest = runs.reduce((m, r) => Math.max(m, r.id), 0);
    const known = s.seen[repo];
    const recent = (r) => { const t = Date.parse(r.updated_at || r.created_at || ''); return Number.isNaN(t) || Date.now() - t < this.MAX_AGE_MS; };
    const fresh = known == null ? (baseline ? [] : runs) : runs.filter(r => r.id > known && recent(r));
    const made = [];
    for (const run of fresh.sort((a, b) => a.id - b.id)) {
      const card = await this.inspect(repo, run);
      const again = this.state();
      again.cards = [card, ...again.cards.filter(c => c.id !== card.id)].slice(0, this.MAX_CARDS);
      this.save(again);
      made.push(card);
    }
    const after = this.state();
    after.seen[repo] = Math.max(newest, known || 0);
    delete after.errors[repo];
    this.save(after);
    for (const card of made) this.announce(card);
    return made;
  },

  // Looks at the newest failed run of one repo now, whatever was seen before.
  async inspectLatest(repo) {
    const runs = await this._runs(repo);
    if (!runs.length) return null;
    const card = await this.inspect(repo, runs.sort((a, b) => b.id - a.id)[0]);
    const s = this.state();
    s.cards = [card, ...s.cards.filter(c => c.id !== card.id)].slice(0, this.MAX_CARDS);
    s.seen[repo] = Math.max(s.seen[repo] || 0, card.runId);
    this.save(s);
    document.dispatchEvent(new CustomEvent('vex:ci-failure', { detail: { id: card.id } }));
    return card;
  },

  announce(card) {
    const A = devLoopAttention();
    const where = card.repo + (card.branch ? ' (' + card.branch + ')' : '');
    A.osNotify({ feature: this.FEATURE, label: 'CI failures', urgency: 'useful', id: card.id, title: 'CI failed: ' + where,
      body: (card.step ? card.step + ': ' : '') + (card.errorLine || card.title || 'a run failed') })
      .catch(err => devLoopNote('CI failures', 'Could not show the desktop notification', err));
    if (typeof VexLedger !== 'undefined') VexLedger.note({ feature: this.FEATURE, what: 'Read the failed run of ' + where + ' on GitHub', why: 'The repository is in your developer list and its Actions run failed. Nothing was changed on GitHub.' });
    document.dispatchEvent(new CustomEvent('vex:ci-failure', { detail: { id: card.id } }));
  },

  async checkAll() {
    if (!this.enabled() || !GitHubVault.enabled()) return [];
    const out = [];
    for (const repo of DevLoopRepos.list()) {
      try { out.push(...await this.checkRepo(repo)); }
      catch (err) {
        const s = this.state();
        s.errors[repo] = String(err && err.message || err).slice(0, 200);
        this.save(s);
        devLoopNote('CI failures', 'Could not check ' + repo, err);
      }
    }
    return out;
  },

  // A prompt to paste into an editor or a local model. Local only: the excerpt
  // has been redacted, and it is never sent to a cloud model from here.
  async draftFixPrompt(card) {
    const system = 'You help a developer fix a failing CI run. Write ONE prompt the developer can paste into a coding assistant: say what failed, quote the key error lines, name the most likely files or causes, and ask for a minimal fix and how to verify it. Do not invent file names. Be brief.';
    const prompt = ['Repository: ' + card.repo, 'Workflow: ' + card.workflow + (card.branch ? ' on ' + card.branch : '') + (card.sha ? ' at ' + card.sha : ''),
      'Failing step: ' + (card.step || 'unknown') + (card.job ? ' (job ' + card.job + ')' : ''), 'First error: ' + (card.errorLine || 'unknown'), '', 'Log excerpt:', card.excerpt || '(no log was readable)'].join('\n');
    return DevLoopLocalAI.generate(system, prompt, { maxTokens: 600 });
  },

  forget(id) { const s = this.state(); s.cards = s.cards.filter(c => c.id !== id); this.save(s); },

  start() {
    if (this._job) return;
    this._job = VexJobs.every('CI failure check', this.EVERY_MS, () => this.checkAll(), { when: 'background', deferOnBattery: true, feature: this.FEATURE });
  },
};

// ---------------------------------------------------------------------------------
// T1-029  Devlog and commit-note drafter
const DevlogDrafter = {
  KEY: 'vex.devlog',
  FEATURE: 'devlog-drafter',
  ...devLoopSwitch('vex.devlog', () => ({ enabled: true })),

  state() { return DevLoopStore.read(this.KEY, () => ({ enabled: true })); },
  author() {
    const s = this.state();
    if (s.author) return s.author;
    try { return String(localStorage.getItem('vex.githubUsername') || '').replace(/^"|"$/g, ''); }
    catch (err) { console.error('[Devlog] the GitHub name could not be read:', err.message); return ''; }
  },
  setAuthor(name) {
    const n = String(name || '').trim();
    if (n && !/^[A-Za-z0-9-]{1,39}$/.test(n)) throw new Error('A GitHub user name is letters, digits and dashes');
    const s = this.state(); s.author = n; DevLoopStore.write(this.KEY, s);
  },

  startOfDay(now = new Date()) { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; },
  ymd(d) { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); },

  firstLine(message) { return String(message || '').split(/\r?\n/)[0].trim().slice(0, 200); },

  // [{ repo, commits: [{ sha, message }] }] -> flat list without merge commits.
  clean(perRepo) {
    return perRepo.map(r => ({ repo: r.repo, commits: r.commits.filter(c => c.message && !/^Merge (branch|pull request|remote-tracking)/.test(c.message)) })).filter(r => r.commits.length);
  },

  markdown(day, perRepo, { style = 'devlog' } = {}) {
    const rows = this.clean(perRepo);
    if (!rows.length) return '# ' + (style === 'standup' ? 'Standup ' : 'Devlog ') + day + '\n\nNo commits found for this day.\n';
    const head = style === 'standup' ? '# Standup ' + day + '\n\nWhat I did:\n' : '# Devlog ' + day + '\n';
    const body = rows.map(r => '\n## ' + r.repo + '\n\n' + r.commits.map(c => '- ' + c.message + ' (`' + c.sha + '`)').join('\n')).join('\n');
    return head + body + '\n';
  },

  async commitsOf(repo, since, author) {
    const q = '?since=' + since.toISOString() + '&per_page=50' + (author ? '&author=' + author : '');
    const list = await GitHubVault.json('/repos/' + repo + '/commits' + q);
    if (!Array.isArray(list)) throw new Error('GitHub gave no commit list for ' + repo);
    return list.map(c => ({ sha: String(c.sha || '').slice(0, 7), message: this.firstLine(c.commit && c.commit.message), at: c.commit && c.commit.author && c.commit.author.date }));
  },

  // -> { day, markdown, repos, errors, method }. method says how the text was made.
  async draft({ date = new Date(), style = 'devlog', polish = false } = {}) {
    if (!this.enabled()) throw new Error('The devlog drafter is switched off');
    const repos = DevLoopRepos.list();
    if (!repos.length) throw new Error('Add at least one repository first');
    const since = this.startOfDay(date), day = this.ymd(date), author = this.author();
    const perRepo = [], errors = {};
    for (const repo of repos) {
      try { perRepo.push({ repo, commits: await this.commitsOf(repo, since, author) }); }
      catch (err) { errors[repo] = err.message; devLoopNote('Devlog', 'Could not read the commits of ' + repo, err); }
    }
    let markdown = this.markdown(day, perRepo, { style }), method = 'plain list';
    if (polish && this.clean(perRepo).length) {
      const system = style === 'standup'
        ? 'Turn this commit list into a short standup update: three to six plain sentences or bullets, first person, past tense. Use only what the commits say.'
        : 'Turn this commit list into a short developer devlog entry: a title line and a few short paragraphs or bullets in plain language. Use only what the commits say; do not invent features.';
      const text = await DevLoopLocalAI.generate(system, markdown, { maxTokens: 700 });
      if (!text) throw new Error('The local model gave no text');
      markdown = text + '\n\n---\n\n' + markdown;
      method = 'local model';
    }
    return { day, markdown, repos: perRepo.length, errors, method };
  },

  saveToNotes(draft) {
    if (typeof NotesPanel === 'undefined' || !Array.isArray(NotesPanel.notes)) throw new Error('Notes are not available');
    const now = new Date().toISOString();
    const note = { id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), title: 'Devlog ' + draft.day, content: draft.markdown, pinned: false, tags: ['devlog'], sourceUrl: '', sourceTitle: '', createdAt: now, updatedAt: now };
    NotesPanel.notes.unshift(note);
    NotesPanel.save();
    try { NotesPanel.renderList?.(); } catch (err) { devLoopNote('Devlog', 'The notes list could not be redrawn', err); }
    return note;
  },
};

// ---------------------------------------------------------------------------------
// T1-030  Worker, bot and endpoint health board
const EndpointBoard = {
  KEY: 'vex.endpoints',
  FEATURE: 'endpoint-board',
  EVERY_MS: 5 * 60000,
  MAX_ITEMS: 20,
  SLOW_MS: 3000,
  HISTORY: 20,
  SECRET_QUERY: /(?:^|[_-])(token|key|secret|password|passwd|pwd|auth|sig|signature|apikey|api_key|access_token|bearer)$/i,
  ...devLoopSwitch('vex.endpoints', () => ({ enabled: true, items: [], results: {} })),

  state() {
    const s = DevLoopStore.read(this.KEY, () => ({ enabled: true, items: [], results: {} }));
    if (!Array.isArray(s.items)) s.items = [];
    if (!s.results || typeof s.results !== 'object') s.results = {};
    return s;
  },
  save(s) { DevLoopStore.write(this.KEY, s); },
  items() { return this.state().items; },

  // The same rules main applies (src/main/dev-feeds.js), so the form says no first.
  validate(href) {
    let u;
    try { u = new URL(String(href == null ? '' : href).trim()); } catch { throw new Error('That is not a web address'); }
    if (String(href).length > 300) throw new Error('That address is too long');
    if (u.protocol !== 'https:') throw new Error('Only https addresses can be checked');
    if (u.username || u.password) throw new Error('Do not put a user name or password in the address');
    for (const k of u.searchParams.keys()) if (this.SECRET_QUERY.test(k)) throw new Error('Do not put a key or token in the address (' + k + ')');
    const PA = typeof VexPrivateAddress !== 'undefined' ? VexPrivateAddress : require('./private-address');
    if (PA.isPrivateHost(u.hostname)) throw new Error('Addresses on this machine or the local network are not checked');
    return u.href;
  },

  add({ name, url, expectStatus = 0, expectField = '', expectValue = '', versionField = '' }) {
    const href = this.validate(url);
    const s = this.state();
    if (s.items.length >= this.MAX_ITEMS) throw new Error('At most ' + this.MAX_ITEMS + ' endpoints');
    if (s.items.some(i => i.url === href)) throw new Error('That address is already on the board');
    const item = { id: 'ep_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(name || new URL(href).hostname).trim().slice(0, 60), url: href,
      expectStatus: Number(expectStatus) || 0, expectField: String(expectField || '').trim().slice(0, 60), expectValue: String(expectValue || '').trim().slice(0, 60), versionField: String(versionField || '').trim().slice(0, 60) };
    if (item.expectStatus && (item.expectStatus < 100 || item.expectStatus > 599)) throw new Error('The expected status is 100 to 599');
    for (const f of [item.expectField, item.versionField]) if (f && !/^[A-Za-z0-9_.-]{1,60}$/.test(f)) throw new Error('A JSON field is letters, digits, dots and dashes');
    s.items.push(item);
    this.save(s);
    return item;
  },
  remove(id) { const s = this.state(); s.items = s.items.filter(i => i.id !== id); delete s.results[id]; this.save(s); },

  pick(text, field) {
    if (!field) return undefined;
    let j;
    try { j = JSON.parse(text); } catch { return undefined; }
    let cur = j;
    for (const part of field.split('.')) { if (cur == null || typeof cur !== 'object') return undefined; cur = cur[part]; }
    return cur;
  },

  // -> { state: 'up'|'slow'|'down', why }
  evaluate(item, r) {
    if (!r.ok && !item.expectStatus) return { state: 'down', why: r.error || ('answered ' + r.status) };
    if (r.status === 0) return { state: 'down', why: r.error || 'no answer' };
    if (item.expectStatus ? r.status !== item.expectStatus : !(r.status >= 200 && r.status < 300)) return { state: 'down', why: 'answered ' + r.status + (item.expectStatus ? ', expected ' + item.expectStatus : '') };
    if (item.expectField) {
      const v = this.pick(r.text, item.expectField);
      if (v === undefined) return { state: 'down', why: 'the answer has no "' + item.expectField + '"' };
      if (item.expectValue && String(v) !== item.expectValue) return { state: 'down', why: '"' + item.expectField + '" is ' + String(v).slice(0, 40) + ', expected ' + item.expectValue };
    }
    if (r.ms > this.SLOW_MS) return { state: 'slow', why: 'answered in ' + r.ms + ' ms' };
    return { state: 'up', why: '' };
  },

  async checkOne(item) {
    const v = window.vex;
    if (!v || typeof v.devfeedsPing !== 'function') throw new Error('The endpoint check is not available in this build');
    const r = await v.devfeedsPing(item.url);
    const ev = this.evaluate(item, r);
    const s = this.state();
    const prev = s.results[item.id] || { history: [], fails: 0, state: 'unknown', since: 0 };
    const res = {
      state: ev.state, why: ev.why, status: r.status, ms: r.ms, at: Date.now(),
      version: item.versionField ? (this.pick(r.text, item.versionField) == null ? '' : String(this.pick(r.text, item.versionField)).slice(0, 40)) : '',
      history: [...(prev.history || []), r.ms].slice(-this.HISTORY),
      fails: ev.state === 'down' ? (prev.fails || 0) + 1 : 0,
      since: prev.state === ev.state ? prev.since : Date.now(),
    };
    s.results[item.id] = res;
    this.save(s);
    this.transition(item, prev, res);
    return res;
  },

  // Down only after two failed looks in a row; one notice per change.
  transition(item, prev, res) {
    const wasDown = prev.state === 'down' && prev.fails >= 2;
    if (res.state === 'down' && res.fails === 2) this._tell(item, 'down', item.name + ' is down', res.why);
    else if (res.state !== 'down' && wasDown) this._tell(item, 'up', item.name + ' is back', 'Answered in ' + res.ms + ' ms');
    document.dispatchEvent(new CustomEvent('vex:endpoint-health', { detail: { id: item.id, state: res.state } }));
  },
  _tell(item, kind, title, body) {
    devLoopAttention().osNotify({ feature: this.FEATURE, label: 'Endpoint health', urgency: 'useful', id: item.id + ':' + kind + ':' + Math.floor(Date.now() / 3600000), title, body })
      .catch(err => devLoopNote('Endpoint health', 'Could not show the desktop notification', err));
  },

  summary() {
    const s = this.state();
    const down = s.items.filter(i => (s.results[i.id] || {}).state === 'down' && (s.results[i.id].fails || 0) >= 2).length;
    return { total: s.items.length, down };
  },

  async checkAll() {
    if (!this.enabled()) return [];
    const out = [];
    for (const item of this.items()) {
      try { out.push({ id: item.id, ...await this.checkOne(item) }); }
      catch (err) { devLoopNote('Endpoint health', 'Could not check ' + item.name, err); }
    }
    return out;
  },

  start() {
    if (this._job) return;
    this._job = VexJobs.every('Endpoint health', this.EVERY_MS, () => this.checkAll(), { when: 'background', deferOnBattery: true, feature: this.FEATURE });
  },
};

// ---------------------------------------------------------------------------------
// T1-031  Dependency radar
const DependencyRadar = {
  KEY: 'vex.depRadar',
  FEATURE: 'dependency-radar',
  EVERY_MS: 12 * 3600000,
  CACHE_MS: 6 * 3600000,
  DEFAULT_KEYS: ['electron', 'vitest', 'electron-builder', 'typescript'],
  CASTLABS: 'castlabs/electron-releases',
  ...devLoopSwitch('vex.depRadar', () => ({ enabled: true })),

  state() {
    const s = DevLoopStore.read(this.KEY, () => ({ enabled: true }));
    if (!Array.isArray(s.keys) || !s.keys.length) s.keys = this.DEFAULT_KEYS.slice();
    if (!s.results || typeof s.results !== 'object') s.results = {};
    if (!s.cache || typeof s.cache !== 'object') s.cache = {};
    return s;
  },
  save(s) { DevLoopStore.write(this.KEY, s); },
  setKeys(list) {
    const keys = Array.from(new Set(list.map(x => String(x).trim()).filter(Boolean)));
    for (const k of keys) if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(k)) throw new Error('"' + k + '" is not a package name');
    if (!keys.length || keys.length > 15) throw new Error('Between 1 and 15 packages');
    const s = this.state(); s.keys = keys; this.save(s);
  },

  // The first version number inside a range ("^1.2.3", ">=2.0", "github:x/y#v42.11.0+wvcus").
  minVersion(range) {
    const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(range || ''));
    return m ? m[1] + '.' + m[2] + '.' + (m[3] || '0') : '';
  },
  compare(have, latest) {
    const a = String(have).split('.').map(n => parseInt(n, 10) || 0), b = String(latest).split('.').map(n => parseInt(n, 10) || 0);
    if (a[0] !== b[0]) return a[0] < b[0] ? 'major' : 'ahead';
    if ((a[1] || 0) !== (b[1] || 0)) return (a[1] || 0) < (b[1] || 0) ? 'minor' : 'ahead';
    if ((a[2] || 0) !== (b[2] || 0)) return (a[2] || 0) < (b[2] || 0) ? 'patch' : 'ahead';
    return 'current';
  },

  // package.json text -> { eco: 'npm', deps: { name: range } }; pyproject.toml -> { eco: 'pypi', ... }
  parseManifest(text, file = 'package.json') {
    if (/pyproject\.toml$/.test(file)) {
      const deps = {};
      const block = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(text);
      for (const m of (block ? block[1] : '').matchAll(/["']([A-Za-z0-9_.-]+)\s*((?:[<>=~!]=?|===)[^"']*)?["']/g)) deps[m[1].toLowerCase()] = (m[2] || '').trim();
      return { eco: 'pypi', deps };
    }
    const j = JSON.parse(text);
    return { eco: 'npm', deps: { ...(j.dependencies || {}), ...(j.devDependencies || {}) } };
  },

  async _fileText(repo, file) {
    const j = await GitHubVault.json('/repos/' + repo + '/contents/' + file);
    if (!j || j.encoding !== 'base64' || typeof j.content !== 'string') throw new Error(file + ' of ' + repo + ' could not be read');
    const bin = atob(j.content.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  },

  async _latest(eco, name, castlabs) {
    const s = this.state();
    const ck = (castlabs ? 'castlabs:' : eco + ':') + name;
    const hit = s.cache[ck];
    if (hit && Date.now() - hit.at < this.CACHE_MS) return hit.version;
    let version;
    if (castlabs) {
      const rel = await GitHubVault.json('/repos/' + this.CASTLABS + '/releases?per_page=10');
      const ok = (Array.isArray(rel) ? rel : []).find(r => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+\+wvcus$/.test(r.tag_name || ''));
      if (!ok) throw new Error('No castLabs release was found');
      version = ok.tag_name.slice(1).replace(/\+wvcus$/, '');
    } else {
      version = (await window.vex.devfeedsLatest(eco, name)).version;
    }
    const again = this.state();
    again.cache[ck] = { version, at: Date.now() };
    this.save(again);
    return version;
  },

  async scanRepo(repo) {
    const tryFiles = ['package.json', 'pyproject.toml'];
    let man = null, file = '';
    for (const f of tryFiles) {
      try { man = this.parseManifest(await this._fileText(repo, f), f); file = f; break; }
      catch (err) { if (!/cannot show that/.test(err.message)) throw err; }
    }
    if (!man) throw new Error(repo + ' has no package.json or pyproject.toml that Vex can read');
    const keys = new Set(this.state().keys.map(k => k.toLowerCase()));
    const names = Object.keys(man.deps).filter(n => keys.has(n.toLowerCase()));
    const deps = [];
    for (const name of names) {
      const range = man.deps[name];
      const castlabs = name === 'electron' && /castlabs/i.test(range);
      const have = this.minVersion(range);
      if (!have) { deps.push({ name, range, have: '', latest: '', gap: 'unknown', advisories: 0, castlabs }); continue; }
      const latest = await this._latest(man.eco, name, castlabs);
      const gap = this.compare(have, latest);
      let advisories = 0;
      if (gap !== 'current' && gap !== 'ahead' && !castlabs) advisories = (await window.vex.devfeedsAdvisories(man.eco, name, have)).count;
      deps.push({ name, range, have, latest, gap, advisories, castlabs });
    }
    return { repo, file, at: Date.now(), deps, error: '' };
  },

  isBehind(result) { return !!result && !result.error && result.deps.some(d => d.gap === 'major' || d.gap === 'minor' || d.gap === 'patch'); },
  behindCount() { const r = this.state().results; return Object.values(r).filter(x => this.isBehind(x)).length; },
  summaryText() {
    const r = Object.values(this.state().results);
    if (!r.length) return 'Not scanned yet';
    const n = this.behindCount();
    return n === 0 ? 'No repositories behind' : n + (n === 1 ? ' repo behind' : ' repos behind');
  },

  async scanAll() {
    if (!this.enabled() || !GitHubVault.enabled()) return [];
    const before = this.behindCount();
    const out = [];
    for (const repo of DevLoopRepos.list()) {
      let res;
      try { res = await this.scanRepo(repo); }
      catch (err) { res = { repo, at: Date.now(), deps: [], error: String(err.message || err).slice(0, 200) }; devLoopNote('Dependency radar', 'Could not scan ' + repo, err); }
      const s = this.state(); s.results[repo] = res; this.save(s);
      out.push(res);
    }
    const now = this.behindCount();
    if (now > before) devLoopAttention().suggest({ feature: this.FEATURE, id: 'behind:' + now, title: this.summaryText(), body: 'Key dependencies of your repositories have newer releases. Open the Dependency radar to see which.' });
    document.dispatchEvent(new CustomEvent('vex:dep-radar'));
    return out;
  },

  start() {
    if (this._job) return;
    this._job = VexJobs.every('Dependency radar', this.EVERY_MS, () => this.scanAll(), { when: 'background', deferOnBattery: true, feature: this.FEATURE });
  },
};

// ---------------------------------------------------------------------------------
// T1-036  Deploy desk assembled from habit
const DeployDesk = {
  KEY: 'vex.deployDesk',
  FEATURE: 'deploy-desk',
  WINDOW_MS: 60 * 24 * 3600 * 1000,
  MIN_VISITS: 2,
  // The hosts of the places a deploy is watched, as seen in the owner's history.
  GROUPS: [
    { id: 'github', label: 'GitHub Actions', hosts: ['github.com'], deep: /\/actions(\/|$)/ },
    { id: 'railway', label: 'Railway', hosts: ['railway.com', 'railway.app'] },
    { id: 'supabase', label: 'Supabase', hosts: ['supabase.com', 'supabase.io'] },
    { id: 'vercel', label: 'Vercel', hosts: ['vercel.com'] },
    { id: 'cloudflare', label: 'Cloudflare', hosts: ['dash.cloudflare.com', 'cloudflare.com'] },
    { id: 'pypi', label: 'PyPI', hosts: ['pypi.org'] },
  ],
  ...devLoopSwitch('vex.deployDesk', () => ({ enabled: true, pins: {}, finishedAt: 0, finished: '' })),

  state() {
    const s = DevLoopStore.read(this.KEY, () => ({ enabled: true, pins: {}, finishedAt: 0, finished: '' }));
    if (!s.pins || typeof s.pins !== 'object') s.pins = {};
    return s;
  },
  save(s) { DevLoopStore.write(this.KEY, s); },

  _entries() {
    if (typeof HistoryPanel !== 'undefined' && typeof HistoryPanel.list === 'function') return HistoryPanel.list();
    const raw = localStorage.getItem('vex.history');
    if (raw == null) return [];
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : (a && Array.isArray(a.entries) ? a.entries : []);
  },

  groupOf(host) {
    const h = String(host || '').toLowerCase().replace(/^www\./, '');
    return this.GROUPS.find(g => g.hosts.some(x => h === x || h.endsWith('.' + x))) || null;
  },

  // History entries -> the groups used at least MIN_VISITS times in the window,
  // busiest first, each with the deep links most recently visited. Only local history is read.
  build(entries, now = Date.now()) {
    const by = new Map();
    for (const e of entries) {
      if (!e || !e.url) continue;
      const t = typeof e.time === 'number' ? e.time : Date.parse(e.time || '') || 0;
      if (t && now - t > this.WINDOW_MS) continue;
      let u;
      try { u = new URL(e.url); } catch { continue; }
      if (u.protocol !== 'https:') continue;
      const g = this.groupOf(u.hostname);
      if (!g) continue;
      const row = by.get(g.id) || { id: g.id, label: g.label, count: 0, lastAt: 0, links: new Map() };
      row.count++;
      row.lastAt = Math.max(row.lastAt, t);
      const key = u.origin + u.pathname;
      const link = row.links.get(key) || { url: u.href, title: String(e.title || '').slice(0, 100), at: 0, n: 0, deep: g.deep ? g.deep.test(u.pathname) : u.pathname.length > 1 };
      link.n++;
      if (t >= link.at) { link.at = t; link.url = u.href; if (e.title) link.title = String(e.title).slice(0, 100); }
      row.links.set(key, link);
      by.set(g.id, row);
    }
    return Array.from(by.values()).filter(r => r.count >= this.MIN_VISITS).map(r => ({
      id: r.id, label: r.label, count: r.count, lastAt: r.lastAt,
      links: Array.from(r.links.values()).sort((a, b) => (b.deep - a.deep) || (b.at - a.at)).slice(0, 4),
    })).sort((a, b) => b.count - a.count);
  },

  groups(now = Date.now()) { return this.build(this._entries(), now); },

  pin(groupId, url) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !this.groupOf(u.hostname)) throw new Error('Only a page of one of the deploy hosts can be pinned');
    const s = this.state();
    const list = (s.pins[groupId] || []).filter(x => x !== u.href);
    list.unshift(u.href);
    s.pins[groupId] = list.slice(0, 5);
    this.save(s);
  },
  unpin(groupId, url) { const s = this.state(); s.pins[groupId] = (s.pins[groupId] || []).filter(x => x !== url); this.save(s); },

  // A GitHub watch finished (js/github-watch.js announces it): the desk says so, so its links are worth a look.
  onWatchFinished(text) {
    if (!this.enabled()) return;
    const s = this.state();
    s.finishedAt = Date.now(); s.finished = devLoopRedact(String(text || '')).slice(0, 200);
    this.save(s);
    document.dispatchEvent(new CustomEvent('vex:deploy-desk'));
  },
  start() {
    if (this._listening || typeof document === 'undefined') return;
    this._listening = true;
    document.addEventListener('vex:github-watch', (e) => this.onWatchFinished(e.detail && e.detail.text));
  },
};

if (typeof window !== 'undefined') {
  Object.assign(window, { DevLoopStore, DevLoopLocalAI, DevLoopRepos, CiFixLoop, DevlogDrafter, EndpointBoard, DependencyRadar, DeployDesk, devLoopRedact });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { DevLoopStore, DevLoopLocalAI, DevLoopRepos, CiFixLoop, DevlogDrafter, EndpointBoard, DependencyRadar, DeployDesk, devLoopRedact };
