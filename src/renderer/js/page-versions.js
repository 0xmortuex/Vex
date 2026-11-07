// === Text versions of a page ====================================================
//
// For a page the person marks "keep versions of this page": the readable TEXT of the page (never its HTML, never a
// picture) is kept whenever a page watch on it sees a change, or when the person presses "save a version now". Up to
// 20 versions per page (the oldest goes when a 21st comes), 200 KB of text each, 100 pages. Two versions can be
// compared as a word-level diff, and every kept page says in one line what changed since the last version.
//
// OFF until the person turns it on (vex.pageVersions.enabled). Marking a page is explicit and per page. Nothing is kept
// from a private, Tor, routed or container tab, nor from a banking, payment, sign-in, mail or health page. Nothing is
// fetched: the text comes from the page already open, or from the text the page watch already read. The files are
// main's (src/main/evodata-versions-store.js, in <userData>/kept-pages/versions); this is the window onto them.
// "Delete everything kept as page versions" removes every file there.
const VexPageVersions = {
  PREF_KEY: 'vex.pageVersions.enabled',
  enabled() { try { return localStorage.getItem(this.PREF_KEY) === 'true'; } catch { return false; } },
  setEnabled(on) { localStorage.setItem(this.PREF_KEY, on ? 'true' : 'false'); },

  offReason() { return this.enabled() ? '' : 'Page versions are switched off. Turn them on in Page versions.'; },

  // "Since the last version: 12 words added, 3 words removed" (or the first version, or no change). change: { added, removed } | null
  summaryLine(change) {
    if (!change) return 'First version';
    if (!change.added && !change.removed) return 'Nothing changed since the last version';
    const words = (n) => VexPlural.count(n, { en: ['word', 'words'], tr: 'sözcük' });
    return VexKept.t('Since the last version: {1} added, {2} removed', words(change.added), words(change.removed));
  },

  // The readable text of the page in a tab, line breaks kept (innerText of the article, main or body), so the diff shows
  // lines. A page that moved on while it was read is refused.
  async readPage(wv) {
    const url = window.vexGuestUrl(wv);
    const page = await window.vexGuestEval(wv, `(function(){try{
      var root=document.querySelector('article,main,[role=main]')||document.body;
      if(!root)return null;
      return {url:location.href,title:(document.title||'').substring(0,300),text:String(root.innerText||'').substring(0,250000)};
    }catch(e){return null}})();`, false, 10000);
    if (!page || !page.text) throw new Error('There is no readable text on this page');
    if (window.vexGuestUrl(wv) !== url) throw new Error('The page changed while it was being read');
    return { url, title: page.title, text: page.text };
  },

  // ---- marking and saving ---------------------------------------------------------------
  // Ctrl+K: mark the page in front, and keep its text as the first version.
  async keepHere() {
    const off = this.offReason();
    if (off) throw new Error(off);
    const wv = VexKept.activeWebview();
    const why = VexKept.refusal(wv);
    if (why) throw new Error(why);
    const page = await this.readPage(wv);
    await VexKept.call('versionsKeep', page.url, page.title);
    const r = await VexKept.call('versionsSave', page.url, page.title, page.text);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('page-versions');
    window.showToast?.(r.saved ? 'Versions of this page are kept from now on. The first one is saved.' : 'Versions of this page are kept from now on.');
    return r;
  },

  // Ctrl+K: save the text of the page in front as a new version, and say what changed.
  async saveNow() {
    const off = this.offReason();
    if (off) throw new Error(off);
    const wv = VexKept.activeWebview();
    const why = VexKept.refusal(wv);
    if (why) throw new Error(why);
    const page = await this.readPage(wv);
    const kept = await VexKept.call('versionsKept', page.url);
    if (!kept.kept) throw new Error('Keep versions of this page first (Ctrl+K: Keep Versions of This Page)');
    const r = await VexKept.call('versionsSave', page.url, page.title, page.text);
    window.showToast?.(r.saved ? this.summaryLine(r.change) : 'Nothing changed since the last version');
    return r;
  },

  // Page watch's "vex:page-watch-snapshot": a watch on a page that is kept saves its text when it changes. Nothing is
  // asked of the page again, and a page that was not marked is not kept.
  async onSnapshot(detail) {
    if (!this.enabled() || !detail || !detail.url || !detail.text) return;
    const r = await VexKept.call('versionsSaveKept', detail.url, detail.title || detail.url, detail.text);
    if (r.kept && r.saved && r.change) window.showToast?.(this.summaryLine(r.change));
  },

  // ---- comparing two versions -----------------------------------------------------------
  async compare(meta) {
    const list = (await VexKept.call('versionsOf', meta.id)).versions;
    if (list.length < 2) throw new Error('Only one version is kept so far, so there is nothing to compare');
    const V = window.VexVersionsCore;
    const { body } = VexKept.sheet(meta.title, 'vex-pagever-compare');
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--border)';
    const pick = (label) => {
      const sel = document.createElement('select');
      sel.className = 'set-input';
      list.forEach((v, i) => sel.append(new Option((i + 1) + ' · ' + new Date(v.at).toLocaleString(), String(v.at))));
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:11.5px;color:var(--text-muted)';
      wrap.append(document.createTextNode(label), sel);
      return { sel, wrap };
    };
    const from = pick('From version'), to = pick('To version');
    from.sel.value = String(list[list.length - 2].at);
    to.sel.value = String(list[list.length - 1].at);
    const summary = VexKept.line('', true);
    summary.setAttribute('role', 'status');
    const out = document.createElement('div');
    out.style.cssText = 'padding:10px 14px;max-height:56vh;overflow:auto;font-size:12.5px;line-height:1.55;color:var(--text);white-space:pre-wrap;word-break:break-word';
    const show = async () => {
      try {
        const { diff } = await VexKept.call('versionsDiff', meta.id, Number(from.sel.value), Number(to.sel.value));
        this.renderDiff(diff, out, V);
        const notes = [];
        const via = (sel) => (list.find(v => String(v.at) === sel.value) || {}).via;
        if (from.sel.value === to.sel.value) notes.push('These are the same version');
        else notes.push(this.summaryLine({ added: diff.added, removed: diff.removed }));
        if (via(from.sel) !== via(to.sel)) notes.push('One was read from the open page and the other by the page watch, which read a page a little differently, so some changes may only be formatting');
        if (diff.cut) notes.push(VexKept.t('The pages are long, so only the first {1} words of each were compared', V.LIMITS.diffTokens));
        if (diff.coarse) notes.push('The change is too large to show word by word, so the old text is shown as removed and the new text as added');
        summary.textContent = notes.join('. ');
      } catch (err) { summary.textContent = err.message; }
    };
    bar.append(from.wrap, to.wrap, VexKept.button('Show the changes', show));
    body.append(bar, summary, VexKept.line('Added text is green and removed text is red.'), out);
    await show();
  },

  // ops -> spans: unchanged text plain, removed text red and struck through, added text green. Textual (textContent only).
  renderDiff(diff, into, V) {
    into.textContent = '';
    const ops = V.foldContext(diff.ops, 12);
    let needSpace = false;
    const gap = () => { const s = document.createElement('span'); s.style.color = 'var(--text-muted)'; s.textContent = ' … '; return s; };
    for (const op of ops) {
      if (op.t === 'gap') { into.append(gap()); needSpace = false; continue; }
      const text = V.joinWords(op.words);
      if (!text) continue;
      if (needSpace && !text.startsWith('\n')) into.append(document.createTextNode(' '));
      const el = document.createElement(op.t === 'eq' ? 'span' : (op.t === 'add' ? 'ins' : 'del'));
      if (op.t === 'add') el.style.cssText = 'background:rgba(48,164,108,.22);text-decoration:none;border-radius:3px';
      if (op.t === 'del') el.style.cssText = 'background:rgba(229,72,77,.2);text-decoration:line-through;border-radius:3px';
      el.textContent = text;
      into.append(el);
      needSpace = !text.endsWith('\n');
    }
  },

  // ---- the screen ----------------------------------------------------------------------
  async open() {
    const { body, close } = VexKept.sheet('Page versions', 'vex-pagever-overlay');
    const render = async () => {
      body.innerHTML = '';
      body.append(VexKept.switchRow('Keep text versions of pages', this, 'Off until you turn it on. For a page you mark with “Keep Versions of This Page”, its readable text (not the page itself, and no picture) is kept when you save a version or when a page watch on it sees a change. It stays on this computer. Nothing is kept from private, Tor or burner tabs, or from banking, payment, sign-in, mail or health pages.', () => render().catch(err => window.showToast?.(err.message, 'error'))));
      let list;
      try { list = await VexKept.call('versionsList'); }
      catch (err) { body.append(VexKept.line(err.message)); return; }
      const L = list.limits;
      body.append(VexKept.line(VexKept.t('Using {1}. Limits: {2} pages, {3} versions of each (the oldest goes first) and {4} of text for each version.', VexKept.formatBytes(list.bytes), L.pages, L.versionsPerPage, VexKept.formatBytes(L.versionChars))));
      if (!list.items.length) body.append(VexKept.line('No pages are kept yet. Open a page and choose “Keep Versions of This Page” from Ctrl+K.'));
      for (const m of list.items) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--border)';
        const label = document.createElement('div');
        label.style.cssText = 'flex:1;min-width:200px';
        const nm = document.createElement('div');
        nm.style.cssText = 'font-size:12.5px;color:var(--text);font-weight:600';
        nm.textContent = m.title || m.url;
        const sub = document.createElement('div');
        sub.style.cssText = 'font-size:11px;color:var(--text-muted)';
        sub.textContent = [VexKept.t('Versions: {1}', m.count), VexKept.formatBytes(m.bytes)].concat(m.lastAt ? [VexKept.t('Last saved {1}', new Date(m.lastAt).toLocaleString())] : []).join(' · ');
        const what = document.createElement('div');
        what.style.cssText = 'font-size:11px;color:var(--text-muted)';
        what.textContent = m.count ? this.summaryLine(m.lastChange) : 'No version saved yet';
        label.append(nm, sub, what);
        const act = (text, fn) => VexKept.button(text, async () => { try { await fn(); } catch (err) { window.showToast?.(err.message, 'error'); } });
        row.append(label,
          act('Compare', () => this.compare(m)),
          act('Stop keeping', async () => {
            const ok = await window.vexConfirm({ title: 'Stop keeping versions of this page?', message: VexKept.t('The versions kept of “{1}” are deleted from this computer. This cannot be undone.', m.title || m.url), okLabel: 'Stop keeping', danger: true });
            if (!ok) return;
            await VexKept.call('versionsForget', m.id);
            await render();
          }));
        body.append(row);
      }
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px';
      bar.append(
        VexKept.deleteAllButton('Delete everything kept as page versions', {
          title: 'Delete all page versions?', message: 'Every kept page and all of its versions are deleted from this computer. This cannot be undone.',
          channel: 'versionsClear', done: () => { render().catch(err => window.showToast?.(err.message, 'error')); },
        }),
        VexKept.button('Close', () => close()),
      );
      body.append(bar);
    };
    await render();
    return close;
  },

  registerCommands() {
    if (typeof VexExtras === 'undefined' || typeof VexExtras.registerCommand !== 'function') return false;
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    VexExtras.registerCommand({ id: 'page-versions-open', label: 'Page Versions', hint: 'The pages whose text you keep versions of: what changed, compare two versions, switch it on or off', icon: 'history', action: () => { this.open().catch(fail); } });
    VexExtras.registerCommand({ id: 'page-versions-keep', label: 'Keep Versions of This Page', hint: 'Mark this page so its readable text is kept when you save a version or a page watch sees it change', icon: 'history', action: () => { this.keepHere().catch(fail); } });
    VexExtras.registerCommand({ id: 'page-versions-save', label: 'Save a Version of This Page Now', hint: 'Keep this page\'s text as it is now, and see what changed since the last version', icon: 'history', action: () => { this.saveNow().catch(fail); } });
    return true;
  },

  init() {
    this.registerCommands();
    document.addEventListener('vex:page-watch-snapshot', (e) => {
      this.onSnapshot(e.detail).catch(err => window.VexProblems?.note('Page versions', 'Could not keep a version for a page watch', err));
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexPageVersions = VexPageVersions;
  VexPageVersions.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPageVersions };
