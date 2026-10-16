// === Paste as plain text, in pages (T3-056) =====================================
//
// Copying from a web page and pasting into a mail, a document or a chat brings
// the page's fonts, colours and links along. Browsers answer with "Paste as plain
// text". Here it is, in two places:
//
//   * the page's right-click menu in anything you can type in: "Paste as plain
//     text" under Paste (js/webview.js asks menuRows());
//   * Ctrl+K, "Paste as plain text": into the tab in front, where the caret is.
//
// The key Ctrl+Shift+V is Chromium's own for the same thing in a page, and Vex
// binds nothing on it, so it reaches the page untouched (a site can still take it
// for itself, as Slack does). This does not replace it.
//
// The paste is the page's own "paste and match style" command: the clipboard's
// plain text only, with no HTML, in the style of where it lands. It does not read
// the clipboard from Vex and does not keep a copy of it.
const VexPastePlain = {
  KEY: 'vex.pastePlain',            // '0' = off

  enabled() { return localStorage.getItem(this.KEY) !== '0'; },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? '1' : '0'); },

  // Paste the clipboard into the page's focused field as plain text.
  paste(webview) {
    if (!this.enabled()) throw new Error('Paste as plain text is switched off in Settings');
    if (!webview || typeof webview.pasteAndMatchStyle !== 'function') throw new Error('There is no page to paste into');
    if (typeof webview.focus === 'function') webview.focus();
    webview.pasteAndMatchStyle();
    return true;
  },

  // The rows for a page's right-click menu: params is Electron's context-menu params.
  menuRows(webview, params) {
    if (!this.enabled() || !params || !params.isEditable) return [];
    const flags = params.editFlags || {};
    return [{
      label: 'Paste as plain text',
      disabled: flags.canPaste === false,
      action: () => {
        try { this.paste(webview); }
        catch (err) { window.showToast?.((err && err.message) || String(err), 'error'); }
      },
    }];
  },

  // Ctrl+K: into the tab in front.
  pasteIntoActive() {
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null;
    if (!wv) throw new Error('Open a page first');
    return this.paste(wv);
  },
};

if (typeof window !== 'undefined') window.VexPastePlain = VexPastePlain;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPastePlain };
