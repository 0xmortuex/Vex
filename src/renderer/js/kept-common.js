// === Pages as data the person keeps: what the three features share =============
//
// Datasets from page tables (js/kept-datasets.js), text versions of a page (js/page-versions.js) and extra things
// remembered in Recall (js/recall-extras.js) are separate opt-in features. What they have in common is here:
//
//   - the asking-main helper (every answer is { ok: true, ... } or { ok: false, error }; a refusal is thrown as an Error
//     with the sentence main gave, never swallowed),
//   - the rule for which tab may be read at all: not a private, Tor, routed or container tab, and not a banking,
//     payment, sign-in, mail or health page (VexPageSensitivity),
//   - the small things a screen needs (a switch kept in localStorage that is OFF until the person turns it on, the size
//     in words, the dialog frame).
//
// Nothing here talks to the network, and nothing here keeps anything: the files are main's (src/main/evodata-*.js).
const VexKept = {
  BTN: 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer',
  DANGER: 'font-size:11.5px;color:var(--danger,#e5484d);background:none;border:1px solid var(--danger,#e5484d);border-radius:6px;padding:3px 9px;cursor:pointer',

  // A text with {1}, {2} ... filled in, translated first (the whole sentence is the key in js/i18n-ui.js).
  t(text, ...args) {
    let out = text;
    if (typeof VexI18nUI !== 'undefined') {
      const hit = VexI18nUI.lookup(text);
      if (hit) out = hit;
    }
    return out.replace(/{(d)}/g, (_m, i) => String(args[Number(i) - 1]));
  },

  // Ask main (window.vex.<name>). Throws an Error with main's own sentence when it says no.
  async call(name, ...args) {
    const fn = window.vex && window.vex[name];
    if (typeof fn !== 'function') throw new Error('This is not available in this window');
    const r = await fn(...args);
    if (!r || r.ok !== true) throw new Error((r && r.error) || 'It did not work');
    return r;
  },

  activeWebview() {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') return null;
    return WebviewManager.webviews.get(TabManager.activeTabId) || null;
  },

  // Why nothing is kept from this tab, in words, or '' when it may be. Checked in the window; main checks the address again.
  refusal(wv) {
    if (!wv) return 'Open a page first';
    const policy = window.VexTabPolicy;
    if (policy && (policy.isPrivateWindow || !policy.canReadWebview(wv))) return 'Nothing is kept from a private, Tor, routed or container tab';
    const partition = wv.getAttribute && wv.getAttribute('partition');
    if (partition && partition !== 'persist:main') return 'Nothing is kept from a private, Tor, routed or container tab';
    const url = typeof window.vexGuestUrl === 'function' ? window.vexGuestUrl(wv) : '';
    if (!/^https?:/i.test(url)) return 'Only a web page can be kept';
    return this.sensitive(url);
  },
  // The plain-words reason an address is left alone (a bank, a payment or sign-in page, mail, health), or ''.
  sensitive(url) {
    const S = window.VexPageSensitivity;
    if (!S) throw new Error('The list of pages that are left alone is not loaded');
    return S.reason(url) || '';
  },

  formatBytes(n) {
    if (!n) return '0 KB';
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  },

  // The dialog frame the page tools use (js/page-export.js).
  sheet(title, cls) {
    if (!window.PageExport || typeof window.PageExport._sheet !== 'function') throw new Error('The dialog is not available');
    return window.PageExport._sheet(title, cls);
  },

  button(label, onClick, style) {
    const b = document.createElement('button');
    b.type = 'button'; b.style.cssText = style || this.BTN; b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  },

  line(text, muted) {
    const d = document.createElement('div');
    d.style.cssText = 'padding:6px 14px;font-size:11.5px;color:' + (muted === false ? 'var(--text)' : 'var(--text-muted)');
    d.textContent = text;
    return d;
  },

  // A switch row for a feature screen: "[x] label" and a sentence under it. -> the row.
  switchRow(label, flag, hint, onChange) {
    const row = document.createElement('label');
    row.style.cssText = 'display:block;padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer';
    const top = document.createElement('div');
    top.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--text);font-weight:600';
    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = flag.enabled();
    box.addEventListener('change', () => { flag.setEnabled(box.checked); if (onChange) onChange(box.checked); });
    top.append(box, document.createTextNode(label));
    const sub = document.createElement('div');
    sub.style.cssText = 'margin:3px 0 0 24px;font-size:11.5px;color:var(--text-muted)';
    sub.textContent = hint;
    row.append(top, sub);
    return row;
  },

  // "Delete everything this feature keeps": asks first, then calls main, then says how many went.
  deleteAllButton(label, { title, message, channel, done }) {
    return this.button(label, async () => {
      const ok = await window.vexConfirm({ title, message, okLabel: label, danger: true });
      if (!ok) return;
      try { const r = await this.call(channel); window.showToast?.(this.t('Deleted. Items: {1}', r.removed)); if (done) done(r); }
      catch (err) { window.showToast?.(err.message, 'error'); }
    }, this.DANGER);
  },
};

if (typeof window !== 'undefined') window.VexKept = VexKept;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexKept };
