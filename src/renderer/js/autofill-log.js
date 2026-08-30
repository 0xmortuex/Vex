// === Vex autofill telemetry ===
// A tiny local log of autofill attempts so reliability is observable, not a
// guessing game. Each of the three autofill systems (password, authenticator
// TOTP, email-code) records fill events here; the Logins & Codes hub shows the
// per-site success rate. Local only, capped, never leaves the machine.
const AutofillLog = {
  KEY: 'vex.autofillLog',
  MAX: 300,

  _host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || '').slice(0, 40); } },
  _load() { try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  _save(a) { try { localStorage.setItem(this.KEY, JSON.stringify(a.slice(-this.MAX))); } catch {} },

  // kind: 'password' | 'totp' | 'emailcode' ; ok: boolean ; url or host
  record(kind, urlOrHost, ok, detail) {
    try {
      const a = this._load();
      a.push({ t: Date.now(), kind, host: this._host(urlOrHost), ok: !!ok, detail: detail ? String(detail).slice(0, 60) : undefined });
      this._save(a);
      window.dispatchEvent(new CustomEvent('vex:autofill-logged'));
    } catch {}
  },

  all() { return this._load().slice().reverse(); },      // newest first
  clear() { this._save([]); },

  // { kind: { fills, ok } } overall, plus per-host rollup.
  stats() {
    const a = this._load();
    const byKind = {}, byHost = {};
    for (const e of a) {
      (byKind[e.kind] = byKind[e.kind] || { fills: 0, ok: 0 });
      byKind[e.kind].fills++; if (e.ok) byKind[e.kind].ok++;
      const h = byHost[e.host] = byHost[e.host] || { fills: 0, ok: 0, last: 0, kinds: {} };
      h.fills++; if (e.ok) h.ok++; h.last = Math.max(h.last, e.t); h.kinds[e.kind] = true;
    }
    return { byKind, byHost };
  },
};

if (typeof window !== 'undefined') window.AutofillLog = AutofillLog;
if (typeof module !== 'undefined' && module.exports) module.exports = { AutofillLog };
