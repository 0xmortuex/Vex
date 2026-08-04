// === Vex Agent CDP input — trusted mouse and keyboard ===
//
// The agent's old click was `el.click()` and its old typing was
// `el.value = text` plus a synthetic 'input' event. Both produce events with
// isTrusted:false, which is why the agent could look like it was working while
// nothing happened: React and Vue reconcile controlled inputs from their own
// state and throw away a directly-assigned .value, canvas apps read real
// pointer events, and plenty of sites gate submit handlers on isTrusted.
//
// Everything here goes through the DevTools Protocol Input domain instead, so
// the page cannot tell the agent apart from a person at the keyboard.
//
// Geometry comes from the page itself (getBoundingClientRect via
// executeJavaScript) and the events are dispatched by the main process at
// those coordinates. That's deliberate — resolving a CSS selector to a node
// over CDP would mean reimplementing querySelector across frames for no gain.
//
// Public API: AgentCDP. Depends on window.vex.cdp.
// KEY_CODES is exported for tests.

// windowsVirtualKeyCode values for the non-printable keys the agent uses.
// Printable text never goes through here — it uses Input.insertText, which
// handles unicode and IME correctly and is far faster than per-character
// key events.
const KEY_CODES = {
  Enter:      { code: 13, key: 'Enter',      text: '\r' },
  Tab:        { code: 9,  key: 'Tab',        text: '\t' },
  Backspace:  { code: 8,  key: 'Backspace',  text: '' },
  Delete:     { code: 46, key: 'Delete',     text: '' },
  Escape:     { code: 27, key: 'Escape',     text: '' },
  ArrowUp:    { code: 38, key: 'ArrowUp',    text: '' },
  ArrowDown:  { code: 40, key: 'ArrowDown',  text: '' },
  ArrowLeft:  { code: 37, key: 'ArrowLeft',  text: '' },
  ArrowRight: { code: 39, key: 'ArrowRight', text: '' },
  Home:       { code: 36, key: 'Home',       text: '' },
  End:        { code: 35, key: 'End',        text: '' },
  PageUp:     { code: 33, key: 'PageUp',     text: '' },
  PageDown:   { code: 34, key: 'PageDown',   text: '' },
};

const AgentCDP = {
  _wcId: null,

  // Resolve the webview's webContents id. Freshly-attached guests can return
  // -1, which is the same silent-failure case the DevTools handler guards
  // against elsewhere in the app.
  _id(webview) {
    try {
      const id = webview && typeof webview.getWebContentsId === 'function' ? webview.getWebContentsId() : -1;
      return typeof id === 'number' && id > 0 ? id : null;
    } catch { return null; }
  },

  available() {
    return !!(window.vex && window.vex.cdp);
  },

  async attach(webview) {
    if (!this.available()) return { ok: false, error: 'CDP bridge unavailable' };
    const id = this._id(webview);
    if (!id) return { ok: false, error: 'Tab is not ready yet' };
    const res = await window.vex.cdp.attach(id);
    if (res.ok) this._wcId = id;
    return res;
  },

  async detach() {
    if (!this.available()) return;
    try { await window.vex.cdp.detachAll(); } catch {}
    this._wcId = null;
  },

  async _send(webview, method, params) {
    if (!this.available()) return { ok: false, error: 'CDP bridge unavailable' };
    const id = this._id(webview);
    if (!id) return { ok: false, error: 'Tab is not ready yet' };
    return window.vex.cdp.send(id, method, params);
  },

  // Scroll the element into view and return its viewport-relative centre in
  // CSS pixels — the same coordinate space CDP's Input domain expects.
  async _centreOf(webview, selector) {
    const rect = await webview.executeJavaScript(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, error: 'Element not found: ' + ${JSON.stringify(selector)} };
        el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return { ok: false, error: 'Element has zero size (hidden?)' };
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') {
          return { ok: false, error: 'Element is not interactable (' + cs.visibility + '/' + cs.display + ')' };
        }
        return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName.toLowerCase() };
      })()
    `);
    return rect;
  },

  // A real click: move the pointer there first so hover/focus handlers run,
  // then press and release.
  async click(webview, selector) {
    const pos = await this._centreOf(webview, selector);
    if (!pos || !pos.ok) return pos || { ok: false, error: 'Could not locate element' };

    const base = { x: Math.round(pos.x), y: Math.round(pos.y), button: 'left', clickCount: 1 };

    let r = await this._send(webview, 'Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', button: 'none', clickCount: 0 });
    if (!r.ok) return r;
    r = await this._send(webview, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
    if (!r.ok) return r;
    r = await this._send(webview, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
    if (!r.ok) return r;

    return { ok: true, tag: pos.tag };
  },

  async pressKey(webview, keyName) {
    const k = KEY_CODES[keyName];
    if (!k) return { ok: false, error: 'Unsupported key: ' + keyName };
    const common = {
      windowsVirtualKeyCode: k.code,
      nativeVirtualKeyCode: k.code,
      key: k.key,
      code: k.key,
    };
    let r = await this._send(webview, 'Input.dispatchKeyEvent', { ...common, type: 'keyDown', text: k.text || undefined });
    if (!r.ok) return r;
    return this._send(webview, 'Input.dispatchKeyEvent', { ...common, type: 'keyUp' });
  },

  // Focus the field by clicking it, optionally clear it the way a person would
  // (select-all then delete — this drives the framework's own onChange rather
  // than fighting it), then insert the text.
  async typeText(webview, selector, text, clearFirst) {
    const clicked = await this.click(webview, selector);
    if (!clicked.ok) return clicked;

    if (clearFirst) {
      // Ctrl+A then Delete. Modifier bit 2 == Ctrl in the CDP Input domain.
      const sel = { windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: 2 };
      await this._send(webview, 'Input.dispatchKeyEvent', { ...sel, type: 'keyDown' });
      await this._send(webview, 'Input.dispatchKeyEvent', { ...sel, type: 'keyUp' });
      const del = await this.pressKey(webview, 'Delete');
      if (!del.ok) return del;
    }

    const str = String(text == null ? '' : text);
    if (str) {
      const r = await this._send(webview, 'Input.insertText', { text: str });
      if (!r.ok) return r;
    }
    return { ok: true };
  },

  async scroll(webview, direction, amount) {
    const amt = Number(amount) || 500;
    // Wheel events need a position to hit the right scroll container; the
    // viewport centre is the sane default.
    const dims = await webview.executeJavaScript(
      '({ w: window.innerWidth, h: window.innerHeight, sh: document.body.scrollHeight })'
    ).catch(() => ({ w: 800, h: 600, sh: 0 }));

    const x = Math.round(dims.w / 2), y = Math.round(dims.h / 2);

    if (direction === 'top' || direction === 'bottom') {
      // A wheel event can't reliably jump to an extreme; scripted scroll is
      // correct here and no site gates page position on event trust.
      await webview.executeJavaScript(
        direction === 'top' ? 'window.scrollTo({top:0})' : 'window.scrollTo({top:document.body.scrollHeight})'
      );
      return { ok: true };
    }

    const deltaY = direction === 'up' ? -amt : amt;
    return this._send(webview, 'Input.dispatchWheelEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
  },

  // JPEG keeps the payload small enough to send every agent turn without
  // blowing up the token bill. Vex's window is well under Claude's 2576px
  // long-edge limit, so no downscaling is needed and the coordinates the model
  // reasons about map 1:1 to the pixels it was shown.
  async screenshot(webview, quality = 70) {
    const r = await this._send(webview, 'Page.captureScreenshot', { format: 'jpeg', quality });
    if (!r.ok) return r;
    return { ok: true, data: r.result && r.result.data, mediaType: 'image/jpeg' };
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KEY_CODES };
}
