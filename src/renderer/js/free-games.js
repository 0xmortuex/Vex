// === Free to keep this week ================================================
//
// The renderer half of src/main/free-games.js: the list, and the one thing
// that makes it worth having — being told about a new one rather than having
// to remember to look. Vex checks once a day at most, quietly, and says
// something only when a game is free now that was not last time.
const FreeGames = {
  SEEN_KEY: 'vex.freeGamesSeen',
  CHECK_KEY: 'vex.freeGamesCheckedAt',
  SETTING: 'vex.freeGamesTell',
  EVERY_MS: 20 * 60 * 60 * 1000,      // once a day is plenty for a weekly giveaway

  tellMe() { try { return localStorage.getItem(this.SETTING) === 'on'; } catch { return false; } },
  setTellMe(on) {
    try { localStorage.setItem(this.SETTING, on ? 'on' : 'off'); } catch {}
    return !!on;
  },
  toggleTellMe() {
    const on = this.setTellMe(!this.tellMe());
    window.showToast?.(on ? 'Vex will tell you when a game goes free' : 'Vex will stop telling you about free games');
    return on;
  },

  seen() { try { const a = JSON.parse(localStorage.getItem(this.SEEN_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  _markSeen(games) {
    const keys = games.map(g => g.store + '::' + g.title);
    try { localStorage.setItem(this.SEEN_KEY, JSON.stringify([...new Set([...this.seen(), ...keys])].slice(-120))); } catch {}
  },

  // What is free now and has not been mentioned before.
  fresh(games) {
    const seen = new Set(this.seen());
    return (games || []).filter(g => g.live && !seen.has(g.store + '::' + g.title));
  },

  async list() {
    const res = await window.vex.freeGames();
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not read the stores');
    return res.games;
  },

  endsIn(game, now = Date.now()) {
    if (game.upcoming || !game.live) {
      if (!game.from) return 'coming soon';
      const days = Math.round((game.from - now) / 86400000);
      return days <= 0 ? 'later today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
    }
    if (!game.until) return 'free now';
    const hours = Math.round((game.until - now) / 3600000);
    if (hours <= 0) return 'gone';
    if (hours < 24) return hours + ' hour' + (hours === 1 ? '' : 's') + ' left';
    const days = Math.round(hours / 24);
    return days + ' day' + (days === 1 ? '' : 's') + ' left';
  },

  // --- the quiet check -----------------------------------------------------

  _due(now = Date.now()) {
    let last = 0;
    try { last = Number(localStorage.getItem(this.CHECK_KEY)) || 0; } catch { last = 0; }
    return now - last > this.EVERY_MS;
  },

  async check({ force = false } = {}) {
    if (!force && (!this.tellMe() || !this._due())) return null;
    const games = await this.list();
    try { localStorage.setItem(this.CHECK_KEY, String(Date.now())); } catch {}
    const fresh = this.fresh(games);
    this._markSeen(games.filter(g => g.live));
    if (!fresh.length) return { games, fresh };
    const names = fresh.map(g => g.title).join(', ');
    // Desktop notification, because the point is hearing about it while you
    // are doing something else (main.js 'notify:show').
    window.vex.notify?.('Free to keep', names + ' — ' + this.endsIn(fresh[0]))
      .catch(err => window.VexProblems?.note('Free games', 'Could not show the notification', err));
    return { games, fresh };
  },

  // --- the list ------------------------------------------------------------

  _card(game) {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const when = this.endsIn(game);
    const tone = game.live ? 'var(--primary)' : 'var(--text-muted)';
    return `
      <a href="#" data-url="${esc(game.url)}" style="display:flex;gap:10px;padding:8px 9px;border-radius:9px;text-decoration:none;color:inherit">
        ${game.image ? `<img src="${esc(game.image)}" alt="" style="width:78px;height:44px;object-fit:cover;border-radius:6px;background:var(--surface)">` : ''}
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(game.title)}</div>
          <div style="font-size:10.5px;color:${tone}">${esc(game.store)} · ${esc(when)}</div>
        </div>
      </a>`;
  },

  async open() {
    document.querySelector('.vex-games-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'vex-games-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.38);display:grid;place-items:start center;padding-top:10vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Free games"
           style="width:min(560px,92vw);max-height:72vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1;font-size:13.5px;font-weight:650;color:var(--text)">Free to keep</div>
          <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted);cursor:pointer">
            <input type="checkbox" data-tell ${this.tellMe() ? 'checked' : ''}> Tell me
          </label>
        </div>
        <div data-list style="overflow-y:auto;padding:6px;flex:1"></div>
        <div style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">
          Epic's and Steam's own lists. Only games that become yours to keep, never a sale.
        </div>
      </div>`;

    const listEl = overlay.querySelector('[data-list]');
    listEl.innerHTML = '<div style="padding:24px;text-align:center;font-size:12.5px;color:var(--text-muted)">Asking the stores…</div>';
    overlay.querySelector('[data-tell]').addEventListener('change', (e) => this.setTellMe(e.target.checked));
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);

    let games;
    try { games = await this.list(); }
    catch (err) {
      listEl.innerHTML = `<div style="padding:24px;text-align:center;font-size:12.5px;color:var(--text-muted)">${window.escapeHtml(err.message)}</div>`;
      return overlay;
    }
    this._markSeen(games.filter(g => g.live));
    listEl.innerHTML = games.length
      ? games.map(g => this._card(g)).join('')
      : '<div style="padding:24px;text-align:center;font-size:12.5px;color:var(--text-muted)">Nothing free right now.</div>';
    listEl.querySelectorAll('[data-url]').forEach(a => {
      a.addEventListener('click', (e) => { e.preventDefault(); close(); TabManager.createTab(a.dataset.url, true); });
      a.addEventListener('mouseenter', () => { a.style.background = 'var(--vex-hover-fill,var(--surface))'; });
      a.addEventListener('mouseleave', () => { a.style.background = ''; });
    });
    return overlay;
  },

  // The check rides the shared timer, so it costs nothing while Vex is hidden
  // or a game is running.
  init() {
    if (typeof VexJobs === 'undefined') return this;
    VexJobs.every('free-games', 30 * 60 * 1000, () => {
      this.check().catch(err => window.VexProblems?.note('Free games', 'Could not check the stores', err));
    }, { when: 'background' });
    return this;
  },
};

if (typeof window !== 'undefined') window.FreeGames = FreeGames;
if (typeof module !== 'undefined' && module.exports) module.exports = { FreeGames };
