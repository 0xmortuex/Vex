// === Vex email-code autofill ===
// vex-layer-exempt: a hidden off-screen webview, never painted over the window
// When a site asks for a verification code it emailed you, and you have Gmail
// (web) open in Vex, read the newest code from the open inbox and fill it — so
// you don't have to switch tabs, open the email, and copy it.
//
// No credentials, no email backend: it only ever reads a Gmail tab you already
// have open in Vex (scraping the inbox rows' visible text). It fills only a real
// one-time-code field, only when empty, and prefers a code from an UNREAD email
// near verification wording — and retries for a bit, since the email usually
// lands a few seconds after you request it. Runs AFTER the authenticator (TOTP)
// autofill, so app-based 2FA still wins.
const EmailCodeAutofill = {
  // Every call into a page goes through here. webview.executeJavaScript has no
  // timeout of its own: on a guest that is asleep, discarded, crashed or
  // mid-navigation its promise can stay pending for ever, and a poll that awaits
  // it never reaches its `finally` - so the mailbox-reading slot it holds is
  // never given back. Three such polls and every later attempt is turned away as
  // "busy" until Vex restarts (T0-011; reproduced in tests/renderer/emailCodeStuck.test.js).
  // A page that does not answer is an error, said as one.
  EXEC_TIMEOUT_MS: 10000,
  _exec(wv, js, ms = this.EXEC_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('email-code: the page did not answer within ' + ms + ' ms')), ms);
      let p;
      try { p = wv.executeJavaScript(js); } catch (err) { clearTimeout(timer); reject(err); return; }
      Promise.resolve(p).then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
  },
  _isStuck(err) { return !!err && /did not answer within/.test(String(err.message || err)); },

  _matchesProvider(provider, value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && provider.host.test(url.href) &&
        ({ gmail: ['mail.google.com'], outlook: ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'], proton: ['mail.proton.me'], yahoo: ['mail.yahoo.com'], icloud: ['www.icloud.com'] }[provider.id] || []).includes(url.hostname);
    } catch { return false; }
  },
  // Pull a verification code out of an email's visible text.
  _extractCode(text) {
    const s = String(text || '');
    // A digit run right after a code keyword (strongest signal).
    let m = /(?:verification|verify|confirm(?:ation)?|one[-\s]?time|security|login|sign[-\s]?in|access)[^0-9\n]{0,24}\b(\d{4,8})\b/i.exec(s);
    if (m) return m[1];
    // "123456 is your code" / "123456 — verification code".
    m = /\b(\d{4,8})\b[^0-9\n]{0,24}(?:is your|verification|one[-\s]?time|security|code)/i.exec(s);
    if (m) return m[1];
    // Bare "code 123456".
    m = /\bcode[^0-9\n]{0,12}\b(\d{4,8})\b/i.exec(s);
    if (m) return m[1];
    // Fallback: a standalone 6-digit run (the most common OTP length), not part
    // of a longer number (avoids phone numbers / order ids). A group joined to
    // other digits by a hyphen, dot or space is a phone number too: "Call
    // 555-123456 now" filled 123456 (found 2026-09-29).
    m = /(?<!\d)(?<!\d\)?[-.  ])(\d{6})(?!\d)(?![-.  ]\(?\d)/.exec(s);
    if (m) return m[1];
    return null;
  },

  // Settings › Privacy › Autofill › "Fill sign-in codes from your email". On
  // unless turned off; the right-click and Ctrl+K "Fill code from email" still
  // work when it is off, because those are asked for by hand.
  enabled() { return globalThis.localStorage?.getItem('vex.emailCodeAutofill') !== '0'; },

  // --- Whose code is it? -----------------------------------------------------
  // A code is only filled into the site its email came from. Nothing used to tie
  // the two together, so a Discord code was filled into disc0rd-verify.example:
  // a look-alike page that shows "enter the code we sent" while the attacker
  // signs in to the real Discord gets the victim's real code.
  //
  // The sender's address is the evidence (Gmail puts it in the row's `email`
  // attribute; the other providers in a `title`). Its registrable domain must be
  // the page's: noreply@discord.com fits discord.com and accounts.discord.com,
  // no-reply@accounts.google.com fits accounts.google.com, and nothing fits
  // disc0rd-verify.example. A code whose sender cannot be read is not filled.
  _SECOND_LEVEL: ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go'],
  // Services that send their codes from one domain and sign you in on another.
  // Only well-known pairs; any other site must match the sender's own domain.
  _SENDER_FAMILIES: [
    ['discord.com', 'discordapp.com'],
    ['microsoft.com', 'live.com', 'microsoftonline.com', 'outlook.com', 'xbox.com'],
    ['steampowered.com', 'steamcommunity.com'],
    ['x.com', 'twitter.com'],
    ['facebook.com', 'facebookmail.com'],
    ['apple.com', 'icloud.com'],
    ['battle.net', 'blizzard.com'],
    ['playstation.com', 'sonyentertainmentnetwork.com'],
  ],
  // accounts.google.com -> google.com, mail.example.co.uk -> example.co.uk.
  _site(host) {
    const parts = String(host || '').toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
    if (parts.length < 2 || parts.some(p => !/^[a-z0-9-]+$/.test(p)) || /^\d+$/.test(parts[parts.length - 1])) return '';
    const n = parts.length;
    const take = (n >= 3 && parts[n - 1].length === 2 && this._SECOND_LEVEL.includes(parts[n - 2])) ? 3 : 2;
    return parts.slice(n - take).join('.');
  },
  _sameService(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    return this._SENDER_FAMILIES.some(f => f.includes(a) && f.includes(b));
  },
  // `from` is the sender address (or a list of them, for a thread). True only
  // when one of them belongs to the site of `pageUrl`.
  _senderMatches(from, pageUrl) {
    let page = '';
    try { page = this._site(new URL(pageUrl).hostname); } catch { return false; }
    if (!page) return false;
    const list = Array.isArray(from) ? from : (from ? [from] : []);
    const trusted = this._trustedFor(page);
    return list.some((address) => {
      const site = this._senderSite(address);
      return !!site && (this._sameService(site, page) || trusted.includes(site));
    });
  },
  // The registrable domain an address was sent from: "x <a@mail.shop.co.uk>" -> shop.co.uk.
  _senderSite(address) {
    const m = /@([a-z0-9.-]+)\s*>?\s*$/i.exec(String(address || '').trim());
    return m ? this._site(m[1]) : '';
  },

  // Senders the person said, with one click, are this site's own (the code for
  // example.com arrives from mailer-9x.net). Kept as { "example.com": ["mailer-9x.net"] }
  // in localStorage 'vex.emailCodeTrust'. A free-mail domain can never be trusted:
  // anyone can send from it, so trusting it would let any stranger's email fill
  // a code - the very thing the sender check exists to stop.
  TRUST_KEY: 'vex.emailCodeTrust',
  _FREE_MAIL: ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'mail.com', 'yandex.com', 'zoho.com'],
  _trustMap() {
    try {
      const v = JSON.parse(globalThis.localStorage?.getItem(this.TRUST_KEY) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (err) { console.error('[email-code] the trusted-senders list is damaged and is ignored:', err); return {}; }
  },
  _trustedFor(pageSite) {
    const list = this._trustMap()[pageSite];
    return Array.isArray(list) ? list.filter(s => typeof s === 'string') : [];
  },
  // `senderSite` comes from a mismatch the person was shown. Throws when it cannot be trusted.
  trustSender(pageUrl, senderSite) {
    const page = this._site(new URL(pageUrl).hostname);
    const sender = String(senderSite || '').toLowerCase();
    if (!page) throw new Error('This page has no site to trust a sender for');
    if (!sender || sender !== this._site(sender)) throw new Error('That is not a sender domain');
    if (this._FREE_MAIL.includes(sender)) throw new Error(sender + ' is a free mail service: anyone can send from it, so it cannot be trusted for ' + page);
    const map = this._trustMap();
    const list = Array.isArray(map[page]) ? map[page] : [];
    if (!list.includes(sender)) list.push(sender);
    map[page] = list.slice(-5);
    const keys = Object.keys(map);
    if (keys.length > 50) delete map[keys[0]];
    localStorage.setItem(this.TRUST_KEY, JSON.stringify(map));
    return true;
  },

  // Supported webmail providers. `host` matches the real mail app URL; `rowSel`
  // selects inbox message rows; `isUnread` is a JS expression (over a row `el`)
  // that's true for unread rows. Gmail is the tested primary; the others are
  // best-effort — if a selector stops matching, we simply read no code (same as
  // no mail open), never a wrong one. Gmail's row/unread selectors are unchanged
  // from the original Gmail-only implementation.
  _PROVIDERS: [
    { id: 'gmail',   host: /(^|\/\/)mail\.google\.com/i,                 rowSel: 'tr.zA', isUnread: "el.classList.contains('zE')", hidden: 'https://mail.google.com/mail/u/0/#inbox' },
    { id: 'outlook', host: /(^|\/\/)outlook\.(live|office|office365)\.com/i, rowSel: 'div[role="option"], .customScrollBar div[role="listitem"]', isUnread: "(el.getAttribute('aria-label')||'').toLowerCase().indexOf('unread')>=0" },
    { id: 'proton',  host: /(^|\/\/)mail\.proton\.me/i,                   rowSel: '.item-container, [data-testid^=\"message-item\"]', isUnread: "el.getAttribute('data-unread')==='true' || (el.className||'').indexOf('read')<0" },
    { id: 'yahoo',   host: /(^|\/\/)mail\.yahoo\.com/i,                   rowSel: 'a[data-test-id=\"message-list-item\"], li[data-test-id=\"message-list-item\"]', isUnread: "el.getAttribute('data-test-unread')==='true'" },
    { id: 'icloud',  host: /(^|\/\/)www\.icloud\.com\/mail/i,             rowSel: '.cloud-mail-message-list-item, li[role=\"row\"]', isUnread: "(el.className||'').indexOf('unseen')>=0 || (el.className||'').indexOf('unread')>=0" },
  ],

  // Find an open webmail INBOX webview for ANY supported provider (Gmail,
  // Outlook, Proton, Yahoo, iCloud). Returns { wv, provider } or null.
  //
  // If a mail tab is open but asleep/lazy (no live webview), wake it in the
  // background so we have something to read — kept awake briefly so the
  // hibernator doesn't re-sleep it mid-poll. We never foreground it; _readInbox
  // reads textContent, which is populated even while hidden.
  // getURL() THROWS ("The WebView must be attached to the DOM and the dom-ready
  // event emitted before this method can be called") on any guest that has not
  // finished attaching - a tab still loading, or one being materialised out of
  // lazy/sleeping state. `w.getURL?.()` does not protect against that: the method
  // exists, it throws when called. Unguarded, one such webview anywhere in the
  // window made _findMailWebview throw, tryFill's outer catch swallowed it, and
  // the whole 90-second poll died silently - which is exactly "Gmail is open and
  // logged in but the code never fills". With several tabs open, the poll calls
  // this thirty times, so any tab loading during it was enough.
  _webviewUrl(webview) {
    try { const url = webview.getURL?.(); if (url) return url; } catch { /* guest not ready yet */ }
    try { return webview.getAttribute('src') || ''; } catch { return ''; }
  },

  // TabManager is a top-level `const` in a classic script: visible to other
  // classic scripts, but NOT a property of window - unlike WebviewManager, which
  // webview.js explicitly assigns. Reading it as window.TabManager therefore
  // always yielded undefined, so every TabManager branch in this file was dead:
  // most importantly the fallback that wakes a sleeping or lazy mail tab. With
  // Vex sleeping background tabs, an open-but-asleep Gmail simply reported
  // "no-mail" and the code was never fetched.
  _tabs() {
    try { return (typeof TabManager !== 'undefined' && TabManager) || (typeof window !== 'undefined' && window.TabManager) || null; }
    catch { return null; }
  },
  _findMailWebview() {
    // What this search saw, so a miss can say WHY (a mail tab that is open but
    // refused by the private/Tor/routed-tab rule is not "no email open").
    this._mailSeen = { open: 0, blocked: 0, privateWindow: false };
    if (globalThis.window?.VexTabPolicy?.isPrivateWindow) { this._mailSeen.privateWindow = true; return null; }
    const wvs = Array.from(document.querySelectorAll('webview'));
    const policyOk = (w) => !globalThis.window?.VexTabPolicy || globalThis.window?.VexTabPolicy.canReadWebview(w);
    for (const p of this._PROVIDERS) {
      const there = wvs.filter(w => this._matchesProvider(p, this._webviewUrl(w)));
      this._mailSeen.open += there.length;
      const live = there.find(policyOk);
      this._mailSeen.blocked += there.filter(w => !policyOk(w)).length;
      if (live) { this._keepMailLive(live); return { wv: live, provider: p }; }
    }
    try {
      const T = this._tabs();
      if (T && Array.isArray(T.tabs)) {
        for (const p of this._PROVIDERS) {
          const mine = T.tabs.filter(t => this._matchesProvider(p, t.url || t.originalUrl || ''));
          const shareable = (t) => !globalThis.window?.VexTabPolicy || globalThis.window?.VexTabPolicy.canShareTab(t);
          const tab = mine.find(shareable);
          if (!tab) { this._mailSeen.open += mine.length; this._mailSeen.blocked += mine.length; continue; }
          // If this tab was asleep/lazy, WE are waking it just to read a code —
          // remember that so we can put it back to sleep afterwards (see
          // _restoreAutoWoken). A sleeping/lazy tab is never user-kept-awake
          // (kept-awake tabs are materialized on startup), so this only reclaims
          // memory the user wasn't asking us to hold. If Gmail was already live,
          // we leave it exactly as-is.
          const wasAsleep = !!(tab.sleeping || tab._lazy);
          // Mark kept-awake BEFORE (re)creating the webview so it's built with
          // background throttling off — a woken mail tab then keeps fetching
          // during the poll, so we read a fresh inbox, not a frozen one.
          tab.keepAwakeUntil = Math.max(tab.keepAwakeUntil || 0, Date.now() + 120000);
          if (tab.sleeping && T.wakeTab) T.wakeTab(tab.id);
          else if (tab._lazy && T._materializeTab) T._materializeTab(tab);
          if (wasAsleep) this._autoWoken = tab.id;
          const wv = (typeof WebviewManager !== 'undefined' && WebviewManager.webviews.get(tab.id))
            || document.querySelector(`webview[data-tab-id="${tab.id}"]`) || null;
          if (wv) return { wv, provider: p };
        }
      }
    } catch {}
    // No mail tab at all. If the user opted in, read codes from a HIDDEN
    // background Gmail — using their existing logged-in session (persist:main),
    // so no new credentials, no IMAP/OAuth. It reads textContent (which works on
    // an unrendered page), so it never has to be visible.
    try {
      if (localStorage.getItem('vex.emailCodeHiddenReader') === '1') {
        const wv = this._ensureHiddenGmail();
        if (wv) return { wv, provider: this._PROVIDERS[0] };
      }
    } catch {}
    return null;
  },

  // An off-screen Gmail webview, created on demand, purely for reading
  // verification codes. Lives in the user's main session so it's already signed
  // in. It's a full Gmail (~300–500 MB), so it does NOT live forever: every use
  // stamps _readerLastUse and (re)arms a cleanup timer that removes it once it's
  // been idle for a few minutes and no autofill is running. It's re-created in
  // milliseconds the next time a code is needed.
  _ensureHiddenGmail() {
    if (globalThis.window?.VexTabPolicy?.isPrivateWindow) return null;
    this._readerLastUse = Date.now();
    this._armReaderCleanup();
    let wv = document.getElementById('vex-gmail-reader');
    if (wv) return wv;
    try {
      wv = document.createElement('webview');
      wv.id = 'vex-gmail-reader';
      wv.setAttribute('src', 'https://mail.google.com/mail/u/0/#inbox');
      wv.setAttribute('partition', 'persist:main');
      wv.setAttribute('webpreferences', 'contextIsolation=yes,backgroundThrottling=no');
      // Off-screen but sized (so Gmail renders + keeps fetching), invisible + inert.
      wv.style.cssText = 'position:fixed;left:-10000px;top:0;width:1100px;height:820px;opacity:0.01;pointer-events:none;z-index:-1';
      document.body.appendChild(wv);
      return wv;
    } catch { return null; }
  },

  // Remove the hidden reader once it's been idle for READER_IDLE_MS with no poll
  // in flight, freeing the ~300–500 MB it holds. One interval; it stops itself
  // once the reader is gone. Each _ensureHiddenGmail call refreshes _readerLastUse
  // so an actively-used reader is never torn down mid-use.
  READER_IDLE_MS: 4 * 60 * 1000,
  _armReaderCleanup() {
    if (this._readerCleanupTimer) return;
    this._readerCleanupTimer = VexJobs.every('Gmail reader cleanup', 60000, () => {
      try {
        const wv = document.getElementById('vex-gmail-reader');
        if (!wv) { this._readerCleanupTimer.stop(); this._readerCleanupTimer = null; return; }
        if (this._running) return; // never tear down mid-poll
        if (Date.now() - (this._readerLastUse || 0) >= this.READER_IDLE_MS) {
          try { wv.remove(); } catch {}
          this._readerCleanupTimer.stop(); this._readerCleanupTimer = null;
        }
      } catch {}
    }, { when: 'background', feature: 'email-code-autofill' });
  },

  // Read Gmail's inbox: report whether it has actually loaded (any rows), and the
  // newest verification code in it (from the first code-bearing row — rows are
  // newest-first). Timestamps are only minute-granular in Gmail, so we do NOT
  // gate on them (a code from a retry a few seconds ago rounds to the same minute
  // as the real one); tryFill instead compares the code VALUE against a baseline.
  //
  // We read textContent, NOT innerText: innerText returns "" for anything not
  // being rendered, and Gmail stops rendering when it's not the foreground tab —
  // so a backgrounded inbox scrapes to nothing with innerText. textContent is
  // populated regardless of render state, so this works on a hidden Gmail. Gmail
  // also puts the code in the row's subject/snippet, so the row text is enough.
  //
  // With `pageUrl`, only a code whose sender belongs to that page's site counts
  // (see _senderMatches): a newer code from another service is skipped, and
  // `foreign` says one was seen. Without it (the Logins hub's self-test) the
  // newest code of any sender is reported, for display only.
  async _readInbox(mailWv, provider, pageUrl) {
    provider = provider || this._PROVIDERS[0];
    const mailUrl = mailWv.getURL?.() || '';
    const generation = mailWv._navigationGeneration;
    const empty = { loaded: false, code: null, unread: false, strong: false, from: null, foreign: false };
    if (!this._matchesProvider(provider, mailUrl) || (globalThis.window?.VexTabPolicy && !globalThis.window?.VexTabPolicy.canReadWebview(mailWv))) return empty;
    // Each row: t = collapsed text, u = unread (per the provider's isUnread test —
    // Gmail marks unread rows with the 'zE' class). Unread + verification wording
    // tells us a just-arrived code apart from an old, already-consumed one. If a
    // provider's unread test is unreliable it just yields false, and only the
    // fast "a newer code arrived" path is used (still correct).
    const js = `(function(){try{
      if(location.href!==${JSON.stringify(mailUrl)})return JSON.stringify({loaded:false,rows:[]});
      var rows=Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(provider.rowSel)}));
      var out=[];
      function senders(el){var out=[];try{
        var e=el.querySelectorAll('[email]');for(var k=0;k<e.length&&k<6;k++){var a=e[k].getAttribute('email');if(a)out.push(a);}
        var t=el.querySelectorAll('[title]');for(var j=0;j<t.length&&j<24;j++){var v=(t[j].getAttribute('title')||'').trim();if(/^[^\\s@<>]+@[a-z0-9.-]+\\.[a-z]{2,}$/i.test(v))out.push(v);}
      }catch(e){}return out;}
      for(var i=0;i<rows.length&&i<12;i++){var el=rows[i];out.push({t:(el.textContent||'').replace(/\\s+/g,' ').trim(), f:senders(el), u:(function(){try{return !!(${provider.isUnread || 'false'});}catch(e){return false;}})()});}
      return JSON.stringify({loaded: rows.length>0, rows: out});
    }catch(e){return JSON.stringify({loaded:false, rows:[]});}})()`;
    let data;
    try { data = JSON.parse(await this._exec(mailWv, js)); }
    catch (err) {
      // A mail page that does not answer is reported as stuck, not as an empty inbox.
      if (this._isStuck(err)) { console.error('[email-code] the mail page is not answering:', err.message); return { ...empty, stuck: true }; }
      return empty;
    }
    if (mailWv.getURL?.() !== mailUrl || mailWv._navigationGeneration !== generation) return empty;
    let code = null, unread = false, strong = false, from = null, foreign = false, foreignFrom = null;
    for (const r of (data.rows || [])) {
      const c = this._extractCode(r.t);
      if (!c) continue;
      const senders = Array.isArray(r.f) ? r.f : [];
      if (pageUrl && !this._senderMatches(senders, pageUrl)) { foreign = true; foreignFrom = foreignFrom || senders.map(s => this._senderSite(s)).find(Boolean) || null; continue; }
      code = c; unread = !!r.u; strong = this._isStrongCodeRow(r.t); from = senders; break;
    }
    // Body fallback (Gmail hidden reader only): some services put the code only
    // in the email BODY, not the inbox subject/snippet. When the rows yield
    // nothing and we're using the dedicated hidden reader (never the user's own
    // visible mail — opening a message there would disrupt their view and mark it
    // read), open the newest unread verification email off-screen, scrape its
    // body, and go back. Throttled so we don't thrash the reader every poll.
    if (!code && !!data.loaded && provider.id === 'gmail' && this._isHiddenReader(mailWv) && (Date.now() - (this._lastBodyRead || 0) > 8000)) {
      this._lastBodyRead = Date.now();
      const body = await this._readNewestUnreadBody(mailWv);
      if (body && body.code) {
        if (!pageUrl || this._senderMatches(body.from, pageUrl)) return { loaded: true, code: body.code, unread: true, strong: true, from: body.from, foreign, foreignFrom };
        foreign = true;
        foreignFrom = foreignFrom || (body.from || []).map(s => this._senderSite(s)).find(Boolean) || null;
      }
    }
    return { loaded: !!data.loaded, code, unread, strong, from, foreign, foreignFrom };
  },

  _isHiddenReader(wv) { return !!(wv && wv.id === 'vex-gmail-reader'); },

  // --- The mail accounts set up in Vex's Mail panel (read-only IMAP) -----------
  // When no webmail tab can be read, the newest messages of an account the person
  // already added to Mail are the next place to look. main/mail.js opens the
  // mailbox read-only and never marks anything read, so this adds no way to
  // change mail. Same result shape as _readInbox, so the poll treats both alike.
  // Each call opens a connection, so the answer is reused for IMAP_MIN_GAP_MS,
  // and at most two message bodies are fetched per read.
  IMAP_MIN_GAP_MS: 8000,
  IMAP_FRESH_MS: 30 * 60 * 1000,
  _imapCache: null,
  async _readImap(pageUrl) {
    const mail = globalThis.window?.vex?.mail;
    if (!mail || typeof mail.accounts !== 'function' || typeof mail.inbox !== 'function') return null;
    if (globalThis.window?.VexTabPolicy?.isPrivateWindow) return null;
    const now = Date.now();
    const cache = this._imapCache;
    if (cache && cache.url === pageUrl && now - cache.at < this.IMAP_MIN_GAP_MS) return cache.result;
    const limit = (p) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('email-code: the mail account did not answer within 20000 ms')), 20000);
      Promise.resolve(p).then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
    let result = null;
    try {
      const accounts = (await limit(mail.accounts())) || [];
      if (accounts.length) {
        let code = null, unread = false, strong = false, from = null, foreign = false, foreignFrom = null, loaded = false, bodies = 0;
        for (const acct of accounts.slice(0, 3)) {
          const box = await limit(mail.inbox(acct.id, 8));
          loaded = true;
          for (const m of (box && box.messages) || []) {
            if (m.date && now - m.date > this.IMAP_FRESH_MS) continue;       // an old code is not this attempt's
            const sender = m.from && m.from.address ? [m.from.address] : [];
            const mine = !pageUrl || this._senderMatches(sender, pageUrl);
            let text = String(m.subject || '');
            let c = this._extractCode(text);
            if (!c && mine && pageUrl && bodies < 2) {
              // Only mail from the page's own sender is opened, two at most.
              bodies++;
              const full = await limit(mail.message(acct.id, m.uid));
              text = text + ' ' + String((full && full.text) || '').slice(0, 600);
              c = this._extractCode(text);
            }
            if (!c) continue;
            if (!mine) { foreign = true; foreignFrom = foreignFrom || this._senderSite(sender[0]) || null; continue; }
            code = c; unread = !m.seen; strong = this._isStrongCodeRow(text); from = sender; break;
          }
          if (code) break;
        }
        result = { loaded, code, unread, strong, from, foreign, foreignFrom };
      }
    } catch (err) {
      console.error('[email-code] could not read the mail account:', err);
      result = null;
    }
    this._imapCache = { url: pageUrl, at: Date.now(), result };
    return result;
  },

  // One look at the mail: a webmail tab if one can be read, else a mail account
  // set up in Vex. `found` is null when there is nothing to read from.
  async _nextRead(pageUrl) {
    const found = this._findMailWebview();
    if (found && found.wv) return { found, read: await this._readInbox(found.wv, found.provider, pageUrl) };
    const imap = await this._readImap(pageUrl);
    if (imap) return { found: { wv: null, provider: { id: 'imap' } }, read: imap };
    return { found: null, read: null };
  },

  // Force the inbox to pull new mail. A hidden/backgrounded Gmail SPA can sit on
  // a stale inbox until refreshed — which is exactly why a code only appeared
  // after the user hit refresh themselves. We click the inbox's OWN Refresh
  // control (non-destructive — identical to the user clicking it), so this is
  // safe even on the user's visible mail tab. Only fall back to a hard reload on
  // a webview WE own (the hidden reader or a tab we woke) — never yank the
  // user's foreground mail out from under them.
  async _refreshInbox(mailWv, provider) {
    try {
      const url = mailWv.getURL?.() || '';
      if (!this._matchesProvider(provider, url) || (globalThis.window?.VexTabPolicy && !globalThis.window?.VexTabPolicy.canReadWebview(mailWv))) return;
      const soft = `(function(){try{
        if(location.href!==${JSON.stringify(url)})return 0;
        var b=document.querySelector('[aria-label="Refresh"],[data-tooltip="Refresh"],div.T-I.nu,button[aria-label*="Refresh"],button[title*="Refresh"]');
        if(b){b.click();return 1;} return 0;
      }catch(e){return 0;}})()`;
      let clicked = 0;
      try { clicked = await this._exec(mailWv, soft); } catch {}
      if (!clicked && mailWv.getURL?.() === url && (this._isHiddenReader(mailWv) || this._autoWoken)) {
        try { mailWv.reload(); } catch {}
      }
    } catch {}
  },

  // Open the newest UNREAD verification-looking email in the (hidden) reader,
  // read its body text and sender, then return to the inbox. Best-effort; returns
  // { code, from } or null. Only ever called on the hidden reader (see _readInbox).
  async _readNewestUnreadBody(gmailWv) {
    const generation = gmailWv._navigationGeneration;
    if (!this._isHiddenReader(gmailWv) || !this._matchesProvider(this._PROVIDERS[0], gmailWv.getURL?.())) return null;
    const js = `(async function(){try{
      if(location.origin!=='https://mail.google.com')return '';
      var re=/verification|verify|one[-\\s]?time|security code|login code|sign[-\\s]?in code|passcode|confirm(?:ation)? code|your (?:\\w+ )?code|code is|is your (?:\\w+ )?code/i;
      var rows=Array.prototype.slice.call(document.querySelectorAll('tr.zA.zE'));
      var row=null;
      for(var i=0;i<rows.length;i++){ if(re.test(rows[i].textContent||'')){ row=rows[i]; break; } }
      if(!row) return '';
      var open=row.querySelector('span[data-thread-id]')||row.querySelector('[role="link"]')||row;
      open.click();
      var body=null;
      for(var w=0;w<24;w++){ await new Promise(function(r){setTimeout(r,150);}); body=document.querySelector('.a3s'); if(body) break; }
      var text=body?(body.innerText||body.textContent||''):'';
      var sender=document.querySelector('.gD[email]');
      var from=sender?(sender.getAttribute('email')||''):'';
      try{ var back=document.querySelector('[aria-label="Back to Inbox"],[data-tooltip="Back to Inbox"]'); if(back){back.click();} else {location.hash='#inbox';} }catch(e){}
      return JSON.stringify({text:text, from:from});
    }catch(e){return '';}})()`;
    let read = null;
    try { read = JSON.parse((await this._exec(gmailWv, js)) || 'null'); } catch { return null; }
    if (!read || gmailWv._navigationGeneration !== generation || !this._matchesProvider(this._PROVIDERS[0], gmailWv.getURL?.())) return null;
    const code = this._extractCode(read.text);
    return code ? { code, from: read.from ? [String(read.from)] : [] } : null;
  },

  // Does the row's own text carry explicit verification wording (not just a bare
  // digit run that happened to match)? Used to gate the "fill the code that was
  // already sitting in the inbox" last resort, so a random 6-digit in a promo
  // never gets auto-filled.
  _isStrongCodeRow(text) {
    return /verification|verify|one[-\s]?time|security code|login code|sign[-\s]?in code|log[-\s]?in code|passcode|access code|confirm(?:ation)? code|your (?:\w+ )?code|code is|is your (?:\w+ )?code|code to (?:log|sign) ?in|enter (?:this|the) code|use this code|temporary code|auth(?:entication)? code/i.test(String(text || ''));
  },

  // Does the login page have an EMPTY one-time-code field to fill?
  async _hasEmptyCodeField(loginWv) {
    const js = `(function(){try{
      function vis(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}
      function meta(el){return ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')).toLowerCase();}
      var all=document.querySelectorAll('input');
      for(var i=0;i<all.length;i++){var el=all[i];var t=(el.type||'').toLowerCase();
        if(t==='password')continue; if(!(t===''||t==='text'||t==='tel'||t==='number'))continue; if(!vis(el))continue; if(el.value)continue;
        var ac=(el.getAttribute('autocomplete')||'').toLowerCase();
        if(ac==='one-time-code')return true;
        if(/otp|2fa|one.?time|verification.?code|security.?code|passcode|confirm.?code|email.?code|enter.?code/.test(meta(el)))return true;
      }
      // split single-digit boxes on a 2FA-looking page
      var boxes=Array.prototype.slice.call(all).filter(function(el){return vis(el)&&el.maxLength===1&&!el.value;});
      if(boxes.length>=4&&boxes.length<=8&&/verification|one.?time|enter the (code|digits)|we (sent|emailed)/i.test(document.body.innerText||''))return true;
      return false;
    }catch(e){return false;}})()`;
    try { return await this._exec(loginWv, js); } catch { return false; }
  },

  _injectCode(loginWv, code, url = loginWv.getURL?.()) {
    const js = `(function(){try{
      var ORIGIN=${JSON.stringify(new URL(url).origin)};
      if(location.origin!==ORIGIN)return false;
      var CODE=${JSON.stringify(code)}; var D=CODE.split('');
      var setter=(function(){try{return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;}catch(e){return null;}})();
      function fire(el,val){try{if(location.origin!==ORIGIN||!vis(el))return;el.focus();setter?setter.call(el,val):(el.value=val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}}
      function vis(el){var r=el.getBoundingClientRect(),s=getComputedStyle(el);return !el.disabled&&!el.readOnly&&s.visibility!=='hidden'&&s.display!=='none'&&r.width>0&&r.height>0&&(!el.form||new URL(el.form.action,location.href).origin===location.origin);}
      function meta(el){return ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')).toLowerCase();}
      function isCode(el){var t=(el.type||'').toLowerCase();if(t==='password')return false;if(!(t===''||t==='text'||t==='tel'||t==='number'))return false;if(!vis(el))return false;var ac=(el.getAttribute('autocomplete')||'').toLowerCase();if(ac==='one-time-code')return true;return /otp|2fa|one.?time|verification.?code|security.?code|passcode|confirm.?code|email.?code|enter.?code/.test(meta(el));}
      var all=Array.prototype.slice.call(document.querySelectorAll('input'));
      // Split layout: several single-digit boxes. Detected by maxlength=1 OR by
      // multiple one-time-code inputs (Spotify uses 6 one-time-code fields with
      // no maxlength). Distribute one digit per box.
      var boxes=all.filter(function(el){var t=(el.type||'').toLowerCase();if(t==='password')return false;if(!vis(el)||el.value)return false;var ac=(el.getAttribute('autocomplete')||'').toLowerCase();return el.maxLength===1||ac==='one-time-code';});
      if(boxes.length>=D.length&&boxes.length<=D.length+2){for(var i=0;i<D.length;i++){fire(boxes[i],D[i]);}return true;}
      // Single field: fill the whole code.
      for(var j=0;j<all.length;j++){if(isCode(all[j])&&!all[j].value){fire(all[j],CODE);return true;}}
      return false;
    }catch(e){return false;}})()`;
    try { return this._exec(loginWv, js); } catch { return Promise.resolve(false); }
  },

  _running: false,

  // Is this page plausibly waiting for an emailed code? A one-time-code field, OR
  // clear "we emailed you a code" wording (the field may render a beat later).
  async _looksLikeCodePage(loginWv) {
    const js = `(function(){try{
      if(document.querySelector('input[autocomplete="one-time-code"]'))return true;
      return /verification code|enter the (code|digits)|we (sent|emailed)(?: you)? a code|one[-\\s]?time (code|password)|check your email|code we sent|enter (the )?code/i.test(document.body.innerText||document.body.textContent||'');
    }catch(e){return false;}})()`;
    try { return await this._exec(loginWv, js); } catch { return false; }
  },

  // Is this page part of a sign-in that could still reach a code step? The code
  // screen usually arrives WITHOUT a page load - Spotify swaps its email step for
  // the code step in place - so a page that merely looks like a sign-in has to
  // keep the poll alive. Ending at fifteen seconds because the code field does
  // not exist yet is why the attempt was never even logged.
  async _looksLikeAuthFlow(loginWv) {
    const js = `(function(){try{
      if(document.querySelector('input[type=password]'))return true;
      if(document.querySelector('input[type=email],input[autocomplete=username],input[autocomplete=email]'))return true;
      if(/login|sign-?in|signin|auth|verify|challenge|account/i.test(location.pathname))return true;
      return /log in|sign in|continue with|email address|one[-\\s]?time|passwordless/i.test(document.body.innerText||document.body.textContent||'');
    }catch(e){return false;}})()`;
    try { return await this._exec(loginWv, js); } catch { return false; }
  },

  // Entry point: called on load AND on in-page (SPA) navigation. Polls, waiting
  // for a code field to appear (SPA renders it a beat late), then fills from an
  // open Gmail. Bails within ~15s if the page never looks like a code screen.
  //
  // Stale-code guard (the important bit): a code page can open with a code ALREADY
  // in the inbox — left over from a previous/failed attempt seconds ago. We must
  // fill the one THIS attempt triggers, which lands a moment later. So we snapshot
  // the newest code the first time we see a loaded inbox (the "baseline") and only
  // fill once a DIFFERENT code shows up. If the inbox has no code at baseline, the
  // first code to arrive is the one we want. Comparing values (not timestamps)
  // works even when both codes fall in the same Gmail minute.
  // One poll PER PAGE, not one for the whole app. This was a single global
  // boolean, which was tolerable while a non-code page gave up after ~15s. Once
  // the poll was extended to ~3 minutes on anything that looks like a sign-in
  // (so Spotify's in-place code step is not missed), that global lock meant a
  // Discord or Roblox login page could hold it for minutes and the attempt on
  // the page actually asking for a code was dropped on entry - silently, because
  // a drop logged nothing at all. That is the regression this replaces.
  //
  // Concurrency is still bounded, and the inbox-refresh throttle below is still
  // global, so several polls cannot hammer the mailbox.
  //
  // The bound is on READING THE MAILBOX, not on watching a page. Every page load
  // used to take one of the three slots on entry and hold it for up to three
  // minutes while it waited to see whether a code field would ever appear, so
  // any three sign-in-looking pages filled them and the page that really asked
  // for a code was turned away as "busy" (the owner's log: 180 attempts, 0
  // fills, 112 busy). Now a page only watches - a cheap DOM check every few
  // seconds - and takes a slot when it actually shows an empty code field. If
  // all slots are taken at that moment it keeps watching and takes one as soon
  // as it frees, instead of giving up.
  _watching: new Set(),   // pages being watched (one watch per page)
  _active: new Set(),     // pages holding a mailbox-reading slot
  MAX_POLLS: 3,

  // _running stays as a plain flag meaning "some poll is reading mail", because
  // the hidden-reader cleanup uses it to avoid tearing the reader down mid-poll.
  _enter(webview) {
    if (this._active.size >= this.MAX_POLLS) return false;
    this._active.add(webview); this._running = true; return true;
  },
  _exit(webview) { this._active.delete(webview); this._running = this._active.size > 0; },
  // The longest one poll may run. Pages are probed every 3 s for up to 60 ticks
  // (3 min); each probe is bounded by EXEC_TIMEOUT_MS, so without an overall
  // bound a page that answers slowly could stretch that without limit.
  WATCH_MAX_MS: 4 * 60 * 1000,
  // manual: the person asked for it (right-click or Ctrl+K), so it runs even
  // with the automatic fill turned off in Settings, and it fills the newest
  // code from this site's own sender at once: no baseline, no 15-30 s grace.
  // That wait is there so the automatic watch does not fill a code left over
  // from an earlier attempt; asking by hand says the code in the inbox is the
  // one wanted. When the automatic watch is already running on the page, the
  // request tells that watch to fill now instead of being dropped.
  async tryFill(loginWv, url, { manual = false } = {}) {
    if (!loginWv) return;
    if (typeof VexShareHold !== 'undefined' && VexShareHold.holds('emailcode')) { if (manual) globalThis.window?.showToast?.(VexShareHold.MESSAGE, 'info'); return; }
    // "Fill now" is set only on a page a watch runs on (this one, or the one
    // that starts below): set before the early returns, it stayed on the tab
    // and a later automatic watch there skipped its 15-30 s wait.
    if (this._watching.has(loginWv)) { if (manual) loginWv._vexEmailCodeFillNow = true; return; }
    if (!manual && !this.enabled()) return;
    try {
      if (!loginWv || !/^https:/i.test(url || '')) return;
      // Never poll the mailbox itself. Opening Gmail fires this like any other
      // page, and a verification email showing in the reading pane makes the page
      // "look like" a code page — so the mail tab started a 90 second poll that
      // could only ever report no-mail, and because _running is a single global
      // mutex that poll then blocked the real attempt on the site actually asking
      // for the code. The autofill log is full of exactly that: repeated
      // emailcode/mail.google.com/no-mail entries and no entry at all for the
      // site the user was signing in to.
      if (this._PROVIDERS.some((provider) => this._matchesProvider(provider, url))) return;
      if (globalThis.window?.VexTabPolicy && !globalThis.window?.VexTabPolicy.canReadWebview(loginWv)) return;
      const generation = loginWv._navigationGeneration;
      // Stay alive across the site's own steps. Asking for a code IS a navigation
      // — Spotify moves from the email step to the code step and rewrites the URL
      // — and `did-start-navigation` bumps the generation even for a same-document
      // push, so comparing either the full URL or the generation killed the poll
      // at exactly the moment the code field appeared. Origin is the boundary that
      // matters: leaving the site stops the poll, changing step does not.
      let origin = '';
      try { origin = new URL(url).origin; } catch { return; }
      // getURL() throws on a guest that is not fully attached yet, and tryFill is
      // called from dom-ready - precisely that moment. Treating a throw as "the
      // page left the site" aborted the poll instantly and silently, because
      // nothing has been seen yet so nothing is logged. _webviewUrl falls back to
      // the src attribute, so a not-ready guest reads as "still here" instead.
      const current = () => {
        if (loginWv.isConnected === false) return false;
        try { return new URL(this._webviewUrl(loginWv) || url).origin === origin; } catch { return false; }
      };
      if (!current()) return;
      if (this._watching.has(loginWv)) { if (manual) loginWv._vexEmailCodeFillNow = true; return; }   // one watch per page
      if (manual) loginWv._vexEmailCodeFillNow = true;
      this._watching.add(loginWv);
      let slot = false, refusedBusy = false, everSlot = false, touchedMail = false, sawStuck = false, foreignFrom = null, blocked = false;
      // Nothing in this poll may outlive WATCH_MAX_MS, whatever the pages do:
      // every page call has its own timeout (_exec), this is the overall bound.
      const deadline = Date.now() + this.WATCH_MAX_MS;
      try {
        let sawField = false, plausible = false;
        let baseline = null, baselineSet = false, baselineUnread = false, baselineStrong = false, unreadStable = 0;
        let filled = false, sawMail = false, sawLoaded = false, sawForeign = false, authFlow = null;
        // Up to ~3 minutes on a sign-in page: requesting a code, waiting for the
        // mail to arrive and the code step to render routinely takes longer than
        // the old 90s, and the clock starts at page load — before the user has even
        // typed their address. An ordinary page still leaves after ~15s below.
        for (let i = 0; i < 60; i++) {
          if (!current()) break;
          if (Date.now() > deadline) { console.error('[email-code] gave up on ' + origin + ': the poll ran past ' + this.WATCH_MAX_MS + ' ms'); break; }
          const hasField = await this._hasEmptyCodeField(loginWv);
          if (hasField) { sawField = true; plausible = true; }
          else if (!plausible) { plausible = await this._looksLikeCodePage(loginWv); }
          if (!hasField && sawField) break;                        // field came and went
          if (!plausible && i >= 4) {
            // Not a code page (yet). Keep going only while this still looks like a
            // sign-in that could produce one; probed once, not every tick.
            if (authFlow === null) authFlow = await this._looksLikeAuthFlow(loginWv);
            if (!authFlow) break;
          }
          // Take a mailbox-reading slot only now that a code is really asked for.
          // All taken: keep watching and try again next tick.
          if (hasField && !slot) {
            slot = this._enter(loginWv);
            if (slot) { everSlot = true; this._lastInboxRefresh = 0; }   // refresh throttle, per attempt
            else refusedBusy = true;
          }
          if (hasField && slot) {
            const { found, read: got } = await this._nextRead(url);
            // A slot is for READING mail. With nothing to read from (no mail open,
            // or the mail tab is refused by the private/routed-tab rule) the page
            // used to keep its slot for the rest of the three minutes, so three
            // such pages made every later attempt "busy" (T0-011): 61 no-mail and
            // 111 busy in the owner's log are the same fault seen twice. It gives
            // the slot back and asks again on the next tick.
            if (!found || !got) {
              const seen = this._mailSeen || {};
              if (seen.blocked) blocked = true;
              this._exit(loginWv); slot = false;
            } else {
              touchedMail = true;
              sawMail = true;
              const read = got;
              if (read.stuck) sawStuck = true;
              if (read.foreignFrom) foreignFrom = foreignFrom || read.foreignFrom;
              const { loaded, unread, strong } = read;
              // Only a code this site's own email carries is ever filled (or
              // auto-submitted); one from another sender is ignored here too, not
              // just skipped by _readInbox.
              const code = (read.code && this._senderMatches(read.from, url)) ? read.code : null;
              if (read.foreign || (read.code && !code)) sawForeign = true;
              if (!current()) break;
              if (loaded) {
                sawLoaded = true;
                if (code && loginWv._vexEmailCodeFillNow) {
                  // Asked for by hand: the newest code from this site's sender, now.
                  loginWv._vexEmailCodeFillNow = false;
                  const ok = await this._injectCode(loginWv, code, url);
                  this._log(url, ok, 'manual'); filled = true;
                  if (ok) { this._toast(); this._maybeAutoSubmit(loginWv, url, generation); break; }
                } else if (!baselineSet) {
                  // Snapshot the newest code the first time we see a loaded inbox.
                  baseline = code; baselineSet = true; baselineUnread = !!unread; baselineStrong = !!strong; unreadStable = 0;
                } else if (code && code !== baseline) {
                  // A DIFFERENT (newer) code arrived after we started — this is the
                  // one THIS attempt triggered. Fill it (the fast, reliable path).
                  const ok = await this._injectCode(loginWv, code, url);
                  this._log(url, ok, 'new-code'); filled = true;
                  if (ok) { this._toast(); this._maybeAutoSubmit(loginWv, url, generation); break; }
                } else if (code && code === baseline && baselineStrong) {
                  // The code was already in the inbox when the page opened (so it
                  // became the baseline) — e.g. the mail synced a beat late, or the
                  // email landed as the page loaded. It's still the newest and
                  // clearly a verification code, with nothing newer superseding it.
                  // Fill it instead of skipping forever, after a grace so a genuine
                  // retry code can arrive first and win via the path above:
                  //  • ~15s if it's still flagged unread (strong signal it's fresh)
                  //  • ~30s even if unread detection is unreliable (Gmail's markup
                  //    varies, and the email may have been auto-marked read) — a
                  //    strong code sitting at the top this long is the one wanted.
                  unreadStable++;
                  const readyUnread = baselineUnread && unread && unreadStable >= 5;
                  const readyStrong = unreadStable >= 10;
                  if (readyUnread || readyStrong) {
                    const ok = await this._injectCode(loginWv, code, url);
                    this._log(url, ok, readyUnread ? 'unread-baseline' : 'strong-baseline'); filled = true;
                    if (ok) { this._toast(); this._maybeAutoSubmit(loginWv, url, generation); break; }
                  }
                }
                // Keep the inbox syncing so a freshly-sent code appears without the
                // user refreshing Gmail. Whenever we've read a loaded inbox but
                // nothing new has filled yet, prod it to fetch new mail (throttled,
                // fire-and-forget — the next read a few seconds later sees the
                // result). This is the core of "keep refreshing until the code
                // arrives."
                if (!filled && found.wv && (Date.now() - (this._lastInboxRefresh || 0) > 9000)) {
                  this._lastInboxRefresh = Date.now();
                  this._refreshInbox(found.wv, found.provider);
                }
              }
            }
          }
          await new Promise(r => setTimeout(r, 3000));
        }
        // Record a miss (with a reason) so a failure is diagnosable, not silent —
        // and, when there really was an empty code field waiting, nudge the user
        // toward the fix instead of failing silently.
        if (!filled && (sawField || plausible)) {
          const reason = (refusedBusy && !everSlot) ? 'busy'
            : !sawMail ? (blocked ? 'mail-blocked' : 'no-mail')
            : (!sawLoaded && sawStuck) ? 'mail-stuck'
            : !sawLoaded ? 'mail-not-loaded'
            : !baselineSet ? 'inbox-empty'
            : sawForeign ? 'sender-mismatch'
            : baseline === null ? 'no-code-arrived'
            : 'no-new-code';
          this._log(url, false, reason);
          this._maybeMissToast(reason, sawField, { loginWv, url, foreignFrom });
        }
      } finally {
        this._watching.delete(loginWv);
        loginWv._vexEmailCodeFillNow = false;
        if (slot) this._exit(loginWv);
        // The mail tab is shared by every reading poll: put it back only when
        // the last one is done, not under another page that is still reading.
        if ((slot || touchedMail) && this._active.size === 0) this._restoreAutoWoken();
      }
    } catch (e) { console.error('[email-code] autofill poll failed:', e); }
  },

  // If this poll woke a sleeping Gmail just to read a code, put it back to sleep
  // now that we're done — so a Gmail the user lets sleep costs ~0 MB between
  // codes instead of staying loaded (~300–500 MB) until auto-sleep. We only
  // touch a tab WE woke (recorded in _findMailWebview) and never the one the user
  // is currently viewing; the user's own never-sleep/keep-awake tabs are left
  // untouched because those are already live and never get marked here.
  // A mail tab that is merely OPEN is not necessarily USABLE. Tabs are created
  // with background throttling on unless they are kept awake
  // (webview.js: `backgroundThrottling=no` only when keptAwake), so while the
  // user is on the sign-in page their Gmail sits backgrounded and throttled: it
  // never fetches the mail carrying the code. _readInbox then rescrapes the same
  // stale rows for the whole poll and reports "no-new-code" - which is exactly
  // what the reported profile's autofill log shows. The old code deliberately
  // left an already-live mail tab untouched, which is what made this bite.
  //
  // So for the duration of the poll: hold it awake and turn throttling off.
  // _restoreAutoWoken puts both back.
  _keepMailLive(webview) {
    try {
      const T = this._tabs();
      const id = webview.getAttribute?.('data-tab-id');
      if (!T || !id || !Array.isArray(T.tabs)) return;
      const tab = T.tabs.find(t => t.id === id);
      if (!tab || this._liveMail === id) return;
      this._liveMail = id;
      this._liveMailKeepAwake = tab.keepAwakeUntil || 0;
      tab.keepAwakeUntil = Math.max(this._liveMailKeepAwake, Date.now() + 240000);
      T._setBackgroundThrottling?.(id, false);
    } catch {}
  },

  _restoreMailThrottling() {
    const id = this._liveMail; this._liveMail = null;
    if (!id) return;
    try {
      const T = this._tabs();
      const tab = T && Array.isArray(T.tabs) && T.tabs.find(t => t.id === id);
      // Leave a tab the user themselves kept awake exactly as they set it.
      if (tab && (this._liveMailKeepAwake || 0) < Date.now()) {
        tab.keepAwakeUntil = this._liveMailKeepAwake || 0;
        T._setBackgroundThrottling?.(id, true);
      }
    } catch {}
  },

  _restoreAutoWoken() {
    this._restoreMailThrottling();
    const id = this._autoWoken; this._autoWoken = null;
    if (!id) return;
    try {
      const T = this._tabs();
      if (!T || !Array.isArray(T.tabs)) return;
      const tab = T.tabs.find(t => t.id === id);
      if (!tab || tab.id === T.activeTabId) return; // gone, or the user is looking at it now
      tab.keepAwakeUntil = 0;                        // drop the temporary wake we set
      if (typeof T.sleepTab === 'function') T.sleepTab(tab.id);
    } catch {}
  },

  _log(url, ok, reason) { try { window.AutofillLog?.record('emailcode', url, ok, reason); } catch {} },
  _toast() { try { globalThis.window?.showToast?.('Filled the code from your email'); } catch {} },

  // Turn a silent miss into an actionable hint — only when a real empty code
  // field was on the page, only for the fixable mail-availability reasons, and
  // throttled so it can't nag. Points at the background reader, which removes the
  // need to keep a mail tab open/awake at all.
  //
  // The toast also carries the way out that does not need the mail at all: "Use
  // the code on the clipboard" (read only when the person presses it), and, for
  // a code from a sender that is not the site's own, "Trust <sender> for <site>".
  _MISS_TOASTS: {
    'no-mail': "Couldn't read a code — open your email, or turn on background code reading (Ctrl+K → Logins & Codes).",
    'mail-not-loaded': "Your email is still loading. If codes don't fill, keep it awake or enable background reading (Ctrl+K → Logins & Codes).",
    'mail-blocked': 'Your email tab is open but Vex does not read private, Tor or routed tabs. Open your email in an ordinary tab, or copy the code.',
    'mail-stuck': 'Your email tab is not answering (it may be asleep or frozen). Reload it, or copy the code.',
    'busy': 'Several sign-ins are looking for a code at once. Copy the code from your email to use it here.',
    'sender-mismatch': 'The code in your email came from another sender than this site, so it was not filled.',
  },
  _maybeMissToast(reason, sawField, ctx) {
    try {
      if (!sawField) return;
      const msg = this._MISS_TOASTS[reason];
      if (!msg) return;
      const now = Date.now();
      if (now - (this._lastMissToast || 0) < 120000) return;
      this._lastMissToast = now;
      const actions = [];
      if (ctx && ctx.loginWv && ctx.url) {
        actions.push({ label: 'Use clipboard code', title: 'Fill the code you copied from your email', run: () => this.fillFromClipboard(ctx.loginWv, ctx.url) });
        if (reason === 'sender-mismatch' && ctx.foreignFrom && !this._FREE_MAIL.includes(ctx.foreignFrom)) {
          actions.push({ label: 'Trust ' + ctx.foreignFrom, title: 'Fill codes from ' + ctx.foreignFrom + ' on this site from now on',
            run: () => { try { this.trustSender(ctx.url, ctx.foreignFrom); globalThis.window?.showToast?.('Codes from ' + ctx.foreignFrom + ' now fill on this site'); } catch (err) { globalThis.window?.showToast?.(err.message, 'error'); } } });
        }
      }
      globalThis.window?.showToast?.(msg, 'info', 9000, actions.length ? { actions } : undefined);
    } catch (err) { console.error('[email-code] could not show the hint:', err); }
  },

  // The person copied the code from their email themselves: fill what is on the
  // clipboard if it is only a 4-8 digit code. The clipboard is read here, when
  // they ask (a button or "Fill code from clipboard"), never in the background.
  // Mail is not involved; nothing is submitted, even with auto-submit on.
  async fillFromClipboard(loginWv, url) {
    if (!loginWv || !/^https:/i.test(url || '')) return false;
    if (typeof VexShareHold !== 'undefined' && VexShareHold.holds('emailcode')) { globalThis.window?.showToast?.(VexShareHold.MESSAGE, 'info'); return false; }
    if (globalThis.window?.VexTabPolicy && !globalThis.window.VexTabPolicy.canFillWebview(loginWv)) return false;
    let text = '';
    try { text = await navigator.clipboard.readText(); }
    catch (err) { globalThis.window?.showToast?.('Could not read the clipboard: ' + ((err && err.message) || err), 'error'); throw err; }
    const m = /^\s*(\d{4,8})\s*$/.exec(text || '');
    if (!m) { globalThis.window?.showToast?.('The clipboard does not hold a code (only the digits, 4 to 8 of them)'); return false; }
    const ok = await this._injectCode(loginWv, m[1], url);
    this._log(url, ok, 'clipboard');
    if (ok) this._toast();
    else globalThis.window?.showToast?.('No empty code field on this page to fill');
    return ok;
  },

  // Optional: after filling, submit the form so the user doesn't have to click.
  // Opt-in (localStorage 'vex.emailCodeAutoSubmit'='1') because a wrong auto-submit
  // is more annoying than a manual click. Prefers an explicit submit button near
  // the code field; falls back to pressing Enter in the focused field. Given a
  // short beat so the framework registers the filled value first.
  _maybeAutoSubmit(loginWv, url, generation) {
    try {
      if (localStorage.getItem('vex.emailCodeAutoSubmit') !== '1') return;
    } catch { return; }
    const js = `(function(){try{
      var ORIGIN=${JSON.stringify(new URL(url).origin)};
      if(location.origin!==ORIGIN)return false;
      var field=document.activeElement;
      if(!field||field.tagName!=='INPUT'||!field.value||!field.form||new URL(field.form.action,location.href).origin!==location.origin)return false;
      function vis(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}
      var re=/verify|confirm|continue|submit|next|log ?in|sign ?in|done/i;
      var btns=Array.prototype.slice.call(field.form.querySelectorAll('button,[type="submit"]'));
      for(var i=0;i<btns.length;i++){var b=btns[i];if(!vis(b)||b.disabled||(b.formAction&&new URL(b.formAction,location.href).origin!==location.origin))continue;var tx=((b.innerText||b.value||b.getAttribute('aria-label')||'')).trim();if(re.test(tx)){b.click();return true;}}
      var a=document.activeElement; if(a&&a.form){try{a.form.requestSubmit?a.form.requestSubmit():a.form.submit();return true;}catch(e){}}
      if(a){a.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,which:13,bubbles:true}));a.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',keyCode:13,which:13,bubbles:true}));return true;}
      return false;
    }catch(e){return false;}})()`;
    // Same reasoning as tryFill's `current()`: the code step is a navigation, so
    // pinning to the original URL/generation meant auto-submit never ran on the
    // page it was meant for. The injected script still requires a filled input
    // inside a same-origin form before it clicks anything.
    setTimeout(() => {
      try {
        const origin = new URL(url).origin;
        if (new URL(loginWv.getURL?.() || '').origin !== origin) return;
        loginWv.executeJavaScript(js).catch(() => {});
      } catch {}
    }, 350);
  },
};

if (typeof window !== 'undefined') window.EmailCodeAutofill = EmailCodeAutofill;
if (typeof module !== 'undefined' && module.exports) module.exports = { EmailCodeAutofill };
