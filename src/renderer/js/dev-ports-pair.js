// === Dev ports: named by repository, reloaded when they come back, kept apart ==
//
// You run Django on 8000, Vite on 5173 and wrangler on 8787 and open all three
// in Vex. This adds three things on top of the dev-server list (main/dev-ports.js):
//
//   Pairing    a port gets the name of a repository ("0xmortuex/vex" -> 5173). The
//              names are in Ctrl+K > "Dev ports" and in Settings > Developer desk.
//   Back up    a tab pointing at a paired port that is down is reloaded once, when the
//              port answers again (recorded in the Action Ledger; a toast is only an
//              Attention-Inbox suggestion).
//   Isolation  with "Keep each dev server's cookies apart" on, a NEW tab on a paired port
//              opens in its own cookie jar (persist:container-devport-<port>), so a login
//              on localhost:8000 no longer replaces the one on localhost:5173 (cookies
//              ignore ports; storage does not).
//
// ALLOWLIST ONLY: nothing happens to a port you did not pair. Only localhost and
// 127.0.0.1 over http count. The check is a local TCP connect (main/dev-ports.js check());
// no request is sent to the server. Off until switched on.
//
// Not built here: the LAN QR code for phone testing (it needs a firewall check).
const DevPortsPair = {
  KEY: 'vex.devPorts',
  FEATURE: 'dev-ports-pair',
  EVERY_MS: 5000,
  MAX_PAIRS: 12,
  ...DevDeskUtil.switchFor('vex.devPorts.enabled'),

  _up: new Map(),        // port -> true/false from the last check
  _job: null,

  state() {
    const s = DevDeskUtil.read(this.KEY, () => ({ pairs: {}, isolate: false }));
    if (!s.pairs || typeof s.pairs !== 'object' || Array.isArray(s.pairs)) s.pairs = {};
    return s;
  },
  isolating() { return this.enabled() && this.state().isolate === true; },
  setIsolating(on) { const s = this.state(); s.isolate = !!on; DevDeskUtil.write(this.KEY, s); },

  validPort(p) { return Number.isInteger(p) && p >= 1024 && p <= 65535; },

  // port -> repository name
  pairs() {
    const out = {};
    for (const [k, v] of Object.entries(this.state().pairs)) {
      const port = Number(k);
      if (this.validPort(port) && typeof v === 'string' && v) out[port] = v;
    }
    return out;
  },
  pair(port, name) {
    const p = Number(port);
    if (!this.validPort(p)) throw new Error('A dev server port is a number from 1024 to 65535');
    const label = String(name == null ? '' : name).trim().slice(0, 80);
    if (!label) throw new Error('Name the repository (owner/name)');
    const s = this.state();
    if (!s.pairs[p] && Object.keys(s.pairs).length >= this.MAX_PAIRS) throw new Error('At most ' + this.MAX_PAIRS + ' ports - unpair one first');
    s.pairs[p] = label;
    DevDeskUtil.write(this.KEY, s);
    this.registerCommands();
    return label;
  },
  unpair(port) {
    const s = this.state();
    if (!(String(port) in s.pairs)) throw new Error('Port ' + port + ' is not paired');
    delete s.pairs[port];
    DevDeskUtil.write(this.KEY, s);
    this._up.delete(Number(port));
    this.registerCommands();
  },

  // http://localhost:5173/... or http://127.0.0.1:5173/... -> 5173, else 0
  portOf(url) {
    let u;
    try { u = new URL(String(url)); } catch { return 0; }
    if (u.protocol !== 'http:') return 0;
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return 0;
    const p = Number(u.port);
    return this.validPort(p) ? p : 0;
  },

  partitionFor(port) { return 'persist:container-devport-' + port; },

  // For tabs.js / webview.js: the partition a tab for this URL belongs in. Returns what it
  // already had unless isolation is on, the port is paired, and the tab was an ordinary one.
  reroute(url, partition) {
    if (!this.isolating()) return partition;
    const current = partition || 'persist:main';
    if (current !== 'persist:main') return partition;
    const port = this.portOf(url);
    return port && this.pairs()[port] ? this.partitionFor(port) : partition;
  },

  // Tabs on a paired port: [{ tab, port, name }]
  tabs() {
    if (typeof TabManager === 'undefined') return [];
    const pairs = this.pairs();
    const out = [];
    for (const tab of TabManager.tabs) {
      const port = this.portOf(tab.url);
      if (port && pairs[port]) out.push({ tab, port, name: pairs[port] });
    }
    return out;
  },

  // One look: which paired ports answer, and a reload for each tab whose port just came back.
  async tick() {
    if (!this.enabled()) return [];
    const ports = Object.keys(this.pairs()).map(Number);
    if (!ports.length) return [];
    const open = new Set(await DevDeskUtil.bridge('devdeskPorts')(ports));
    const reloaded = [];
    for (const port of ports) {
      const was = this._up.get(port);
      const now = open.has(port);
      this._up.set(port, now);
      if (was === false && now) reloaded.push(...this._cameBack(port));
    }
    return reloaded;
  },

  _cameBack(port) {
    const hit = this.tabs().filter(t => t.port === port);
    const done = [];
    for (const { tab, name } of hit) {
      const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tab.id) : null;
      if (!wv || typeof wv.reload !== 'function') continue;
      wv.reload();
      done.push(tab.id);
      if (typeof VexLedger !== 'undefined') {
        VexLedger.record({ feature: this.FEATURE, what: 'Reloaded the tab on localhost:' + port + ' (' + name + ')', why: 'The dev server came back after being down' });
      }
    }
    if (done.length && typeof VexAttention !== 'undefined') {
      VexAttention.suggest({ feature: this.FEATURE, label: 'Dev ports', id: 'back:' + port, title: 'localhost:' + port + ' is back', body: done.length + ' tab' + VexPlural.s(done.length) + ' reloaded.' });
    }
    return done;
  },

  // Status words for one paired port: 'up' | 'down' | 'unknown'
  statusOf(port) { return this._up.has(port) ? (this._up.get(port) ? 'up' : 'down') : 'unknown'; },

  start() {
    if (this._job || typeof VexJobs === 'undefined') return;
    this._job = VexJobs.every('Dev ports', this.EVERY_MS, () => this.tick().catch((err) => DevDeskUtil.fail('Dev ports', err)), { feature: this.FEATURE });
  },
  stop() { if (this._job) { this._job.stop(); this._job = null; } },
  sync() { if (this.enabled()) this.start(); else this.stop(); },

  openPort(port) {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    DevDeskUtil.touch(this.FEATURE);
    const url = 'http://localhost:' + port + '/';
    return TabManager.createTab(url, true);
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    const list = this.enabled() ? Object.entries(this.pairs()).map(([port, name]) => ({
      id: 'devports:' + port, label: 'Dev port: ' + name + ' (' + port + ')', icon: 'code', hint: 'Open localhost:' + port + (this.statusOf(Number(port)) === 'down' ? ' (down right now)' : ''),
      action: () => { try { this.openPort(Number(port)); } catch (err) { DevDeskUtil.fail('Dev ports', err); } },
    })) : [];
    VexModuleCommands.set('devports:', list);
    return true;
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    const redraw = () => VexSettingsGroup.refresh('setting-dev-desk');
    const fail = (err) => DevDeskUtil.fail('Dev ports', err);
    body.appendChild(S.note('Dev ports: give a localhost port the name of a repository, reload its tabs when it comes back, and (optionally) keep each paired port\'s cookies in its own jar. Only the ports you pair are touched; the check is a local connect and sends nothing.'));
    body.appendChild(S.toggle('Dev ports', this.enabled(), (on) => { this.setEnabled(on); this.sync(); this.registerCommands(); redraw(); }));
    if (!this.enabled()) return;
    body.appendChild(S.toggle('Keep each dev server\'s cookies apart', this.state().isolate === true, (on) => { this.setIsolating(on); }, 'new tabs only'));
    for (const [port, name] of Object.entries(this.pairs())) {
      const row = DevDeskUtil.el('div', 'setting-toggle-row');
      const label = DevDeskUtil.el('span');
      const code = DevDeskUtil.el('code', '', 'localhost:' + port);
      label.append(code, ' ' + name + ' (' + this.statusOf(Number(port)) + ')');
      row.append(label, S.button('Open', () => { try { this.openPort(Number(port)); } catch (err) { fail(err); } }),
        S.button('Unpair', () => { try { this.unpair(port); redraw(); } catch (err) { fail(err); } }, 'danger'));
      body.appendChild(row);
    }
    body.appendChild(S.button('Pair a port...', () => {
      (async () => {
        const port = await vexPrompt({ title: 'Pair a port', label: 'Port number', placeholder: '5173' });
        if (port == null) return;
        const known = typeof VexRepos !== 'undefined' ? VexRepos.list().map(r => r.name).join(', ') : '';
        const name = await vexPrompt({ title: 'Which repository?', label: 'owner/name' + (known ? ' (yours: ' + known + ')' : ''), placeholder: '0xmortuex/vex' });
        if (name == null) return;
        this.pair(Number(String(port).trim()), name);
        redraw();
      })().catch(fail);
    }));
  },
};

if (typeof window !== 'undefined') {
  window.DevPortsPair = DevPortsPair;
  DevPortsPair.sync();
  DevPortsPair.registerCommands();
  document.addEventListener('DOMContentLoaded', () => { DevPortsPair.sync(); DevPortsPair.registerCommands(); });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { DevPortsPair };
