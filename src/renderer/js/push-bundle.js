// === Site notification bundling (T3-052) =========================================
//
// Some sites send a notification for everything (a shop, a forum, a news site). Windows
// shows each one as it comes. For the few sites the person LISTS, this holds those
// notifications back and shows them together, once an hour (or inside the Delivery windows
// digest, js/attention-digest.js, when that is on).
//
//   Opt in per site   only the sites you list are touched; every other site, and every
//                     private or Tor tab and private window, is left exactly as it is
//   Straight through  a notification is never held if it looks like a one-time code or a
//                     sign-in/security/emergency message, or contains a word you gave
//                     ("school", "driver"): those are shown at once, as the page asked
//   Never lost        if a notification cannot be held for any reason it is shown; nothing
//                     held is deleted before it has been shown or listed; an unshown one is
//                     released after 3 hours whatever else is going on
//   Banks             a bank, payment or government address cannot be listed at all
//   Not here          Discord and WhatsApp are handled by "Notifications from panels"
//
// How: the tab's preload (preload-webview.js) wraps Notification on a listed page only. What
// it holds (a title and a short body, nothing else) comes to this window, is kept on this
// computer for 3 days (at most 200), and never leaves it.
const VexPushBundle = {
  KEYS: { on: 'vex.pushBundle.enabled', data: 'vex.pushBundle' },
  FEATURE: 'push-bundle',
  EVERY_MS: 5 * 60 * 1000,
  BUNDLE_MS: 60 * 60 * 1000,
  MAX_HOLD_MS: 3 * 60 * 60 * 1000,
  MAX_ITEMS: 200,
  MAX_AGE_MS: 3 * 24 * 3600 * 1000,
  MAX_HOSTS: 30,
  MAX_WORDS: 20,
  // One-time codes, sign-in and security messages, emergencies. Always straight through.
  BUILTIN_PASS: [
    'one[- ]?time', '\\botp\\b', '\\b2fa\\b', 'two[- ]?factor', 'verification', 'verify', 'security (code|alert)', '(sign|log)[- ]?in (code|attempt|alert)',
    'pass ?code', 'password', 'unusual (sign|log|activity)', 'suspicious', 'fraud', 'emergency', 'urgent', 'evacuat', 'amber alert', 'lockdown',
    '\\b\\d{4,8}\\b (is|as) your', '(code|pin)[: ]+\\d{4,8}',
  ],
  _now() { return Date.now(); },

  enabled() { return VexMediaKit.flag(this.KEYS.on, false); },
  setEnabled(on) {
    VexMediaKit.setFlag(this.KEYS.on, !!on);
    this.pushAll();
  },

  // ---- pure ----------------------------------------------------------------------------
  passSource(words) {
    const esc = (w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.BUILTIN_PASS.concat((words || []).map(esc)).join('|');
  },
  // Would this notification be shown at once? (The page does the same test with the same source.)
  passes(title, body, words) {
    return new RegExp(this.passSource(words), 'i').test(String(title) + ' ' + String(body));
  },
  cleanHost(input) {
    let h = String(input == null ? '' : input).trim().toLowerCase();
    try { if (/^[a-z][a-z0-9+.-]*:\/\//.test(h)) h = new URL(h).hostname; } catch (err) { throw new Error('That is not a web address', { cause: err }); }
    h = h.replace(/^www\./, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h) || h.length > 100) throw new Error('"' + String(input).slice(0, 40) + '" is not a site name like shop.example.com');
    if (/(^|\.)(discord\.com|discordapp\.com|whatsapp\.com)$/.test(h)) throw new Error('Discord and WhatsApp are handled by "Notifications from panels"');
    if (/bank|paypal|wise\.com|revolut|monzo|n26|stripe|(^|\.)gov(\.|$)/.test(h)) throw new Error('A bank, payment or government site cannot be bundled: its notifications are often codes you need at once');
    return h;
  },
  // 'a.com': 2, 'b.com': 1 → "a.com 2, b.com 1"
  describe(items) {
    const by = new Map();
    for (const i of items) by.set(i.host, (by.get(i.host) || 0) + 1);
    return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([h, n]) => h + ' ' + n).join(', ');
  },

  // ---- data -------------------------------------------------------------------------------
  data() {
    const v = VexMediaKit.read(this.KEYS.data, null);
    if (v == null) return { hosts: [], words: [], items: [] };
    if (typeof v !== 'object' || !Array.isArray(v.hosts) || !Array.isArray(v.words) || !Array.isArray(v.items)) throw new Error('The saved notification bundle is not readable');
    return v;
  },
  _save(d) { VexMediaKit.write(this.KEYS.data, d); },
  addHost(input) {
    const h = this.cleanHost(input);
    const d = this.data();
    if (d.hosts.includes(h)) throw new Error('That site is already listed');
    if (d.hosts.length >= this.MAX_HOSTS) throw new Error('At most ' + this.MAX_HOSTS + ' sites');
    d.hosts.push(h);
    this._save(d);
    this.pushAll();
    return h;
  },
  removeHost(h) { const d = this.data(); d.hosts = d.hosts.filter(x => x !== h); this._save(d); this.pushAll(); },
  setWords(input) {
    const words = [...new Set((Array.isArray(input) ? input : String(input == null ? '' : input).split(/[\n,;]+/)).map(w => String(w).trim().toLowerCase()).filter(Boolean))];
    if (words.some(w => w.length < 2 || w.length > 40)) throw new Error('Each word is 2 to 40 characters');
    if (words.length > this.MAX_WORDS) throw new Error('At most ' + this.MAX_WORDS + ' words');
    const d = this.data();
    d.words = words;
    this._save(d);
    this.pushAll();
    return words;
  },

  // ---- telling the pages -------------------------------------------------------------------------
  _readable(webview) {
    const policy = typeof window !== 'undefined' ? window.VexTabPolicy : null;
    return !!(policy && typeof policy.canReadWebview === 'function' && webview && !policy.isPrivateWindow && policy.canReadWebview(webview));
  },
  rules() {
    const d = this.data();
    return this.enabled() ? { hosts: d.hosts.slice(), pass: this.passSource(d.words) } : { hosts: [], pass: '' };
  },
  pushRules(webview) {
    if (!webview || typeof webview.send !== 'function') return false;
    if (!this._readable(webview)) return false;
    // A page that was never given rules is never touched, so nothing is sent while the feature
    // is off and has never been on for it.
    if (!this.enabled() && !this._sent.has(webview)) return false;
    webview.send('vex-push-rules', this.rules());
    this._sent.add(webview);
    return true;
  },
  _sent: new WeakSet(),
  pushAll() {
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) return 0;
    let n = 0;
    for (const wv of WebviewManager.webviews.values()) { try { if (this.pushRules(wv)) n++; } catch (err) { VexMediaKit.problem('Notifications', 'A page could not be told about the bundle', err); } }
    return n;
  },

  // ---- coming in -----------------------------------------------------------------------------------
  fromTab(webview, payload) {
    if (!this.enabled() || !this._readable(webview)) return null;
    let host = '';
    try { host = new URL(webview.getURL()).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
    const d = this.data();
    if (!d.hosts.some(h => host === h || host.endsWith('.' + h))) return null;
    if (!payload || typeof payload !== 'object') throw new Error('A held notification needs a title and a body');
    const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
    const title = clean(payload.title, 200), body = clean(payload.body, 300);
    if (!title && !body) return null;
    const now = this._now();
    const item = { id: VexMediaKit.uid('pb'), host, title, body, ts: now, released: 0 };
    d.items = d.items.filter(i => now - i.ts < this.MAX_AGE_MS);
    d.items.unshift(item);
    while (d.items.length > this.MAX_ITEMS) d.items.pop();
    this._save(d);
    return item;
  },
  list({ since = 0, unreleasedOnly = true } = {}) {
    const now = this._now();
    return this.data().items.filter(i => i.ts > since && now - i.ts < this.MAX_AGE_MS && (!unreleasedOnly || !i.released));
  },
  markReleased(ids = null) {
    const d = this.data();
    const now = this._now();
    let n = 0;
    for (const i of d.items) if (!i.released && (!ids || ids.includes(i.id))) { i.released = now; n++; }
    if (n) this._save(d);
    return n;
  },
  forget() { const d = this.data(); d.items = []; this._save(d); },

  // ---- going out ---------------------------------------------------------------------------------------
  // The digest has the final say when it is on, except that nothing waits more than MAX_HOLD_MS.
  release({ force = false } = {}) {
    if (!this.enabled()) return null;
    const items = this.list();
    if (!items.length) return null;
    const now = this._now();
    const oldest = Math.min(...items.map(i => i.ts));
    const overdue = now - oldest >= this.MAX_HOLD_MS;
    if (!force && typeof AttentionDigest !== 'undefined' && AttentionDigest.enabled() && !overdue) return null;
    if (!force && now - oldest < this.BUNDLE_MS) return null;
    if (!force && VexMediaKit.quiet() && !overdue) return null;
    const text = items.length + ' site notification' + VexPlural.s(items.length) + ' held for you: ' + this.describe(items) + '.';
    this.markReleased(items.map(i => i.id));
    const show = () => VexMediaKit.toast(text, 'info', 12000, { action: { label: 'See them', run: () => this.open() } });
    if (typeof VexAttention !== 'undefined') VexAttention.notify({ feature: this.FEATURE, urgency: 'asked', id: 'b' + now, title: text }, show);
    else show();
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({ feature: this.FEATURE, what: 'Showed ' + items.length + ' held site notification' + VexPlural.s(items.length) + ' together', why: 'You listed these sites to be bundled once an hour (' + this.describe(items) + ')' });
    }
    return text;
  },

  // ---- drawing -----------------------------------------------------------------------------------------------
  open() {
    const K = VexMediaKit;
    const { body } = K.dialog({ id: 'push-bundle', title: 'Held site notifications', sub: 'What the sites you listed sent, newest first. Kept for 3 days on this computer.' });
    const items = this.list({ unreleasedOnly: false });
    if (!items.length) body.appendChild(K.info('Nothing held.'));
    for (const i of items) body.appendChild(K.row(i.host + ': ' + i.title + (i.body ? ' - ' + i.body : '') + (i.released ? '' : ' (not shown yet)'), K.button('Open site', () => TabManager.createTab('https://' + i.host + '/', true), { label: 'Open ' + i.host })));
    body.appendChild(K.button('Forget them all', () => { this.forget(); K.toast('Forgotten'); }, { danger: true }));
  },
  render(body) {
    const K = VexMediaKit;
    body.textContent = '';
    body.appendChild(K.info('For the sites you list, notifications are held and shown together once an hour instead of one by one. One-time codes, sign-in and security messages, emergencies and the words you give are never held. Other sites, private tabs, banks, Discord and WhatsApp are not touched.'));
    body.appendChild(K.switchRow('Bundle notifications from the sites I list', this.enabled(), (on) => this.setEnabled(on)));
    const list = K.el('div');
    const wordsIn = K.input('Words that must always come straight through', { value: '', placeholder: 'school, driver, delivery', max: 300 });
    const draw = () => {
      list.textContent = '';
      let d;
      try { d = this.data(); } catch (err) { list.appendChild(K.info(err.message)); return; }
      wordsIn.value = d.words.join(', ');
      if (!d.hosts.length) list.appendChild(K.info('No sites listed. Nothing is held.'));
      for (const h of d.hosts) list.appendChild(K.row(h, K.button('Remove', () => { this.removeHost(h); draw(); }, { danger: true, label: 'Remove ' + h })));
    };
    draw();
    wordsIn.addEventListener('change', () => { try { this.setWords(wordsIn.value); } catch (err) { K.fail(err); } });
    const site = K.input('Site to bundle', { placeholder: 'shop.example.com', max: 100 });
    body.append(list, K.row('Add a site', site, K.button('Add', () => { this.addHost(site.value); site.value = ''; draw(); })), K.row('Always straight through', wordsIn),
      K.button('See held notifications', () => this.open()), K.button('Show them now', () => { const t = this.release({ force: true }); K.toast(t || 'Nothing is held'); }));
  },
  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof VexJobs === 'undefined') throw new Error('VexJobs is not loaded: js/jobs.js must come before js/push-bundle.js');
    VexJobs.every('Site notification bundle', this.EVERY_MS, () => this.release(), { when: 'background', feature: this.FEATURE });
    VexMediaKit.register({
      id: 'push-bundle', title: 'Bundle site notifications', keywords: 'notifications push sites bundle digest hourly quiet',
      render: (b) => this.render(b),
      commands: [{ id: 'push-bundle', label: 'Held site notifications', hint: 'What the bundled sites sent', icon: 'bell', action: () => { try { this.open(); } catch (err) { VexMediaKit.fail(err); } } }],
    });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexPushBundle = VexPushBundle;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPushBundle };
