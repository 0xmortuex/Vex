// === Vex per-site routing rules ============================================
//
// "Always open these sites through Tor." Routing already works per session,
// and a container is a session — so a rule is a host plus the session it is
// allowed to be opened in. Name a host here and every tab that goes there
// opens in a session that is routed, without you remembering to.
//
// Two things make this safe rather than a hope:
//
//  - The routed session is armed on startup, and main.js installs a refused
//    loopback proxy on any Tor session before a single request can leave it.
//    If Tor is not up yet, the site does not load. It does not quietly load
//    direct, which is the failure that makes a rule worse than no rule.
//  - A rule only ever moves a tab OUT of the ordinary session. A tab already
//    in a container is left where it is: the container was a deliberate
//    choice and a rule must not silently overrule it.
//
// A routed session is a separate cookie jar, so a site opened through a rule
// is signed out. That is said on the screen, because for Tor it is the point
// and for a proxy it is a surprise.
const SiteRoutes = {
  KEY: 'vex.siteRoutes',

  rules() {
    let list = null;
    try { list = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { list = null; }
    if (!Array.isArray(list)) return [];
    return list
      .filter(r => r && typeof r.host === 'string' && (r.mode === 'tor' || r.mode === 'proxy'))
      .map(r => ({ host: r.host.toLowerCase(), mode: r.mode, custom: typeof r.custom === 'string' ? r.custom : null }));
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

  // One session per distinct route, so every Tor-routed site shares one Tor
  // cookie jar rather than one per site.
  partitionFor(rule) {
    if (!rule) return null;
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
    this.arm(rule);
    return routed;
  },

  // Put the route on the session. Armed once per session per run; the choice
  // itself is remembered by the main process and restored at startup, so this
  // is a repair rather than the only thing holding the route up.
  _armed: new Set(),
  arm(rule, force = false) {
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
      const part = this.partitionFor(rule);
      if (seen.has(part)) continue;
      seen.add(part);
      this.arm(rule);
    }
  },

  add(host, mode, custom) {
    const h = this.normalizeHost(host);
    if (!h) throw new Error('That is not a web address — try "example.com"');
    if (mode !== 'tor' && mode !== 'proxy') throw new Error('A rule routes through Tor or through a proxy');
    if (mode === 'proxy' && !/^(socks5|socks4|http|https):\/\/[^\s]+$/i.test(String(custom || '').trim())) {
      throw new Error('A proxy looks like socks5://127.0.0.1:1080');
    }
    const rule = { host: h, mode, custom: mode === 'proxy' ? String(custom).trim() : null };
    const list = this.rules().filter(r => r.host !== h);
    list.push(rule);
    this._save(list);
    this.arm(rule, true);
    return rule;
  },

  remove(host) {
    const h = this.normalizeHost(host) || String(host || '').toLowerCase();
    const list = this.rules().filter(r => r.host !== h);
    this._save(list);
    return list;
  },

  // Is this tab open through one of its rules? Used by the marker in the
  // toolbar, so a routed tab never looks like an ordinary one.
  describe(tab) {
    if (!tab || !tab.partition) return '';
    if (tab.partition === 'persist:route-tor') return 'This tab is going through Tor because of a site rule';
    if (/^persist:route-proxy-/.test(tab.partition)) return 'This tab is going through your proxy because of a site rule';
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
      + '<div class="vexsr-head"><span class="vexsr-title">Sites that always go through a route</span>'
      + '<button class="vexsr-x" id="sr-close" aria-label="Close">✕</button></div>'
      + '<div class="vexsr-sub">Name a site and Vex opens it in a session of its own that is routed — every time, without you remembering to. A rule for <code>example.com</code> also covers <code>mail.example.com</code>.</div>'
      + '<div id="sr-list" class="vexsr-list"></div>'
      + '<div class="vexsr-row">'
      + '<input id="sr-host" placeholder="example.com" class="vexsr-input">'
      + '<select id="sr-mode" class="vexsr-input" style="flex:0 0 130px"><option value="tor">Through Tor</option><option value="proxy">Through a proxy</option></select>'
      + '<button id="sr-add" class="vexsr-go">Add</button>'
      + '</div>'
      + '<input id="sr-proxy" placeholder="socks5://127.0.0.1:1080" class="vexsr-input" hidden style="margin-top:8px;width:100%">'
      + '<div id="sr-msg" class="vexsr-msg"></div>'
      + '<div class="vexsr-note">A routed session is a separate cookie jar, so a site opened by a rule is signed out of — for Tor that is the point, for a proxy it is worth knowing. A tab you opened in a container is left alone: that was a deliberate choice.</div>'
      + '</div>';
    document.body.appendChild(m);

    const msg = (t, bad) => { const e = m.querySelector('#sr-msg'); e.textContent = t || ''; e.style.color = bad ? 'var(--danger, #ef4444)' : 'var(--text-muted)'; };
    const close = () => m.remove();
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.querySelector('#sr-close').addEventListener('click', close);

    const mode = m.querySelector('#sr-mode');
    const proxy = m.querySelector('#sr-proxy');
    mode.addEventListener('change', () => { proxy.hidden = mode.value !== 'proxy'; });

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
        row.innerHTML = '<span class="vexsr-host">' + esc(r.host) + '</span>'
          + '<span class="vexsr-mode">' + (r.mode === 'tor' ? 'Tor' : esc(r.custom || 'proxy')) + '</span>';
        const del = document.createElement('button');
        del.className = 'vexsr-x';
        del.textContent = 'Remove';
        del.addEventListener('click', () => { this.remove(r.host); draw(); msg(r.host + ' goes the ordinary way again'); });
        row.appendChild(del);
        host.appendChild(row);
      }
    };
    draw();

    m.querySelector('#sr-add').addEventListener('click', () => {
      try {
        const r = this.add(m.querySelector('#sr-host').value, mode.value, proxy.value);
        m.querySelector('#sr-host').value = '';
        draw();
        msg(r.host + ' will open through ' + (r.mode === 'tor' ? 'Tor' : 'your proxy') + ' from now on');
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
