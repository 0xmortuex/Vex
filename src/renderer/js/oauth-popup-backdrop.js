// === OAuth popup backdrop — dims Vex behind the real auth popup window ===
//
// The login/OAuth popup MUST be a real child window (Electron BrowserWindow) so
// it keeps window.opener for the credential handback — routing it into the
// in-app Peek overlay (a <webview>) severs the opener and the login dead-ends
// (the Ticket Tool / Discord bug). To restore the old in-app Peek *look*, main
// opens that popup frameless + parented + centered, and tells us to dim the main
// window behind it: 'oauth-popup:open' shows the backdrop, 'oauth-popup:close'
// (incl. the provider's own window.close() on success, Esc, or a backdrop click)
// hides it. Clicking the backdrop dismisses the popup via window.vex.dismissOAuthPopup.
//
// Mirrors the Peek backdrop styling (css/peek.css: rgba(0,0,0,.45), .16s fade)
// so the two feel like the same overlay. Self-contained: injects its own <style>.

const OAuthPopupBackdrop = {
  _el: null,
  _styled: false,

  _injectStyle() {
    if (this._styled) return;
    const s = document.createElement('style');
    s.id = 'vex-oauth-backdrop-style';
    s.textContent = `
      #vex-oauth-backdrop {
        position: fixed; inset: 0; z-index: 89000;
        background: rgba(0, 0, 0, 0.45);
        opacity: 0; transition: opacity .16s ease;
        pointer-events: none;
      }
      #vex-oauth-backdrop.show { opacity: 1; pointer-events: auto; }
    `;
    document.head.appendChild(s);
    this._styled = true;
  },

  _build() {
    if (this._el) return;
    this._injectStyle();
    const el = document.createElement('div');
    el.id = 'vex-oauth-backdrop';
    el.hidden = true;
    el.title = 'Click to dismiss';
    el.addEventListener('click', () => {
      try { window.vex?.dismissOAuthPopup?.(); } catch {}
    });
    document.body.appendChild(el);
    this._el = el;
  },

  show() {
    this._build();
    this._el.hidden = false;
    requestAnimationFrame(() => this._el && this._el.classList.add('show'));
  },

  hide() {
    if (!this._el) return;
    this._el.classList.remove('show');
    setTimeout(() => { if (this._el) this._el.hidden = true; }, 180);
  },

  init() {
    try {
      window.vex?.onOAuthPopupOpen?.(() => this.show());
      window.vex?.onOAuthPopupClose?.(() => this.hide());
    } catch { /* ignore — backdrop is cosmetic, never block the app */ }
  },
};

if (typeof window !== 'undefined') window.OAuthPopupBackdrop = OAuthPopupBackdrop;
if (typeof module !== 'undefined' && module.exports) module.exports = { OAuthPopupBackdrop };
