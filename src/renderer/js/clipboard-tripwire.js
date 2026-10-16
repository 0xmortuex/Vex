// === Paste-and-run tripwire (T3-121) ============================================
//
// "ClickFix" pages ("verify you are human", "fix this error") put a shell command
// on your clipboard and tell you to paste it into Win+R or PowerShell. Here the
// page's clipboard writes are watched (preload-webview.js): a write made by a
// SCRIPT, with no click or key press behind it, whose text looks like a shell
// one-liner, gets a warning with two buttons: "Clear the clipboard" and "Keep it".
//
// Only programmatic writes count. A "Copy" button on a documentation page, or
// you selecting a command and pressing Ctrl+C, is a user action and is never
// reported, so copying PowerShell from docs by hand is untouched. The price is
// that a ClickFix page that copies when you click its fake "I am not a robot"
// button also looks like a user action and is not caught (nothing in the page can
// tell the two apart); docs/security-tier3-threat-notes.md.
//
// It only ever warns. It never blocks the write, never clears by itself, and
// "Clear" empties the clipboard only if it still holds exactly the text the page put
// there (main/secret-clipboard.js clearIf): something you copied since is left alone.
// The command text is never saved: the small log keeps the site, the time, the kind of
// command and what you chose.
const VexClipboardTripwire = {
  ENABLED_KEY: 'vex.clipTripwire.enabled',
  LOG_KEY: 'vex.clipTripwire.log',
  FEATURE: 'clipboard-tripwire',
  MAX_LOG: 20,
  REPEAT_MS: 10 * 60 * 1000,
  _last: new Map(),

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) === 'true'; }
    catch (err) { console.error('[ClipTripwire] the switch could not be read:', err); return false; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); },

  // ---- pure: does this text look like a command to paste into a shell? ---------------
  // -> { kind, why } or null. Conservative: it needs a launcher AND something that fetches,
  // hides or runs code; plain commands such as "npm install x" or "Get-ChildItem" are not flagged.
  RULES: [
    { kind: 'powershell-download', why: 'runs PowerShell that downloads and runs something', test: (t) => /\bpowershell(?:\.exe)?\b/i.test(t) && /\b(?:iex|invoke-expression|downloadstring|downloadfile|iwr|invoke-webrequest|irm|invoke-restmethod|start-bitstransfer)\b/i.test(t) },
    { kind: 'powershell-hidden', why: 'runs PowerShell hidden or with an encoded command', test: (t) => /\bpowershell(?:\.exe)?\b/i.test(t) && /(?:\s-(?:w|win|windowstyle)\s+(?:h|hidden)\b|\s-(?:e|ec|enc|encodedcommand)\s+[A-Za-z0-9+/=]{20,}|\s-(?:nop|noprofile)\b[^\n]*\s-(?:ep|executionpolicy)\s+bypass)/i.test(t) },
    { kind: 'powershell-pipe', why: 'downloads text and runs it straight away', test: (t) => /\b(?:irm|iwr|invoke-restmethod|invoke-webrequest)\b[^\n|]*\|\s*(?:iex|invoke-expression)\b/i.test(t) },
    { kind: 'mshta', why: 'runs a remote script with mshta', test: (t) => /\bmshta(?:\.exe)?\s+(?:"|')?(?:https?:|javascript:|vbscript:)/i.test(t) },
    { kind: 'cmd-chain', why: 'runs a command prompt line that downloads something', test: (t) => /\bcmd(?:\.exe)?\s*\/[ck]\b/i.test(t) && /\b(?:curl|bitsadmin|certutil|powershell|mshta|http:|https:)/i.test(t) },
    { kind: 'lolbin-download', why: 'uses a Windows tool to fetch and run a file', test: (t) => /\bcertutil(?:\.exe)?\b[^\n]*-urlcache\b/i.test(t) || /\bbitsadmin\b[^\n]*\/transfer\b/i.test(t) || /\bregsvr32\b[^\n]*\/i:\s*https?:/i.test(t) || /\brundll32\b[^\n]*(?:https?:|\\\\)/i.test(t) },
    { kind: 'curl-pipe-shell', why: 'downloads a script and pipes it into a shell', test: (t) => /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|powershell|pwsh|iex)\b/i.test(t) },
    { kind: 'base64-shell', why: 'decodes hidden text and runs it', test: (t) => /\bbase64\s+(?:-d|--decode)\b[^\n|]*\|\s*(?:sh|bash|zsh)\b/i.test(t) || /\bFromBase64String\b[^\n]*\b(?:iex|invoke-expression)\b/i.test(t) },
  ],
  classify(text) {
    const t = String(text == null ? '' : text).trim();
    if (t.length < 12 || t.length > 4000) return null;
    for (const r of this.RULES) { if (r.test(t)) return { kind: r.kind, why: r.why }; }
    return null;
  },

  // ---- the log (no command text) -------------------------------------------------------
  log() {
    try { const a = JSON.parse(localStorage.getItem(this.LOG_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (err) { console.error('[ClipTripwire] the log could not be read:', err); return []; }
  },
  _record(row) {
    const list = this.log();
    list.push({ at: Date.now(), ...row });
    while (list.length > this.MAX_LOG) list.shift();
    localStorage.setItem(this.LOG_KEY, JSON.stringify(list));
  },
  clearLog() { localStorage.removeItem(this.LOG_KEY); },

  // ---- a report from a page (webview.js 'vex-clipboard-tripwire') --------------------------
  fromTab(webview, d) {
    if (!this.enabled() || !d || typeof d.text !== 'string') return false;
    let actual = '';
    try { actual = new URL(webview.getURL()).hostname.replace(/^www\./, ''); } catch (err) { console.error('[ClipTripwire] the page address could not be read:', err.message); return false; }
    // The report names the frame's own host; one from a frame that is not the tab's site is still a page
    // writing the clipboard, so it is shown with the host that wrote it.
    const host = typeof d.host === 'string' && d.host ? d.host.slice(0, 120) : actual;
    const verdict = this.classify(d.text);
    if (!verdict) return false;
    const now = Date.now();
    const last = this._last.get(host);
    if (last !== undefined && now - last < this.REPEAT_MS) return false;
    this._last.set(host, now);
    this._warn(host, verdict, d.text, String(d.how || ''));
    return true;
  },

  _warn(host, verdict, text, how) {
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const clear = async () => {
      try {
        if (!window.vex || typeof window.vex.clearClipboardIf !== 'function') throw new Error('This window cannot clear the clipboard');
        const r = await window.vex.clearClipboardIf(text);
        this._record({ host, kind: verdict.kind, did: r.cleared ? 'cleared' : 'changed-already' });
        window.showToast?.(r.cleared ? 'Clipboard cleared' : 'The clipboard no longer holds that text, so it was left alone');
      } catch (err) { fail(err); }
    };
    const keep = () => { try { this._record({ host, kind: verdict.kind, did: 'kept' }); } catch (err) { fail(err); } };
    const title = host + ' copied a command to your clipboard by itself';
    const body = 'It ' + verdict.why + '. Do not paste it into Run, PowerShell or a terminal unless you know what it is.';
    const show = () => window.showToast?.(title + '. ' + body, 'error', 30000, {
      actions: [
        { label: 'Clear the clipboard', title: 'Empty the clipboard if it still holds that text', run: clear },
        { label: 'Keep it', title: 'Leave the clipboard as it is', run: keep },
      ],
    });
    // The clipboard is poisoned now, so this goes through as critical (not held for a quiet moment).
    if (typeof VexAttention !== 'undefined') VexAttention.notify({ feature: this.FEATURE, urgency: 'critical', id: host, title, body, label: 'Paste-and-run tripwire' }, show);
    else show();
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('Warns when a page puts a shell command on your clipboard by itself, with no click or key press, and offers to clear it. Copying a command from a docs page by clicking Copy, or with Ctrl+C, is never reported. A page that copies when you click its own "verify" button looks the same as a Copy button, so that case is not caught. The command text is never saved.'));
    body.appendChild(S.toggle('Paste-and-run tripwire', this.enabled(), (on) => { this.setEnabled(on); if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE); }));
    const rows = this.log().slice().reverse().slice(0, 8);
    if (this.enabled() && rows.length) {
      const ul = document.createElement('ul');
      ul.className = 'setting-info';
      for (const r of rows) {
        const li = document.createElement('li');
        li.textContent = new Date(r.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' - ' + r.host + ' (' + r.kind + '): ' + r.did;
        ul.appendChild(li);
      }
      body.appendChild(ul);
      body.appendChild(S.button('Clear this list', () => { this.clearLog(); window.VexSettingsGroups?.inject(); }));
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexClipboardTripwire = VexClipboardTripwire;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'clipboard-tripwire', title: 'Paste-and-run tripwire', keywords: 'clipboard clickfix powershell paste command malware verify human', before: 'about', render: (body) => VexClipboardTripwire.settingsRows(body) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexClipboardTripwire };
