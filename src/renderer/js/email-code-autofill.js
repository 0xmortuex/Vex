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

  // Find an open Gmail INBOX webview (the real app is always mail.google.com,
  // for personal AND Workspace accounts). Deliberately NOT workspace.google.com
  // /gmail — that's the marketing page, not your mail, and has nothing to read.
  //
  // If Gmail is open but its tab is asleep/lazy (no live webview), wake it in the
  // background so we have something to read — and keep it awake briefly so the
  // hibernator doesn't re-sleep it mid-poll. We never bring it to the foreground;
  // _scrapeFreshCode reads textContent, which is populated even while hidden.
  _findGmailWebview() {
    const isGmail = (s) => /(^|\/\/)mail\.google\.com/i.test(s || '');
    const live = Array.from(document.querySelectorAll('webview'))
      .find(w => isGmail(w.getAttribute('src')));
    if (live) return live;
    try {
      const T = (typeof window !== 'undefined') && window.Tabs;
      if (T && Array.isArray(T.tabs)) {
        const tab = T.tabs.find(t => isGmail(t.url) || isGmail(t.originalUrl));
        if (tab) {
          // Mark kept-awake BEFORE (re)creating the webview so it's built with
          // background throttling off — a woken Gmail then keeps fetching mail
          // during the poll, so we read a fresh inbox, not a frozen one.
          tab.keepAwakeUntil = Math.max(tab.keepAwakeUntil || 0, Date.now() + 120000);
          if (tab.sleeping && T.wakeTab) T.wakeTab(tab.id);
          else if (tab._lazy && T._materializeTab) T._materializeTab(tab);
          return (typeof WebviewManager !== 'undefined' && WebviewManager.webviews.get(tab.id))
            || document.querySelector(`webview[data-tab-id="${tab.id}"]`) || null;
        }
      }
    } catch {}
    // No Gmail tab at all. If the user opted in, read codes from a HIDDEN
    // background Gmail — using their existing logged-in session (persist:main),
    // so no new credentials, no IMAP/OAuth. It reads textContent (which works on
    // an unrendered page), so it never has to be visible.
    try { if (localStorage.getItem('vex.emailCodeHiddenReader') === '1') return this._ensureHiddenGmail(); } catch {}
    return null;
  },

  // A persistent off-screen Gmail webview, created on demand, purely for reading
  // verification codes. Lives in the user's main session so it's already signed in.
  _ensureHiddenGmail() {
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
  async _readInbox(gmailWv) {
    // Each row: t = collapsed text, u = unread (Gmail marks unread rows with the
    // 'zE' class, read rows with 'yO'). Unread + verification wording tells us a
    // just-arrived code apart from an old, already-consumed one.
    const js = `(function(){try{
      var rows=Array.prototype.slice.call(document.querySelectorAll('tr.zA'));
      var out=[];
      for(var i=0;i<rows.length&&i<12;i++){out.push({t:(rows[i].textContent||'').replace(/\\s+/g,' ').trim(), u: rows[i].classList.contains('zE')});}
      return JSON.stringify({loaded: rows.length>0, rows: out});
    }catch(e){return JSON.stringify({loaded:false, rows:[]});}})()`;
    let data;
    try { data = JSON.parse(await gmailWv.executeJavaScript(js)); } catch { return { loaded: false, code: null, unread: false, strong: false }; }
    let code = null, unread = false, strong = false;
    for (const r of (data.rows || [])) {
      const c = this._extractCode(r.t);
      if (c) { code = c; unread = !!r.u; strong = this._isStrongCodeRow(r.t); break; }
    }
    // Body fallback: some services put the code only in the email BODY, not the
    // inbox subject/snippet. When the rows yield nothing and we're using the
    // dedicated hidden reader (never the user's own visible Gmail — opening a
    // message there would disrupt their view and mark it read), open the newest
    // unread verification email off-screen, scrape its body, and go back.
    // Throttled so we don't thrash the reader every poll.
    if (!code && !!data.loaded && this._isHiddenReader(gmailWv) && (Date.now() - (this._lastBodyRead || 0) > 8000)) {
      this._lastBodyRead = Date.now();
      const bc = await this._readNewestUnreadBody(gmailWv);
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
    return /verification|verify|one[-\s]?time|security code|login code|sign[-\s]?in code|passcode|confirm(?:ation)? code|your (?:\w+ )?code|code is|is your (?:\w+ )?code/i.test(String(text || ''));
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
      let filled = false, sawGmail = false, sawLoaded = false;
      for (let i = 0; i < 22; i++) {
        if (loginWv.isConnected === false) break;
        const hasField = await this._hasEmptyCodeField(loginWv);
        if (hasField) { sawField = true; plausible = true; }
        else if (!plausible) { plausible = await this._looksLikeCodePage(loginWv); }
        if (!hasField && sawField) break;                        // field came and went
        if (!plausible && i >= 4) break;                         // not a code page
        if (hasField) {
          const gmailWv = this._findGmailWebview();
          if (gmailWv) {
            sawGmail = true;
            const { loaded, code, unread, strong } = await this._readInbox(gmailWv);
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
                if (ok) { this._toast(); break; }
              } else if (code && code === baseline && baselineUnread && unread && baselineStrong) {
                // The code was already in the inbox when the page opened (so it
                // became the baseline) — e.g. Gmail synced a beat late, or the
                // email landed as the page loaded. It's still the newest, still
                // unread, and clearly a verification code, with nothing newer
                // superseding it. After a short grace (so a genuine retry code can
                // arrive first and win above), fill it instead of skipping forever.
                if (++unreadStable >= 5) {
                  const ok = await this._injectCode(loginWv, code);
                  this._log(url, ok, 'unread-baseline'); filled = true;
                  if (ok) { this._toast(); break; }
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
        const reason = !sawGmail ? 'no-gmail'
          : !sawLoaded ? 'gmail-not-loaded'
          : !baselineSet ? 'inbox-empty'
          : baseline === null ? 'no-code-arrived'
          : 'no-new-code';
        this._log(url, false, reason);
        this._maybeMissToast(reason, sawField);
      }
      this._running = false;
    } catch (e) { this._running = false; }
  },

  _log(url, ok, reason) { try { window.AutofillLog?.record('emailcode', url, ok, reason); } catch {} },
  _toast() { try { window.showToast?.('📧 Filled the code from your email'); } catch {} },

  // Turn a silent miss into an actionable hint — only when a real empty code
  // field was on the page, only for the fixable Gmail-availability reasons, and
  // throttled so it can't nag. Points at the background reader, which removes the
  // need to keep Gmail open/awake at all.
  _maybeMissToast(reason, sawField) {
    try {
      if (!sawField) return;
      if (reason !== 'no-gmail' && reason !== 'gmail-not-loaded') return;
      const now = Date.now();
      if (now - (this._lastMissToast || 0) < 120000) return;
      this._lastMissToast = now;
      const msg = reason === 'no-gmail'
        ? "📧 Couldn't read a code — open Gmail, or turn on background code reading (Ctrl+K → Logins & Codes)."
        : "📧 Gmail is still loading. If codes don't fill, keep Gmail awake or enable background reading (Ctrl+K → Logins & Codes).";
      window.showToast?.(msg, 'info', 6500);
    } catch {}
  },
};

if (typeof window !== 'undefined') window.EmailCodeAutofill = EmailCodeAutofill;
if (typeof module !== 'undefined' && module.exports) module.exports = { EmailCodeAutofill };
