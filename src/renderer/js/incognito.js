// === Incognito: a window that forgets, and nothing more ====================
//
// Incognito, a Tor tab and "route all of Vex" are three different things, and they were mixed up:
//   * Incognito (this file, the mask): the window keeps no history, cookies or logins once it is closed. The
//     connection is NOT hidden: the sites and your network see the same address as always.
//   * Tor tab (js/tor-session.js, the onion): one tab whose traffic goes through Tor, which hides where you connect from.
//   * Route all of Vex (js/private-routing.js): a setting, kept across restarts, that sends EVERY window, incognito
//     ones included, through Tor or a proxy.
// Opening incognito never starts Tor. Only that last setting can put an incognito window on Tor, and when it does the
// window says so instead of implying it is merely private.

const VexIncognito = {
  // The note shown once in every incognito window. Said plainly, and without promising what incognito cannot do.
  NOTE_DIRECT: 'Incognito: this window does not save history, cookies or logins when you close it. Your connection is NOT hidden — for that, use a Tor tab.',
  NOTE_TOR: 'Incognito: nothing is saved when you close this window. Everything in Vex, including this window, is going through Tor.',
  NOTE_PROXY: 'Incognito: nothing is saved when you close this window. Everything in Vex, including this window, is going through your proxy.',

  // The words for a route mode ('direct' | 'tor' | 'proxy', as main saved it). Anything else is read as direct.
  noteFor(mode) {
    if (mode === 'tor') return this.NOTE_TOR;
    if (mode === 'proxy') return this.NOTE_PROXY;
    return this.NOTE_DIRECT;
  },

  // A normal incognito window only. A clean window (for sharing a screen) must show nothing of Vex's, and a guest window has
  // its own badge.
  wantsNote(policy, guest) {
    return !!(policy && policy.isPrivateWindow && !policy.isCleanWindow && !guest);
  },

  _t(s) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(s)) || s; },

  // Main refuses before the privacy policy is agreed to, and while Vex is locked: said, not dropped.
  async open() {
    if (!window.vex || typeof window.vex.openPrivateWindow !== 'function') {
      window.showToast?.('An incognito window is not available in this build', 'error');
      return false;
    }
    try {
      await window.vex.openPrivateWindow(
        typeof VexGuiStyle !== 'undefined' ? VexGuiStyle.get() : '',
        typeof VexSimpleMode !== 'undefined' ? VexSimpleMode.mode() : '');
      if (typeof VexUsage !== 'undefined' && VexUsage.touch) VexUsage.touch('private-window');
      return true;
    } catch (err) {
      window.showToast?.(String((err && err.message) || err).replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, ''), 'error');
      return false;
    }
  },

  // Slim bar at the bottom of the window. Dismissed with the button; it is shown once per window, so it is not remembered
  // anywhere (a new incognito window is a new window and says it again).
  showNote(mode) {
    if (typeof document === 'undefined') return null;
    document.getElementById('vex-incognito-note')?.remove();
    const el = document.createElement('div');
    el.id = 'vex-incognito-note';
    el.setAttribute('role', 'status');
    el.dataset.route = mode === 'tor' || mode === 'proxy' ? mode : 'direct';
    const icon = document.createElement('span');
    icon.className = 'vex-incognito-note-icon';
    icon.setAttribute('aria-hidden', 'true');
    if (typeof VexIcons !== 'undefined') icon.innerHTML = VexIcons.svg(mode === 'tor' ? 'onion' : 'incognito', { size: 16 });
    const text = document.createElement('span');
    text.className = 'vex-incognito-note-text';
    text.textContent = this._t(this.noteFor(mode));
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'vex-incognito-note-ok';
    ok.textContent = this._t('Got it');
    ok.addEventListener('click', () => el.remove());
    el.append(icon, text, ok);
    document.body.appendChild(el);
    if (typeof VexLayer !== 'undefined') VexLayer.track(el, { tier: 'toast', id: 'incognito-note' });
    return el;
  },

  async init() {
    const policy = typeof window !== 'undefined' ? window.VexTabPolicy : null;
    const guest = typeof VexGuest !== 'undefined' && VexGuest.isGuestWindow && VexGuest.isGuestWindow();
    if (!this.wantsNote(policy, guest)) return false;
    document.body.classList.add('vex-incognito-window');
    let mode = 'direct';
    if (typeof PrivateRouting !== 'undefined') mode = ((await PrivateRouting.state()) || {}).mode || 'direct';
    this.showNote(mode);
    return true;
  },
};

if (typeof window !== 'undefined') window.VexIncognito = VexIncognito;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexIncognito };
