// === Datasets from pages =======================================================
//
// "Copy a table or list from this page" (js/table-extract.js) hands a table over and forgets it. This lets the person
// KEEP it: a named dataset on this computer (columns worked out from the table, rows capped at 5,000 and 5 MB each, at
// most 50 datasets), that more rows can be added to later (rows whose key column is already there are left out),
// that can be looked at, filtered and sorted here, and saved as CSV (UTF-8 with a byte-order mark, a cell that a
// spreadsheet would run as a formula gets a leading quote mark) or JSON. A page watch can add one row to a dataset
// each time it sees a change (the watch's own change detection; nothing new polls).
//
// OFF until the person turns it on (vex.keptDatasets.enabled). Nothing is kept from a private, Tor, routed or
// container tab, nor from a banking, payment, sign-in, mail or health page, nor leaves this computer. The files are
// main's (src/main/evodata-datasets-store.js, in <userData>/kept-pages/datasets); this is the window onto them.
// "Delete everything kept as datasets" removes every file there.
const VexKeptDatasets = {
  PREF_KEY: 'vex.keptDatasets.enabled',
  SHOW_ROWS: 300,
  enabled() { try { return localStorage.getItem(this.PREF_KEY) === 'true'; } catch { return false; } },
  setEnabled(on) { localStorage.setItem(this.PREF_KEY, on ? 'true' : 'false'); },

  // Why the person can not use datasets right now, or '' (the switch).
  offReason() { return this.enabled() ? '' : 'Datasets are switched off. Turn them on in Datasets from pages.'; },

  // ---- keeping a table -----------------------------------------------------------
  // data: { rows, caption } from TableExtract. Asks for a name, whether the first row is the header and the key column.
  async keep(data, wv, closeAfter) {
    const off = this.offReason();
    if (off) throw new Error(off);
    const why = VexKept.refusal(wv);
    if (why) throw new Error(why);
    const C = window.VexEvoCore;
    const { body, close } = VexKept.sheet('Keep this table as a dataset', 'vex-keptds-new');
    const form = document.createElement('div');
    form.style.cssText = 'display:grid;gap:10px;padding:12px 14px';
    const field = (label, el) => { const w = document.createElement('label'); w.style.cssText = 'display:grid;gap:3px;font-size:11.5px;color:var(--text-muted)'; w.append(document.createTextNode(label), el); return w; };
    const name = document.createElement('input');
    name.type = 'text'; name.className = 'set-input'; name.maxLength = C.LIMITS.nameChars;
    let pageTitle = '';
    try { pageTitle = (wv && wv.getTitle && wv.getTitle()) || ''; } catch { pageTitle = ''; }
    name.value = (data.caption || pageTitle || '').slice(0, C.LIMITS.nameChars);
    const headerBox = document.createElement('input');
    headerBox.type = 'checkbox';
    headerBox.checked = C.inferColumns(data.rows, { header: 'auto' }).header;
    const headerRow = document.createElement('label');
    headerRow.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:12px;color:var(--text)';
    headerRow.append(headerBox, document.createTextNode('First row is the header'));
    const keySel = document.createElement('select');
    keySel.className = 'set-input';
    const summary = VexKept.line('', true);
    summary.style.padding = '0';
    const refresh = () => {
      const inferred = C.inferColumns(data.rows, { header: headerBox.checked });
      const keep = keySel.value;
      keySel.innerHTML = '';
      keySel.append(new Option('No key column (identical rows are kept once)', ''));
      for (const c of inferred.columns) keySel.append(new Option(c.name, c.name));
      if ([...keySel.options].some(o => o.value === keep)) keySel.value = keep;
      summary.textContent = VexKept.t('Rows: {1} · Columns: {2}', inferred.body.length, inferred.columns.length);
    };
    headerBox.addEventListener('change', refresh);
    refresh();
    const status = VexKept.line('', true);
    status.style.padding = '0';
    status.setAttribute('role', 'status');
    const go = VexKept.button('Keep', async () => {
      try {
        const r = await VexKept.call('datasetCreate', {
          name: name.value, rows: data.rows, header: headerBox.checked, keyColumn: keySel.value || undefined,
          source: { url: window.vexGuestUrl(wv), title: pageTitle },
        });
        window.showToast?.(VexKept.t(r.capped ? 'Kept. Rows: {1}. Identical rows left out: {2}. Not kept because the dataset is full: {3}' : 'Kept. Rows: {1}. Identical rows left out: {2}', r.rows, r.duplicates, r.capped));
        if (typeof VexUsage !== 'undefined') VexUsage.touch('kept-datasets');
        close();
        if (typeof closeAfter === 'function') closeAfter();
      } catch (err) { status.textContent = err.message; }
    });
    const cancel = VexKept.button('Cancel', () => close());
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px';
    bar.append(go, cancel);
    form.append(field('Name', name), headerRow, field('Key column (rows with the same key are kept once)', keySel), summary, bar, status);
    body.append(form);
    name.focus();
  },

  // Add this page's rows to a dataset already kept. The page's own header row, when it comes again, is left out.
  async addTo(data, wv, closeAfter) {
    const off = this.offReason();
    if (off) throw new Error(off);
    const why = VexKept.refusal(wv);
    if (why) throw new Error(why);
    const list = await VexKept.call('datasetList');
    if (!list.items.length) throw new Error('No datasets yet. Point at a table on a page and choose “Keep as a dataset”.');
    const { body, close } = VexKept.sheet('Add rows to a dataset', 'vex-keptds-add');
    const form = document.createElement('div');
    form.style.cssText = 'display:grid;gap:10px;padding:12px 14px';
    const pick = document.createElement('select');
    pick.className = 'set-input';
    for (const m of list.items) pick.append(new Option(m.name, m.id));
    const keySel = document.createElement('select');
    keySel.className = 'set-input';
    const fillKeys = () => {
      const m = list.items.find(x => x.id === pick.value);
      keySel.innerHTML = '';
      keySel.append(new Option(m && m.keyColumn ? VexKept.t('The dataset\'s own key ({1})', m.keyColumn) : 'The dataset\'s own key (none: identical rows are kept once)', ''));
      keySel.append(new Option('No key column (identical rows are kept once)', ''));
      for (const c of (m ? m.columns : [])) keySel.append(new Option(c, c));
    };
    pick.addEventListener('change', fillKeys);
    fillKeys();
    const field = (label, el) => { const w = document.createElement('label'); w.style.cssText = 'display:grid;gap:3px;font-size:11.5px;color:var(--text-muted)'; w.append(document.createTextNode(label), el); return w; };
    const status = VexKept.line('', true);
    status.style.padding = '0';
    status.setAttribute('role', 'status');
    const go = VexKept.button('Add rows', async () => {
      try {
        // The first choice is the dataset's own key: nothing is sent, so main keeps it.
        const key = keySel.selectedIndex === 0 ? undefined : keySel.value;
        const r = await VexKept.call('datasetAppend', pick.value, data.rows, key);
        window.showToast?.(VexKept.t(r.capped ? 'Added: {1}. Already there: {2}. Not added because the dataset is full: {3}' : 'Added: {1}. Already there: {2}', r.added, r.skipped, r.capped));
        close();
        if (typeof closeAfter === 'function') closeAfter();
      } catch (err) { status.textContent = err.message; }
    });
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px';
    bar.append(go, VexKept.button('Cancel', () => close()));
    form.append(field('Dataset', pick), field('Key column (rows with the same key are kept once)', keySel), bar, status);
    body.append(form);
  },

  // Ctrl+K: point at a table on the page in front and keep it.
  async keepFromPage() {
    const off = this.offReason();
    if (off) throw new Error(off);
    const wv = VexKept.activeWebview();
    const why = VexKept.refusal(wv);
    if (why) throw new Error(why);
    if (!window.TableExtract) throw new Error('Reading tables is not available');
    const data = await window.TableExtract.read(wv);
    await this.keep(data, wv);
  },

  // ---- a page watch fills a dataset ------------------------------------------------
  WATCH_COLUMNS: ['Captured at', 'Value', 'What changed'],

  // Page watch's "vex:page-watch-snapshot" (the first look and every change it already detects): one row for every dataset
  // linked to that watch. Nothing here asks the page again.
  async onSnapshot(detail) {
    if (!this.enabled() || !detail || !detail.watchId) return;
    const value = detail.kind === 'text' ? (detail.first ? 'first look' : 'changed') : String(detail.value == null ? '' : detail.value).slice(0, 300);
    const row = [new Date(detail.at).toISOString(), value, String(detail.why || detail.summary || '').slice(0, 300)];
    await VexKept.call('datasetAppendWatch', detail.watchId, row);
  },

  // A new dataset that a page watch fills. The first row is the value the watch holds now.
  async newForWatch() {
    const off = this.offReason();
    if (off) throw new Error(off);
    if (typeof PageWatch === 'undefined') throw new Error('Page watching is not available');
    const watches = PageWatch.list().filter(w => !VexKept.sensitive(w.url));
    if (!watches.length) throw new Error('No page watch can fill a dataset yet. Watch a page first (pages that are left alone, like a bank, are not listed).');
    const { body, close } = VexKept.sheet('A dataset that a page watch fills', 'vex-keptds-watch');
    const form = document.createElement('div');
    form.style.cssText = 'display:grid;gap:10px;padding:12px 14px';
    const pick = document.createElement('select');
    pick.className = 'set-input';
    for (const w of watches) pick.append(new Option(w.title || w.url, w.id));
    const note = VexKept.line('A row is added each time the watch sees a change, with the time and the value. The watch itself is not changed.', true);
    note.style.padding = '0';
    const status = VexKept.line('', true);
    status.style.padding = '0';
    const go = VexKept.button('Create the dataset', async () => {
      try {
        const w = watches.find(x => x.id === pick.value);
        await VexKept.call('datasetCreate', {
          name: (w.title || w.url).slice(0, 70) + ' (changes)', rows: [this.WATCH_COLUMNS], header: true, allowEmpty: true, watchId: w.id,
          source: { url: w.url, title: w.title || '' },
        });
        window.showToast?.('Created. A row is added each time the watch sees a change.');
        close();
      } catch (err) { status.textContent = err.message; }
    });
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px';
    bar.append(go, VexKept.button('Cancel', () => close()));
    form.append(pick, note, bar, status);
    body.append(form);
  },

  // ---- looking at one dataset ---------------------------------------------------------
  async view(id) {
    const C = window.VexEvoCore;
    const { dataset } = await VexKept.call('datasetGet', id);
    const { body } = VexKept.sheet(dataset.name, 'vex-keptds-view');
    const state = { filter: '', col: -1, desc: false };
    const top = document.createElement('div');
    top.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--border)';
    const input = document.createElement('input');
    input.type = 'search'; input.className = 'set-input'; input.style.flex = '1';
    input.placeholder = 'Filter rows'; input.setAttribute('aria-label', 'Filter rows');
    top.append(input);
    const info = VexKept.line('', true);
    info.setAttribute('role', 'status');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'overflow:auto;max-height:52vh';
    const table = document.createElement('table');
    table.style.cssText = 'border-collapse:collapse;font-size:12px;color:var(--text);min-width:100%';
    wrap.append(table);
    body.append(top, info, wrap);
    const cell = 'padding:4px 10px;border-bottom:1px solid var(--border);text-align:left;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis';
    const draw = () => {
      const idx = C.view(dataset, {
        filter: state.filter, sortColumn: state.col, descending: state.desc,
        foldFn: (s) => VexTr.fold(s), compare: (a, b) => VexTr.compare(a, b),
      });
      table.innerHTML = '';
      const head = table.createTHead().insertRow();
      dataset.columns.forEach((c, i) => {
        const th = document.createElement('th');
        th.style.cssText = cell + ';font-weight:650;position:sticky;top:0;background:var(--bg);cursor:pointer';
        th.textContent = c.name; th.title = 'Sort by this column'; th.tabIndex = 0;
        th.setAttribute('aria-sort', state.col === i ? (state.desc ? 'descending' : 'ascending') : 'none');
        const sort = () => { if (state.col === i) state.desc = !state.desc; else { state.col = i; state.desc = false; } draw(); };
        th.addEventListener('click', sort);
        th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
        head.append(th);
      });
      const tb = table.createTBody();
      for (const i of idx.slice(0, this.SHOW_ROWS)) {
        const tr = tb.insertRow();
        dataset.rows[i].forEach((v) => { const td = tr.insertCell(); td.style.cssText = cell; td.textContent = v; td.title = v; });
      }
      info.textContent = VexKept.t('Showing {1} of {2} rows', Math.min(idx.length, this.SHOW_ROWS), idx.length)
        + (state.col >= 0 ? '. ' + VexKept.t(state.desc ? 'Sorted by {1} (descending)' : 'Sorted by {1} (ascending)', dataset.columns[state.col].name) : '');
    };
    input.addEventListener('input', () => { state.filter = input.value; draw(); });
    draw();
  },

  // ---- the screen ------------------------------------------------------------------------
  async open() {
    const { body, close } = VexKept.sheet('Datasets from pages', 'vex-keptds-overlay');
    const render = async () => {
      body.innerHTML = '';
      body.append(VexKept.switchRow('Keep tables from pages as datasets', this, 'Off until you turn it on. A dataset is a table you chose to keep, saved on this computer only and never sent anywhere. Nothing is kept from private, Tor or burner tabs, or from banking, payment, sign-in, mail or health pages.', () => render().catch(err => window.showToast?.(err.message, 'error'))));
      let list;
      try { list = await VexKept.call('datasetList'); }
      catch (err) { body.append(VexKept.line(err.message)); return; }
      const L = list.limits;
      body.append(VexKept.line(VexKept.t('Using {1}. Limits: {2} datasets, {3} rows and {4} for each dataset. A full dataset refuses new rows; nothing old is dropped.', VexKept.formatBytes(list.bytes), L.datasets, L.rows, VexKept.formatBytes(L.bytes))));
      if (!list.items.length) body.append(VexKept.line('No datasets yet. Point at a table on a page and choose “Keep as a dataset”.'));
      const watchName = (wid) => { try { const w = typeof PageWatch !== 'undefined' ? PageWatch.list().find(x => x.id === wid) : null; return w ? (w.title || w.url) : ''; } catch { return ''; } };
      for (const m of list.items) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--border)';
        const label = document.createElement('div');
        label.style.cssText = 'flex:1;min-width:180px';
        const nm = document.createElement('div');
        nm.style.cssText = 'font-size:12.5px;color:var(--text);font-weight:600';
        nm.textContent = m.name;
        const sub = document.createElement('div');
        sub.style.cssText = 'font-size:11px;color:var(--text-muted)';
        sub.textContent = [VexKept.t('Rows: {1} · Columns: {2}', m.rowCount, m.columns.length), VexKept.formatBytes(m.bytes)]
          .concat(m.keyColumn ? [VexKept.t('Key: {1}', m.keyColumn)] : [], m.watchId ? [watchName(m.watchId) ? VexKept.t('Recording a page watch: {1}', watchName(m.watchId)) : 'Recording a page watch'] : []).join(' · ');
        label.append(nm, sub);
        const act = (text, fn) => VexKept.button(text, async () => { try { await fn(); } catch (err) { window.showToast?.(err.message, 'error'); } });
        const exportAs = (format) => async () => {
          const r = await VexKept.call('datasetExport', m.id, format);
          if (!r.cancelled) window.showToast?.(VexKept.t('Saved: {1}', r.path));
        };
        row.append(label, act('Open', () => this.view(m.id)), act('CSV', exportAs('csv')), act('CSV (semicolon)', exportAs('csv-semicolon')), act('JSON', exportAs('json')));
        if (m.watchId) row.append(act('Stop recording', async () => { await VexKept.call('datasetSetWatch', m.id, null); await render(); }));
        row.append(act('Delete', async () => {
          const ok = await window.vexConfirm({ title: 'Delete this dataset?', message: VexKept.t('“{1}” and its rows are deleted from this computer. This cannot be undone.', m.name), okLabel: 'Delete', danger: true });
          if (!ok) return;
          await VexKept.call('datasetDelete', m.id);
          await render();
        }));
        body.append(row);
      }
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px';
      bar.append(
        VexKept.button('A dataset that a page watch fills…', () => this.newForWatch().catch(err => window.showToast?.(err.message, 'error'))),
        VexKept.deleteAllButton('Delete everything kept as datasets', {
          title: 'Delete all datasets?', message: 'Every dataset and all of its rows are deleted from this computer. This cannot be undone.',
          channel: 'datasetClear', done: () => { render().catch(err => window.showToast?.(err.message, 'error')); },
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
    VexExtras.registerCommand({ id: 'datasets-open', label: 'Datasets from Pages', hint: 'The tables you kept from pages: look, filter, sort, save as CSV or JSON, switch it on or off', icon: 'table', runsWhenOff: true, action: () => { this.open().catch(fail); } });
    VexExtras.registerCommand({ id: 'dataset-keep', label: 'Keep a Table from This Page as a Dataset', hint: 'Click a table on the page and keep it on this computer, to add to and save as CSV later', icon: 'table', action: () => { this.keepFromPage().catch(fail); } });
    return true;
  },

  init() {
    this.registerCommands();
    document.addEventListener('vex:page-watch-snapshot', (e) => {
      this.onSnapshot(e.detail).catch(err => window.VexProblems?.note('Datasets', 'Could not add a row for a page watch', err));
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexKeptDatasets = VexKeptDatasets;
  VexKeptDatasets.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexKeptDatasets };
