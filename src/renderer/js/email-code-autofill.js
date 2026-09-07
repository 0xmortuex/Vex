// === Vex email-code autofill ===
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
    // of a longer number (avoids phone numbers / order ids).
    m = /(?:^|[^0-9])(\d{6})(?:[^0-9]|$)/.exec(s);
    if (m) return m[1];
    return null;
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
    if (globalThis.window?.VexTabPolicy?.isPrivateWindow) return null;
    const wvs = Array.from(document.querySelectorAll('webview'));
    for (const p of this._PROVIDERS) {
      const live = wvs.find(w => (!globalThis.window?.VexTabPolicy || globalThis.window?.VexTabPolicy.canReadWebview(w)) && this._matchesProvider(p, this._webviewUrl(w)));
      if (live) { this._keepMailLive(live); return { wv: live, provider: p }; }
    }
    try {
      const T = this._tabs();
      if (T && Array.isArray(T.tabs)) {
        for (const p of this._PROVIDERS) {
          const tab = T.tabs.find(t => (!globalThis.window?.VexTabPolicy || globalThis.window?.VexTabPolicy.canPersist(t)) && this._matchesProvider(p, t.url || t.originalUrl || ''));
          if (!tab) continue;
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
    this._readerCleanupTimer = setInterval(() => {
      try {
        const wv = document.getElementById('vex-gmail-reader');
        if (!wv) { clearInterval(this._readerCleanupTimer); this._readerCleanupTimer = null; return; }
        if (this._running) return; // never tear down mid-poll
        if (Date.now() - (this._readerLastUse || 0) >= this.READER_IDLE_MS) {
          try { wv.remove(); } catch {}
          clearInterval(this._readerCleanupTimer); this._readerCleanupTimer = null;
        }
      } catch {}
    }, 60000);
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
  async _readInbox(mailWv, provider) {
    provider = provider || this._PROVIDERS[0];
    const mailUrl = mailWv.getURL?.() || '';
    const generation = mailWv._navigationGeneration;
    const empty = { loaded: false, code: null, unread: false, strong: false };
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
      for(var i=0;i<rows.length&&i<12;i++){var el=rows[i];out.push({t:(el.textContent||'').replace(/\\s+/g,' ').trim(), u:(function(){try{return !!(${provider.isUnread || 'false'});}catch(e){return false;}})()});}
      return JSON.stringify({loaded: rows.length>0, rows: out});
    }catch(e){return JSON.stringify({loaded:false, rows:[]});}})()`;
    let data;
    try { data = JSON.parse(await mailWv.executeJavaScript(js)); } catch { return { loaded: false, code: null, unread: false, strong: false }; }
    if (mailWv.getURL?.() !== mailUrl || mailWv._navigationGeneration !== generation) return empty;
    let code = null, unread = false, strong = false;
    for (const r of (data.rows || [])) {
      const c = this._extractCode(r.t);
      if (c) { code = c; unread = !!r.u; strong = this._isStrongCodeRow(r.t); break; }
    }
    // Body fallback (Gmail hidden reader only): some services put the code only
    // in the email BODY, not the inbox subject/snippet. When the rows yield
    // nothing and we're using the dedicated hidden reader (never the user's own
    // visible mail — opening a message there would disrupt their view and mark it
    // read), open the newest unread verification email off-screen, scrape its
    // body, and go back. Throttled so we don't thrash the reader every poll.
    if (!code && !!data.loaded && provider.id === 'gmail' && this._isHiddenReader(mailWv) && (Date.now() - (this._lastBodyRead || 0) > 8000)) {
      this._lastBodyRead = Date.now();
      const bc = await this._readNewestUnreadBody(mailWv);
      if (bc) return { loaded: true, code: bc, unread: true, strong: true };
    }
    return { loaded: !!data.loaded, code, unread, strong };
  },

  _isHiddenReader(wv) { return !!(wv && wv.id === 'vex-gmail-reader'); },

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
      try { clicked = await mailWv.executeJavaScript(soft); } catch {}
      if (!clicked && mailWv.getURL?.() === url && (this._isHiddenReader(mailWv) || this._autoWoken)) {
        try { mailWv.reload(); } catch {}
      }
    } catch {}
  },

  // Open the newest UNREAD verification-looking email in the (hidden) reader,
  // read its body text, then return to the inbox. Best-effort; returns a code or
  // null. Only ever called on the hidden reader (see _readInbox).
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
      try{ var back=document.querySelector('[aria-label="Back to Inbox"],[data-tooltip="Back to Inbox"]'); if(back){back.click();} else {location.hash='#inbox';} }catch(e){}
      return text;
    }catch(e){return '';}})()`;
    let text = '';
    try { text = await gmailWv.executeJavaScript(js); } catch { return null; }
    if (gmailWv._navigationGeneration !== generation || !this._matchesProvider(this._PROVIDERS[0], gmailWv.getURL?.())) return null;
    return this._extractCode(text);
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
    try { return await loginWv.executeJavaScript(js); } catch { return false; }
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
    try { return loginWv.executeJavaScript(js); } catch { return Promise.resolve(false); }
  },

  _running: false,

  // Is this page plausibly waiting for an emailed code? A one-time-code field, OR
  // clear "we emailed you a code" wording (the field may render a beat later).
  async _looksLikeCodePage(loginWv) {
    const js = `(function(){try{
      if(document.querySelector('input[autocomplete="one-time-code"]'))return true;
      return /verification code|enter the (code|digits)|we (sent|emailed)(?: you)? a code|one[-\\s]?time (code|password)|check your email|code we sent|enter (the )?code/i.test(document.body.innerText||document.body.textContent||'');
    }catch(e){return false;}})()`;
    try { return await loginWv.executeJavaScript(js); } catch { return false; }
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
    try { return await loginWv.executeJavaScript(js); } catch { return false; }
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
  async tryFill(loginWv, url) {
    if (this._running) return;
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
      const current = () => {
        if (loginWv.isConnected === false) return false;
        try { return new URL(loginWv.getURL?.() || '').origin === origin; } catch { return false; }
      };
      if (!current()) return;
      if (this._running) return;                                 // one poll at a time
      this._running = true;
      this._lastInboxRefresh = 0;                                // refresh throttle, per attempt
      let sawField = false, plausible = false;
      let baseline = null, baselineSet = false, baselineUnread = false, baselineStrong = false, unreadStable = 0;
      let filled = false, sawMail = false, sawLoaded = false, authFlow = null;
      // Up to ~3 minutes on a sign-in page: requesting a code, waiting for the
      // mail to arrive and the code step to render routinely takes longer than
      // the old 90s, and the clock starts at page load — before the user has even
      // typed their address. An ordinary page still leaves after ~15s below.
      for (let i = 0; i < 60; i++) {
        if (!current()) break;
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
        if (hasField) {
          const found = this._findMailWebview();
          if (found && found.wv) {
            sawMail = true;
            const { loaded, code, unread, strong } = await this._readInbox(found.wv, found.provider);
            if (!current()) break;
            if (loaded) {
              sawLoaded = true;
              if (!baselineSet) {
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
              if (!filled && (Date.now() - (this._lastInboxRefresh || 0) > 9000)) {
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
        const reason = !sawMail ? 'no-mail'
          : !sawLoaded ? 'mail-not-loaded'
          : !baselineSet ? 'inbox-empty'
          : baseline === null ? 'no-code-arrived'
          : 'no-new-code';
        this._log(url, false, reason);
        this._maybeMissToast(reason, sawField);
      }
      this._running = false;
      this._restoreAutoWoken();
    } catch (e) { this._running = false; this._restoreAutoWoken(); }
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
  _toast() { try { window.showToast?.('📧 Filled the code from your email'); } catch {} },

  // Turn a silent miss into an actionable hint — only when a real empty code
  // field was on the page, only for the fixable mail-availability reasons, and
  // throttled so it can't nag. Points at the background reader, which removes the
  // need to keep a mail tab open/awake at all.
  _maybeMissToast(reason, sawField) {
    try {
      if (!sawField) return;
      if (reason !== 'no-mail' && reason !== 'mail-not-loaded') return;
      const now = Date.now();
      if (now - (this._lastMissToast || 0) < 120000) return;
      this._lastMissToast = now;
      const msg = reason === 'no-mail'
        ? "📧 Couldn't read a code — open your email, or turn on background code reading (Ctrl+K → Logins & Codes)."
        : "📧 Your email is still loading. If codes don't fill, keep it awake or enable background reading (Ctrl+K → Logins & Codes).";
      window.showToast?.(msg, 'info', 6500);
    } catch {}
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
