// === Docs version pinning and answer-age lens ====================================
//
// Docs pages default to "latest" or to whatever version a search result linked.
// Pin the version each project uses (Django 5.1, Python 3.12, Node 22, Rust 1.80)
// and a bar on a docs page for ANOTHER version says so, with a link to the same
// page at your version (that page may not exist; the link is a guess at the same
// path, said so). On a Stack Overflow question each answer gets its age and the
// card shows how old the question and the best answers are, with a jump to the
// newest answer that still has a good score.
//
// Docs hosts known: docs.djangoproject.com, docs.python.org, nodejs.org/docs,
// doc.rust-lang.org. Pins are on this computer; the page is only read for the
// dates, and the page's own text is never kept or sent. Private, Tor and routed
// tabs are not touched.
//
// Not built: the "watch this bookmark for change" flag that would feed page watch;
// page watch has its own add flow (js/page-watch.js) and a second entry point to it
// was left for a later pass.
const VexDocsPin = {
  KEY: 'vex.docsPins',              // { current: 'project', projects: { name: { django: '5.1' } } }
  ENABLED_KEY: 'vex.docsPins.enabled',

  enabled() { return VexBench.flag(this.ENABLED_KEY); },
  setEnabled(on) { VexBench.setFlag(this.ENABLED_KEY, on); },

  // Docs hosts: how to read the version out of an address and how to put another in.
  PRODUCTS: {
    django: {
      title: 'Django',
      read(u) { if (u.hostname !== 'docs.djangoproject.com') return null; const m = /^\/[a-z-]+\/([0-9]+\.[0-9]+|dev)(\/|$)/.exec(u.pathname); return m ? m[1] : null; },
      swap(u, v) { const n = new URL(u.href); n.pathname = u.pathname.replace(/^(\/[a-z-]+\/)([0-9]+\.[0-9]+|dev)(\/|$)/, (m, a, b, c) => a + v + c); return n.href; },
    },
    python: {
      title: 'Python',
      read(u) { if (u.hostname !== 'docs.python.org') return null; const m = /^\/(?:[a-z]{2}(?:-[A-Za-z]+)?\/)?(3(?:\.[0-9]+)?|dev)(\/|$)/.exec(u.pathname); return m ? m[1] : null; },
      swap(u, v) { const n = new URL(u.href); n.pathname = u.pathname.replace(/^(\/(?:[a-z]{2}(?:-[A-Za-z]+)?\/)?)(3(?:\.[0-9]+)?|dev)(\/|$)/, (m, a, b, c) => a + v + c); return n.href; },
    },
    node: {
      title: 'Node.js',
      read(u) { if (u.hostname !== 'nodejs.org') return null; const m = /^\/docs\/(latest-v([0-9]+)\.x|v([0-9]+)\.[0-9]+\.[0-9]+|latest)\//.exec(u.pathname); return m ? (m[2] || m[3] || 'latest') : null; },
      swap(u, v) { const n = new URL(u.href); n.pathname = u.pathname.replace(/^\/docs\/(?:latest-v[0-9]+\.x|v[0-9]+\.[0-9]+\.[0-9]+|latest)\//, '/docs/latest-v' + v + '.x/'); return n.href; },
    },
    rust: {
      title: 'Rust',
      read(u) { if (u.hostname !== 'doc.rust-lang.org') return null; const m = /^\/(stable|beta|nightly|[0-9]+\.[0-9]+\.[0-9]+)(\/|$)/.exec(u.pathname); return m ? m[1] : null; },
      swap(u, v) { const n = new URL(u.href); n.pathname = u.pathname.replace(/^\/(stable|beta|nightly|[0-9]+\.[0-9]+\.[0-9]+)(\/|$)/, (m, a, b) => '/' + v + b); return n.href; },
    },
  },

  // → { product, title, version } for a docs address, or null.
  parse(url) {
    let u;
    try { u = new URL(String(url)); } catch { return null; }
    if (u.protocol !== 'https:') return null;
    for (const [product, p] of Object.entries(this.PRODUCTS)) {
      const version = p.read(u);
      if (version) return { product, title: p.title, version };
    }
    return null;
  },
  // The address at another version, or null when it is already that version.
  switchTo(url, product, version) {
    const u = new URL(String(url));
    const p = this.PRODUCTS[product];
    if (!p || !/^[A-Za-z0-9.]{1,12}$/.test(version)) throw new Error('That version cannot be used');
    if (p.read(u) === version) return null;
    return p.swap(u, version);
  },

  // ---- pins -----------------------------------------------------------------------------
  _strict() {
    const raw = localStorage.getItem(this.KEY);
    if (!raw) return { current: '', projects: {} };
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || typeof o.projects !== 'object' || Array.isArray(o.projects)) throw new Error('The pinned versions are not readable, so they were not changed');
    return o;
  },
  state() {
    try { return this._strict(); }
    catch (err) { console.error('[DocsPin] the pins could not be read:', err.message); return { current: '', projects: {} }; }
  },
  setPin(project, product, version) {
    if (!/^[\w .-]{1,40}$/.test(project)) throw new Error('A project name is letters, digits, spaces, dots and dashes');
    if (!this.PRODUCTS[product]) throw new Error('Unknown product ' + product);
    if (!/^[A-Za-z0-9.]{1,12}$/.test(version)) throw new Error('A version is like 5.1 or 22');
    const s = this._strict();
    (s.projects[project] = s.projects[project] || {})[product] = version;
    if (!s.current) s.current = project;
    localStorage.setItem(this.KEY, JSON.stringify(s));
  },
  removePin(project, product) {
    const s = this._strict();
    if (s.projects[project]) { delete s.projects[project][product]; if (!Object.keys(s.projects[project]).length) delete s.projects[project]; }
    if (!s.projects[s.current]) s.current = Object.keys(s.projects)[0] || '';
    localStorage.setItem(this.KEY, JSON.stringify(s));
  },
  setCurrent(project) {
    const s = this._strict();
    if (!s.projects[project]) throw new Error('No such project');
    s.current = project;
    localStorage.setItem(this.KEY, JSON.stringify(s));
  },
  pinFor(product) { const s = this.state(); return (s.projects[s.current] || {})[product] || null; },

  // ---- Stack Overflow answer age (pure part) ---------------------------------------------
  // data: { question: iso, answers: [{ id, iso, score, accepted }] } -> what to show.
  YEAR: 365.25 * 24 * 3600 * 1000,
  summarize(data, now = Date.now()) {
    const years = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? (now - t) / this.YEAR : null; };
    const answers = (data.answers || []).map(a => ({ ...a, age: years(a.iso) })).filter(a => a.age != null);
    const top = answers.reduce((m, a) => Math.max(m, a.score || 0), 0);
    const good = answers.filter(a => (a.score || 0) >= Math.max(3, top / 2));
    const newestGood = good.slice().sort((a, b) => a.age - b.age)[0] || null;
    const accepted = answers.find(a => a.accepted) || null;
    return { questionAge: years(data.question), answers, accepted, newestGood, top };
  },
  ageText(y) { return y == null ? 'unknown age' : y < 1 ? Math.max(1, Math.round(y * 12)) + ' month' + (Math.round(y * 12) === 1 ? '' : 's') + ' old' : (Math.round(y * 10) / 10) + ' years old'; },

  async onSettled(tab, wv) {
    if (!VexBench.canRead(wv)) return;
    const url = String(tab.url || '');
    const doc = this.parse(url);
    if (doc) {
      const pin = this.pinFor(doc.product);
      if (!pin || pin === doc.version) { await VexBench.clearInPage(wv, 'vex-docs-pin'); return; }
      const link = this.switchTo(url, doc.product, pin);
      await VexBench.inPage(wv, {
        id: 'vex-docs-pin', mode: 'bar', tone: 'caution',
        title: 'This is the ' + doc.title + ' ' + doc.version + ' documentation; your project uses ' + pin + '.',
        actions: link ? [{ label: 'Same page at ' + pin + ' (may not exist)', href: link }] : [],
      });
      return;
    }
    if (/^https:\/\/(?:[a-z0-9-]+\.)?(?:stackoverflow|serverfault|superuser|askubuntu)\.com\/questions\/\d+/i.test(url) || /^https:\/\/[a-z]+\.stackexchange\.com\/questions\/\d+/i.test(url)) await this.stackOverflow(wv);
  },

  async stackOverflow(wv) {
    const raw = await wv.executeJavaScript('(' + function () {
      const dateOf = (root) => { const t = root.querySelector('time[itemprop="dateCreated"], .user-action-time time, time[datetime]'); return t ? (t.getAttribute('datetime') || '') : ''; };
      const q = document.querySelector('#question');
      const answers = [];
      document.querySelectorAll('.answer[data-answerid]').forEach((a) => {
        const vote = a.querySelector('.js-vote-count');
        answers.push({ id: a.getAttribute('data-answerid'), iso: dateOf(a.querySelector('.post-layout, .answercell') || a), score: vote ? parseInt(vote.getAttribute('data-value') || vote.textContent, 10) || 0 : 0, accepted: a.classList.contains('accepted-answer') });
      });
      return JSON.stringify({ question: q ? dateOf(q) : '', answers });
    }.toString() + ')()');
    const data = JSON.parse(raw);
    if (!data.answers.length) return;
    const s = this.summarize(data);
    const rows = [['Question', this.ageText(s.questionAge)]];
    if (s.accepted) rows.push(['Accepted answer', this.ageText(s.accepted.age)]);
    if (s.newestGood) rows.push(['Newest good answer', this.ageText(s.newestGood.age) + ', score ' + s.newestGood.score]);
    const oldest = s.answers.every(a => a.age > 4);
    await VexBench.inPage(wv, {
      id: 'vex-answer-age', mode: 'card', tone: oldest ? 'caution' : 'info', title: 'Answer age', rows,
      lines: oldest ? ['Every answer here is more than four years old; check the version it assumes.'] : [],
      actions: s.newestGood ? [{ label: 'Jump to the newest good answer', scrollTo: 'answer-' + s.newestGood.id }] : [],
    });
  },

  // ---- Settings ---------------------------------------------------------------------------
  settingsRows(box) {
    box.appendChild(VexSettingsGroup.note('Pin the version your project uses; a docs page for another version shows a bar with a link to your version. Stack Overflow questions show how old the answers are.'));
    const s = this.state();
    const names = Object.keys(s.projects);
    const sel = document.createElement('select');
    names.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; o.selected = n === s.current; sel.appendChild(o); });
    sel.addEventListener('change', () => { try { this.setCurrent(sel.value); VexSettingsGroups.inject(); } catch (e) { VexBench.fail(e); } });
    if (names.length) box.appendChild(VexSettingsGroup.field('Current project', sel));
    for (const [product, v] of Object.entries(s.projects[s.current] || {})) {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:4px 0';
      const t = document.createElement('span'); t.style.flex = '1'; t.textContent = this.PRODUCTS[product].title + ' ' + v;
      row.append(t, VexSettingsGroup.button('Remove', () => { try { this.removePin(s.current, product); VexSettingsGroups.inject(); } catch (e) { VexBench.fail(e); } }, 'danger'));
      box.appendChild(row);
    }
    box.appendChild(VexSettingsGroup.button('Pin a version...', async () => {
      try {
        const project = await vexPrompt({ title: 'Project', label: 'Project name', value: s.current || 'my project' });
        if (project == null) return;
        const product = await vexPrompt({ title: 'Product', message: 'One of: ' + Object.keys(this.PRODUCTS).join(', '), label: 'Product', value: 'django' });
        if (product == null) return;
        const version = await vexPrompt({ title: 'Version', message: 'For example 5.1, 3.12, 22 or 1.80.0', label: 'Version', value: '' });
        if (version == null) return;
        this.setPin(project.trim(), product.trim().toLowerCase(), version.trim());
        VexSettingsGroups.inject();
      } catch (e) { VexBench.fail(e); }
    }));
  },
};

if (typeof window !== 'undefined') {
  window.VexDocsPin = VexDocsPin;
  VexBench.register({
    id: 'docs-pin', title: 'Docs version pinning and answer age', hint: 'django, python, node, rust + Stack Overflow',
    enabled: () => VexDocsPin.enabled(), setEnabled: (on) => VexDocsPin.setEnabled(on),
    settingsRows: (box) => VexDocsPin.settingsRows(box), onSettled: (t, wv) => VexDocsPin.onSettled(t, wv),
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDocsPin };
