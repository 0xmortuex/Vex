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

  // Find an open Gmail webview anywhere in Vex (tab or panel).
  _findGmailWebview() {
    const wvs = Array.from(document.querySelectorAll('webview'));
    return wvs.find(w => /mail\.google\.com/i.test(w.getAttribute('src') || '')) || null;
  },

  // Scrape the newest inbox rows for a verification code, preferring unread.
  async _scrapeLatestCode(gmailWv) {
    const js = `(function(){try{
      // Gmail inbox rows are <tr class="zA">; unread rows also carry "zE".
      var rows=Array.prototype.slice.call(document.querySelectorAll('tr.zA')).slice(0,8);
      var out=[];
      for(var i=0;i<rows.length;i++){var r=rows[i];var unread=/(^|\\s)zE(\\s|$)/.test(r.className);var t='';try{t=(r.innerText||'').replace(/\\s+/g,' ').trim();}catch(e){}out.push({unread:unread,text:t});}
      return JSON.stringify(out);
    }catch(e){return '[]';}})()`;
    let rows = [];
    try { rows = JSON.parse(await gmailWv.executeJavaScript(js)); } catch { return null; }
    // Unread rows first (a fresh code email is unread), newest order preserved.
    const ordered = rows.filter(r => r.unread).concat(rows.filter(r => !r.unread));
    for (const r of ordered) {
      const code = this._extractCode(r.text);
      if (code) return code;
    }
    return null;
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
      var boxes=all.filter(function(el){return vis(el)&&el.maxLength===1&&!el.value;});
      if(boxes.length>=D.length&&boxes.length<=D.length+2){for(var i=0;i<D.length;i++){fire(boxes[i],D[i]);}return true;}
      for(var j=0;j<all.length;j++){if(isCode(all[j])&&!all[j].value){fire(all[j],CODE);return true;}}
      return false;
    }catch(e){return false;}})()`;
    try { return loginWv.executeJavaScript(js); } catch { return Promise.resolve(false); }
  },

  // Entry point: called on pages that may be waiting for an emailed code.
  async tryFill(loginWv, url) {
    try {
      if (!loginWv || !/^https:/i.test(url || '')) return;
      const gmailWv = this._findGmailWebview();
      if (!gmailWv) return;                                   // no open Gmail → nothing to read
      if (!(await this._hasEmptyCodeField(loginWv))) return;  // not a code screen
      // The email usually arrives a few seconds after you ask for it — poll a bit.
      for (let i = 0; i < 8; i++) {
        if (!(await this._hasEmptyCodeField(loginWv))) return; // filled/left already
        const code = await this._scrapeLatestCode(gmailWv);
        if (code) {
          const ok = await this._injectCode(loginWv, code);
          if (ok) { try { window.showToast?.('📧 Filled the code from your email'); } catch {} return; }
        }
        await new Promise(r => setTimeout(r, 2500));
      }
    } catch {}
  },
};

if (typeof window !== 'undefined') window.EmailCodeAutofill = EmailCodeAutofill;
if (typeof module !== 'undefined' && module.exports) module.exports = { EmailCodeAutofill };
