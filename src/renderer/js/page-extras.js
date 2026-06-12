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
    const css = this.SELECTORS.join(',') + '{display:none!important;visibility:hidden!important}'
      + 'html,body{overflow:auto!important;position:static!important}';
    const js = `(function(){try{
      var id='vex-consent-style';
      if(!document.getElementById(id)){var el=document.createElement('style');el.id=id;el.textContent=${JSON.stringify(css)};document.documentElement.appendChild(el);}
    }catch(e){}})();`;
    try { webview.executeJavaScript(js).catch(() => {}); } catch {}
  },
};

if (typeof window !== 'undefined') { window.ReadAloud = ReadAloud; window.ConsentBlock = ConsentBlock; }
if (typeof module !== 'undefined' && module.exports) module.exports = { ReadAloud, ConsentBlock };
