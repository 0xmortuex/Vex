// === Close-protect: ask before closing a tab you are using ===========================
//
// Closing a tab by reflex (Ctrl+W, the X, a middle click, a gesture) loses the
// call you were in, the song that was playing, or the half-written message
// in a box. This asks ONCE, with one sentence that says why, before it closes
// a tab that is
//
//   playing sound            audible and not muted
//   in a call or recording   the microphone, camera or screen is in use
//   holding typed text       a text box or editor on the page has something in it
//
// and closes any other tab at once, as before. "Keep it open" leaves the tab
// alone. After "Close tab" the tab is in the closed-tab list like any other, so
// Reopen closed tab (Ctrl+Shift+T) puts it back where it was.
//
// The typed-text check asks the page ONE yes-or-no question (does any ordinary
// text box hold something?): the text itself is never read out, kept or sent,
// and a page that does not answer within 0.4 s is treated as having none.
// Password and search boxes do not count.
//
// Only closes the person asks for one tab at a time go through here
// (TabManager.requestClose): "close the other tabs", the agent's closes and
// other bulk closes do not ask, because the person already chose them as a set.
const CloseProtect = {
  KEY: 'vex.closeProtect.on',
  TYPED_MS: 400,
  _asking: false,

  enabled() { return localStorage.getItem(this.KEY) !== '0'; },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? '1' : '0'); },

  // A yes/no only: no text leaves the page.
  TYPED_SCRIPT: '(() => { try {'
    + ' const sel = \'textarea, input:not([type]), input[type="text"], input[type="email"], input[type="url"], input[type="tel"], input[type="number"], [contenteditable=""], [contenteditable="true"]\';'
    + ' for (const el of document.querySelectorAll(sel)) {'
    + '  const hint = ((el.getAttribute("role") || "") + " " + (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("name") || "") + " " + (el.getAttribute("type") || "")).toLowerCase();'
    + '  if (/search|find|query|password/.test(hint)) continue;'
    + '  if (el !== document.activeElement && !el.offsetParent) continue;'
    + '  const v = el.isContentEditable ? el.textContent : el.value;'
    + '  if (typeof v === "string" && v.trim().length >= 3) return true;'
    + ' } return false; } catch (e) { return false; } })()',

  // The reasons that can be known at once.
  quickReasons(tab) {
    const out = [];
    if (!tab) return out;
    if (typeof TabManager !== 'undefined' && TabManager.isCapturing && TabManager.isCapturing(tab)) out.push('is in a call or using the microphone, camera or screen');
    if (tab.audible && !tab.muted) out.push('is playing sound');
    return out;
  },

  // The live page of a tab, or null: a sleeping or not-yet-built tab has nothing typed in it.
  _page(tab) {
    if (tab.sleeping || tab._lazy || typeof WebviewManager === 'undefined' || typeof window.vexGuestEval !== 'function') return null;
    return WebviewManager.webviews.get(tab.id) || null;
  },

  async _typed(tab) {
    const wv = this._page(tab);
    if (!wv) return false;
    try { return (await window.vexGuestEval(wv, this.TYPED_SCRIPT, false, this.TYPED_MS)) === true; }
    catch (err) {
      // A page that is loading or not answering must not keep the tab open; it is noted so a real fault is seen.
      window.VexProblems?.note('Tabs', 'Close-protect could not look for typed text in "' + String(tab.title || tab.url).slice(0, 40) + '"', err);
      return false;
    }
  },

  async reasons(tab) {
    const out = this.quickReasons(tab);
    if (await this._typed(tab)) out.push('has text you typed that is not sent yet');
    return out;
  },

  // Close one tab the way a person does. Resolves true when it was closed. A tab that
  // cannot be protected (off, asleep, nothing live to ask) is closed at once, in this call.
  close(id) {
    if (typeof TabManager === 'undefined') return Promise.reject(new Error('Tabs are not loaded'));
    const tab = TabManager.tabs.find(t => t.id === id);
    if (!tab || !this.enabled() || (!this.quickReasons(tab).length && !this._page(tab))) { TabManager.closeTab(id); return Promise.resolve(true); }
    if (this._asking) return Promise.resolve(false);   // one question at a time: a second Ctrl+W waits for the answer
    return this._closeAsking(id, tab);
  },

  async _closeAsking(id, tab) {
    const why = await this.reasons(tab);
    if (!why.length) { TabManager.closeTab(id); return true; }
    this._asking = true;
    try {
      const name = String(tab.title || tab.url || 'This tab').slice(0, 60);
      const yes = await window.vexConfirm({
        title: 'Close this tab?',
        message: '"' + name + '" ' + why.join(' and ') + '. Closing it ends that. You can bring the tab back with Reopen closed tab (Ctrl+Shift+T), but not what was playing or typed.',
        okLabel: 'Close tab', cancelLabel: 'Keep it open', danger: true,
      });
      if (!yes) return false;
      // The tab may have gone while the question was open.
      if (!TabManager.tabs.some(t => t.id === id)) return true;
      TabManager.closeTab(id);
      return true;
    } finally { this._asking = false; }
  },
};

if (typeof window !== 'undefined') window.CloseProtect = CloseProtect;
if (typeof module !== 'undefined' && module.exports) module.exports = { CloseProtect };
