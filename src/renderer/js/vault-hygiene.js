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
//   If your email is taken over  (Wave 5) a mailbox that is the login name of other accounts is what
//                              their "forgot password" mail goes to. For each such mailbox, its own saved
//                              login is checked: weak, reused, no authenticator entry. Vex stores no
//                              recovery address, so this reads the login names as the stand-in.
//   Weekly safety check        (Wave 5) one quiet roll-up once a week: the vault findings above, permissions
//                              that end soon, programs and old files in Downloads. Findings and counts only.
//
// Only findings reach this window, as in Password Health: hosts, user names, ages and reasons.
// The password values stay in the main process (vault:health) and are never read here.
// Once a week, when there is something to rotate, one quiet line waits in the Attention Inbox;
// when there is nothing, nothing is said.
const VexVaultHygiene = {
  KEY: 'vex.vaultHygiene',            // 'off' turns it off
  WEEK_KEY: 'vex.vaultHygiene.week',  // the week the quiet line was last offered for
  ROLL_KEY: 'vex.vaultHygiene.rollup',      // 'off' turns the weekly roll-up off
  ROLL_WEEK_KEY: 'vex.vaultHygiene.rollWeek', // the week the roll-up was last offered for
  FEATURE: 'vault-hygiene',
  MAX_PICKS: 3,
  // Mailbox providers: the domain of an address -> the names its own login host contains.
  MAIL_PROVIDERS: {
    'gmail.com': ['google'], 'googlemail.com': ['google'],
    'outlook.com': ['live', 'microsoft', 'outlook'], 'hotmail.com': ['live', 'microsoft', 'outlook'], 'live.com': ['live', 'microsoft', 'outlook'], 'msn.com': ['live', 'microsoft', 'outlook'],
    'yahoo.com': ['yahoo'], 'ymail.com': ['yahoo'], 'icloud.com': ['icloud', 'apple'], 'me.com': ['icloud', 'apple'],
    'proton.me': ['proton', 'protonmail'], 'protonmail.com': ['proton', 'protonmail'], 'pm.me': ['proton', 'protonmail'],
    'aol.com': ['aol'], 'gmx.com': ['gmx'], 'gmx.net': ['gmx'], 'zoho.com': ['zoho'], 'yandex.com': ['yandex'], 'mail.ru': ['mail'],
  },
  rollupEnabled() { try { return this.enabled() && localStorage.getItem(this.ROLL_KEY) !== 'off'; } catch (err) { throw new Error('Could not read the weekly safety check switch: ' + err.message, { cause: err }); } },
  // The person's own choice for the weekly check, whatever the master switch says (the switch in Settings shows this).
  rollupPreference() { try { return localStorage.getItem(this.ROLL_KEY) !== 'off'; } catch (err) { throw new Error('Could not read the weekly safety check switch: ' + err.message, { cause: err }); } },
  setRollupEnabled(on) { localStorage.setItem(this.ROLL_KEY, on ? 'on' : 'off'); return !!on; },

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
    // The mailbox chain: an address that is the login name of other accounts recovers them.
    const emailChain = this._emailChain({ logins, health, has2fa, ageOf, clusters });
    for (const m of emailChain) {
      if (m.own && m.risk === 'high' && m.dependents >= 2) bump(m.own.host, m.own.username, 130 + m.dependents * 5, 'it is the mailbox that recovers ' + m.dependents + ' other accounts');
    }
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

    return { total: health.total || 0, rotate, clusters, coverage, buckets, unknownAge: unknown, emailChain };
  },

  // -> [{ mailbox, provider, dependents, hosts, own: {host, username}|null, problems: [], risk: 'high'|'ok'|'unknown' }]
  _emailChain({ logins, health, has2fa, ageOf, clusters }) {
    const mailOf = (u) => { const m = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/.exec(String(u || '').trim().toLowerCase()); return m ? { box: String(u).trim().toLowerCase(), domain: m[1] } : null; };
    const weak = new Set((health.weak || []).map(w => w.host + '\n' + w.username));
    const reused = new Set();
    for (const c of clusters) for (const e of c.entries) reused.add(e.host + '\n' + e.username);
    const groups = new Map();
    for (const l of logins) {
      const m = mailOf(l.username);
      if (!m) continue;
      if (!groups.has(m.box)) groups.set(m.box, { mailbox: m.box, domain: m.domain, rows: [] });
      groups.get(m.box).rows.push(l);
    }
    const out = [];
    for (const g of groups.values()) {
      const names = this.MAIL_PROVIDERS[g.domain] || null;
      const isOwn = (l) => !!names && names.includes(this._root(l.host));
      const own = g.rows.find(isOwn) || null;
      const dependentRows = g.rows.filter(l => !isOwn(l));
      const hosts = [...new Set(dependentRows.map(l => l.host))];
      if (!hosts.length) continue;
      // A mailbox with no saved login of its own is only worth a line when several accounts lean on it.
      if (!own && hosts.length < 2) continue;
      const problems = [];
      let risk = 'unknown';
      if (own) {
        const key = own.host + '\n' + own.username;
        if (weak.has(key)) problems.push('its password is weak');
        if (reused.has(key)) problems.push('its password is also used on other sites');
        if (!has2fa(own.host)) problems.push('it has no authenticator entry in Vex');
        const days = ageOf(own.host, own.username);
        if (days != null && days > 1095) problems.push('it has not changed for ' + Math.floor(days / 365) + ' years');
        risk = problems.length ? 'high' : 'ok';
      }
      out.push({ mailbox: g.mailbox, provider: g.domain, dependents: hosts.length, hosts, own: own ? { host: own.host, username: own.username } : null, problems, risk });
    }
    const rank = { high: 0, unknown: 1, ok: 2 };
    return out.sort((a, b) => rank[a.risk] - rank[b.risk] || b.dependents - a.dependents);
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

  // ---- the weekly safety check (Wave 5) ---------------------------------------------------------------
  // Gathers what each area already knows. An area that cannot be read is said so in its own line.
  // -> { week, items: [{ area, level: 'attention'|'note'|'ok', text }] }
  async rollup(now = new Date()) {
    const items = [];
    const add = (area, level, text) => items.push({ area, level, text });
    try {
      const d = await this.load();
      const v = this.build({ health: d.health, logins: d.logins, totp: d.totp || [] });
      if (v.rotate.length) add('Passwords', 'attention', v.rotate.length + ' worth changing: ' + v.rotate.map(r => r.host).join(', ') + '.');
      else add('Passwords', 'ok', 'Nothing stands out.');
      for (const m of v.emailChain.filter(x => x.risk === 'high').slice(0, 3)) add('Recovery email', 'attention', m.mailbox + ' recovers ' + m.dependents + ' other site' + VexPlural.s(m.dependents) + ', and ' + m.problems.join(', ') + '.');
    } catch (err) { add('Passwords', 'note', 'Could not be checked: ' + err.message); }
    try {
      if (!window.vex || typeof window.vex.hygienePermSummary !== 'function') throw new Error('permission hygiene is not available here');
      const s = await window.vex.hygienePermSummary();
      const soon = (s && s.soon) || [];
      if (soon.length) add('Permissions', 'attention', soon.length + ' site permission' + (soon.length === 1 ? ' ends' : 's end') + ' within 3 days: ' + soon.slice(0, 3).map(r => r.origin).join(', ') + '.');
      else add('Permissions', 'ok', ((s && s.lines && s.lines.length) ? s.lines.join('; ') + '.' : 'No saved camera, microphone or location grants.'));
    } catch (err) { add('Permissions', 'note', 'Could not be checked: ' + err.message); }
    try {
      if (!window.vex || typeof window.vex.hygieneDownloadsScan !== 'function') throw new Error('the downloads check is not available here');
      const r = await window.vex.hygieneDownloadsScan();
      const risky = (r.flagged || []);
      const disguised = risky.filter(f => f.kind === 'disguised').length;
      const progs = risky.length - disguised;
      const old = Math.max(0, (r.total || 0) - (r.recent || 0));
      if (disguised) add('Downloads', 'attention', disguised + ' file' + (disguised === 1 ? ' has' : 's have') + ' a name that hides a program behind a picture or document ending.');
      if (progs) add('Downloads', 'note', progs + ' program or script' + VexPlural.s(progs) + ' downloaded in the last ' + r.days + ' days. Vex does not check signatures here; open one in the Downloads panel to see who signed it.');
      if (old > 20) add('Downloads', 'note', old + ' files older than ' + r.days + ' days are still in your Downloads folder.');
      if (!disguised && !progs && old <= 20) add('Downloads', 'ok', 'Nothing unusual in the names of your recent downloads.');
    } catch (err) { add('Downloads', 'note', 'Could not be checked: ' + err.message); }
    return { week: this.weekId(now), items };
  },

  // Once a week, quietly, and only when something wants attention. Returns false when nothing was offered.
  async maybeRollup(now = new Date()) {
    if (!this.rollupEnabled()) return false;
    const week = this.weekId(now);
    let last = '';
    try { last = localStorage.getItem(this.ROLL_WEEK_KEY) || ''; } catch (err) { throw new Error('Could not read when the weekly safety check was last offered: ' + err.message, { cause: err }); }
    if (last === week) return false;
    const r = await this.rollup(now);
    localStorage.setItem(this.ROLL_WEEK_KEY, week);
    const hot = r.items.filter(i => i.level === 'attention');
    if (!hot.length) return false;
    if (typeof VexAttention === 'undefined') throw new Error('VexAttention is not loaded');
    return VexAttention.suggest({ feature: this.FEATURE, label: 'Weekly safety check', id: 'roll-' + week, title: 'Your weekly safety check',
      body: hot.map(i => i.area + ': ' + i.text).join(' ').slice(0, 220), action: { label: 'Open', key: 'rollup' } });
  },

  async openRollup() {
    if (!window.VexSettingsGroups || typeof VexSettingsGroups.dialog !== 'function') throw new Error('The weekly safety check needs the platform dialog');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-safety-rollup', title: 'Weekly safety check', sub: 'Vault, permissions and downloads in one place. Counts and names only; no password is shown.' });
    body.textContent = 'Checking...';
    const r = await this.rollup();
    body.textContent = '';
    for (const i of r.items) {
      const row = document.createElement('div');
      row.style.cssText = 'font-size:12.5px;padding:3px 0;' + (i.level === 'attention' ? '' : 'color:var(--text-muted)');
      row.textContent = i.area + ': ' + i.text;
      body.appendChild(row);
    }
    return r;
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

    h('If your email is taken over');
    if (!v.emailChain.length) p('No saved login uses an email address as its name, so there is no chain to follow.', true);
    for (const m of v.emailChain) {
      const who = m.mailbox + ' is the login name of ' + m.dependents + ' other site' + VexPlural.s(m.dependents) + ', so it is where their password resets go';
      if (m.risk === 'high') p(who + '; ' + m.problems.join(', ') + '.');
      else if (m.risk === 'ok') p(who + '. Its own login looks fine.', true);
      else p(who + '. Its own login is not saved in Vex, so its strength cannot be checked here.', true);
    }
    if (v.emailChain.length) p('Vex does not store a site\'s recovery address; the login name stands in for it.', true);

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
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle(this.FEATURE, (key) => { if (key === 'open') return this.open(); if (key === 'rollup') return this.openRollup(); throw new Error('Unknown vault hygiene action ' + key); });
    // Weekly and quiet; a long session still gets its line.
    if (typeof VexJobs !== 'undefined') {
      VexJobs.every('Vault hygiene', 6 * 3600 * 1000, () => Promise.all([
        this.maybeSuggest().catch(err => window.VexProblems?.note('Vault hygiene', 'The weekly check failed', err)),
        this.maybeRollup().catch(err => window.VexProblems?.note('Vault hygiene', 'The weekly safety check failed', err)),
      ]), { when: 'background', feature: this.FEATURE });
    }
    return true;
  },
};

if (typeof window !== 'undefined') window.VexVaultHygiene = VexVaultHygiene;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexVaultHygiene };
