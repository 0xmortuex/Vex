// === Vex TOTP 2FA autofill ===
// On a site's 2FA screen, auto-fill the 6-digit authenticator code from Vex's
// built-in Authenticator — so you never open the panel, read, and type it.
//
// SAFETY: a TOTP code is only injected when the PAGE'S SITE matches a saved
// account's issuer (e.g. the GitHub code only ever goes into github.com). The
// site "brand" is the registrable label (second-to-last host label), so a
// look-alike host like github.com.evil.com resolves to brand "evil" and gets
// nothing — the code can't be phished onto a wrong origin. Only fills a genuine
// one-time-code field (never a search/promo box), and only when it's empty.
const TotpAutofill = {
  _norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); },

  async autofill(webview, url) {
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return; }
    if (!host || !/^https:/i.test(url)) return;
    const brand = this._norm((host.split('.').slice(-2)[0]) || host);
    if (brand.length < 3) return;

    let list = [];
    try { list = await window.vex.totpList(); } catch { return; }
    if (!list || !list.length) return;

    // Match by issuer (brand names like "GitHub"/"Google"); fall back to label
    // only when an account has no issuer. Require a real overlap, not a 1-char one.
    const matches = list.filter((a) => {
      const iss = this._norm(a.issuer);
      if (iss) return iss.length >= 3 && (iss === brand || iss.includes(brand) || brand.includes(iss));
      const lab = this._norm(a.label);
      return lab.length >= 3 && (lab.includes(brand) || brand.includes(lab));
    });
    if (matches.length !== 1) return;   // exactly one → unambiguous & safe

    let codes = [];
    try { codes = await window.vex.totpCodes(); } catch { return; }
    const entry = codes.find((x) => x.id === matches[0].id);
    const code = entry && entry.code;
    if (!code || !/^\d{4,8}$/.test(code)) return;
    this._inject(webview, code);
    try { window.AutofillLog?.record('totp', url, true, matches[0].issuer || matches[0].label); } catch {}
  },

  _inject(webview, code) {
    const js = `(function(){try{
      var CODE=${JSON.stringify(code)};
      var DIGITS=CODE.split('');
      var setter=(function(){try{return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;}catch(e){return null;}})();
      function fire(el,val){try{el.focus();setter?setter.call(el,val):(el.value=val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}}
      function vis(el){try{var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}catch(e){return false;}}
      function meta(el){try{return ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')).toLowerCase();}catch(e){return '';}}
      // A genuine one-time-code field. Deliberately strict: autocomplete
      // one-time-code, or clear 2FA wording — never a bare "code" (promo/coupon).
      function isOtp(el){var t=(el.type||'').toLowerCase();if(t==='password')return false;if(!(t===''||t==='text'||t==='tel'||t==='number'))return false;if(!vis(el))return false;var ac=(el.getAttribute('autocomplete')||'').toLowerCase();if(ac==='one-time-code')return true;return /otp|2fa|two.?factor|totp|mfa|authenticator|one.?time|verification.?code|security.?code|passcode|auth.?code/.test(meta(el));}
      function pageIs2fa(){try{return /two.?factor|authenticat|verify your|verification code|one.?time|2fa|enter the (code|digits)/i.test(document.body.innerText||'');}catch(e){return false;}}
      function fill(){
        var all=Array.prototype.slice.call(document.querySelectorAll('input'));
        // Split-box case: a row of maxlength-1 numeric inputs (React OTP). Only on
        // a page that clearly IS a 2FA screen, to avoid unrelated 1-char inputs.
        var boxes=all.filter(function(el){var t=(el.type||'').toLowerCase();var im=(el.getAttribute('inputmode')||'').toLowerCase();return vis(el)&&el.maxLength===1&&(t==='tel'||t==='number'||im==='numeric'||/^\\d?$/.test(el.value||''))&&(t===''||t==='text'||t==='tel'||t==='number');});
        if(boxes.length>=DIGITS.length&&boxes.length<=DIGITS.length+2&&pageIs2fa()){
          var empty=boxes.filter(function(b){return !b.value;});
          if(empty.length>=DIGITS.length){for(var i=0;i<DIGITS.length;i++){fire(boxes[i],DIGITS[i]);}return true;}
        }
        // Single-field case.
        for(var j=0;j<all.length;j++){if(isOtp(all[j])&&!all[j].value){fire(all[j],CODE);return true;}}
        return false;
      }
      fill();
      // 2FA fields often render a beat after load — retry briefly, and re-fill on
      // focus (click-to-fill), always only into an empty field.
      var n=0;var iv=setInterval(function(){if(fill()||++n>8)clearInterval(iv);},400);
      if(!window.__vexTotpFocusWired){window.__vexTotpFocusWired=true;
        document.addEventListener('focusin',function(e){try{var el=e.target;if(el&&el.tagName==='INPUT'&&!el.value&&isOtp(el)){setTimeout(fill,0);}}catch(e){}},true);
      }
    }catch(e){}})();`;
    try { webview.executeJavaScript(js).catch(() => {}); } catch {}
  },
};

if (typeof window !== 'undefined') window.TotpAutofill = TotpAutofill;
if (typeof module !== 'undefined' && module.exports) module.exports = { TotpAutofill };
