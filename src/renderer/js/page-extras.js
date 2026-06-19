// === Vex page extras: Read Aloud (TTS) + cookie-banner auto-dismiss ===

// ---- Read Aloud — speaks the article text of the active tab ----
const ReadAloud = {
  speaking: false,

  async toggle() {
    if (this.speaking) { this.stop(); return; }
    const wv = WebviewManager.getActiveWebview();
    if (!wv) { window.showToast?.('Open a page first'); return; }
    let text = '';
    try {
      text = await wv.executeJavaScript(
        `(()=>{const el=document.querySelector('article,main,[role=main]')||document.body;return (el.innerText||'').replace(/\\s+/g,' ').trim().substring(0,12000);})()`
      );
    } catch {}
    if (!text || text.length < 40) { window.showToast?.('Nothing readable on this page'); return; }
    try { speechSynthesis.cancel(); } catch {}
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.onend = () => { this.speaking = false; window.showToast?.('Read aloud finished'); };
    u.onerror = () => { this.speaking = false; };
    this.speaking = true;
    speechSynthesis.speak(u);
    window.showToast?.('🔊 Reading aloud — run again to stop');
  },

  stop() {
    try { speechSynthesis.cancel(); } catch {}
    this.speaking = false;
    window.showToast?.('Stopped reading');
  },
};

// ---- Cookie-banner auto-dismiss ----
// Hides the major consent-platform containers and unlocks page scroll. CSS-only
// (no auto-clicking), so it can't accidentally accept anything — it simply
// removes the wall. Toggle in Settings → Privacy; default ON.
const ConsentBlock = {
  KEY: 'vex.consentBlock',
  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) { try { localStorage.setItem(this.KEY, on ? 'on' : 'off'); } catch {} },

  SELECTORS: [
    '#onetrust-consent-sdk', '#onetrust-banner-sdk', '.onetrust-pc-dark-filter',
    '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay',
    '#didomi-host', '.didomi-popup-backdrop',
    '#usercentrics-root', '#usercentrics-cmp-ui',
    '.qc-cmp2-container', '#qc-cmp2-container',
    '#sp_message_container_', 'div[id^="sp_message_container"]',
    '.fc-consent-root', '.cmp-banner', '#cmpbox', '#cmpbox2',
    '.truste_overlay', '.truste_box_overlay',
    '#cookie-banner', '#cookieBanner', '#cookie-notice', '.cookie-notice',
    '.cookie-banner', '.cookie-consent', '#cookieConsent', '.cc-window.cc-banner',
    '#gdpr-banner', '.gdpr-banner', '#consent-banner', '.consent-banner',
  ],

  applyTo(webview) {
    if (!this.enabled()) return;
    const sel = this.SELECTORS.join(',');
    const hideCss = sel + '{display:none!important;visibility:hidden!important}';
    // Scroll/position un-lock that undoes a banner's body scroll-lock. This must
    // NOT be applied blanket: forcing html,body to position:static + overflow:auto
    // overrides sites that legitimately position/scroll on body and wrecks their
    // layout (Roblox anchored its global footer to <body>, so position:static
    // dropped it into the middle of the page). We add it ONLY once a consent
    // element is actually present, re-checking briefly for banners that mount
    // after dom-ready. The hide rule is safe everywhere — the selectors are
    // specific CMP/cookie-banner IDs that don't match ordinary markup.
    const unlockCss = 'html,body{overflow:auto!important;position:static!important}';
    // Known "reject all" buttons across the major CMPs, plus a scoped text match
    // inside consent containers — so we record a real opt-out (banner stays gone
    // next visit) instead of only hiding it. Text matching is confined to the
    // consent containers above so we never click a stray "reject" elsewhere.
    const rejectIds = JSON.stringify([
      '#onetrust-reject-all-handler', '.ot-pc-refuse-all-handler',
      '#CybotCookiebotDialogBodyButtonDecline', '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
      '#didomi-notice-disagree-button', '.didomi-continue-without-agreeing',
      'button[mode="primary"].qc-cmp2-summary-button', '[data-testid="uc-deny-all-button"]',
      '.fc-cta-do-not-consent', '.fc-button.fc-cta-do-not-consent',
      '[data-testid="reject-all"]', '[aria-label="Reject all"]', '[title="Reject all"]',
    ]);
    const js = `(function(){try{
      var sel=${JSON.stringify(sel)};
      var REJECT_IDS=${rejectIds};
      var RX=/(^\\s*(reject|decline|refuse|deny|disagree)\\b)|reject all|decline all|only necessary|necessary only|essential( cookies)? only|continue without accepting|do not (sell|share|accept)/i;
      var clicked=false;
      function vis(el){if(!el)return false;var r=el.getBoundingClientRect();if(r.width<2||r.height<2)return false;var cs=getComputedStyle(el);return cs.visibility!=='hidden'&&cs.display!=='none';}
      function tryReject(){
        if(clicked)return true;
        for(var i=0;i<REJECT_IDS.length;i++){var b=document.querySelector(REJECT_IDS[i]);if(b&&vis(b)){try{b.click();clicked=true;return true;}catch(e){}}}
        var cs=document.querySelectorAll(sel);
        for(var c=0;c<cs.length;c++){var bs=cs[c].querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]');
          for(var j=0;j<bs.length;j++){var t=(bs[j].textContent||bs[j].value||'').trim();if(t&&t.length<40&&RX.test(t)&&vis(bs[j])){try{bs[j].click();clicked=true;return true;}catch(e){}}}}
        return false;
      }
      var id='vex-consent-style';
      function ensure(){var el=document.getElementById(id);if(!el){el=document.createElement('style');el.id=id;document.documentElement.appendChild(el);}return el;}
      function paint(){var has=!!document.querySelector(sel);if(has)tryReject();ensure().textContent=${JSON.stringify(hideCss)}+(has?${JSON.stringify(unlockCss)}:'');return has;}
      if(!paint() && typeof MutationObserver==='function'){
        var n=0;var mo=new MutationObserver(function(){if((paint()&&clicked)||++n>40)mo.disconnect();});
        try{mo.observe(document.documentElement,{childList:true,subtree:true});}catch(e){}
        setTimeout(function(){try{mo.disconnect();}catch(e){}},10000);
      }
    }catch(e){}})();`;
    try { webview.executeJavaScript(js).catch(() => {}); } catch {}
  },
};

// ---- Copy & right-click unlock — bypass sites that block selection/copy ----
// Re-enables text selection, right-click, and copy/cut on pages that disable
// them via JS or CSS (the common "you can't copy this" walls). It does NOT
// crack DRM or read canvas-rendered editors (e.g. Google Docs has no selectable
// DOM text). Two entry points:
//   • applyTo(webview)       — auto-applied on every page load when the global
//                              toggle (Settings → Browsing extras) is ON.
//   • applyNow()             — on-demand from the command bar; unlocks just the
//                              current page regardless of the global toggle.
// Default is OFF so it never interferes with legit copy handlers in web apps
// (spreadsheets, code editors). The injected script:
//   1. stops the site's capture-phase block handlers (stopPropagation, NOT
//      stopImmediatePropagation — so Vex's own gesture handler still runs and
//      we never call preventDefault, letting the native copy/menu proceed);
//   2. nulls the inline on* blockers sites re-assign (re-cleared for ~10s);
//   3. forces user-select back on via injected CSS.
const CopyUnlock = {
  KEY: 'vex.copyUnlock',
  enabled() { try { return localStorage.getItem(this.KEY) === 'on'; } catch { return false; } },
  setEnabled(on) { try { localStorage.setItem(this.KEY, on ? 'on' : 'off'); } catch {} },

  _script() {
    return `(function(){try{
      if (window.__vexCopyUnlock) return; window.__vexCopyUnlock = true;
      // Block only copy/selection-related events at capture; stopPropagation
      // (not Immediate, not preventDefault) bypasses the site's own blockers
      // on inner nodes while leaving the native copy/menu and Vex gestures.
      var STOP = ['contextmenu','copy','cut','selectstart','dragstart','beforecopy'];
      STOP.forEach(function(type){
        try { document.addEventListener(type, function(e){ e.stopPropagation(); }, true); } catch(_){}
      });
      // Sites re-assign inline on* handlers; clear the copy/selection ones for a
      // short window after load.
      var PROPS = ['oncontextmenu','oncopy','oncut','onselectstart','ondragstart','onbeforecopy'];
      function clearOn(){
        var nodes = [document, document.documentElement, document.body];
        for (var n=0;n<nodes.length;n++){ if(!nodes[n]) continue;
          for (var p=0;p<PROPS.length;p++){ try{ nodes[n][PROPS[p]] = null; }catch(_){} } }
      }
      clearOn();
      var ticks=0; var iv=setInterval(function(){ clearOn(); if(++ticks>20){ try{clearInterval(iv);}catch(_){} } }, 500);
      // Force selection back on (overrides user-select:none).
      var id='vex-copy-unlock-style';
      if(!document.getElementById(id)){
        var st=document.createElement('style'); st.id=id;
        st.textContent='*,*::before,*::after{-webkit-user-select:auto!important;-moz-user-select:auto!important;-ms-user-select:auto!important;user-select:auto!important;-webkit-touch-callout:default!important;}html,body{-webkit-user-select:auto!important;user-select:auto!important;}';
        (document.head||document.documentElement).appendChild(st);
      }
    }catch(e){}})();`;
  },

  applyTo(webview, force) {
    if (!force && !this.enabled()) return;
    try { webview.executeJavaScript(this._script()).catch(() => {}); } catch {}
  },

  // On-demand: unlock the active page now, regardless of the global toggle.
  applyNow() {
    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    if (!wv) { window.showToast?.('Open a page first'); return; }
    this.applyTo(wv, true);
    window.showToast?.('🔓 Copy & right-click unlocked on this page');
  },
};

if (typeof window !== 'undefined') { window.ReadAloud = ReadAloud; window.ConsentBlock = ConsentBlock; window.CopyUnlock = CopyUnlock; }
if (typeof module !== 'undefined' && module.exports) module.exports = { ReadAloud, ConsentBlock, CopyUnlock };
