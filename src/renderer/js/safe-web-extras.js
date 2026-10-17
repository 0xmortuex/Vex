// === Safer web, the small extras (Wave 4 fold-ins) ==========================
//
// Four little things that extend the web-safety layer, none of which looks
// anything up about where you browse:
//
//   Third-party count     In the site panel: of the other sites this page loaded
//                         things from, how many keep cookies in this tab's
//                         session. Counts only, never a cookie's name or value.
//   Breach re-check       Once a week, only if you switched it on (and only if the
//                         Password Health breach check is already on): runs that
//                         same check, which sends the first 5 characters of each
//                         password's hash and nothing else, and puts ONE line in
//                         the Attention Inbox if a saved password is newly in a
//                         known breach. The first run only sets the baseline.
//   Backup check          Read-only: would a Vex backup file contain a secret, and
//                         is it encrypted? (It is not: it is a plain file.)
//   Settings              One group, "Safer web", with the two switches.
//
// The link and invite part is in js/chat-link-hygiene.js.
const SafeWebExtras = {
  RECHECK_FEATURE: 'breach-recheck',
  RECHECK_KEY: 'vex.safeWeb.breachRecheck',
  SEEN_KEY: 'vex.safeWeb.breachSeen',
  LAST_KEY: 'vex.safeWeb.breachLast',
  BREACH_KEY: 'vex.breachCheck',
  WEEK_MS: 7 * 24 * 3600 * 1000,

  _msg(err) { return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); },
  _get(key) { try { return localStorage.getItem(key); } catch (err) { console.error('[SafeWebExtras] could not read ' + key + ':', err); return null; } },

  // ---- third-party count ------------------------------------------------------------------
  // The hosts a page loaded things from, read from the page's own resource list.
  HOSTS_SCRIPT: `(() => {
    const seen = new Set();
    for (const e of performance.getEntriesByType('resource')) {
      let h = null;
      try { h = new URL(e.name).hostname; } catch (err) { h = null; }
      if (h) seen.add(h);
      if (seen.size >= 500) break;
    }
    return Array.from(seen);
  })()`,

  // -> { note } when it cannot be counted here, else { contacted, withCookies, cookies, domains }
  async thirdPartyFor(c) {
    if (!c || !c.web) return { note: 'Not a website.' };
    if (c.tor || c.torRoute) return { note: 'Not counted in a Tor tab.' };
    if (!c.wv) return { note: 'The page is not loaded yet.' };
    if (window.VexTabPolicy && typeof window.VexTabPolicy.canReadWebview === 'function' && !window.VexTabPolicy.canReadWebview(c.wv)) return { note: 'Not counted in a private tab.' };
    if (!window.vex || !window.vex.webSafety || typeof window.vex.webSafety.thirdPartyCount !== 'function') throw new Error('The third-party count is not available in this window');
    const hosts = await window.vexGuestEval(c.wv, this.HOSTS_SCRIPT, false, 5000);
    if (!Array.isArray(hosts)) throw new Error('The page did not list the sites it loaded from');
    return window.vex.webSafety.thirdPartyCount({ site: c.fullHost || c.host, partition: c.partition, hosts });
  },
  thirdPartyLine(t) {
    if (!t) return 'Counting…';
    if (t.error) return t.error;
    if (t.note) return t.note;
    if (!t.contacted) return 'This page loaded nothing from other sites.';
    const cookieWords = t.withCookies ? `${t.withCookies} of them ${t.withCookies === 1 ? 'keeps' : 'keep'} ${t.cookies} cookie${VexPlural.s(t.cookies)} here` : 'none of them keeps a cookie here';
    return `Loaded from ${t.contacted} other site${VexPlural.s(t.contacted)}; ${cookieWords}.`;
  },

  // ---- weekly breach re-check -----------------------------------------------------------------
  recheckEnabled() { return this._get(this.RECHECK_KEY) === 'true'; },
  breachCheckOn() { return this._get(this.BREACH_KEY) === 'true'; },
  setRecheckEnabled(on) {
    if (on && !this.breachCheckOn()) throw new Error('Turn on the breach check in Password Health first; the weekly re-check only repeats that check.');
    // Switching off keeps what was already seen, so switching back on does not re-announce old breaches.
    localStorage.setItem(this.RECHECK_KEY, on ? 'true' : 'false');
  },
  // enabled() is the switch the usage registry flips (Minimal Vex).
  enabled() { return this.recheckEnabled(); },
  setEnabled(on) { this.setRecheckEnabled(on); },

  // A short non-reversible tag for a saved login, so the list of what was seen holds no host or user name.
  _tag(host, username) {
    let h = 0x811c9dc5;
    const s = String(host || '') + '\u0000' + String(username || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16);
  },
  // -> the breached entries whose tag is not in `seen`.
  fresh(breached, seen) {
    const known = new Set(seen || []);
    return (breached || []).filter(b => !known.has(this._tag(b.host, b.username)));
  },

  // -> { skipped } | { baseline: true, count } | { count, fresh: n }
  async recheck({ force = false } = {}) {
    if (!this.recheckEnabled()) { if (force) throw new Error('The weekly re-check is off'); return { skipped: 'off' }; }
    if (!this.breachCheckOn()) { if (force) throw new Error('The breach check is off in Password Health'); return { skipped: 'breach check off' }; }
    const last = Number(this._get(this.LAST_KEY) || 0);
    if (!force && Date.now() - last < this.WEEK_MS) return { skipped: 'not due' };
    if (!window.vex || typeof window.vex.vaultBreachCheck !== 'function') throw new Error('The breach check is not available in this window');
    const r = await window.vex.vaultBreachCheck();
    const breached = Array.isArray(r.breached) ? r.breached : [];
    const raw = this._get(this.SEEN_KEY);
    const seen = raw == null ? null : JSON.parse(raw);
    localStorage.setItem(this.SEEN_KEY, JSON.stringify(breached.map(b => this._tag(b.host, b.username))));
    localStorage.setItem(this.LAST_KEY, String(Date.now()));
    if (typeof VexLedger !== 'undefined') {
      VexLedger.record({
        feature: this.RECHECK_FEATURE, what: `Checked ${r.checked} saved passwords against known breaches`,
        why: 'You switched on the weekly re-check. Only the first 5 characters of each password’s hash were sent; the comparison happened here. Switch it off in Settings > Safer web.',
      });
    }
    if (seen === null) return { baseline: true, count: breached.length };
    const added = this.fresh(breached, seen);
    if (added.length && typeof VexAttention !== 'undefined') {
      VexAttention.suggest({
        feature: this.RECHECK_FEATURE, label: 'Breach re-check', id: 'breach-' + new Date().toISOString().slice(0, 10),
        title: added.length === 1 ? 'A saved password is newly in a known breach' : `${added.length} saved passwords are newly in a known breach`,
        body: 'Found by the weekly re-check while you were away. Change them on their sites.',
        action: { label: 'Open Password Health', key: 'open' },
      });
    }
    return { count: breached.length, fresh: added.length };
  },
  async tick() {
    try { await this.recheck(); }
    catch (err) { window.VexProblems?.note('Breach re-check', 'The weekly breach re-check did not run', err); }
  },

  // ---- backup check -----------------------------------------------------------------------------
  // Shapes of a real secret, found by value. Only the KEY a match was found in is ever reported.
  SECRET_PATTERNS: [
    ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/],
    ['an API key (sk-)', /\bsk-[A-Za-z0-9_-]{20,}/],
    ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
    ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
    ['a Discord token', /\b[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/],
    ['a sign-in token (JWT)', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
    ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['a password inside an address', /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@/i],
    ['a bearer token', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/],
    ['a stored password or secret', /"(?:password|passwd|secret|api_?key|access_?token|auth_?token)"\s*:\s*"[^"]{6,}"/i],
  ],
  // items: { key: string value }. -> { scanned, findings: [{ key, kind }] } (a key once per kind)
  scanItems(items) {
    const findings = [];
    let scanned = 0;
    for (const [key, raw] of Object.entries(items || {})) {
      scanned++;
      const text = String(raw == null ? '' : raw);
      if (!text) continue;
      for (const [kind, re] of this.SECRET_PATTERNS) if (re.test(text)) findings.push({ key, kind });
    }
    return { scanned, findings };
  },
  // -> { encrypted: false, count, withheld, findings, optional: [..], lines[] }
  backupReport() {
    if (typeof VexBackup === 'undefined') throw new Error('The backup module is not loaded');
    // Worst case: every optional group ticked.
    const file = VexBackup.collect(Object.keys(VexBackup.OPTIONAL));
    const scan = this.scanItems(file.items);
    const optional = Object.keys(VexBackup.OPTIONAL).filter(w => Object.keys(file.items).some(k => VexBackup._isOptional(k, w)));
    const lines = [];
    lines.push('A Vex backup is a plain text file. It is not encrypted: anyone who gets the file can read everything in it.');
    lines.push(`With every option ticked it would hold ${Object.keys(file.items).length} settings; Vex keeps ${file.skipped} more out by their names (passwords, tokens, keys, the vault).`);
    if (optional.length) lines.push('Optional groups that hold personal data and would be in it if ticked: ' + optional.join(', ') + '.');
    if (scan.findings.length) {
      lines.push('Values that look like secrets were found in these settings (names only, nothing is shown or changed):');
      for (const f of scan.findings.slice(0, 12)) lines.push(`  ${f.key}: looks like ${f.kind}`);
      if (scan.findings.length > 12) lines.push(`  and ${scan.findings.length - 12} more.`);
      lines.push('Keep such a file out of Downloads, shared folders and cloud sync, or remove those settings first.');
    } else {
      lines.push('No value in it looks like a password, token or key.');
    }
    return { encrypted: false, count: Object.keys(file.items).length, withheld: file.skipped, findings: scan.findings, optional, lines };
  },

  // ---- settings -----------------------------------------------------------------------------------
  render(body) {
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const toggle = (label, note, get, set) => {
      const row = el('div', 'setting-toggle-row');
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = get(); input.setAttribute('aria-label', label);
      input.addEventListener('change', () => { try { set(input.checked); } catch (err) { input.checked = !input.checked; window.showToast?.(this._msg(err), 'error'); } });
      lab.append(input, el('span', 'toggle-slider'));
      row.append(el('span', 'setting-label-text', label), lab);
      body.append(row, el('div', 'setting-hint', note));
    };
    toggle('Chat link hygiene', 'Off by default. In a link’s right-click menu, says when a Discord or Roblox link is a redirect or an invite that runs out, and warns when a link you copy is a lookalike, a shortener or carries a secret. Reads only the address.',
      () => typeof ChatLinkHygiene !== 'undefined' && ChatLinkHygiene.enabled(), (on) => ChatLinkHygiene.setEnabled(on));
    toggle('Weekly breach re-check', 'Off by default, and needs the Password Health breach check to be on. Once a week it repeats that check and leaves one line in the Attention Inbox if a saved password is newly in a known breach. It sends only the first 5 characters of each password’s hash.',
      () => this.recheckEnabled(), (on) => this.setRecheckEnabled(on));
    const run = el('button', 'btn-secondary', 'Check now'); run.type = 'button';
    run.addEventListener('click', async () => {
      run.disabled = true;
      try {
        const r = await this.recheck({ force: true });
        window.showToast?.(r.baseline ? `Checked. ${r.count} breached password${VexPlural.s(r.count)} noted as the starting point.` : `Checked. ${r.fresh} new since last time.`);
      } catch (err) { window.showToast?.('The re-check could not run: ' + this._msg(err), 'error'); }
      run.disabled = false;
    });
    const bk = el('button', 'btn-secondary', 'Check what a backup would contain'); bk.type = 'button';
    bk.addEventListener('click', async () => {
      try {
        const r = this.backupReport();
        await window.vexConfirm({ title: 'Would a backup hold secrets?', message: r.lines.join('\n'), okLabel: 'Got it', cancelLabel: 'Close' });
      } catch (err) { window.showToast?.('The backup check could not run: ' + this._msg(err), 'error'); }
    });
    const actions = el('div', 'setting-actions');
    actions.append(run, bk);
    body.append(actions);
  },

  init() {
    if (typeof VexJobs !== 'undefined') VexJobs.every('Breach re-check', 6 * 3600 * 1000, () => this.tick(), { when: 'background', deferOnBattery: true, feature: this.RECHECK_FEATURE });
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle(this.RECHECK_FEATURE, async (key) => {
        if (key !== 'open') return;
        try { await VexLazy.ensure('js/password-health.js'); PasswordHealth.open(); } catch (err) { window.showToast?.('Could not open Password Health: ' + this._msg(err), 'error'); }
      });
    }
    if (typeof VexSettingsGroups !== 'undefined') {
      VexSettingsGroups.register({ id: 'safer-web', title: 'Safer web', keywords: 'link invite discord roblox breach backup secrets third party cookies lookalike', render: (body) => this.render(body) });
    }
    if (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) {
      CommandBar.commands.push({ id: 'backup-secrets-check', label: 'Check what a backup would contain', hint: 'Read-only: would a Vex backup hold a secret, and is it encrypted', icon: 'shield', action: async () => {
        try { const r = this.backupReport(); await window.vexConfirm({ title: 'Would a backup hold secrets?', message: r.lines.join('\n'), okLabel: 'Got it', cancelLabel: 'Close' }); }
        catch (err) { window.showToast?.('The backup check could not run: ' + this._msg(err), 'error'); }
      } });
    }
  },
};

if (typeof window !== 'undefined') {
  window.SafeWebExtras = SafeWebExtras;
  const boot = () => { try { SafeWebExtras.init(); } catch (err) { console.error('[SafeWebExtras] could not start:', err); } };
  if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') boot();
    else document.addEventListener('DOMContentLoaded', boot);
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { SafeWebExtras };
