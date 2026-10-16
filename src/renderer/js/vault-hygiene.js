// === Vault hygiene: age, reuse with its blast radius, 2FA coverage, "rotate 3 things" (T3-088) ===
//
// Password Health (js/password-health.js) already lists reused, weak and year-old passwords.
// This view puts the same findings in the order a person would act on them, calmly (it is low
// priority housekeeping, not an alarm):
//
//   Rotate up to 3 this week   the few passwords that would help most to change: a reused one first
//                              (worst when it has no 2FA), then a weak one, then the oldest
//   If one leaks               for each reused password: which accounts open with it
//   2FA coverage               which saved logins have an authenticator entry and which do not
//   Age                        how long since each login was saved or changed (main/vault.js keeps
//                              updatedAt; Vex has no other age record)
//
// Only findings reach this window, as in Password Health: hosts, user names, ages and reasons.
// The password values stay in the main process (vault:health) and are never read here.
// Once a week, when there is something to rotate, one quiet line waits in the Attention Inbox;
// when there is nothing, nothing is said.
const VexVaultHygiene = {
  KEY: 'vex.vaultHygiene',            // 'off' turns it off
  WEEK_KEY: 'vex.vaultHygiene.week',  // the week the quiet line was last offered for
  FEATURE: 'vault-hygiene',
  MAX_PICKS: 3,

  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? 'on' : 'off'); return !!on; },

  _root(host) {
    const parts = String(host || '').toLowerCase().replace(/^www\./, '').split('.');
    return (parts.length >= 2 ? parts[parts.length - 2] : parts[0]) || '';
  },
  _years(days) {
    if (days == null) return 'age unknown';
    if (days < 60) return 'changed ' + days + ' days ago';
    if (days < 730) return 'unchanged for ' + Math.floor(days / 30) + ' months';
    return 'unchanged for ' + Math.floor(days / 365) + ' years';
  },

  // → the whole view as data. health: vault:health; logins: vault:list rows (host, username); totp: totp:list rows.
  build({ health, logins = [], totp = [] }) {
    if (!health || typeof health !== 'object') throw new Error('There is no password health to read');
    const ages = new Map((health.ages || []).map(a => [a.host + '\n' + a.username, a.days]));
    const ageOf = (host, username) => { const d = ages.get(host + '\n' + username); return d == null ? null : d; };

    const totpWords = new Set();
    for (const a of totp) String(a.issuer || a.label || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).forEach(w => totpWords.add(w));
    const has2fa = (host) => totpWords.has(this._root(host));

    // Reuse, with the blast radius.
    const clusters = (health.reused || []).map(g => {
      const entries = g.entries || [];
      const without = entries.filter(e => !has2fa(e.host)).length;
      const names = entries.map(e => e.host);
      return { count: g.count || entries.length, entries, without2fa: without,
        blast: 'If the password for ' + names[0] + ' leaks, ' + (names.length > 2 ? names.slice(1, 4).join(', ') + (names.length > 4 ? ' and ' + (names.length - 4) + ' more' : '') : names.slice(1).join(', ')) + ' open' + (names.length === 2 ? 's' : '') + ' too'
          + (without ? ' (' + without + ' of ' + names.length + ' without 2FA).' : ' (all have 2FA).') };
    });

    // Candidates to rotate this week.
    const score = new Map();
    const bump = (host, username, points, reason) => {
      const key = host + '\n' + username;
      const cur = score.get(key) || { host, username, points: 0, reasons: [] };
      cur.points = Math.max(cur.points, points);
      if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
      score.set(key, cur);
    };
    for (const c of clusters) {
      for (const e of c.entries) {
        const days = ageOf(e.host, e.username);
        bump(e.host, e.username, 100 + c.count * 10 + (has2fa(e.host) ? 0 : 15) + Math.min(20, (days || 0) / 60), 'the same password is on ' + c.count + ' sites');
      }
    }
    for (const w of (health.weak || [])) bump(w.host, w.username, 80 + (has2fa(w.host) ? 0 : 10), 'weak: ' + (w.reasons || []).join(', '));
    for (const o of (health.old || [])) bump(o.host, o.username, 40 + Math.min(30, o.days / 365 * 5) + (has2fa(o.host) ? 0 : 10), this._years(o.days));
    const rotate = [...score.values()].sort((a, b) => b.points - a.points).slice(0, this.MAX_PICKS)
      .map(c => ({ host: c.host, username: c.username, reasons: c.reasons, no2fa: !has2fa(c.host) }));

    // 2FA coverage over distinct hosts.
    const seen = new Set(); const coverage = [];
    for (const l of logins) { if (seen.has(l.host)) continue; seen.add(l.host); coverage.push({ host: l.host, has2fa: has2fa(l.host) }); }
    coverage.sort((a, b) => Number(a.has2fa) - Number(b.has2fa) || a.host.localeCompare(b.host));

    // Age buckets.
    const buckets = [['Under 3 months', 0, 90], ['3 to 12 months', 90, 365], ['1 to 2 years', 365, 730], ['Over 2 years', 730, Infinity]]
      .map(([label, lo, hi]) => ({ label, count: (health.ages || []).filter(a => a.days != null && a.days >= lo && a.days < hi).length }));
    const unknown = (health.ages || []).filter(a => a.days == null).length;

    return { total: health.total || 0, rotate, clusters, coverage, buckets, unknownAge: unknown };
  },

  // The Monday-based week a date is in, as "2026-W42".
  weekId(d = new Date()) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
    return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - yearStart) / 86400000 + 1) / 7)).padStart(2, '0');
  },

  async load() {
    if (!window.vex || typeof window.vex.vaultHealth !== 'function') throw new Error('The password vault is not available in this window');
    const health = await window.vex.vaultHealth();
    if (!health || health.error) throw new Error('Your saved passwords could not be checked: ' + ((health && health.error) || 'no answer from the vault'));
    const logins = (await window.vex.vaultList()) || [];
    let totp = [];
    try { totp = (await window.vex.totpList()) || []; }
    catch (err) { window.VexProblems?.note('Vault hygiene', 'Could not read the authenticator list, so 2FA coverage is not shown', err); totp = null; }
    return { health, logins, totp };
  },

  // Once a week, quietly: only when there is something to rotate.
  async maybeSuggest(now = new Date()) {
    if (!this.enabled()) return false;
    const week = this.weekId(now);
    let last = '';
    try { last = localStorage.getItem(this.WEEK_KEY) || ''; } catch (err) { throw new Error('Could not read when the weekly line was last offered: ' + err.message, { cause: err }); }
    if (last === week) return false;
    const data = await this.load();
    const view = this.build({ health: data.health, logins: data.logins, totp: data.totp || [] });
    localStorage.setItem(this.WEEK_KEY, week);
    if (!view.rotate.length) return false;
    if (typeof VexAttention === 'undefined') throw new Error('VexAttention is not loaded');
    return VexAttention.suggest({ feature: this.FEATURE, label: 'Vault hygiene', id: week, title: 'Passwords worth changing this week',
      body: view.rotate.map(r => r.host).join(', ') + '. No hurry; this is housekeeping.', action: { label: 'Open', key: 'open' } });
  },

  // --- the view ---------------------------------------------------------------------------------------
  async open() {
    if (!window.VexSettingsGroups || typeof VexSettingsGroups.dialog !== 'function') throw new Error('The vault hygiene view needs the platform dialog');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-vault-hygiene', title: 'Vault hygiene', sub: 'Housekeeping for your saved logins, in the order that helps most. Nothing here is urgent, and no password is shown.' });
    body.textContent = 'Reading your vault…';
    let view;
    try { const d = await this.load(); view = this.build({ health: d.health, logins: d.logins, totp: d.totp || [] }); view.totpMissing = d.totp === null; }
    catch (err) { body.textContent = err.message; return null; }
    this._paint(body, view);
    return view;
  },

  _paint(body, v) {
    body.textContent = '';
    const h = (text) => { const d = document.createElement('div'); d.style.cssText = 'font-weight:650;margin:14px 0 4px'; d.textContent = text; body.appendChild(d); };
    const p = (text, muted) => { const d = document.createElement('div'); d.style.cssText = 'font-size:12.5px;padding:2px 0;' + (muted ? 'color:var(--text-muted)' : ''); d.textContent = text; body.appendChild(d); return d; };
    const open = (host) => { TabManager.createTab('https://' + host + '/', true); };
    const hostRow = (host, right) => {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:3px 0;font-size:12.5px';
      const l = document.createElement('span'); l.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; l.textContent = host;
      const r = document.createElement('span'); r.style.cssText = 'color:var(--text-muted)'; r.textContent = right;
      row.append(l, r);
      row.appendChild(VexSettingsGroups.button('Open', () => open(host), { label: 'Open ' + host }));
      body.appendChild(row);
    };

    h('Rotate up to 3 this week');
    if (!v.rotate.length) p('Nothing stands out. No reused or weak passwords, and none a year old.', true);
    for (const r of v.rotate) hostRow(r.host + (r.username ? ' · ' + r.username : ''), r.reasons.join('; ') + (r.no2fa ? '; no 2FA' : ''));

    h('If one leaks');
    if (!v.clusters.length) p('No password is used on more than one site.', true);
    for (const c of v.clusters) p(c.blast);

    h('2FA coverage');
    if (v.totpMissing) p('The authenticator list could not be read, so coverage is not shown.', true);
    else if (!v.coverage.length) p('No saved logins yet.', true);
    else {
      const withOut = v.coverage.filter(c => !c.has2fa);
      p((v.coverage.length - withOut.length) + ' of ' + v.coverage.length + ' sites have an authenticator entry in Vex.', true);
      for (const c of withOut.slice(0, 15)) hostRow(c.host, 'no authenticator entry');
      if (withOut.length > 15) p('…and ' + (withOut.length - 15) + ' more without one.', true);
    }

    h('Age');
    for (const b of v.buckets) p(b.label + ': ' + b.count);
    if (v.unknownAge) p(v.unknownAge + ' with no date (saved before Vex kept one).', true);
    p('Counted from when Vex saved or last changed the login. A long, unique password does not need changing on a schedule.', true);
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle(this.FEATURE, (key) => { if (key === 'open') return this.open(); throw new Error('Unknown vault hygiene action ' + key); });
    // Weekly and quiet; a long session still gets its line.
    if (typeof VexJobs !== 'undefined') {
      VexJobs.every('Vault hygiene', 6 * 3600 * 1000, () => this.maybeSuggest().catch(err => window.VexProblems?.note('Vault hygiene', 'The weekly check failed', err)), { when: 'background', feature: this.FEATURE });
    }
    return true;
  },
};

if (typeof window !== 'undefined') window.VexVaultHygiene = VexVaultHygiene;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexVaultHygiene };
