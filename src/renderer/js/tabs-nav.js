// === Tabs and navigation extras ===============================================
//
// One small module for the ergonomics that sit between the address bar, the find
// bar, the tab strip and the window (master list T2-001, 026, 032, 042, 053, 054,
// 065, 066). The pure parts are here and tested (tests/renderer/tabsNav.test.js);
// the few lines that call them live in app.js, smart-searchbar.js, tabs.js,
// webview.js, url-bar-menu.js and horizontal-tabs.js, each guarded by a typeof
// check so a build without this file works as before.
//
// Storage (all four owned by the 'tabs-nav' manifest, js/feature-manifests.js):
//   vex.tabsNav.prefs        the master switch and one switch per extra
//   vex.tabsNav.findHistory  the last words searched with the find bar
//   vex.tabsNav.typed        how often each site was typed or picked in the address bar
//   vex.tabsNav.defaultZoom  the zoom (50-300) of a page that has none of its own
//
// Nothing here talks to the network. Minimal Vex switches the whole module off
// through enabled()/setEnabled() (js/vex-usage-registry.js).
(function () {
  const PREFS_KEY = 'vex.tabsNav.prefs';
  const FIND_KEY = 'vex.tabsNav.findHistory';
  const TYPED_KEY = 'vex.tabsNav.typed';
  const ZOOM_KEY = 'vex.tabsNav.defaultZoom';

  // One switch per extra. Only the PASSIVE ones are on for a new profile (they add a menu entry, a find-bar
  // option or a dot and change nothing you type). The ones that change what Enter or the address bar does,
  // and the window-level one, are a choice and arrive off. A profile that existed before this release gets
  // the whole module off (maturity 'new': js/feature-registry.js staged enablement).
  const DEFAULTS = Object.freeze({
    enabled: true,
    findOptions: true,      // match case, seed from the selection, Up/Down history
    cleanCopy: true,        // Copy clean link / Copy as Markdown (address bar, tab menu)
    textFragment: true,     // Copy link to selected text
    typedRanking: false,    // inline completion prefers the sites you type most (changes what Enter picks)
    switchToTab: false,     // Enter on an address that is already open goes to that tab (changes Enter)
    addressExtras: false,   // Alt+Up one level, Alt+Shift+Up path menu, Shift+Enter new window, search-selection key, drag the padlock as a link, calculator row
    smartPrint: false,      // a printed or saved-as-PDF page is named "site - title - date" (T2-060)
    autoHideChrome: false,  // in full screen the toolbar and tabs slide in when the pointer touches the top edge (T2-060)
    downloadTypes: false,   // a finished PDF opens in a tab (T2-072)
    downloadEnter: false,   // Enter opens the file of the newest finished-download card (T2-072)
    activityDot: true,      // a count in a background tab's title marks a dot
    findMatchCase: false,   // the Aa toggle in the find bar (a remembered choice)
    findWholeWord: false,   // the ab toggle in the find bar: whole words only (js/whole-word-find.js)
    keepOnTop: false,       // Vex's own window above others (never over a full-screen game)
  });

  const warn = (what, err) => {
    console.error('[TabsNav] ' + what + ':', err && err.message ? err.message : err);
    if (typeof VexProblems !== 'undefined' && VexProblems && typeof VexProblems.note === 'function') {
      VexProblems.note('Tabs and navigation', what, err && err.message ? err.message : String(err));
    }
  };

  function readJson(key, fallback) {
    let raw;
    try { raw = localStorage.getItem(key); } catch (err) { warn('storage is not readable (' + key + ')', err); return fallback; }
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch (err) { warn(key + ' holds something that is not JSON, using the defaults', err); return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { warn('could not save ' + key, err); }
  }

  // ---- switches ---------------------------------------------------------------
  function prefs() {
    const saved = readJson(PREFS_KEY, {});
    const out = { ...DEFAULTS };
    if (saved && typeof saved === 'object') for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === 'boolean') out[k] = saved[k];
    return out;
  }
  function setPref(name, value) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, name)) throw new Error('Unknown setting: ' + name);
    if (typeof value !== 'boolean') throw new Error('A setting is on or off');
    const p = prefs(); p[name] = value;
    writeJson(PREFS_KEY, p);
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:tabs-nav-changed', { detail: { name, value } }));
  }
  const enabled = () => prefs().enabled;
  function setEnabled(v) {
    setPref('enabled', !!v);
    // The window-level extra follows the master switch, so Minimal Vex lets go of it.
    syncOnTop();
  }
  // True when the master switch and this extra are both on.
  function on(name) { const p = prefs(); return p.enabled && p[name] === true; }

  // ---- default zoom (T2-060: there was a zoom per site but no zoom for all of them) --------
  // A percent from 50 to 300; 100 means no default. Used by webview.js for any page that
  // has no zoom of its own, and by Ctrl+0.
  const ZOOM_MIN = 50, ZOOM_MAX = 300;
  function defaultZoomPercent() {
    const v = readJson(ZOOM_KEY, 100);
    return Number.isFinite(v) && v >= ZOOM_MIN && v <= ZOOM_MAX ? Math.round(v) : 100;
  }
  function setDefaultZoomPercent(pct) {
    if (!Number.isFinite(pct) || pct < ZOOM_MIN || pct > ZOOM_MAX) throw new Error('The default zoom is between ' + ZOOM_MIN + '% and ' + ZOOM_MAX + '%');
    writeJson(ZOOM_KEY, Math.round(pct));
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:zoom-changed'));
  }
  // The factor a page without a zoom of its own gets (1 when the module is off).
  const defaultZoomFactor = () => (enabled() ? defaultZoomPercent() / 100 : 1);

  // ---- find bar (T2-001) ----------------------------------------------------------
  const FIND_MAX = 20;
  const findHistory = {
    list() { const v = readJson(FIND_KEY, []); return Array.isArray(v) ? v.filter(s => typeof s === 'string') : []; },
    add(text) {
      const t = String(text || '').trim();
      if (!t || t.length > 200) return;
      const list = this.list().filter(x => x !== t);
      list.unshift(t);
      writeJson(FIND_KEY, list.slice(0, FIND_MAX));
    },
    clear() { writeJson(FIND_KEY, []); },
    // The index reached by moving from `index` (-1 = what was typed, nothing chosen). dir +1 goes to an older
    // entry, -1 to a newer one; it stops at the oldest and at -1.
    step(index, dir, list) {
      const l = list || this.list();
      const next = index + dir;
      if (next < -1) return -1;
      if (next >= l.length) return l.length ? l.length - 1 : -1;
      return next;
    },
  };

  // The words a find bar should start with: the page's selection when it is one
  // short line. Returns '' when there is none.
  function cleanSelection(raw) {
    const t = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    return t.length > 0 && t.length <= 120 && !/[\r\n]/.test(String(raw).trim()) ? t : '';
  }
  async function seedFromSelection(wv) {
    if (!wv || typeof wv.executeJavaScript !== 'function') return '';
    if (typeof VexTabPolicy !== 'undefined' && VexTabPolicy.canReadWebview && !VexTabPolicy.canReadWebview(wv)) return '';
    const raw = await wv.executeJavaScript('String(window.getSelection ? window.getSelection() : "")', true);
    return cleanSelection(raw);
  }

  // ---- copying a link (T2-026) -------------------------------------------------------
  const SENSITIVE = /^(token|access_token|id_token|refresh_token|auth|auth_token|authorization|sid|sessionid|session_id|session|sess|key|api_key|apikey|secret|password|passwd|pwd|code|signature|sig|jwt|otp)$/i;

  function sensitiveParams(url) {
    let u;
    try { u = new URL(String(url)); } catch { return []; }
    return [...new Set([...u.searchParams.keys()].filter(k => SENSITIVE.test(k)))];
  }
  // The link as it should be shared: wrappers unwrapped, tracking tags removed
  // (js/link-safety.js), and the names of anything that looks like a secret.
  function cleanLink(url) {
    const raw = String(url || '');
    if (!/^https?:\/\//i.test(raw)) return { text: raw, changed: false, sensitive: [] };
    const LS = typeof LinkSafety !== 'undefined' ? LinkSafety : (typeof require === 'function' ? require('./link-safety.js').LinkSafety : null);
    if (!LS) throw new Error('js/link-safety.js is not loaded, so a link cannot be cleaned');
    const text = LS.clean(raw);
    return { text, changed: text !== raw, sensitive: sensitiveParams(text) };
  }
  function markdownLink(title, url) {
    const name = String(title || '').replace(/[\[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || String(url);
    const href = String(url).replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
    return '[' + name + '](' + href + ')';
  }
  // Copies the link (cleaned) or a Markdown link to it. A link with something
  // that looks like a secret in its query asks first. -> true when copied.
  async function copyLink(tab, kind) {
    if (!tab || !/^https?:\/\//i.test(tab.url || '')) throw new Error('Only a web page has a link to copy');
    const c = cleanLink(tab.url);
    if (c.sensitive.length) {
      const ok = await window.vexConfirm({
        title: 'This link may carry a secret',
        message: 'Its address has ' + c.sensitive.map(n => n + '=').join(', ') + ' in it. Anyone who gets the link may be able to use your sign-in. Copy it anyway?',
        okLabel: 'Copy anyway',
      });
      if (!ok) return false;
    }
    const text = kind === 'markdown' ? markdownLink(tab.title, c.text) : c.text;
    await navigator.clipboard.writeText(text);
    if (typeof window !== 'undefined' && window.showToast) {
      window.showToast(kind === 'markdown' ? 'Copied as a Markdown link' : (c.changed ? 'Copied without its tracking tags' : 'Copied the link'));
    }
    return true;
  }

  // ---- link to the selected text (T2-054) -----------------------------------------------
  // Percent-encodes a piece of the fragment: encodeURIComponent plus the three
  // characters the text-fragment syntax reserves ('-', ',' and '&' are encoded
  // too so a hyphen is not read as the end of a range).
  function fragmentEncode(s) {
    return encodeURIComponent(s).replace(/-/g, '%2D').replace(/!/g, '%21').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A');
  }
  // https://page#:~:text=... for a selection, or null when it cannot name a passage.
  // Up to 160 characters are quoted whole; a longer one is named by its first and
  // last few words (textStart,textEnd), which also survives paragraph breaks.
  function textFragmentUrl(pageUrl, selection) {
    let u;
    try { u = new URL(String(pageUrl)); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const raw = String(selection == null ? '' : selection);
    const t = raw.replace(/\s+/g, ' ').trim();
    if (t.length < 2) return null;
    const multiBlock = /\n\s*\n|\r\n\s*\r\n/.test(raw.trim());
    u.hash = '';
    const base = u.href.replace(/#$/, '');
    if (t.length <= 160 && !multiBlock) return base + '#:~:text=' + fragmentEncode(t);
    const words = t.split(' ');
    if (words.length < 8) {
      return base + '#:~:text=' + fragmentEncode(t.slice(0, 160));
    }
    const start = words.slice(0, 4).join(' ');
    const end = words.slice(-4).join(' ');
    return base + '#:~:text=' + fragmentEncode(start) + ',' + fragmentEncode(end);
  }

  // ---- typed counts and the inline completion (T2-032) ------------------------------------
  const TYPED_MAX = 300;
  const hostKey = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

  const typed = {
    all() { const v = readJson(TYPED_KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; },
    count(host) { const n = this.all()[String(host || '').toLowerCase().replace(/^www\./, '')]; return Number.isFinite(n) ? n : 0; },
    // An address typed or picked in the address bar. Only web addresses count.
    record(url) {
      if (!/^https?:\/\//i.test(String(url || ''))) return;
      const host = hostKey(url);
      if (!host) return;
      const all = this.all();
      all[host] = (all[host] || 0) + 1;
      const keys = Object.keys(all);
      if (keys.length > TYPED_MAX) {
        keys.sort((a, b) => all[a] - all[b]).slice(0, keys.length - TYPED_MAX).forEach(k => { delete all[k]; });
      }
      writeJson(TYPED_KEY, all);
    },
    clear() { writeJson(TYPED_KEY, {}); },
  };

  // True for a host that must never be offered as a completion: a lookalike of a
  // guarded site, or a punycode name that reads as Latin (js/link-safety.js, js/idn.js).
  function lookalikeHost(host) {
    const LS = typeof LinkSafety !== 'undefined' ? LinkSafety : (typeof require === 'function' ? require('./link-safety.js').LinkSafety : null);
    if (!LS) throw new Error('js/link-safety.js is not loaded, so completions cannot be checked');
    return !!LS.lookalike(host);
  }
  // Options for _inlineCompletion (smart-searchbar.js): the typed count of a host
  // and whether to skip it. null when the extra is off.
  function completionOptions() {
    if (!on('typedRanking')) return null;
    return { typedCount: (host) => typed.count(host), skip: (host) => lookalikeHost(host) };
  }

  // ---- already open (T2-042) ------------------------------------------------------------------
  // An address compared without scheme, www., a trailing slash or a #fragment.
  function addressKey(url) {
    let u;
    try { u = new URL(String(url)); } catch { return ''; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const path = u.pathname.replace(/\/+$/, '');
    return u.host.toLowerCase().replace(/^www\./, '') + path + u.search;
  }
  // The tab (not the one in front) already showing this address, in the same kind
  // of session (a private tab is never reached from a normal one, and back).
  function findOpenTab(url, tabs, activeId) {
    const key = addressKey(url);
    if (!key) return null;
    const active = (tabs || []).find(t => t.id === activeId);
    const kind = active ? String(active.partition || '') : '';
    return (tabs || []).find(t => t && t.id !== activeId && addressKey(t.url) === key && String(t.partition || '') === kind) || null;
  }
  // Enter in the address bar: go to the tab that already shows the address.
  // -> true when it did (the caller then does not navigate).
  function switchToOpen(url) {
    if (!on('switchToTab') || typeof TabManager === 'undefined') return false;
    const hit = findOpenTab(url, TabManager.tabs, TabManager.activeTabId);
    if (!hit) return false;
    const from = TabManager.getActiveTab();
    TabManager.switchTab(hit.id);
    // A blank new tab you typed in has nothing to keep.
    if (from && typeof isStartPage === 'function' && isStartPage(from.url)) TabManager.closeTab(from.id);
    return true;
  }

  // ---- where Shift+Enter opens the address (T2-065) -----------------------------------------------
  // 'app': a small window of its own, in the tab's own profile (as before). 'private': a full Vex window with
  // its tabs, toolbar and sidebar, but private: it keeps nothing and has none of this profile's logins (a second
  // window of the normal profile does not exist in Vex). Remembered; 'app' until chosen.
  const SHIFT_ENTER_KEY = 'vex.tabsNav.shiftEnter';
  const SHIFT_ENTER_TARGETS = ['app', 'private'];
  function shiftEnterTarget() {
    let v = null;
    try { v = localStorage.getItem(SHIFT_ENTER_KEY); } catch (err) { warn('storage is not readable (' + SHIFT_ENTER_KEY + ')', err); }
    return SHIFT_ENTER_TARGETS.includes(v) ? v : 'app';
  }
  function setShiftEnterTarget(value) {
    if (!SHIFT_ENTER_TARGETS.includes(value)) throw new Error('Shift+Enter opens a small app window or a full private window');
    localStorage.setItem(SHIFT_ENTER_KEY, value);
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:tabs-nav-changed', { detail: { name: 'shiftEnter', value } }));
    return value;
  }

  // ---- address bar extras (T2-065) -------------------------------------------------------------
  // One URL level up: /a/b/c -> /a/b -> /a -> / ; the query and fragment go with
  // the first step. null at the top of a site.
  function parentUrl(url) {
    let u;
    try { u = new URL(String(url)); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.search || u.hash) { u.search = ''; u.hash = ''; return u.href; }
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    parts.pop();
    u.pathname = '/' + parts.join('/');
    u.search = ''; u.hash = '';
    return u.href;
  }
  // The levels of an address, nearest the site first: [{ label, url }]. "example.com", "/docs", "/docs/api".
  // The page's own query is not a level. -> [] for a page that is not http(s).
  function segments(url) {
    let u;
    try { u = new URL(String(url)); } catch { return []; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return [];
    const out = [{ label: u.host, url: u.origin + '/' }];
    let acc = '';
    for (const part of u.pathname.split('/').filter(Boolean)) {
      acc += '/' + part;
      out.push({ label: decodeSafe(part), url: u.origin + acc });
    }
    return out;
  }
  function decodeSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }
  // A small menu under the address bar with each level of the address; choosing one goes there.
  function showSegments(anchor, url, go) {
    const segs = segments(url);
    document.getElementById('vex-address-path')?.remove();
    if (!segs.length) throw new Error('This address has no levels to go to');
    const box = document.createElement('div');
    box.id = 'vex-address-path';
    box.setAttribute('role', 'menu');
    box.setAttribute('aria-label', 'Levels of this address');
    const close = () => { box.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey, true); };
    const outside = (e) => { if (!box.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); anchor.focus(); } };
    for (const s of segs) {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.textContent = s.label; b.title = s.url;
      b.addEventListener('click', () => { close(); go(s.url); });
      box.appendChild(b);
    }
    const r = anchor.getBoundingClientRect();
    box.style.left = Math.max(4, r.left) + 'px';
    box.style.top = (r.bottom + 2) + 'px';
    document.body.appendChild(box);
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
    box.querySelector('button')?.focus();
    return box;
  }
  // The words selected on the page in front, searched with the engine you chose, in a new tab.
  async function searchSelection() {
    if (!on('addressExtras')) throw new Error('Turn on "Tabs and navigation extras" and then "Address bar extras" in Settings > Tabs and navigation first');
    if (typeof TabManager === 'undefined' || typeof WebviewManager === 'undefined') throw new Error('Tabs are not loaded');
    const wv = WebviewManager.webviews.get(TabManager.activeTabId);
    if (!wv) throw new Error('Open a page first');
    const words = await seedFromSelection(wv);
    if (!words) throw new Error('Select a few words on the page first');
    const where = VexTypedAddress.resolve(words);
    if (!where) throw new Error('Those words could not be searched');
    TabManager.createTab(where.url, true);
    return words;
  }
  // The answer to a typed sum or unit conversion ("12*7", "20cm to in"), or null.
  function calcFor(text) {
    if (!on('addressExtras') || typeof VexCalc === 'undefined' || typeof VexCalc.evaluate !== 'function') return null;
    const q = String(text || '').trim();
    if (!q || (!/\s/.test(q) && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(q))) return null;
    const r = VexCalc.evaluate(q);
    if (!r || typeof r.text !== 'string' || !r.text || r.unavailable) return null;
    return r.text.trim() === q ? null : r;
  }

  // ---- activity on background tabs (T2-066) --------------------------------------------------------
  // A page that counts something puts the count in its title: "(3) Inbox", "[2] Chat".
  function titleCount(title) {
    const m = /^\s*(?:\((\d{1,4})\+?\)|\[(\d{1,4})\+?\])/.exec(String(title || ''));
    return m ? Number(m[1] || m[2]) : 0;
  }
  // Called when a tab's title changed. `tab._act` = { base, count }: base is the
  // count the tab had when it was last in front, count what is new since.
  function noteTitle(tab, isActive) {
    if (!tab) return false;
    const n = titleCount(tab.title);
    if (!tab._act) tab._act = { base: n, count: 0 };
    if (isActive || !on('activityDot')) { tab._act.base = n; return setCount(tab, 0); }
    if (n > tab._act.base) return setCount(tab, n - tab._act.base);
    if (n < tab._act.base) tab._act.base = n;          // the page read some of them
    return setCount(tab, tab._act.count);
  }
  function setCount(tab, count) {
    const changed = (tab._act.count || 0) !== count;
    tab._act.count = count;
    return changed;
  }
  function clearActivity(tab) {
    if (!tab) return;
    const n = titleCount(tab.title);
    tab._act = { base: n, count: 0 };
  }
  const activityOf = (tab) => (tab && tab._act && tab._act.count > 0 && on('activityDot') ? tab._act.count : 0);
  // Puts the dot on the horizontal strip's tabs. Absolutely positioned (css/tabs-nav.css),
  // so it adds nothing to any tab's size and the strip keeps its height in every look.
  function decorateStrip(container) {
    if (!container || typeof TabManager === 'undefined') return;
    container.querySelectorAll('.top-tab[data-tab-id]').forEach((el) => {
      el.querySelectorAll('.tab-activity').forEach(n => n.remove());
      const tab = TabManager.tabs.find(t => String(t.id) === el.dataset.tabId);
      const n = activityOf(tab);
      el.classList.toggle('has-activity', n > 0);
      if (!n) return;
      const dot = document.createElement('span');
      dot.className = 'tab-activity';
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', n + ' new in this tab');
      dot.textContent = n > 9 ? '9+' : (n > 1 ? String(n) : '');
      el.appendChild(dot);
    });
  }

  // ---- what a finished download does by kind (T2-072) ------------------------------------------------
  // With "downloadTypes" on, a finished PDF opens in a tab of its own (Vex shows it) instead of waiting in a card.
  // Installers ask where to save: that is a main-process preference (downloads:set-ask-types), set from Settings.
  const INSTALLER_KINDS = Object.freeze(['exe', 'msi', 'msix', 'appx', 'msp', 'bat', 'cmd', 'ps1', 'scr', 'jar']);
  const kindOf = (filename) => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(filename || '')); return m ? m[1].toLowerCase() : ''; };
  const fileUrl = (p) => encodeURI('file:///' + String(p).replace(/\\/g, '/').replace(/^\/+/, '')).replace(/#/g, '%23').replace(/\?/g, '%3F');
  // -> 'tab' for a file that should open in a tab when it finishes, else ''.
  function downloadAction(filename) {
    return on('downloadTypes') && kindOf(filename) === 'pdf' ? 'tab' : '';
  }
  function openDownloadInTab(path) {
    if (!path || typeof TabManager === 'undefined') throw new Error('There is no file to open');
    return TabManager.createTab(fileUrl(path), true);
  }

  // ---- download speed and time left (T2-072) -------------------------------------------------
  // Feed every progress report to rateStep(previous, receivedBytes, nowMs); it keeps a smoothed
  // bytes-per-second (a paused or stalled transfer decays to 0). etaText() says how long is left.
  function rateStep(prev, received, now) {
    if (!prev || !(now > prev.at) || received < prev.received) return { at: now, received, bps: 0 };
    const dt = (now - prev.at) / 1000;
    if (dt < 0.5) return prev;                       // too soon to say anything new
    const inst = (received - prev.received) / dt;
    const bps = prev.bps > 0 ? prev.bps * 0.7 + inst * 0.3 : inst;
    return { at: now, received, bps };
  }
  function formatRate(bps) {
    if (!(bps > 0)) return '';
    const u = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let i = 0, v = bps;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
  }
  function etaText(bps, received, total) {
    if (!(bps > 0) || !(total > received)) return '';
    const s = Math.ceil((total - received) / bps);
    if (s < 60) return s + ' s left';
    if (s < 3600) return Math.round(s / 60) + ' min left';
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h + ' h ' + m + ' min left';
  }

  // ---- smart print file name (T2-060) --------------------------------------------------------------
  // "example.com - Page title - 2026-10-17": the name Windows offers for a printed page or a PDF. The title
  // is cleaned of what a file name cannot hold and of a closing " | Site" that names the site again; 90
  // characters at most.
  function printName(title, url, when = new Date()) {
    let host = '';
    try { host = new URL(String(url)).hostname.replace(/^www\./, ''); } catch { host = ''; }
    const site = (host.split('.').slice(-2, -1)[0] || host).toLowerCase();
    const seg = String(title == null ? '' : title).split(/\s+[|–—-]\s+/);
    if (seg.length > 1 && site && seg[seg.length - 1].toLowerCase().includes(site)) seg.pop();
    const t = seg.join(' - ').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const d = when.getFullYear() + '-' + String(when.getMonth() + 1).padStart(2, '0') + '-' + String(when.getDate()).padStart(2, '0');
    const name = [host, t, d].filter(Boolean).join(' - ');
    return name.length > 90 ? name.slice(0, 89).trim() + '…' : name;
  }
  // Gives the page the smart name while it prints; -> a function that puts the old title back (or null when
  // the extra is off or the page cannot be read).
  async function namePrintJob(wv) {
    if (!on('smartPrint') || !wv || typeof wv.executeJavaScript !== 'function') return null;
    if (typeof VexTabPolicy !== 'undefined' && VexTabPolicy.canReadWebview && !VexTabPolicy.canReadWebview(wv)) return null;
    const old = String(await wv.executeJavaScript('document.title', true));
    const next = printName(old, wv.getURL());
    await wv.executeJavaScript('document.title = ' + JSON.stringify(next), true);
    return async () => {
      await wv.executeJavaScript('(() => { if (document.title === ' + JSON.stringify(next) + ') document.title = ' + JSON.stringify(old) + '; })()', true);
    };
  }

  // ---- full screen without losing the toolbar (T2-060) ----------------------------------------------
  // With the extra on, in full screen a thin strip at the top edge brings the toolbar and the tab strip back
  // while the pointer is on it, and they slide away again. Normal windows are not touched at all.
  let revealTimer = null;
  function setReveal(show) {
    if (typeof document === 'undefined') return;
    clearTimeout(revealTimer);
    if (show) {
      const bar = document.getElementById('top-bar');
      if (bar) document.documentElement.style.setProperty('--vex-chrome-top', bar.offsetHeight + 'px');
      document.body.classList.add('chrome-reveal');
    } else {
      document.body.classList.remove('chrome-reveal');
    }
  }
  function syncAutoHide() {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.toggle('chrome-autohide', on('autoHideChrome'));
    if (!on('autoHideChrome')) setReveal(false);
  }
  function wireAutoHide() {
    const zone = document.createElement('div');
    zone.id = 'vex-chrome-hotzone';
    zone.setAttribute('aria-hidden', 'true');
    document.body.appendChild(zone);
    zone.addEventListener('mouseenter', () => { if (document.body.classList.contains('fullscreen') && on('autoHideChrome')) setReveal(true); });
    const leave = () => {
      clearTimeout(revealTimer);
      revealTimer = setTimeout(() => {
        const keep = document.activeElement && document.activeElement.closest && document.activeElement.closest('#top-bar, #top-tab-bar');
        if (!keep) setReveal(false);
      }, 500);
    };
    for (const id of ['top-bar', 'top-tab-bar']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener('mouseleave', leave);
      el.addEventListener('mouseenter', () => clearTimeout(revealTimer));
      el.addEventListener('focusout', leave);
    }
    document.addEventListener('vex:tabs-nav-changed', syncAutoHide);
    syncAutoHide();
  }

  // ---- Keep Vex on top (T2-053) -----------------------------------------------------------------------
  let onTopState = { wanted: false, active: false, held: false };
  const isPrivateWindow = () => typeof VexTabPolicy !== 'undefined' && !!VexTabPolicy.isPrivateWindow;
  async function syncOnTop() {
    if (typeof window === 'undefined' || isPrivateWindow() || !window.vex || typeof window.vex.keepWindowOnTop !== 'function') return onTopState;
    const want = enabled() && prefs().keepOnTop === true;
    if (!want && !onTopState.wanted) return onTopState;
    onTopState = await window.vex.keepWindowOnTop(want);
    return onTopState;
  }
  async function setKeepOnTop(value) {
    if (isPrivateWindow()) throw new Error('Keep on top is set from a normal window');
    // The master switch gates it (syncOnTop wants enabled() && keepOnTop): saying "Vex stays on top" while that is off was untrue.
    if (value && !enabled()) throw new Error('Turn on "Tabs and navigation extras" in Settings > Tabs and navigation first, then Keep Vex on top');
    setPref('keepOnTop', !!value);
    const s = await syncOnTop();
    if (typeof window !== 'undefined' && window.showToast) {
      window.showToast(s.held ? 'Keep on top is on, paused while a full-screen game has the screen' : (value ? 'Vex stays on top' : 'Vex no longer stays on top'));
    }
    return s;
  }

  const api = {
    PREFS_KEY, FIND_KEY, TYPED_KEY, ZOOM_KEY, DEFAULTS,
    defaultZoomPercent, setDefaultZoomPercent, defaultZoomFactor,
    prefs, setPref, enabled, setEnabled, on,
    findHistory, cleanSelection, seedFromSelection,
    sensitiveParams, cleanLink, markdownLink, copyLink,
    fragmentEncode, textFragmentUrl,
    typed, hostKey, lookalikeHost, completionOptions,
    addressKey, findOpenTab, switchToOpen,
    parentUrl, calcFor, segments, showSegments, searchSelection,
    printName, namePrintJob, syncAutoHide, setReveal,
    INSTALLER_KINDS, kindOf, fileUrl, downloadAction, openDownloadInTab,
    titleCount, noteTitle, clearActivity, activityOf, decorateStrip,
    rateStep, formatRate, etaText,
    syncOnTop, setKeepOnTop, onTopState: () => ({ ...onTopState }),
    SHIFT_ENTER_KEY, SHIFT_ENTER_TARGETS, shiftEnterTarget, setShiftEnterTarget,
  };

  if (typeof window !== 'undefined') {
    window.VexTabsNav = api;
    // A background tab that is brought to the front has seen its activity.
    window.addEventListener('vex:tab-activated', (e) => {
      try {
        const id = e.detail && e.detail.tabId;
        const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === id) : null;
        if (tab && tab._act && tab._act.count) {
          clearActivity(tab);
          if (typeof HorizontalTabs !== 'undefined' && HorizontalTabs.render) HorizontalTabs.render();
        }
      } catch (err) { warn('could not clear a tab\'s activity', err); }
    });
    // Restore the window-level choice at start (a normal window only).
    window.addEventListener('load', () => {
      if (isPrivateWindow() || !prefs().keepOnTop || !enabled()) return;
      syncOnTop().catch(err => warn('could not keep the window on top', err));
    });
    // The padlock can be dragged out as a link (T2-065).
    document.addEventListener('DOMContentLoaded', () => {
      try { wireAutoHide(); } catch (err) { warn('could not wire the full-screen toolbar', err); }
      const btn = document.getElementById('url-site-btn');
      if (!btn) return;
      btn.draggable = true;
      btn.addEventListener('dragstart', (e) => {
        const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
        if (!on('addressExtras') || !tab || !/^https?:\/\//i.test(tab.url || '')) { e.preventDefault(); return; }
        e.dataTransfer.setData('text/uri-list', tab.url);
        e.dataTransfer.setData('text/plain', tab.url);
        e.dataTransfer.effectAllowed = 'copyLink';
      });
    });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
