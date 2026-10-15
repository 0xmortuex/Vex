// === Archive library: pages you chose to keep ===============================
//
// "Archive this page" (the button in the library, Ctrl+K, and the page's
// right-click menu) keeps one self-contained copy on this PC, in a folder Vex
// manages — not Downloads — with its title, address, time, size and text.
// The library lists them, searches title and text (Recall's engine, in main),
// opens a copy in a window that runs no script and fetches nothing, exports
// one as a file, and deletes one. See src/main/archive-library.js.
//
// Never automatic. Never for a private, Tor, routed or container tab, a site
// on Recall's "never remember" list, or a sign-in / bank / mail / health page.
// A copy is not synced, and a backup carries only the setting below, not the
// copies (they can be hundreds of megabytes: export the ones you want).
//
// When a page you archived will not load (offline, gone, 404), an offer to
// open your copy appears beside the Wayback Machine one.

const ArchiveLibrary = {
  OFFER_KEY: 'vex.archive.offer',

  offerEnabled() {
    try { return localStorage.getItem(this.OFFER_KEY) !== 'false'; } catch { return true; }
  },
  setOfferEnabled(on) { try { localStorage.setItem(this.OFFER_KEY, on ? 'true' : 'false'); } catch {} },

  // What a failed or empty load says about the page, or null when it says
  // nothing worth offering a copy for. A superseded load (-3), a blocked one
  // (-20 by Vex, -27 by the page) and a certificate problem (-200..-299, which
  // has its own page) are not "the page is gone".
  deadKind({ isMainFrame = true, errorCode = 0, httpStatus = 0 } = {}) {
    if (isMainFrame === false) return null;
    if (errorCode < 0) {
      if (errorCode === -3 || errorCode === -20 || errorCode === -27) return null;
      if (errorCode <= -200 && errorCode >= -299) return null;
      return 'unreachable';
    }
    if (httpStatus === 404 || httpStatus === 410) return 'gone';
    if (httpStatus >= 500 && httpStatus <= 599) return 'unreachable';
    return null;
  },

  _api() { return window.vex || null; },

  // The page in front, kept. Throws with a plain reason when it must not be.
  async archiveActive() {
    const api = this._api();
    if (!api || typeof api.pageArchiveSave !== 'function') throw new Error('The archive library is not available here');
    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    if (!wv) throw new Error('No page is open');
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) throw new Error('Private, Tor and routed tabs are never archived');
    const url = wv.getURL ? wv.getURL() : '';
    if (!/^https?:/i.test(url)) throw new Error('Only a web page can be archived');
    if (typeof Recall !== 'undefined' && Recall.isExcluded && Recall.isExcluded(url)) throw new Error('This site is on your list of sites Vex does not remember, so it is not archived');
    let wcId = null;
    try { wcId = wv.getWebContentsId(); } catch {}
    if (typeof wcId !== 'number' || wcId < 0) throw new Error('This page has not finished opening yet');
    // The readable text, by the same extractor Recall uses, so a copy can be
    // found by what it says. A page with no readable text is kept without it.
    let page = null;
    if (typeof Recall !== 'undefined' && typeof Recall._extractor === 'function') {
      page = await wv.executeJavaScript(Recall._extractor(url, 100000));
    }
    const tab = (typeof TabManager !== 'undefined' && TabManager.getActiveTab) ? TabManager.getActiveTab() : null;
    const title = (page && page.title) || (tab && tab.title) || url;
    const r = await api.pageArchiveSave(wcId, { title, text: (page && page.text) || '' });
    if (!r || !r.ok) {
      const err = new Error((r && r.error) || 'The page could not be archived');
      err.refused = r && r.refused;
      err.suggest = r && r.suggest;
      throw err;
    }
    return r.entry;
  },

  // The command, the button and the menu all come here.
  async archiveNow() {
    try {
      const entry = await this.archiveActive();
      window.showToast?.('Kept a copy of "' + entry.title.slice(0, 60) + '" (' + this.size(entry.bytes) + ')', 'success', 5000, {
        action: { label: 'Open library', run: () => this.open() },
      });
      return entry;
    } catch (err) {
      if (err.refused === 'library-full') {
        window.showToast?.(err.message, 'error', 9000, { action: { label: 'Open library', run: () => this.open() } });
      } else {
        window.showToast?.(err.message, 'error', 6000);
      }
      return null;
    }
  },

  size(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1024 * 1024) return (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB';
    return Math.max(1, Math.round(n / 1024)) + ' KB';
  },

  // ---- "Open your copy" on a page that will not load -----------------------
  // info: { isMainFrame, errorCode, httpStatus }. Only a page that is in the
  // library gets an offer; every other dead page is left exactly as it was.
  async offerForDeadPage(url, info) {
    try {
      if (!this.offerEnabled()) return null;
      if (!/^https?:/i.test(url || '')) return null;
      if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return null;
      const kind = this.deadKind(info);
      if (!kind) return null;
      const api = this._api();
      if (!api || typeof api.pageArchiveFind !== 'function') return null;
      const r = await api.pageArchiveFind(url);
      if (!r || !r.ok || !r.entry) return null;
      const entry = r.entry;
      const when = new Date(entry.at).toLocaleDateString();
      const actions = [{ label: 'Open your copy', title: 'Saved ' + new Date(entry.at).toLocaleString(), run: () => this.openCopy(entry.id) }];
      if (typeof LinkRot !== 'undefined') actions.push({ label: 'Wayback Machine', run: () => LinkRot.viewArchived(url) });
      window.showToast?.((kind === 'gone' ? 'This page is gone. ' : 'This page will not load. ') + 'You kept a copy on ' + when + '.', 'info', 12000, { actions });
      return entry;
    } catch (err) {
      console.error('[Archive] could not check for your copy of ' + url + ':', err && err.message);
      return null;
    }
  },

  async openCopy(id) {
    const r = await this._api().pageArchiveOpen(id);
    if (!r || !r.ok) window.showToast?.((r && r.error) || 'That copy could not be opened', 'error');
  },

  // ---- the library --------------------------------------------------------
  open() {
    document.getElementById('vex-archive')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-archive';
    m.className = 'vexsr-ov';
    m.innerHTML = '<div class="vexsr-card" role="dialog" aria-modal="true" aria-labelledby="ar-title" style="width:640px">'
      + '<div class="vexsr-head"><span class="vexsr-title" id="ar-title">Archive library</span>'
      + '<button class="vexsr-x" id="ar-close" aria-label="Close" title="Close">' + VexIcons.svg('x', { size: 13 }) + '</button></div>'
      + '<div class="vexsr-sub" id="ar-usage">Copies of pages you chose to keep, on this PC only.</div>'
      + '<div class="vexsr-row" style="margin-top:10px">'
      + '<input class="vexsr-input" id="ar-q" type="search" placeholder="Search titles and the saved text" aria-label="Search your copies">'
      + '<button class="vexsr-go" id="ar-add">Archive this page</button></div>'
      + '<div class="vexsr-msg" id="ar-msg" role="status"></div>'
      + '<div class="vexsr-list" id="ar-list"></div>'
      + '<label class="vexsr-check" style="margin-top:6px"><input type="checkbox" id="ar-offer"> Offer my copy when a page I archived will not load</label>'
      + '<div class="vexsr-note">Copies are kept in a folder Vex manages in its own data folder, not in Downloads, and are never uploaded, synced or archived by themselves. '
      + 'They open in a window that runs no script and loads nothing from the network. Private, Tor and routed tabs, sites on your Recall exclusion list, and sign-in, bank, payment, mail and health pages are never archived. '
      + 'A backup carries the setting above, not the copies themselves; use Export for the ones you want to take with you.</div>'
      + '</div>';
    document.body.appendChild(m);

    const msg = (t, bad) => { const e = m.querySelector('#ar-msg'); e.textContent = t || ''; e.style.color = bad ? 'var(--danger, #ef4444)' : 'var(--text-muted)'; };
    const onKey = (e) => {
      if (!m.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); };
    document.addEventListener('keydown', onKey, true);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.querySelector('#ar-close').addEventListener('click', close);
    m.querySelector('#ar-close').focus({ preventScroll: true });

    const offer = m.querySelector('#ar-offer');
    offer.checked = this.offerEnabled();
    offer.addEventListener('change', () => this.setOfferEnabled(offer.checked));

    let seq = 0;
    const draw = async () => {
      const mine = ++seq;
      const q = m.querySelector('#ar-q').value;
      const api = this._api();
      let r;
      try { r = q.trim() ? await api.pageArchiveSearch(q) : await api.pageArchiveList(); }
      catch (err) { r = { ok: false, error: err.message }; }
      if (mine !== seq || !m.isConnected) return;
      const list = m.querySelector('#ar-list');
      list.textContent = '';
      if (!r || !r.ok) { msg('The library could not be read: ' + ((r && r.error) || 'unknown error'), true); return; }
      const hits = r.result ? r.result.hits : r.entries;
      const st = r.stats;
      if (st) m.querySelector('#ar-usage').textContent = st.count + ' cop' + (st.count === 1 ? 'y' : 'ies') + ', ' + this.size(st.bytes) + ' of ' + this.size(st.maxBytes)
        + ' (one copy can be at most ' + this.size(st.maxPageBytes) + '). Nothing is removed unless you remove it.';
      if (!hits.length) {
        list.innerHTML = VexUI.emptyState('archive', q.trim() ? 'No copy matches' : 'No copies yet', q.trim() ? 'Try other words.' : 'Open a page and press Archive this page.');
        return;
      }
      for (const h of hits) list.appendChild(this._row(h, { msg, redraw: draw }));
    };
    let timer = null;
    m.querySelector('#ar-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 180); });
    m.querySelector('#ar-add').addEventListener('click', async () => {
      msg('Keeping this page…');
      const entry = await this._archiveFromLibrary(msg);
      if (entry) { msg('Kept a copy (' + this.size(entry.bytes) + ')'); draw(); }
    });
    draw();
    return m;
  },

  // From inside the library the page in front is the tab behind it.
  async _archiveFromLibrary(msg) {
    try { return await this.archiveActive(); }
    catch (err) {
      let text = err.message;
      if (err.refused === 'library-full' && Array.isArray(err.suggest) && err.suggest.length) {
        text += ' Oldest: ' + err.suggest.slice(0, 5).map(e => '"' + e.title.slice(0, 40) + '"').join(', ') + '.';
      }
      msg(text, true);
      return null;
    }
  },

  _row(h, { msg, redraw }) {
    const row = document.createElement('div');
    row.className = 'vexsr-rule';
    row.dataset.archiveId = h.id;
    row.style.flexWrap = 'wrap';
    const text = document.createElement('div');
    text.style.cssText = 'flex:1;min-width:200px';
    const title = document.createElement('div');
    title.className = 'vexsr-host';
    title.textContent = h.title;
    const meta = document.createElement('div');
    meta.className = 'vexsr-mode';
    meta.style.whiteSpace = 'normal';
    meta.textContent = h.host + ' · ' + new Date(h.at).toLocaleString() + ' · ' + this.size(h.bytes);
    text.append(title, meta);
    if (Array.isArray(h.snippet) && h.snippet.length) {
      const sn = document.createElement('div');
      sn.className = 'vexsr-sub';
      for (const [part, hit] of h.snippet) {
        if (hit) { const b = document.createElement('mark'); b.textContent = part; sn.appendChild(b); }
        else sn.appendChild(document.createTextNode(part));
      }
      text.appendChild(sn);
    }
    const btn = (label, aria, run, icon) => {
      const b = document.createElement('button');
      b.className = 'vexsr-x';
      b.textContent = label;
      b.setAttribute('aria-label', aria + ': ' + h.title);
      b.addEventListener('click', run);
      return b;
    };
    const open = btn('Open', 'Open your copy', async () => {
      const r = await this._api().pageArchiveOpen(h.id);
      if (!r || !r.ok) msg((r && r.error) || 'That copy could not be opened', true);
    });
    const exp = btn('Export', 'Export a file of', async () => {
      const r = await this._api().pageArchiveExport(h.id);
      if (!r || !r.ok) msg((r && r.error) || 'That copy could not be exported', true);
      else if (!r.cancelled) msg('Exported to ' + String(r.path).split(/[\\/]/).pop());
    });
    const del = btn('Delete', 'Delete your copy', async () => {
      const ok = await vexConfirm({ title: 'Delete this copy?', message: '"' + h.title + '" will be removed from the library. The page itself on the web is not affected.', okLabel: 'Delete', danger: true });
      if (!ok) return;
      const r = await this._api().pageArchiveRemove(h.id);
      if (!r || !r.ok) { msg((r && r.error) || 'That copy could not be deleted', true); return; }
      msg('Deleted');
      redraw();
    });
    row.append(text, open, exp, del);
    return row;
  },
};

if (typeof window !== 'undefined') window.ArchiveLibrary = ArchiveLibrary;
if (typeof module !== 'undefined' && module.exports) module.exports = { ArchiveLibrary };
