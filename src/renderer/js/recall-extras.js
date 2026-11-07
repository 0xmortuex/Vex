// === Remembered in Recall: what the person adds by hand ===========================
//
// Recall (js/recall.js) finds the pages that were read. This lets the person ADD other things to it, one at a time, on
// purpose: a selected text from a page, the name of a downloaded file, a reminder, a note. Nothing is added automatically,
// and nothing is read from anywhere except what the person pressed "remember" on. Ctrl+K recall search then finds them,
// each with its type (Clip, Downloaded file, Reminder, Note).
//
// They live in their own small file (src/main/evodata-extras-store.js: <userData>/kept-pages/recall-extras.json, 500 things,
// 2,000 characters each, 400 KB in all, the oldest go first) and are merged into the results when Recall is searched
// (Recall.extraHits, called by the panel in js/recall.js). recall.json, a bare ~4 MB array that is rewritten whole, is not
// touched and does not get bigger.
//
// OFF until the person turns it on (vex.recallExtras.enabled). A text selected on a private, Tor, routed or container tab,
// or on a banking, payment, sign-in, mail or health page, is never remembered. "Delete everything remembered in Recall" removes the file.
const VexRecallExtras = {
  PREF_KEY: 'vex.recallExtras.enabled',
  enabled() { try { return localStorage.getItem(this.PREF_KEY) === 'true'; } catch { return false; } },
  setEnabled(on) { localStorage.setItem(this.PREF_KEY, on ? 'true' : 'false'); },

  offReason() { return this.enabled() ? '' : 'Remembering in Recall is switched off. Turn it on in Remembered in Recall.'; },

  // ---- adding -------------------------------------------------------------------------
  // item: { kind: 'clip' | 'file' | 'reminder' | 'note', text, title?, url? }
  async remember(item) {
    const off = this.offReason();
    if (off) throw new Error(off);
    const r = await VexKept.call('extraAdd', item);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('recall-extras');
    return r;
  },

  // The text selected in the page in front. Needs a web page that may be read at all.
  async rememberSelection(wv) {
    const off = this.offReason();
    if (off) throw new Error(off);
    const tab = wv || VexKept.activeWebview();
    const why = VexKept.refusal(tab);
    if (why) throw new Error(why);
    const url = window.vexGuestUrl(tab);
    const picked = await window.vexGuestEval(tab, '(function(){try{return {text:String(window.getSelection()||"").substring(0,4000),title:(document.title||"").substring(0,300)}}catch(e){return null}})();', false, 5000);
    const text = picked && picked.text ? picked.text.trim() : '';
    if (!text) throw new Error('Select some text on the page first');
    await this.remember({ kind: 'clip', text, title: picked.title, url });
    window.showToast?.('Remembered. Recall search will find it.');
  },

  // A note or a reminder typed here (this does not create a reminder in the Reminders list: it only makes the words findable).
  async rememberTyped(kind) {
    const off = this.offReason();
    if (off) throw new Error(off);
    const note = kind === 'note';
    const text = await window.vexPrompt({
      title: note ? 'Remember a note in Recall' : 'Remember a reminder in Recall',
      label: note ? 'The note' : 'The reminder', multiline: true, okLabel: 'Remember',
    });
    if (text == null || !String(text).trim()) return;
    await this.remember({ kind, text: String(text) });
    window.showToast?.('Remembered. Recall search will find it.');
  },

  // The newest finished downloads, to pick a file name from. Only the name is kept, not the folder and not the address it came from.
  recentDownloads(limit = 20) {
    const list = typeof DownloadsPanel !== 'undefined' && Array.isArray(DownloadsPanel.downloads) ? DownloadsPanel.downloads : [];
    return list.filter(d => d && d.state === 'completed' && !d.ephemeral && d.filename).slice(-limit).reverse();
  },
  async rememberDownload() {
    const off = this.offReason();
    if (off) throw new Error(off);
    const files = this.recentDownloads();
    if (!files.length) throw new Error('There are no finished downloads to remember');
    const { body, close } = VexKept.sheet('Remember a downloaded file in Recall', 'vex-recallextra-pick');
    body.append(VexKept.line('Only the file name is remembered, not where it is or where it came from.'));
    for (const d of files) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:7px 14px;border-bottom:1px solid var(--border)';
      const nm = document.createElement('div');
      nm.style.cssText = 'flex:1;min-width:0;font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      nm.textContent = d.filename; nm.title = d.filename;
      row.append(nm, VexKept.button('Remember', async () => {
        try { await this.remember({ kind: 'file', text: d.filename }); window.showToast?.('Remembered. Recall search will find it.'); close(); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      }));
      body.append(row);
    }
  },

  // The page's right-click menu, on a selection: one row (js/webview.js asks with typeof). [] while it is off or the tab may not be read.
  selectionItems(selectionText, wv) {
    if (!this.enabled() || !selectionText || VexKept.refusal(wv)) return [];
    return [{ label: 'Remember this in Recall', action: () => { this.rememberSelection(wv).catch(err => window.showToast?.(err.message, 'error')); } }];
  },

  // ---- finding and forgetting -------------------------------------------------------------
  // Recall.extraHits: the things whose words match the query, shaped as Recall hits. [] while it is off.
  async hits(query, opts) {
    if (!this.enabled()) return [];
    const q = String(query || '').trim();
    if (!q) return [];
    const { items } = await VexKept.call('extraList');
    return window.VexExtrasCore.searchExtras(items, q, { foldFn: (s) => VexTr.fold(s), since: (opts && opts.since) || 0, limit: 50 });
  },
  async forget(id) { await VexKept.call('extraRemove', id); },

  // ---- the screen -----------------------------------------------------------------------------
  async open() {
    const { body, close } = VexKept.sheet('Remembered in Recall', 'vex-recallextra-overlay');
    const render = async () => {
      body.innerHTML = '';
      body.append(VexKept.switchRow('Remember things I add by hand in Recall', this, 'Off until you turn it on. You choose each thing: a selected text, a downloaded file\'s name, a reminder or a note. Recall search then finds it, with its type. Nothing is added by itself. It stays on this computer, apart from the pages Recall indexes, and nothing is remembered from private, Tor or burner tabs or from banking, payment, sign-in, mail or health pages.', () => render().catch(err => window.showToast?.(err.message, 'error'))));
      let list;
      try { list = await VexKept.call('extraList'); }
      catch (err) { body.append(VexKept.line(err.message)); return; }
      const L = list.limits;
      body.append(VexKept.line(VexKept.t('Using {1}. Limits: {2} things, {3} characters each and {4} in all (the oldest goes first).', VexKept.formatBytes(list.bytes), L.extras, L.extraChars, VexKept.formatBytes(L.extrasChars))));
      if (!list.items.length) body.append(VexKept.line('Nothing is remembered yet. Select text on a page and choose “Remember the Selected Text in Recall” from Ctrl+K, or use the page menu.'));
      const labels = window.VexExtrasCore.KIND_LABEL;
      for (const it of list.items.slice(0, 200)) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;padding:8px 14px;border-bottom:1px solid var(--border)';
        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0';
        const tag = document.createElement('div');
        tag.style.cssText = 'font-size:10.5px;color:var(--text-muted)';
        tag.textContent = VexKept.t(labels[it.kind]) + ' · ' + new Date(it.at).toLocaleString();
        const text = document.createElement('div');
        text.style.cssText = 'font-size:12.5px;color:var(--text);white-space:pre-wrap;word-break:break-word;max-height:4.6em;overflow:hidden';
        text.textContent = it.text;
        info.append(tag, text);
        row.append(info, VexKept.button('Forget', async () => {
          try { await this.forget(it.id); await render(); } catch (err) { window.showToast?.(err.message, 'error'); }
        }));
        body.append(row);
      }
      if (list.items.length > 200) body.append(VexKept.line(VexKept.t('Showing the newest 200 of {1}', list.items.length)));
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px';
      bar.append(
        VexKept.deleteAllButton('Delete everything remembered in Recall', {
          title: 'Delete everything you added to Recall?', message: 'Every clip, file name, reminder and note you added by hand is deleted from this computer. The pages Recall indexes are not touched. This cannot be undone.',
          channel: 'extraClear', done: () => { render().catch(err => window.showToast?.(err.message, 'error')); },
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
    VexExtras.registerCommand({ id: 'recall-extras-open', label: 'Remembered in Recall', hint: 'The clips, file names, reminders and notes you added to Recall by hand: look, forget, switch it on or off', icon: 'search', action: () => { this.open().catch(fail); } });
    VexExtras.registerCommand({ id: 'recall-remember-selection', label: 'Remember the Selected Text in Recall', hint: 'Keep the text selected on this page so Recall search finds it later, with the page it came from', icon: 'search', action: () => { this.rememberSelection().catch(fail); } });
    VexExtras.registerCommand({ id: 'recall-remember-note', label: 'Remember a Note in Recall', hint: 'Type a note that Recall search will find', icon: 'note', action: () => { this.rememberTyped('note').catch(fail); } });
    VexExtras.registerCommand({ id: 'recall-remember-reminder', label: 'Remember a Reminder in Recall', hint: 'Type a reminder that Recall search will find (it does not ring an alarm)', icon: 'clock', action: () => { this.rememberTyped('reminder').catch(fail); } });
    VexExtras.registerCommand({ id: 'recall-remember-download', label: 'Remember a Downloaded File in Recall', hint: 'Pick a finished download so Recall search finds its name', icon: 'download', action: () => { this.rememberDownload().catch(fail); } });
    return true;
  },

  init() {
    this.registerCommands();
    // The Recall panel asks for these when it searches (js/recall.js).
    if (window.Recall) window.Recall.extraHits = (q, opts) => this.hits(q, opts);
  },
};

if (typeof window !== 'undefined') {
  window.VexRecallExtras = VexRecallExtras;
  VexRecallExtras.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexRecallExtras };
