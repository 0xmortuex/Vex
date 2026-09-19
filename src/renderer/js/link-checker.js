// === Check this page's links ================================================
//
// Every link on the page, asked whether it still answers, and sorted by what
// you would do about it: broken first, then the ones that moved, then the ones
// that would not say (a login wall is not a dead link). "Show on page" scrolls
// to the link and outlines it, because a list of URLs is no use when the thing
// to fix is the paragraph it sits in.
//
// The asking is done by main (src/main/link-check.js) from an empty session,
// so the sites learn nothing about you. A private or Tor tab is not checked at
// all: forty requests from your real connection would undo what the tab is for.

const LinkChecker = {
  // Runs in the page: every http(s) link, where it is, and what it says.
  LINKS_SCRIPT: `(() => {
    const here = location.href.split('#')[0];
    const out = [];
    const seen = new Set();
    document.querySelectorAll('a[href]').forEach((a, i) => {
      let u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { return; }
      if (!/^https?:$/.test(u.protocol)) return;
      const bare = u.href.split('#')[0];
      if (bare === here) return;                 // a jump within this page
      a.setAttribute('data-vex-link', String(i));
      if (seen.has(u.href)) return;
      seen.add(u.href);
      out.push({ url: u.href, text: (a.innerText || a.title || a.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 120), index: i });
    });
    return out;
  })()`,

  GROUPS: [
    ['broken', 'Broken', 'The page is gone or the site does not answer'],
    ['error', 'Server error', 'The site is failing right now — try again later'],
    ['slow', 'No answer', 'Gave up waiting after 12 seconds'],
    ['moved', 'Moved', 'Still works, but sends you somewhere else — worth updating'],
    ['blocked', 'Needs sign-in', 'Would not answer a stranger: a login or bot wall, not a dead link'],
    ['ok', 'Working', ''],
  ],

  // Main's verdict, with "moved" split out of "ok": a redirect works today and
  // is the most common thing worth fixing.
  groupOf(r) {
    if (r.verdict === 'ok' && r.redirected && !this._sameIgnoringTrivia(r.url, r.finalUrl)) return 'moved';
    return r.verdict;
  },

  // http→https, a trailing slash, www. — the site tidying up, not the link
  // having moved.
  _sameIgnoringTrivia(a, b) {
    const norm = (u) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '') + x.search).toLowerCase(); } catch { return String(u); } };
    return norm(a) === norm(b);
  },

  async run() {
    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    if (!wv) throw new Error('No page is open');
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) throw new Error('Links in a private tab are not checked — it would contact every site from your real connection');
    const links = await window.vexGuestEval(wv, this.LINKS_SCRIPT);
    if (!Array.isArray(links) || !links.length) throw new Error('There are no links on this page to check');

    const { overlay, head, body, close } = window.PageExport._sheet('Links on this page', 'vex-links-overlay');
    body.innerHTML = `<div style="padding:26px 16px;text-align:center;font-size:12.5px;color:var(--text-muted)">Asking ${links.length} link${links.length === 1 ? '' : 's'}, a few at a time — from an empty session, so no site learns who you are…</div>`;

    const r = await window.vex.checkLinks(links.map(l => l.url));
    if (!overlay.isConnected) return null;                 // closed while waiting
    if (!r || !r.ok) { close(); throw new Error((r && r.error) || 'Could not check the links'); }

    const byUrl = new Map(links.map(l => [l.url, l]));
    const rows = r.results.map(x => ({ ...x, ...(byUrl.get(x.url) || {}), group: this.groupOf(x) }));
    this._render({ rows, skipped: r.skipped, wv, head, body, close });
    return rows;
  },

  _render({ rows, skipped, wv, head, body, close }) {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const count = (g) => rows.filter(x => x.group === g).length;
    const bad = rows.filter(x => ['broken', 'error', 'slow'].includes(x.group));
    let show = bad.length ? 'problems' : 'all';

    head.insertAdjacentHTML('beforeend', `<button data-copy type="button" style="font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer">Copy report</button>`);
    head.querySelector('[data-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(this.report(rows)); window.showToast?.('Link report copied'); }
      catch { window.showToast?.('Could not copy that', 'error'); }
    });

    const draw = () => {
      const summary = this.GROUPS.filter(([g]) => count(g)).map(([g, label]) =>
        `<span style="color:${['broken', 'error'].includes(g) ? 'var(--danger,#e5534b)' : 'var(--text-muted)'}">${count(g)} ${esc(label.toLowerCase())}</span>`).join(' · ');
      body.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px">
          <div style="flex:1;min-width:0">${summary}${skipped ? ` · <span style="color:var(--text-muted)">${skipped} more not checked</span>` : ''}</div>
          <button data-show="problems" type="button" style="font-size:11.5px;padding:2px 9px;border-radius:12px;cursor:pointer;border:1px solid var(--border);background:${show === 'problems' ? 'var(--primary)' : 'none'};color:${show === 'problems' ? '#fff' : 'var(--text)'}">Problems</button>
          <button data-show="all" type="button" style="font-size:11.5px;padding:2px 9px;border-radius:12px;cursor:pointer;border:1px solid var(--border);background:${show === 'all' ? 'var(--primary)' : 'none'};color:${show === 'all' ? '#fff' : 'var(--text)'}">All</button>
        </div>
        <div data-rows style="padding:6px"></div>`;
      body.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => { show = b.dataset.show; draw(); }));
      const list = body.querySelector('[data-rows]');
      const groups = this.GROUPS.filter(([g]) => show === 'all' || g !== 'ok');
      let any = false;
      for (const [g, label, why] of groups) {
        const items = rows.filter(x => x.group === g);
        if (!items.length) continue;
        any = true;
        list.insertAdjacentHTML('beforeend', `<div style="padding:10px 8px 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted)">${esc(label)} <span style="font-weight:400;text-transform:none;letter-spacing:0">${esc(why)}</span></div>`);
        for (const x of items) {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px';
          const code = x.status ? String(x.status) : 'failed';
          row.innerHTML = `
            <code style="flex:0 0 auto;min-width:44px;text-align:center;font-size:11px;padding:1px 5px;border-radius:5px;border:1px solid var(--border);color:${['broken', 'error'].includes(g) ? 'var(--danger,#e5534b)' : 'var(--text-muted)'}">${esc(code)}</code>
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.text || x.url)}</div>
              <div style="font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.url)}${g === 'moved' ? ' → ' + esc(x.finalUrl) : ''}${x.error ? ' — ' + esc(x.error) : ''}</div>
            </div>
            <button data-find type="button" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;cursor:pointer;color:var(--text)">Show on page</button>
            <button data-open type="button" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;cursor:pointer;color:var(--text)">Open</button>`;
          row.querySelector('[data-find]').addEventListener('click', () => { close(); this.showOnPage(wv, x.index); });
          row.querySelector('[data-open]').addEventListener('click', () => { try { TabManager.createTab(x.url, true); close(); } catch {} });
          list.appendChild(row);
        }
      }
      if (!any) list.innerHTML = '<div style="padding:24px;text-align:center;font-size:12.5px;color:var(--text-muted)">Every link on this page answered.</div>';
    };
    draw();
  },

  // Scroll to the link and outline it for a moment.
  showOnPage(wv, index) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0) return;
    const code = `(() => {
      const a = document.querySelector('[data-vex-link="${i}"]');
      if (!a) return false;
      a.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const before = a.style.outline, offset = a.style.outlineOffset;
      a.style.outline = '3px solid #e5534b'; a.style.outlineOffset = '2px';
      setTimeout(() => { a.style.outline = before; a.style.outlineOffset = offset; }, 2600);
      return true;
    })()`;
    return window.vexGuestEval(wv, code).catch(() => false);
  },

  // Plain text, for an email to whoever owns the page.
  report(rows) {
    const lines = [];
    for (const [g, label] of this.GROUPS) {
      if (g === 'ok') continue;
      const items = rows.filter(x => x.group === g);
      if (!items.length) continue;
      lines.push(label + ' (' + items.length + ')');
      for (const x of items) lines.push('  ' + (x.status || 'failed') + '  ' + x.url + (g === 'moved' ? '  →  ' + x.finalUrl : '') + (x.text ? '   "' + x.text + '"' : ''));
      lines.push('');
    }
    const ok = rows.filter(x => x.group === 'ok').length;
    lines.push(ok + ' working');
    return lines.join('\n');
  },
};

if (typeof window !== 'undefined') window.LinkChecker = LinkChecker;
if (typeof module !== 'undefined' && module.exports) module.exports = { LinkChecker };
