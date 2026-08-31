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
  _findMailWebview() {
    const wvs = Array.from(document.querySelectorAll('webview'));
    for (const p of this._PROVIDERS) {
      const live = wvs.find(w => p.host.test(w.getAttribute('src') || ''));
      if (live) return { wv: live, provider: p };
    }
    try {
      const T = (typeof window !== 'undefined') && window.Tabs;
      if (T && Array.isArray(T.tabs)) {
        for (const p of this._PROVIDERS) {
          const tab = T.tabs.find(t => p.host.test(t.url || '') || p.host.test(t.originalUrl || ''));
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
    // Each row: t = collapsed text, u = unread (per the provider's isUnread test —
    // Gmail marks unread rows with the 'zE' class). Unread + verification wording
    // tells us a just-arrived code apart from an old, already-consumed one. If a
    // provider's unread test is unreliable it just yields false, and only the
    // fast "a newer code arrived" path is used (still correct).
    const js = `(function(){try{
      var rows=Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(provider.rowSel)}));
      var out=[];
      for(var i=0;i<rows.length&&i<12;i++){var el=rows[i];out.push({t:(el.textContent||'').replace(/\\s+/g,' ').trim(), u:(function(){try{return !!(${provider.isUnread || 'false'});}catch(e){return false;}})()});}
      return JSON.stringify({loaded: rows.length>0, rows: out});
    }catch(e){return JSON.stringify({loaded:false, rows:[]});}})()`;
    let data;
    try { data = JSON.parse(await mailWv.executeJavaScript(js)); } catch { return { loaded: false, code: null, unread: false, strong: false }; }
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

  // Open the newest UNREAD verification-looking email in the (hidden) reader,
  // read its body text, then return to the inbox. Best-effort; returns a code or
  // null. Only ever called on the hidden reader (see _readInbox).
  async _readNewestUnreadBody(gmailWv) {
    const js = `(async function(){try{
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

  _injectCode(loginWv, code) {
    const js = `(function(){try{
      var CODE=${JSON.stringify(code)}; var D=CODE.split('');
      var setter=(function(){try{return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;}catch(e){return null;}})();
      function fire(el,val){try{el.focus();setter?setter.call(el,val):(el.value=val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}}
      function vis(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}
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
      return /verification code|enter the (code|digits)|we (sent|emailed)(?: you)? a code|one[-\\s]?time (code|password)|check your email|code we sent|enter (the )?code/i.test(document.body.innerText||'');
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
    try {
      if (!loginWv || !/^https:/i.test(url || '')) return;
      if (this._running) return;                                 // one poll at a time
      this._running = true;
      let sawField = false, plausible = false;
      let baseline = null, baselineSet = false, baselineUnread = false, baselineStrong = false, unreadStable = 0;
      let filled = false, sawMail = false, sawLoaded = false;
      for (let i = 0; i < 22; i++) {
        if (loginWv.isConnected === false) break;
        const hasField = await this._hasEmptyCodeField(loginWv);
        if (hasField) { sawField = true; plausible = true; }
        else if (!plausible) { plausible = await this._looksLikeCodePage(loginWv); }
        if (!hasField && sawField) break;                        // field came and went
        if (!plausible && i >= 4) break;                         // not a code page
        if (hasField) {
          const found = this._findMailWebview();
          if (found && found.wv) {
            sawMail = true;
            const { loaded, code, unread, strong } = await this._readInbox(found.wv, found.provider);
            if (loaded) {
              sawLoaded = true;
              if (!baselineSet) {
                // Snapshot the newest code the first time we see a loaded inbox.
                baseline = code; baselineSet = true; baselineUnread = !!unread; baselineStrong = !!strong; unreadStable = 0;
              } else if (code && code !== baseline) {
                // A DIFFERENT (newer) code arrived after we started — this is the
                // one THIS attempt triggered. Fill it (the fast, reliable path).
                const ok = await this._injectCode(loginWv, code);
                this._log(url, ok, 'new-code'); filled = true;
                if (ok) { this._toast(); this._maybeAutoSubmit(loginWv); break; }
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
                  const ok = await this._injectCode(loginWv, code);
                  this._log(url, ok, readyUnread ? 'unread-baseline' : 'strong-baseline'); filled = true;
                  if (ok) { this._toast(); this._maybeAutoSubmit(loginWv); break; }
                }
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
  _restoreAutoWoken() {
    const id = this._autoWoken; this._autoWoken = null;
    if (!id) return;
    try {
      const T = (typeof window !== 'undefined') && window.Tabs;
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
  _maybeAutoSubmit(loginWv) {
    try {
      if (localStorage.getItem('vex.emailCodeAutoSubmit') !== '1') return;
    } catch { return; }
    const js = `(function(){try{
      function vis(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}
      var re=/verify|confirm|continue|submit|next|log ?in|sign ?in|done/i;
      var btns=Array.prototype.slice.call(document.querySelectorAll('button,[type="submit"],[role="button"]'));
      for(var i=0;i<btns.length;i++){var b=btns[i];if(!vis(b)||b.disabled)continue;var tx=((b.innerText||b.value||b.getAttribute('aria-label')||'')).trim();if(re.test(tx)){b.click();return true;}}
      var a=document.activeElement; if(a&&a.form){try{a.form.requestSubmit?a.form.requestSubmit():a.form.submit();return true;}catch(e){}}
      if(a){a.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,which:13,bubbles:true}));a.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',keyCode:13,which:13,bubbles:true}));return true;}
      return false;
    }catch(e){return false;}})()`;
    setTimeout(() => { try { loginWv.executeJavaScript(js).catch(() => {}); } catch {} }, 350);
  },
};

if (typeof window !== 'undefined') window.EmailCodeAutofill = EmailCodeAutofill;
if (typeof module !== 'undefined' && module.exports) module.exports = { EmailCodeAutofill };
