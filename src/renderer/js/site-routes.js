// === Vex per-site rules ====================================================
//
// It began as "always open these sites through Tor", and the shape it needed
// for that — a host, and the session it is allowed to open in — turned out
// to be the shape of the rule people actually want most, which is not about
// an IP address at all. It is: this site always opens in my work container.
// Two Gmail accounts, no signing out, no remembering.
//
// So a rule names a host and says where it opens:
//
//   tor        — a session routed through Tor
//   proxy      — a session routed through a proxy you already have
//   container  — one of your own containers, by name
//
// and, whichever of those it is, two things about how it behaves once open:
// muted, and never allowed to sleep.
//
// Three things make this safe rather than a hope:
//
//  - The routed session is armed on startup, and main.js installs a refused
//    loopback proxy on any Tor session before a single request can leave it.
//    If Tor is not up yet, the site does not load. It does not quietly load
//    direct, which is the failure that makes a rule worse than no rule.
//  - A rule only ever moves a tab OUT of the ordinary session. A tab already
//    in a container is left where it is: the container was a deliberate
//    choice and a rule must not silently overrule it.
//  - A tab a rule has moved says so, in the strip and in its tooltip
//    (js/tabs.js). A session you cannot see is a session you will misjudge.
//
// Every one of these sessions is a separate cookie jar, so a site opened
// through a rule is signed out of — which is the entire point of a container
// and a surprise for a proxy. The screen says so.
const SiteRoutes = {
  KEY: 'vex.siteRoutes',

  MODES: ['tor', 'proxy', 'container'],

  rules() {
    let list = null;
    try { list = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { list = null; }
    if (!Array.isArray(list)) return [];
    return list
      .filter(r => r && typeof r.host === 'string' && this.MODES.includes(r.mode))
      .map(r => ({
        host: r.host.toLowerCase(),
        mode: r.mode,
        custom: typeof r.custom === 'string' ? r.custom : null,
        container: typeof r.container === 'string' ? r.container : null,
        muted: !!r.muted,
        awake: !!r.awake,
      }));
  },

  // A container name as typed, reduced to something that can be a partition:
  // letters, digits and dashes. 'Work Email' and 'work-email' are one
  // container, which is what anyone typing either of them meant.
  normalizeContainer(input) {
    return String(input || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  },

  _save(list) {
    try { localStorage.setItem(this.KEY, JSON.stringify(list)); return true; }
    catch (err) { console.error('[SiteRoutes] the rules could not be saved:', err.message); return false; }
  },

  // A host as typed, cleaned up: a pasted URL, a stray "www.", a path.
  normalizeHost(input) {
    let h = String(input || '').trim().toLowerCase();
    if (!h) return '';
    h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0].split('?')[0].split('#')[0];
    h = h.replace(/^www\./, '').replace(/:\d+$/, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : '';
  },

  hostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
  },

  // The rule for a URL, if there is one. A rule for example.com covers
  // mail.example.com, because nobody means only the bare domain.
  match(url) {
    const host = this.hostOf(url);
    if (!host) return null;
    return this.rules().find(r => host === r.host || host.endsWith('.' + r.host)) || null;
  },

  // One session per distinct destination, so every Tor-routed site shares one
  // Tor cookie jar rather than one per site — and a container rule uses the
  // very same partition as the container of that name, so a rule and a "New
  // work container tab" land in the same place rather than two lookalikes.
  partitionFor(rule) {
    if (!rule) return null;
    if (rule.mode === 'container') {
      const name = this.normalizeContainer(rule.container);
      return name ? 'persist:container-' + name : null;
    }
    if (rule.mode === 'tor') return 'persist:route-tor';
    let slug = 0;
    for (const ch of String(rule.custom || '')) slug = (slug * 31 + ch.charCodeAt(0)) >>> 0;
    return 'persist:route-proxy-' + slug.toString(36);
  },

  // Which partition a tab for this URL belongs in. Returns the partition it
  // was already going to use unless a rule says otherwise — and never moves a
  // tab out of a container or a private session.
  reroute(url, partition) {
    const current = partition || 'persist:main';
    if (current !== 'persist:main') return partition;
    const rule = this.match(url);
    if (!rule) return partition;
    const routed = this.partitionFor(rule);
    if (!routed) return partition;           // a container rule with no name left
    this.arm(rule);
    return routed;
  },

  // How a tab a rule moved should behave once it is open: muted, and kept
  // awake. Called when the tab is made and again when it navigates, because
  // a link followed inside an existing tab is the other way to arrive.
  applyTo(tab) {
    const rule = tab && tab.url ? this.match(tab.url) : null;
    if (!rule) return null;
    const did = [];
    if (rule.muted && !tab.muted) {
      try {
        const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.webviews.get(tab.id) : null;
        if (wv && typeof wv.setAudioMuted === 'function') { wv.setAudioMuted(true); tab.muted = true; did.push('muted'); }
      } catch (err) { console.warn('[SiteRoutes] could not mute ' + rule.host + ':', err.message); }
    }
    // The same "never, until reverted" a tab's own keep-awake card writes,
    // so one mechanism decides whether a tab may sleep, not two.
    if (rule.awake && !tab.keepAwakeUntil) {
      tab.keepAwakeUntil = Number.MAX_SAFE_INTEGER;
      did.push('kept awake');
    }
    if (did.length && typeof TabManager !== 'undefined') {
      try { TabManager.renderTabUpdate(tab); } catch { /* the row catches up on the next render */ }
    }
    return did.length ? did : null;
  },

  // Put the route on the session. Armed once per session per run; the choice
  // itself is remembered by the main process and restored at startup, so this
  // is a repair rather than the only thing holding the route up.
  _armed: new Set(),
  arm(rule, force = false) {
    // A container is a cookie jar, not a route: there is nothing to arm, and
    // asking the main process to set a proxy on it would be a lie.
    if (!rule || rule.mode === 'container') return Promise.resolve(null);
    const part = this.partitionFor(rule);
    if (!part || !window.vex || typeof window.vex.routingSet !== 'function') return Promise.resolve(null);
    if (!force && this._armed.has(part)) return Promise.resolve(null);
    this._armed.add(part);
    return Promise.resolve(window.vex.routingSet(part, rule.mode, rule.custom || undefined))
      .then(r => {
        if (!r || !r.ok) {
          this._armed.delete(part);
          console.warn('[SiteRoutes] ' + rule.host + ' could not be routed:', (r && r.error) || 'unknown');
        }
        return r;
      })
      .catch(err => { this._armed.delete(part); console.warn('[SiteRoutes] ' + rule.host + ':', err.message); return null; });
  },

  // Every distinct route, armed at startup, so the first tab through a rule
  // does not wait for Tor to start.
  armAll() {
    const seen = new Set();
    for (const rule of this.rules()) {
      if (rule.mode === 'container') continue;
      const part = this.partitionFor(rule);
      if (!part || seen.has(part)) continue;
      seen.add(part);
      this.arm(rule);
    }
  },

  add(host, mode, custom, opts = {}) {
    const h = this.normalizeHost(host);
    if (!h) throw new Error('That is not a web address — try "example.com"');
    if (!this.MODES.includes(mode)) throw new Error('A rule opens a site through Tor, through a proxy, or in a container');
    if (mode === 'proxy' && !/^(socks5|socks4|http|https):\/\/[^\s]+$/i.test(String(custom || '').trim())) {
      throw new Error('A proxy looks like socks5://127.0.0.1:1080');
    }
    const container = mode === 'container' ? this.normalizeContainer(custom) : null;
    if (mode === 'container' && !container) throw new Error('Give the container a name — "work", "personal", anything');
    const rule = {
      host: h, mode,
      custom: mode === 'proxy' ? String(custom).trim() : null,
      container,
      muted: !!opts.muted,
      awake: !!opts.awake,
    };
    const list = this.rules().filter(r => r.host !== h);
    list.push(rule);
    this._save(list);
    this.arm(rule, true);
    return rule;
  },

  // One of the two switches on an existing rule, flipped.
  setFlag(host, flag, on) {
    if (flag !== 'muted' && flag !== 'awake') throw new Error('A rule can be muted or kept awake');
    const h = this.normalizeHost(host) || String(host || '').toLowerCase();
    const list = this.rules();
    const rule = list.find(r => r.host === h);
    if (!rule) throw new Error('There is no rule for ' + h);
    rule[flag] = !!on;
    this._save(list);
    return rule;
  },

  // Where a rule sends a site, in words. One sentence fragment that reads
  // correctly after both "will open" and on a row of its own.
  whereOf(rule) {
    if (!rule) return '';
    if (rule.mode === 'container') return 'in the “' + (rule.container || '?') + '” container';
    if (rule.mode === 'tor') return 'through Tor';
    return 'through ' + (rule.custom || 'your proxy');
  },

  remove(host) {
    const h = this.normalizeHost(host) || String(host || '').toLowerCase();
    const list = this.rules().filter(r => r.host !== h);
    this._save(list);
    return list;
  },

  // Which session a tab is in, in words — and the class the tab strip wears
  // to show it. A session you cannot see is a session you will misjudge: you
  // will type a password into the wrong one, or wonder why you are signed
  // out. Every tab that is not in the ordinary session says which it is in.
  describe(tab) {
    const part = (tab && tab.partition) || '';
    if (!part || part === 'persist:main') return '';
    if (part === 'persist:route-tor') return 'This tab is going through Tor';
    if (/^persist:route-proxy-/.test(part)) return 'This tab is going through your proxy';
    if (/^persist:container-/.test(part)) return 'This tab is in the “' + part.slice('persist:container-'.length) + '” container — its own separate logins';
    if (/^tor-/.test(part)) return 'This tab is going through Tor';
    if (!part.startsWith('persist:')) return 'This tab keeps nothing — it forgets everything when you close it';
    return '';
  },

  // The marker class for that session, or ''. Kept here beside describe() so
  // the words and the colour can never disagree about what a tab is.
  markerFor(tab) {
    const part = (tab && tab.partition) || '';
    if (part === 'persist:route-tor' || /^tor-/.test(part)) return 'routed-tor';
    if (/^persist:route-proxy-/.test(part)) return 'routed-proxy';
    if (/^persist:container-/.test(part)) return 'container-tab';
    return '';
  },

  // ---- the screen ---------------------------------------------------------
  open() {
    document.getElementById('vex-site-routes')?.remove();
    const esc = (v) => (window.escapeHtml ? window.escapeHtml(String(v)) : String(v));
    const m = document.createElement('div');
    m.id = 'vex-site-routes';
    m.className = 'vexsr-ov';
    m.innerHTML = '<div class="vexsr-card">'
      + '<div class="vexsr-head"><span class="vexsr-title">Sites that always open a certain way</span>'
      + '<button class="vexsr-x" id="sr-close" aria-label="Close">✕</button></div>'
      + '<div class="vexsr-sub">Name a site and Vex opens it that way every time, without you remembering to — in a container of its own, or through Tor or a proxy. A rule for <code>example.com</code> also covers <code>mail.example.com</code>.</div>'
      + '<div id="sr-list" class="vexsr-list"></div>'
      + '<div class="vexsr-row">'
      + '<input id="sr-host" placeholder="example.com" class="vexsr-input">'
      + '<select id="sr-mode" class="vexsr-input" style="flex:0 0 150px">'
      + '<option value="container">In a container</option><option value="tor">Through Tor</option><option value="proxy">Through a proxy</option>'
      + '</select>'
      + '<button id="sr-add" class="vexsr-go">Add</button>'
      + '</div>'
      + '<input id="sr-where" placeholder="work" class="vexsr-input" style="margin-top:8px;width:100%">'
      + '<div class="vexsr-row" style="margin-top:8px">'
      + '<label class="vexsr-check"><input type="checkbox" id="sr-muted"> Always muted</label>'
      + '<label class="vexsr-check"><input type="checkbox" id="sr-awake"> Never let it sleep</label>'
      + '</div>'
      + '<div id="sr-msg" class="vexsr-msg"></div>'
      + '<div class="vexsr-note">Each of these is a separate cookie jar, so a site opened by a rule is signed out of — for a container and for Tor that is the whole point, for a proxy it is worth knowing. A tab you opened in a container yourself is left alone: that was a deliberate choice. A tab a rule moved says so in the strip.</div>'
      + '</div>';
    document.body.appendChild(m);

    const msg = (t, bad) => { const e = m.querySelector('#sr-msg'); e.textContent = t || ''; e.style.color = bad ? 'var(--danger, #ef4444)' : 'var(--text-muted)'; };
    const close = () => m.remove();
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.querySelector('#sr-close').addEventListener('click', close);

    // One box for "where", because the three modes each need exactly one
    // name and asking for three separate ones would be three empty boxes.
    const mode = m.querySelector('#sr-mode');
    const where = m.querySelector('#sr-where');
    const PLACEHOLDER = { container: 'work', proxy: 'socks5://127.0.0.1:1080', tor: '' };
    const syncWhere = () => {
      where.hidden = mode.value === 'tor';
      where.placeholder = PLACEHOLDER[mode.value] || '';
    };
    mode.addEventListener('change', syncWhere);
    syncWhere();

    const draw = () => {
      const host = m.querySelector('#sr-list');
      const list = this.rules();
      if (!list.length) {
        host.innerHTML = '<div class="vexsr-empty">No rules yet. Everything goes the ordinary way.</div>';
        return;
      }
      host.innerHTML = '';
      for (const r of list) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        const extras = [r.muted ? 'muted' : '', r.awake ? 'never sleeps' : ''].filter(Boolean).join(', ');
        row.innerHTML = '<span class="vexsr-host">' + esc(r.host) + '</span>'
          + '<span class="vexsr-mode">' + esc(this.whereOf(r)) + (extras ? ' · ' + esc(extras) : '') + '</span>';
        // The two switches, on the row: they are about this site and nowhere
        // else is the right place to ask.
        for (const [flag, label] of [['muted', 'Mute'], ['awake', 'Keep awake']]) {
          const b = document.createElement('button');
          b.className = 'vexsr-x' + (r[flag] ? ' on' : '');
          b.dataset.flag = flag;
          b.dataset.host = r.host;
          b.textContent = label;
          b.setAttribute('aria-pressed', String(!!r[flag]));
          b.addEventListener('click', () => {
            try { this.setFlag(r.host, flag, !r[flag]); draw(); }
            catch (err) { msg(err.message, true); }
          });
          row.appendChild(b);
        }
        const del = document.createElement('button');
        del.className = 'vexsr-x';
        del.textContent = 'Remove';
        del.addEventListener('click', () => { this.remove(r.host); draw(); msg(r.host + ' opens the ordinary way again'); });
        row.appendChild(del);
        host.appendChild(row);
      }
    };
    draw();

    m.querySelector('#sr-add').addEventListener('click', () => {
      try {
        const r = this.add(m.querySelector('#sr-host').value, mode.value, where.value, {
          muted: m.querySelector('#sr-muted').checked,
          awake: m.querySelector('#sr-awake').checked,
        });
        m.querySelector('#sr-host').value = '';
        m.querySelector('#sr-muted').checked = false;
        m.querySelector('#sr-awake').checked = false;
        draw();
        msg(r.host + ' will open ' + this.whereOf(r) + ' from now on');
      } catch (err) { msg(err.message, true); }
    });
    m.querySelector('#sr-host').addEventListener('keydown', e => { if (e.key === 'Enter') m.querySelector('#sr-add').click(); });
    return m;
  },
};

if (typeof window !== 'undefined') {
  window.SiteRoutes = SiteRoutes;
  // Arm the routes once the window is up, so the first tab through a rule is
  // not the one waiting for Tor to start.
  if (typeof document !== 'undefined') {
    const go = () => { try { SiteRoutes.armAll(); } catch (err) { console.warn('[SiteRoutes]', err.message); } };
    if (document.readyState === 'complete') setTimeout(go, 2000);
    else window.addEventListener('load', () => setTimeout(go, 2000), { once: true });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { SiteRoutes };
