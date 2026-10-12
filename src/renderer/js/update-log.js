// "What's New" after an update.
//
// When Vex starts on a newer version than it last ran, a small card in the
// corner names what is new: the release's title and the bold lead of each of
// its points (at most eight), taken from the CHANGELOG.md that ships inside
// the app, so it needs no network. If several updates were missed, the card
// covers all of them. "See everything" opens the full notes (this file's
// modal, also opened from Ctrl+K "What's New") for every version since the
// last run. Closing the card in any way is final for that version; until then
// it comes back on the next start. Never on a first install (the setup wizard
// is the welcome there), never in a private window, and Settings › About can
// turn the card off.

// --- Pure helpers (unit-tested in tests/renderer/updateLogCard.test.js) ------
const VexUpdateNotes = {
  MAX_POINTS: 8,

  _parts(v) {
    return String(v == null ? '' : v).trim().replace(/^v/i, '').split(/[-+]/)[0].split('.').map(n => parseInt(n, 10) || 0);
  },
  cmp(a, b) {
    const x = this._parts(a), y = this._parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  },

  // The CHANGELOG entries after `from`, up to and including `to` (newest first,
  // as the list comes).
  between(list, from, to) {
    return (Array.isArray(list) ? list : []).filter(e => e && e.version && this.cmp(e.version, from) > 0 && this.cmp(e.version, to) <= 0);
  },

  // Markdown inline marks out: the card shows plain text.
  plain(md) {
    return String(md || '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
      .replace(/\s+/g, ' ')
      .trim();
  },

  _clip(text, max) {
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const space = cut.lastIndexOf(' ');
    return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.—-]+$/, '') + '…';
  },

  // "**Extensions update themselves**: checked…" -> "Extensions update themselves"
  lead(bullet) {
    const m = /^\*\*(.+?)\*\*/.exec(String(bullet || '').trim());
    if (!m) return null;
    const text = this.plain(m[1]).replace(/[\s.:;,—-]+$/, '');
    return text ? this._clip(text, 110) : null;
  },

  // A release whose points have no bold lead: the first sentence of each.
  firstSentence(bullet) {
    const text = this.plain(bullet);
    const m = /^(.+?[.!?])(\s|$)/.exec(text);
    return this._clip((m ? m[1] : text).replace(/[.]$/, ''), 90);
  },

  points(body) {
    const bullets = String(body || '').replace(/\r/g, '').split('\n')
      .map(line => /^\s*[-*]\s+(.*)$/.exec(line))
      .filter(Boolean)
      .map(m => m[1].trim())
      .filter(Boolean);
    const leads = bullets.map(b => this.lead(b)).filter(Boolean);
    return leads.length ? leads : bullets.map(b => this.firstSentence(b)).filter(Boolean);
  },

  // "v2.37.0 — A full check-up" -> "A full check-up"
  title(entry) {
    const name = String((entry && entry.name) || '');
    const i = name.indexOf(' — ');
    return i >= 0 ? name.slice(i + 3).trim() : '';
  },

  // What the card lists: at most `max` points, shared out between the
  // releases so a missed update is never crowded out by the newest one.
  highlights(entries, max = this.MAX_POINTS) {
    const groups = (entries || []).map(e => ({ version: e.version, title: this.title(e), points: this.points(e.body) }));
    const quota = groups.map(() => 0);
    let left = max, moved = true;
    while (left > 0 && moved) {
      moved = false;
      for (let i = 0; i < groups.length && left > 0; i++) {
        if (quota[i] < groups[i].points.length) { quota[i]++; left--; moved = true; }
      }
    }
    return groups.map((g, i) => ({ ...g, points: g.points.slice(0, quota[i]) })).filter(g => g.points.length);
  },
};

(function () {
  if (typeof window === 'undefined' || !window.vex || typeof window.vex.getReleaseNotes !== 'function') return;

  const SEEN_KEY = 'vex.lastSeenVersion';      // the version that last ran here
  const PENDING_KEY = 'vex.whatsNewPending';   // { from, to }: a card not yet closed
  const CARD_KEY = 'vex.whatsNewCard';         // 'off' turns the card off

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  const icon = (name, size) => (typeof VexIcons !== 'undefined' && VexIcons.has && VexIcons.has(name)) ? VexIcons.svg(name, { size }) : '';
  const problem = (what, err) => {
    console.warn('[WhatsNew] ' + what, err);
    if (typeof VexProblems !== 'undefined') VexProblems.note("What's new", what, err);
  };

  // Tiny, safe Markdown → HTML for release notes (headings, lists, bold,
  // italics, inline code, links). Everything is escaped first.
  function mdToHtml(md) {
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    let html = '', inList = false;
    const inline = (t) => esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (let raw of lines) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { closeList(); continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { closeList(); html += m[1].length <= 2 ? `<h3>${inline(m[2])}</h3>` : `<h4>${inline(m[2])}</h4>`; }
      else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(m[1])}</li>`; }
      else { closeList(); html += `<p>${inline(line)}</p>`; }
    }
    closeList();
    return html;
  }

  function injectStyles() {
    if (document.getElementById('whatsnew-styles')) return;
    const st = document.createElement('style');
    st.id = 'whatsnew-styles';
    st.textContent = `
      .whatsnew-ov{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;background:rgba(8,10,14,0.7);backdrop-filter:blur(4px);font-family:var(--b-font,var(--vex-font-base,'Outfit',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif));-webkit-font-smoothing:antialiased;}
      .whatsnew-card{width:560px;max-width:92vw;max-height:82vh;display:flex;flex-direction:column;background:var(--surface,#1b1b24);border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:16px;box-shadow:0 24px 70px var(--vex-shadow-color,rgba(0,0,0,0.6));overflow:hidden;}
      .whatsnew-head{padding:18px 22px 14px;border-bottom:1px solid var(--border,rgba(255,255,255,0.08));}
      .whatsnew-kicker{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--primary,#6366f1);font-weight:600;}
      .whatsnew-titlerow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:5px;}
      .whatsnew-title{margin:0;font-family:var(--vex-font-heading,'Space Grotesk','Outfit',sans-serif);font-size:21px;font-weight:700;letter-spacing:-.01em;line-height:1.15;color:var(--text,#e9e9ee);}
      .whatsnew-select{flex:none;max-width:52%;background:var(--bg,#12121a);color:var(--text,#e9e9ee);border:1px solid var(--border,rgba(255,255,255,0.14));border-radius:8px;padding:5px 8px;font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;}
      .whatsnew-select:hover{border-color:var(--primary,#6366f1);}
      .whatsnew-body{padding:8px 22px 18px;overflow-y:auto;color:var(--text,#e9e9ee);font-size:14px;line-height:1.68;font-weight:400;}
      .whatsnew-body h3{font-family:var(--vex-font-heading,'Space Grotesk','Outfit',sans-serif);font-size:15px;font-weight:700;margin:20px 0 4px;padding-top:12px;border-top:1px solid var(--border,rgba(255,255,255,0.08));color:var(--text,#e9e9ee);}
      .whatsnew-body h3:first-child{margin-top:8px;padding-top:0;border-top:none;}
      .whatsnew-body h4{font-family:var(--vex-font-heading,'Space Grotesk','Outfit',sans-serif);font-size:13.5px;font-weight:700;letter-spacing:.01em;margin:18px 0 7px;color:var(--text,#e9e9ee);}
      .whatsnew-body ul{margin:5px 0 5px 2px;padding-left:18px;}
      .whatsnew-body li{margin:4px 0;}
      .whatsnew-body p{margin:7px 0;color:var(--text-muted,#b9b9c4);}
      .whatsnew-body strong{font-weight:600;color:var(--text,#e9e9ee);}
      .whatsnew-body code{font-family:'JetBrains Mono',ui-monospace,Consolas,monospace;background:var(--vex-hover-fill,rgba(127,127,127,0.14));padding:1px 5px;border-radius:4px;font-size:11.5px;letter-spacing:-.01em;}
      .whatsnew-body a{color:var(--primary,#8b8bf5);}
      .whatsnew-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 22px;border-top:1px solid var(--border,rgba(255,255,255,0.08));}
      .whatsnew-link{font-size:12px;font-weight:500;color:var(--text-muted,#9a9aa5);text-decoration:none;}
      .whatsnew-link:hover{color:var(--primary,#8b8bf5);}
      .whatsnew-btn{border:none;background:var(--primary,#6366f1);color:var(--on-primary,#fff);border-radius:9px;padding:9px 18px;font-size:13px;font-weight:600;font-family:inherit;letter-spacing:.01em;cursor:pointer;}
      .whatsnew-empty{color:var(--text-muted,#9a9aa5);font-size:13px;padding:18px 0;}
    `;
    document.head.appendChild(st);
  }

  // --- The full notes ----------------------------------------------------------
  //
  // opts.from / opts.to: open on every release since `from` (the updates that
  // were missed), as one page, with the picker still offering each release.
  let _open = false;
  async function showWhatsNew(opts) {
    opts = opts || {};
    if (_open) return;
    _open = true;
    let notes = null;
    try { notes = await window.vex.getReleaseNotes(); }
    catch (err) {
      // Said, not swallowed: a silent failure here hid "What's new" after every
      // update for two weeks.
      problem('Could not read the release notes', err);
    }
    if (!notes && !opts.force) { _open = false; return; }

    // Full history for the version picker (local CHANGELOG, newest-first).
    let list = [];
    try { if (typeof window.vex.getReleaseList === 'function') list = await window.vex.getReleaseList(); }
    catch (err) { problem('Could not read the list of releases', err); }
    if (!Array.isArray(list) || !list.length) list = notes ? [notes] : [];

    let idx = 0;
    const missed = opts.from && opts.to ? VexUpdateNotes.between(list, opts.from, opts.to) : [];
    if (missed.length > 1) {
      // One page for every update since the last run, first in the picker.
      list = [{
        version: missed[0].version,
        name: `Everything since v${String(opts.from).replace(/^v/i, '')} (${missed.length} updates)`,
        body: missed.map(e => `## ${e.name || e.version}\n\n${e.body || ''}`).join('\n\n'),
      }, ...list];
    } else {
      const want = (missed[0] && missed[0].version) || (notes && notes.version);
      const i = want ? list.findIndex(e => e.version === want) : -1;
      if (i >= 0) idx = i;
    }
    if (!list.length) list = [{ version: '', name: 'Vex', body: '' }];

    injectStyles();
    const previousFocus = document.activeElement;
    const ov = document.createElement('div');
    ov.className = 'whatsnew-ov';
    const picker = list.length > 1
      ? `<select class="whatsnew-select" title="Choose a release" aria-label="Choose a release">${list.map((e, i) => `<option value="${i}"${i === idx ? ' selected' : ''}>${esc(e.name || e.version)}</option>`).join('')}</select>`
      : '';
    ov.innerHTML = `
      <div class="whatsnew-card" role="dialog" aria-modal="true" aria-labelledby="whatsnew-title">
        <div class="whatsnew-head">
          <div class="whatsnew-kicker">What's new</div>
          <div class="whatsnew-titlerow">
            <h2 class="whatsnew-title" id="whatsnew-title"></h2>
            ${picker}
          </div>
        </div>
        <div class="whatsnew-body" tabindex="0" aria-label="Release notes"></div>
        <div class="whatsnew-foot">
          <a class="whatsnew-link" href="#" data-ext>View on GitHub</a>
          <button class="whatsnew-btn">Got it</button>
        </div>
      </div>`;

    const titleEl = ov.querySelector('.whatsnew-title');
    const bodyEl = ov.querySelector('.whatsnew-body');
    const linkEl = ov.querySelector('.whatsnew-link[data-ext]');
    const render = (i) => {
      const e = list[i] || list[0];
      titleEl.textContent = e.name || e.version || 'Vex';
      bodyEl.innerHTML = e.body ? mdToHtml(e.body) : '<div class="whatsnew-empty">No release notes for this build — the releases page has the full history.</div>';
      bodyEl.scrollTop = 0;
      linkEl.dataset.url = e.version ? ('https://github.com/0xmortuex/Vex/releases/tag/' + e.version) : 'https://github.com/0xmortuex/Vex/releases';
    };
    render(idx);

    // Esc only unbound itself when Esc was the thing that closed the modal, so
    // closing with "Got it", the GitHub link or a backdrop click left a live
    // document-level listener behind — one more on every open, each holding the
    // removed overlay and the whole release list alive.
    const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const close = () => {
      document.removeEventListener('keydown', onEsc, true);
      ov.remove();
      _open = false;
      if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
    };
    ov.querySelector('.whatsnew-select')?.addEventListener('change', (e) => render(parseInt(e.target.value, 10) || 0));
    ov.querySelector('.whatsnew-btn').addEventListener('click', close);
    linkEl?.addEventListener('click', (e) => {
      e.preventDefault();
      try { window.vex?.openExternal?.(linkEl.dataset.url || 'https://github.com/0xmortuex/Vex/releases'); }
      catch (err) { problem('Could not open the release page', err); }
      close(); // the release opens in the browser — no reason to keep the modal up
    });
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.addEventListener('keydown', onEsc, true);
    document.body.appendChild(ov);
    ov.querySelector('.whatsnew-btn').focus();
  }

  // --- The card --------------------------------------------------------------

  function readPending() {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      return p && typeof p.from === 'string' && typeof p.to === 'string' ? p : null;
    } catch { return null; }
  }

  function cardEnabled() { return localStorage.getItem(CARD_KEY) !== 'off'; }
  function setCardEnabled(on) {
    // Written both ways (not removed when on), so the choice syncs either way.
    if (on) localStorage.setItem(CARD_KEY, 'on');
    else { localStorage.setItem(CARD_KEY, 'off'); localStorage.removeItem(PENDING_KEY); closeCard(); }
  }

  let _card = null;
  function closeCard() {
    if (!_card) return;
    const { el, previousFocus, onDocKey } = _card;
    const hadFocus = el.contains(document.activeElement);
    _card = null;
    document.removeEventListener('keydown', onDocKey);
    el.remove();
    if (hadFocus && previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
  }

  // Closing it in any way means it was seen: it does not come back for this
  // version.
  function dismissCard() {
    localStorage.removeItem(PENDING_KEY);
    closeCard();
  }

  async function showCard(pending) {
    if (_card) return null;
    let list;
    try { list = await window.vex.getReleaseList(); }
    catch (err) { problem('Could not read the release notes for the update card', err); return null; }
    const entries = VexUpdateNotes.between(list, pending.from, pending.to);
    const groups = VexUpdateNotes.highlights(entries);
    if (!groups.length) {
      // Nothing in the bundled CHANGELOG for these versions: said, and the
      // card is not kept waiting for notes that will never be there.
      problem(`The bundled CHANGELOG has no notes for v${pending.to}`, new Error('no CHANGELOG entry between ' + pending.from + ' and ' + pending.to));
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
    if (_card || readPending() === null) return null;   // closed or turned off meanwhile

    const newest = entries[0];
    const version = String(pending.to).replace(/^v/i, '');
    const title = VexUpdateNotes.title(newest) || `What's new in Vex ${version}`;
    const several = entries.length > 1;
    const el = document.createElement('section');
    el.className = 'whatsnew-tip';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'whatsnew-tip-title');
    el.setAttribute('aria-describedby', 'whatsnew-tip-kicker');
    el.innerHTML = `
      <div class="whatsnew-tip-head">
        <span class="whatsnew-tip-icon" aria-hidden="true">${icon('gift', 18)}</span>
        <div class="whatsnew-tip-heading">
          <p class="whatsnew-tip-kicker" id="whatsnew-tip-kicker">Updated to Vex ${esc(version)}</p>
          <h2 class="whatsnew-tip-title" id="whatsnew-tip-title">${esc(title)}</h2>
          ${several ? `<p class="whatsnew-tip-sub">${entries.length} updates since v${esc(String(pending.from).replace(/^v/i, ''))}</p>` : ''}
        </div>
        <button type="button" class="whatsnew-tip-close" data-act="close" aria-label="Close what's new" title="Close (Esc)">${icon('x', 15)}</button>
      </div>
      <div class="whatsnew-tip-body">
        ${groups.map(g => `
          ${several ? `<h3 class="whatsnew-tip-ver" title="${esc(g.version)}${g.title ? ' — ' + esc(g.title) : ''}">${esc(g.version)}${g.title ? ' — ' + esc(g.title) : ''}</h3>` : ''}
          <ul class="whatsnew-tip-list">${g.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`).join('')}
      </div>
      <div class="whatsnew-tip-foot">
        <button type="button" class="whatsnew-tip-btn whatsnew-tip-btn-quiet" data-act="close">Got it</button>
        <button type="button" class="whatsnew-tip-btn whatsnew-tip-btn-main" data-act="all">See everything ${icon('arrow-right', 14)}</button>
      </div>`;

    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') dismissCard();
      if (act === 'all') {
        dismissCard();
        showWhatsNew({ force: true, from: pending.from, to: pending.to });
      }
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismissCard(); }
    });

    // Escape from anywhere else closes it too, as long as nothing else used
    // that Escape (a menu, a field reverting) and no dialog is open: the card
    // does not take the keyboard from the address bar, so Escape must still
    // reach it from there.
    const onDocKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || el.contains(e.target)) return;
      // (The command bar stays in the page, hidden, between uses.)
      if ([...document.querySelectorAll('[aria-modal="true"]')].some(d => d.getClientRects().length && getComputedStyle(d).visibility !== 'hidden')) return;
      dismissCard();
    };
    const previousFocus = document.activeElement;
    _card = { el, previousFocus, pending, onDocKey };
    document.addEventListener('keydown', onDocKey);
    document.body.appendChild(el);
    // Typing that already went somewhere (the address bar) is left alone;
    // otherwise the card takes the keyboard, so Tab and Escape reach it.
    if (!previousFocus || previousFocus === document.body || previousFocus === document.documentElement) {
      el.querySelector('[data-act="all"]').focus();
    }
    return el;
  }

  // On each start: a newer version than last time makes (or widens) the
  // pending card; a card not yet closed comes back. The first run here only
  // records the version.
  function noteVersion(ver) {
    const seen = localStorage.getItem(SEEN_KEY);
    localStorage.setItem(SEEN_KEY, ver);
    if (!cardEnabled()) { localStorage.removeItem(PENDING_KEY); return null; }
    let pending = readPending();
    if (pending && VexUpdateNotes.cmp(pending.to, ver) > 0) pending = null;   // went back to an older Vex
    if (seen && VexUpdateNotes.cmp(ver, seen) > 0) {
      const from = pending && VexUpdateNotes.cmp(pending.from, seen) < 0 ? pending.from : seen;
      pending = { from, to: ver };
    }
    if (pending) localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    else localStorage.removeItem(PENDING_KEY);
    return pending;
  }

  async function checkOnStartup() {
    if (window.VexTabPolicy?.isPrivateWindow) return;
    let ver;
    try { ver = await window.vex.getAppVersion(); }
    catch (err) { problem('Could not read the Vex version', err); return; }
    if (!ver) return;
    const pending = noteVersion(String(ver));
    if (pending) setTimeout(() => { showCard(pending).catch(err => problem('Could not show what is new', err)); }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkOnStartup);
  else checkOnStartup();

  // Ctrl+K "What's New", Settings › About, and the card's "See everything".
  window.VexWhatsNew = {
    open: (opts) => showWhatsNew({ ...(opts || {}), force: true }),
    cardEnabled,
    setCardEnabled,
    showCard,
    dismissCard,
    noteVersion,
  };
})();

if (typeof window !== 'undefined') window.VexUpdateNotes = VexUpdateNotes;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUpdateNotes };
