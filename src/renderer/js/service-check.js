// === "Is it me or the game?" and platform status (T3-016) ====================
//
// The connection check (js/latency-check.js, main/latency.js) already times a
// plain TCP connection to a few well-known hosts and says whether the problem is
// your line or theirs. What it cannot say is what the service itself reports.
// This adds that, from the pages the person listed:
//
//   Ctrl+K "Is it me or the game?"   reads the listed status pages AND times the
//                                    connection, then answers in one sentence with
//                                    the sources it used
//   New Tab                          a line for a service only while it reports an
//                                    incident ("Discord: Partial System Outage");
//                                    nothing at all when everything is fine
//
// What it reads is the services' own public status summary
// (<site>/api/v2/summary.json, the Atlassian Statuspage format; main/status-check.js)
// and the TCP timing that was already there. It never contacts a game server, sends
// nothing of the person's, and does not look at any game. The list starts empty: the
// person adds their own, or presses "Add the usual five" (Discord, GitHub, Cloudflare,
// Roblox, Epic Games). The background check (every 10 minutes, held while a game runs
// like every Vex job) is a separate switch and is off until switched on.
const VexServiceCheck = {
  KEYS: { on: 'vex.serviceCheck.enabled', pages: 'vex.serviceCheck.pages', bg: 'vex.serviceCheck.background', last: 'vex.serviceCheck.last' },
  FEATURE: 'service-check',
  MAX_PAGES: 12,
  EVERY_MS: 10 * 60 * 1000,
  PRESETS: [
    { name: 'Discord', site: 'discordstatus.com' },
    { name: 'GitHub', site: 'www.githubstatus.com' },
    { name: 'Cloudflare', site: 'www.cloudflarestatus.com' },
    { name: 'Roblox', site: 'status.roblox.com' },
    { name: 'Epic Games', site: 'status.epicgames.com' },
  ],
  _now() { return Date.now(); },

  enabled() { return VexMediaKit.flag(this.KEYS.on, false); },
  setEnabled(on) { VexMediaKit.setFlag(this.KEYS.on, !!on); },
  background() { return VexMediaKit.flag(this.KEYS.bg, false); },
  setBackground(on) { VexMediaKit.setFlag(this.KEYS.bg, !!on); },

  // ---- the list ---------------------------------------------------------------------
  pages() {
    const v = VexMediaKit.read(this.KEYS.pages, []);
    if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw new Error('The saved status page list is not readable');
    return v;
  },
  _normal(input) {
    const text = String(input == null ? '' : input).trim();
    if (!text) throw new Error('Type the status site, for example status.example.com');
    let u;
    try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : 'https://' + text); } catch (err) { throw new Error('That is not a web address', { cause: err }); }
    if (u.protocol !== 'https:') throw new Error('Only https status pages are read');
    if (u.username || u.password) throw new Error('Do not put a user name or password in the address');
    return u.hostname + (u.pathname.replace(/\/+$/, '') || '');
  },
  add(input) {
    const site = this._normal(input);
    const list = this.pages();
    if (list.includes(site)) throw new Error('That status page is already listed');
    if (list.length >= this.MAX_PAGES) throw new Error('That is as many status pages as Vex reads (' + this.MAX_PAGES + ')');
    list.push(site);
    VexMediaKit.write(this.KEYS.pages, list);
    return site;
  },
  remove(site) { VexMediaKit.write(this.KEYS.pages, this.pages().filter(s => s !== site)); },
  addPresets() {
    let n = 0;
    for (const p of this.PRESETS) { try { this.add(p.site); n++; } catch (err) { if (!/already listed/.test(err.message)) throw err; } }
    return n;
  },

  // ---- reading ------------------------------------------------------------------------
  async fetchStatus() {
    const list = this.pages();
    if (!list.length) throw new Error('List at least one status page first (Settings, Is it me or the game?)');
    if (!window.vex || typeof window.vex.statusCheck !== 'function') throw new Error('Status pages cannot be read in this window');
    const results = await window.vex.statusCheck(list);
    if (!Array.isArray(results)) throw new Error('The status check gave an unexpected answer');
    return results;
  },
  async fetchLatency() {
    if (!window.vex || typeof window.vex.netLatency !== 'function') throw new Error('The connection check is not available in this window');
    const r = await window.vex.netLatency();
    if (!r || !r.ok) throw new Error((r && r.error) || 'The connection check could not run');
    return r;
  },

  // ---- the answer (pure) ----------------------------------------------------------------
  // Words for the service state. 'none' is fine; anything else is an incident.
  incidents(results) {
    return (results || []).filter(r => r && r.ok && r.indicator && r.indicator !== 'none');
  },
  // → { who: 'you'|'them'|'unclear'|'fine', headline, lines: [{ source, text }] }
  combine(statusResults, latency) {
    const lines = [];
    const bad = this.incidents(statusResults);
    for (const r of statusResults || []) {
      if (!r.ok) lines.push({ source: r.url || r.host, text: (r.host || 'A status page') + ' could not be read: ' + r.error });
      else lines.push({ source: r.url, text: (r.name || r.host) + ': ' + (r.description || r.indicator) + (r.incidents && r.incidents.length ? ' (' + r.incidents.map(i => i.name).join('; ') + ')' : '') });
    }
    let line = '', yourLine = false;
    if (latency && latency.verdict) {
      line = latency.verdict;
      lines.push({ source: 'a TCP timing to a few public hosts (nothing is sent)', text: line });
      yourLine = /connection is slow|Nothing answered at all/.test(line);
    }
    if (yourLine && bad.length) return { who: 'unclear', headline: 'Both: your connection is slow and ' + bad.map(r => r.name || r.host).join(', ') + ' report a problem.', lines };
    if (yourLine) return { who: 'you', headline: 'It looks like your connection: ' + line, lines };
    if (bad.length) return { who: 'them', headline: 'It is them, not you: ' + bad.map(r => (r.name || r.host) + ' reports "' + (r.description || r.indicator) + '"').join('; ') + '.', lines };
    const unread = (statusResults || []).filter(r => !r.ok).length;
    if (unread && unread === (statusResults || []).length) return { who: 'unclear', headline: 'No status page could be read, so only your connection was checked. ' + (line || ''), lines };
    return { who: 'fine', headline: 'No listed service reports a problem and your connection looks fine. If the game still stutters the cause is on your PC or in the game\'s own servers, which no status page covers.', lines };
  },
  async ask() {
    if (!this.enabled()) throw new Error('"Is it me or the game?" is switched off in Settings');
    const [status, latency] = await Promise.all([this.fetchStatus(), this.fetchLatency()]);
    this._remember(status);
    return this.combine(status, latency);
  },

  // ---- the New Tab line and the quiet check -----------------------------------------------
  _remember(results) {
    VexMediaKit.write(this.KEYS.last, { at: this._now(), items: (results || []).filter(r => r && r.ok).map(r => ({ name: r.name || r.host, indicator: r.indicator, description: r.description })) });
  },
  // Only a service that reports an incident gets a line; a result older than 3 hours is not shown.
  widgetLines(now = this._now()) {
    if (!this.enabled()) return [];
    const last = VexMediaKit.read(this.KEYS.last, null);
    if (!last || !Array.isArray(last.items) || now - last.at > 3 * 3600 * 1000) return [];
    return last.items.filter(i => i.indicator && i.indicator !== 'none').slice(0, 3).map(i => i.name + ': ' + (i.description || i.indicator));
  },
  async tick() {
    if (!this.enabled() || !this.background() || !this.pages().length) return null;
    const before = new Set(this.widgetLines().map(l => l));
    const results = await this.fetchStatus();
    this._remember(results);
    const fresh = this.widgetLines().filter(l => !before.has(l));
    if (fresh.length && typeof VexAttention !== 'undefined') {
      VexAttention.notify({ feature: this.FEATURE, urgency: 'useful', id: fresh.join('|').slice(0, 80), title: 'A service reports a problem: ' + fresh[0] },
        () => VexMediaKit.toast('A service reports a problem: ' + fresh.join('; '), 'info', 8000));
    }
    return results;
  },

  // ---- drawing ------------------------------------------------------------------------------
  async show() {
    const K = VexMediaKit;
    const { body } = K.dialog({ id: 'service-check', title: 'Is it me or the game?', sub: 'The services\' own status pages and a connection timing. Nothing is sent to a game server.' });
    body.appendChild(K.info('Checking...'));
    let answer;
    try { answer = await this.ask(); }
    catch (err) { body.textContent = ''; body.appendChild(K.info(err.message)); return null; }
    body.textContent = '';
    body.appendChild(K.el('p', 'setting-label-text', answer.headline));
    for (const l of answer.lines) {
      const r = K.el('div', 'setting-row');
      r.appendChild(K.el('span', '', l.text));
      r.appendChild(K.el('span', 'setting-info', 'Source: ' + l.source));
      body.appendChild(r);
    }
    return answer;
  },
  render(body) {
    const K = VexMediaKit;
    body.textContent = '';
    body.appendChild(K.info('Checks the status pages you list (the services\' own public summaries) together with a connection timing, and says whether the problem is you or them. Never contacts a game server.'));
    body.appendChild(K.switchRow('Is it me or the game?', this.enabled(), (on) => this.setEnabled(on)));
    body.appendChild(K.switchRow('Check in the background every 10 minutes and show a line on the New Tab only during an incident', this.background(), (on) => this.setBackground(on)));
    const list = K.el('div');
    const draw = () => {
      list.textContent = '';
      let pages;
      try { pages = this.pages(); } catch (err) { list.appendChild(K.info(err.message)); return; }
      if (!pages.length) list.appendChild(K.info('No status pages listed yet.'));
      for (const p of pages) list.appendChild(K.row(p, K.button('Remove', () => { this.remove(p); draw(); }, { danger: true, label: 'Remove ' + p })));
    };
    draw();
    const input = K.input('Status site to add', { placeholder: 'status.example.com', max: 300 });
    body.append(list, K.row('Add a status page', input, K.button('Add', () => { this.add(input.value); input.value = ''; draw(); })),
      K.button('Add the usual five', () => { const n = this.addPresets(); draw(); K.toast(n ? 'Added ' + n : 'They were all listed already'); }),
      K.button('Check now', () => this.show()));
  },
  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof VexJobs === 'undefined') throw new Error('VexJobs is not loaded: js/jobs.js must come before js/service-check.js');
    VexJobs.every('Service status', this.EVERY_MS, () => this.tick(), { when: 'background', deferOnBattery: true, feature: this.FEATURE });
    if (typeof VexNewTab !== 'undefined' && typeof VexNewTab.addTextWidget === 'function') VexNewTab.addTextWidget(this.FEATURE, () => this.widgetLines());
    VexMediaKit.register({
      id: 'service-check', title: 'Is it me or the game?', keywords: 'status outage down discord steam roblox github cloudflare lag ping',
      render: (b) => this.render(b),
      commands: [{ id: 'service-check', label: 'Is it me or the game?', hint: 'Status pages and a connection timing, with sources', icon: 'wifi', action: () => { this.show().catch((err) => VexMediaKit.fail(err)); } }],
    });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexServiceCheck = VexServiceCheck;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexServiceCheck };
