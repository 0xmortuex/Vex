// === Page checks, again ======================================================
//
// The link check, the speed check, the accessibility check and the site crawl
// each answer "what is wrong now". The next question is always "did my fix
// work?" — and that needs the last answer to compare with. Each run's numbers
// are kept here, per page, and every report opens with what changed since the
// last run on that page ("Broken 3 → 1"). "Recent Page Checks" lists them, to
// run any of them again.
//
// Only the counts are kept, never the page's content or the report itself.

const CheckHistory = {
  KEY: 'vex.checkHistory',
  MAX: 60,
  LOAD_TIMEOUT_MS: 45000,
  SETTLE_MS: 1500,            // a page's largest paint can land after load

  KINDS: {
    links: { label: 'Link check', run: () => window.LinkChecker.run() },
    speed: { label: 'Speed check', run: () => window.PerfCheck.run(), reload: true },
    a11y:  { label: 'Accessibility check', run: () => window.A11yCheck.run() },
    crawl: { label: 'Site crawl', run: () => window.SiteCrawler.run() },
  },

  bare(url) { try { const u = new URL(url); u.hash = ''; return u.href; } catch { return String(url || ''); } },

  list() {
    let a;
    try { a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); }
    catch (err) { throw new Error('The history of your page checks could not be read', { cause: err }); }
    return Array.isArray(a) ? a.filter(r => r && this.KINDS[r.kind] && Array.isArray(r.entries)) : [];
  },

  // entries: [{ key, label, value (number), text }]. Returns the previous run
  // of this kind on this page, or null — read before this one is stored.
  record(kind, url, entries, verdict) {
    if (!this.KINDS[kind]) throw new Error('Not a page check: ' + kind);
    const page = this.bare(url);
    const all = this.list();
    const prev = all.find(r => r.kind === kind && r.url === page) || null;
    all.unshift({ kind, url: page, at: Date.now(), verdict: String(verdict || '').slice(0, 200), entries: entries.map(e => ({ key: String(e.key), label: String(e.label), value: Number(e.value) || 0, text: String(e.text != null ? e.text : e.value) })) });
    localStorage.setItem(this.KEY, JSON.stringify(all.slice(0, this.MAX)));
    return prev;
  },

  // record() for the page in a tab — except a private or Tor tab, which
  // leaves nothing behind (null: nothing kept, nothing to compare).
  track(kind, wv, entries, verdict) {
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) return null;
    return this.record(kind, wv.getURL(), entries, verdict);
  },

  // What changed: every figure whose value moved, including ones that
  // appeared or went to nothing.
  changes(prev, entries) {
    if (!prev) return null;
    const before = new Map(prev.entries.map(e => [e.key, e]));
    const now = new Map(entries.map(e => [e.key, e]));
    const out = [];
    for (const key of new Set([...before.keys(), ...now.keys()])) {
      const a = before.get(key), b = now.get(key);
      const av = a ? a.value : 0, bv = b ? b.value : 0;
      // Equal, or equal as shown (1.21 s and 1.19 s both read "1.2 s").
      if (av === bv || (a && b && a.text === b.text)) continue;
      out.push({ key, label: (b || a).label, from: a ? a.text : '0', to: b ? b.text : '0' });
    }
    return out;
  },

  when(at) {
    return new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  },

  // One sentence for the top of a report, or null for a first run.
  since(prev, entries) {
    const ch = this.changes(prev, entries);
    if (!ch) return null;
    const when = this.when(prev.at);
    if (!ch.length) return 'The same as last time (' + when + ').';
    return 'Since last time (' + when + '): ' + ch.map(c => c.label + ' ' + c.from + ' → ' + c.to).join(' · ');
  },

  // The line and the Run again button, added to a report sheet.
  decorate({ head, body, close }, kind, prev, entries, runAgain) {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const line = this.since(prev, entries);
    // Above the body, not in it: some reports redraw their body (a filter
    // toggle) and would wipe it.
    if (line) body.insertAdjacentHTML('beforebegin', `<div data-since style="padding:8px 14px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text);background:var(--surface)">${esc(line)}</div>`);
    head.insertAdjacentHTML('beforeend', `<button data-again type="button" style="font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer">Run again</button>`);
    head.querySelector('[data-again]').addEventListener('click', async () => {
      close();
      try { await (runAgain || (() => this.runOn(kind, null)))(); }
      catch (err) { window.showToast?.((err && err.message) || 'Could not run it again', 'error'); }
    });
  },

  // Wait until a webview has finished loading. Polled rather than an event:
  // a fast page can finish before a listener is attached.
  async _loaded(wv) {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    await sleep(300);                                   // let the load begin
    const until = Date.now() + this.LOAD_TIMEOUT_MS;
    while (wv.isLoading()) {
      if (Date.now() > until) throw new Error('The page did not finish loading in ' + Math.round(this.LOAD_TIMEOUT_MS / 1000) + ' s');
      await sleep(250);
    }
    await sleep(this.SETTLE_MS);
  },

  // Run a check on a page: the one open, or open it first. A speed check
  // measures a load, so it reloads the page before measuring.
  async runOn(kind, url) {
    const k = this.KINDS[kind];
    if (!k) throw new Error('Not a page check: ' + kind);
    let wv = WebviewManager.getActiveWebview();
    const here = wv ? this.bare(wv.getURL()) : '';
    if (url && this.bare(url) !== here) {
      TabManager.createTab(url, true);
      await new Promise(r => setTimeout(r, 50));
      wv = WebviewManager.getActiveWebview();
      if (!wv) throw new Error('The page could not be opened');
      await this._loaded(wv);
    } else if (k.reload) {
      if (!wv) throw new Error('No page is open');
      wv.reload();
      await this._loaded(wv);
    }
    return k.run();
  },

  // --- Recent Page Checks ---------------------------------------------------------
  open() {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { head, body, close } = window.PageExport._sheet('Recent page checks', 'vex-checks-overlay');
    head.insertAdjacentHTML('beforeend', `<button data-clear type="button" style="font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer">Forget all</button>`);
    head.querySelector('[data-clear]').addEventListener('click', async () => {
      const ok = await window.vexConfirm({ title: 'Forget every check?', message: 'The numbers from past link, speed, accessibility and crawl checks are deleted. The next run of each has nothing to compare with.', okLabel: 'Forget all', danger: true });
      if (!ok) return;
      localStorage.removeItem(this.KEY);
      draw();
    });
    const draw = () => {
      // Newest run of each check on each page.
      const seen = new Set();
      const rows = this.list().filter(r => { const k = r.kind + ' ' + r.url; if (seen.has(k)) return false; seen.add(k); return true; });
      body.innerHTML = rows.length ? '<div data-rows style="padding:6px"></div>' : `<div style="padding:22px 14px;text-align:center;font-size:12.5px;color:var(--text-muted)">No checks yet. Run Check This Page's Links, Why Is This Page Slow?, Check Accessibility or Crawl This Site, and it will be here to run again.</div>`;
      const list = body.querySelector('[data-rows]');
      for (const r of rows) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px';
        const page = (() => { try { const u = new URL(r.url); return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname); } catch { return r.url; } })();
        row.innerHTML = `
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;color:var(--text)">${esc(this.KINDS[r.kind].label)} · <span style="color:var(--text-muted)">${esc(page)}</span></div>
            <div style="font-size:10.5px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(this.when(r.at))}${r.verdict ? ' — ' + esc(r.verdict) : ''}</div>
          </div>
          <button data-run type="button" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:6px;padding:2px 8px;cursor:pointer;color:var(--text)">Run again</button>`;
        row.querySelector('[data-run]').addEventListener('click', async () => {
          close();
          try { await this.runOn(r.kind, r.url); }
          catch (err) { window.showToast?.((err && err.message) || 'Could not run it again', 'error'); }
        });
        list.appendChild(row);
      }
    };
    draw();
    return body;
  },
};

if (typeof window !== 'undefined') window.CheckHistory = CheckHistory;
if (typeof module !== 'undefined') module.exports = { CheckHistory };
