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
          if (tab.sleeping && T.wakeTab) T.wakeTab(tab.id);
          else if (tab._lazy && T._materializeTab) T._materializeTab(tab);
          tab.keepAwakeUntil = Date.now() + 120000;   // survive the ~66s poll
          return (typeof WebviewManager !== 'undefined' && WebviewManager.webviews.get(tab.id))
            || document.querySelector(`webview[data-tab-id="${tab.id}"]`) || null;
        }
      }
    } catch {}
    return null;
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
    const js = `(function(){try{
      var rows=Array.prototype.slice.call(document.querySelectorAll('tr.zA'));
      var out=[];
      for(var i=0;i<rows.length&&i<12;i++){out.push((rows[i].textContent||'').replace(/\\s+/g,' ').trim());}
      return JSON.stringify({loaded: rows.length>0, rows: out});
    }catch(e){return JSON.stringify({loaded:false, rows:[]});}})()`;
    let data;
    try { data = JSON.parse(await gmailWv.executeJavaScript(js)); } catch { return { loaded: false, code: null }; }
    let code = null;
    for (const text of (data.rows || [])) { const c = this._extractCode(text); if (c) { code = c; break; } }
    return { loaded: !!data.loaded, code };
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
      let sawField = false, plausible = false, baseline = null, baselineSet = false;
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
            const { loaded, code } = await this._readInbox(gmailWv);
            if (loaded) {
              if (!baselineSet) { baseline = code; baselineSet = true; }   // pre-existing code — don't fill it, wait for a new one
              else if (code && code !== baseline) {
                const ok = await this._injectCode(loginWv, code);
                if (ok) { try { window.showToast?.('📧 Filled the code from your email'); } catch {} break; }
              }
            }
          }
        }
        await new Promise(r => setTimeout(r, 3000));
      }
      this._running = false;
    } catch (e) { this._running = false; }
  },
};

if (typeof window !== 'undefined') window.EmailCodeAutofill = EmailCodeAutofill;
if (typeof module !== 'undefined' && module.exports) module.exports = { EmailCodeAutofill };
