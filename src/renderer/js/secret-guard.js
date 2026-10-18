// === Secret paste guard and redact-before-paste ===================================
//
// A token pasted into a chat, an issue or an AI prompt is a token you now have to revoke.
// This catches the common ones BEFORE the paste lands:
//
//   web inputs   a paste into a text box on a site that is not on your allow list, when the
//                text holds an API key, token, private key or "@everyone". The paste is held
//                (by the page-side hook in preload-webview.js, which keeps the text in the
//                page's own process), Vex asks, and "Paste redacted" inserts a copy with the
//                secret replaced by <redacted: kind>. Cancel inserts nothing.
//   AI prompts   the same check on what you are about to send to Vex AI, before it is sent.
//   clipboard    Ctrl+K > "Redact the clipboard": rewrites C:\Users\<name> to ~ and secrets to
//                <redacted: kind>, with a count, and puts the result back on the clipboard.
//
// The secret is NEVER logged, stored, sent to the AI or shown: only the KIND of thing found and
// a count are ever written down or displayed. The patterns are the block between the BEGIN
// and END markers below; preload-webview.js carries an identical copy (a test compares them).
//
// Off until switched on.

// BEGIN vex-secret-patterns
const VEX_SECRET_PATTERNS = [
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{20,255})\b/g],
  ['OpenAI or Anthropic key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,200}\b/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Discord token', /\b[MN][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,40}\b/g],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,100}\b/g],
  ['Stripe key', /\b[sr]k_live_[A-Za-z0-9]{16,100}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['Private key', /-----BEGIN [A-Z ]{0,20}PRIVATE KEY-----[\s\S]{0,6000}?(?:-----END [A-Z ]{0,20}PRIVATE KEY-----|$)/g],
  ['Bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{20,500}/g],
  ['Mass mention', /@(?:everyone|here)\b/g],
];
// END vex-secret-patterns

const SecretGuard = {
  KEY: 'vex.secretGuard',
  FEATURE: 'secret-guard',
  MAX_TEXT: 200000,
  ...DevDeskUtil.switchFor('vex.secretGuard.enabled'),

  // ---- pure parts (tested) -------------------------------------------------------------------
  // text -> [{ kind, count }]   (kinds and counts only; never the match)
  detect(text) {
    const s = String(text == null ? '' : text).slice(0, this.MAX_TEXT);
    const out = [];
    for (const [kind, re] of VEX_SECRET_PATTERNS) {
      re.lastIndex = 0;
      const n = (s.match(re) || []).length;
      if (n) out.push({ kind, count: n });
    }
    return out;
  },
  // text -> { text, count, paths }  with secrets as <redacted: kind>, @everyone as (everyone),
  // and C:\Users\<name> as ~
  redact(text) {
    let s = String(text == null ? '' : text).slice(0, this.MAX_TEXT);
    let count = 0;
    for (const [kind, re] of VEX_SECRET_PATTERNS) {
      re.lastIndex = 0;
      s = s.replace(re, () => { count++; return kind === 'Mass mention' ? '(everyone)' : '<redacted: ' + kind + '>'; });
    }
    let paths = 0;
    s = s.replace(/[A-Za-z]:\\Users\\[^\\\s"'<>|]+/g, () => { paths++; return '~'; });
    return { text: s, count, paths };
  },
  describeKinds(kinds) { return kinds.map(k => k.kind + (k.count > 1 ? ' x' + k.count : '')).join(', '); },

  // ---- allow list ------------------------------------------------------------------------------
  state() {
    const s = DevDeskUtil.read(this.KEY, () => ({ allow: [] }));
    if (!Array.isArray(s.allow)) s.allow = [];
    return s;
  },
  allowed() { return this.state().allow.filter(h => typeof h === 'string' && h); },
  allow(host) {
    const h = String(host == null ? '' : host).trim().toLowerCase().replace(/^www\./, '');
    if (!/^[a-z0-9.-]{1,100}$/.test(h) || !h.includes('.')) throw new Error('Use a site name like example.com');
    const s = this.state();
    if (s.allow.includes(h)) return h;
    if (s.allow.length >= 100) throw new Error('At most 100 allowed sites');
    s.allow.push(h);
    DevDeskUtil.write(this.KEY, s);
    this.pushAll();
    return h;
  },
  disallow(host) {
    const s = this.state();
    if (!s.allow.includes(host)) throw new Error(host + ' is not on the list');
    s.allow = s.allow.filter(h => h !== host);
    DevDeskUtil.write(this.KEY, s);
    this.pushAll();
  },

  // ---- web inputs: the page-side hook is told what to do -------------------------------------------
  config() { return { on: this.enabled(), allow: this.allowed() }; },
  push(webview) {
    if (!webview || typeof webview.send !== 'function') return;
    try { webview.send('vex-secret-guard-config', this.config()); }
    catch (err) { console.error('[SecretGuard] a page could not be told the setting:', err.message); }
  },
  pushAll() {
    if (typeof WebviewManager === 'undefined') return;
    for (const wv of WebviewManager.webviews.values()) this.push(wv);
  },
  // Runs on every route that flips the switch (DevDeskUtil.switchFor): the open pages are told, the command follows.
  followEnabled() { this.pushAll(); this.registerCommands(); },
  // The page held a paste: ask, then tell it what to do.
  async onPaste(webview, msg) {
    if (!msg || typeof msg !== 'object' || !Number.isInteger(msg.id) || !Array.isArray(msg.kinds)) return;
    const kinds = msg.kinds.filter(k => k && typeof k.kind === 'string').slice(0, 12).map(k => ({ kind: String(k.kind).slice(0, 40), count: Number(k.count) || 1 }));
    let action = 'cancel';
    try {
      const ok = await vexConfirm({
        title: 'This looks like a secret',
        message: 'The text you pasted contains ' + this.describeKinds(kinds) + ', and ' + (String(msg.host || 'this site')) + ' is not on your allowed list. Paste a copy with it replaced by <redacted>?',
        okLabel: 'Paste redacted', cancelLabel: 'Do not paste',
      });
      action = ok ? 'redact' : 'cancel';
    } catch (err) { DevDeskUtil.fail('Secret guard', err); }
    DevDeskUtil.touch(this.FEATURE);
    // Only kinds and counts are recorded, never the text.
    if (typeof VexLedger !== 'undefined') VexLedger.record({ feature: this.FEATURE, what: (action === 'redact' ? 'Pasted a redacted copy' : 'Held back a paste') + ' on ' + String(msg.host || 'a site').slice(0, 80), why: 'The text contained ' + this.describeKinds(kinds) });
    try { webview.send('vex-secret-paste-decision', { id: msg.id, action }); }
    catch (err) { DevDeskUtil.fail('Secret guard', err); }
  },

  // ---- AI prompts ------------------------------------------------------------------------------------------
  // -> the text to send (redacted if the owner agreed), or null to send nothing.
  async guardPrompt(text) {
    if (!this.enabled()) return text;
    const kinds = this.detect(text);
    if (!kinds.length) return text;
    const ok = await vexConfirm({
      title: 'This prompt contains a secret',
      message: 'It holds ' + this.describeKinds(kinds) + '. Send a copy with it replaced by <redacted>? Choosing "Do not send" lets you edit it first.',
      okLabel: 'Send redacted', cancelLabel: 'Do not send',
    });
    if (!ok) return null;
    DevDeskUtil.touch(this.FEATURE);
    return this.redact(text).text;
  },

  // ---- the clipboard command -------------------------------------------------------------------------------
  async redactClipboard() {
    if (!this.enabled()) throw new Error('The secret guard is switched off (Settings > Developer desk)');
    const text = await navigator.clipboard.readText();
    if (!text) throw new Error('The clipboard has no text');
    const r = this.redact(text);
    if (!r.count && !r.paths) { window.showToast?.('Nothing to redact in the clipboard'); return r; }
    await navigator.clipboard.writeText(r.text);
    DevDeskUtil.touch(this.FEATURE);
    window.showToast?.('Clipboard rewritten: ' + r.count + ' secret' + VexPlural.s(r.count) + ', ' + r.paths + ' user path' + VexPlural.s(r.paths));
    return r;
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('secretguard:', this.enabled() ? [{
      id: 'secretguard:clipboard', label: 'Redact the clipboard', icon: 'code', hint: 'Replace tokens and C:\\Users\\name in the copied text',
      action: () => { this.redactClipboard().catch(err => DevDeskUtil.fail('Redact the clipboard', err)); },
    }] : []);
    return true;
  },
  settingsRows(body) {
    const S = VexSettingsGroup;
    const redraw = () => VexSettingsGroup.refresh('setting-dev-desk');
    body.appendChild(S.note('Secret paste guard: holds a paste that contains an API key, token, private key or @everyone on a site that is not on your allowed list, and the same check on Vex AI prompts, and offers a redacted copy. The secret itself is never logged or stored.'));
    body.appendChild(S.toggle('Secret paste guard', this.enabled(), (on) => { this.setEnabled(on); redraw(); }));
    if (!this.enabled()) return;
    for (const h of this.allowed()) {
      const row = DevDeskUtil.el('div', 'setting-toggle-row');
      row.append(DevDeskUtil.el('span', '', h + ' (pastes are not checked)'), S.button('Remove', () => { try { this.disallow(h); redraw(); } catch (err) { DevDeskUtil.fail('Secret guard', err); } }, 'danger'));
      body.appendChild(row);
    }
    body.appendChild(S.button('Allow a site...', () => {
      (async () => {
        const v = await vexPrompt({ title: 'Allow pasting secrets on a site', label: 'Site name', placeholder: 'github.com' });
        if (v == null) return;
        this.allow(v);
        redraw();
      })().catch(err => DevDeskUtil.fail('Secret guard', err));
    }));
  },
};

if (typeof window !== 'undefined') {
  window.SecretGuard = SecretGuard;
  window.VEX_SECRET_PATTERNS = VEX_SECRET_PATTERNS;
  SecretGuard.registerCommands();
  document.addEventListener('DOMContentLoaded', () => SecretGuard.registerCommands());
}
if (typeof module !== 'undefined' && module.exports) module.exports = { SecretGuard, VEX_SECRET_PATTERNS };
