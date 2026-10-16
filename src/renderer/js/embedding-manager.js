// === Embedding model manager (T2-021) =========================================
//
// Recall (search history by meaning) and the knowledge base (search what you
// keep by meaning) both need one small "embedding" model in your own Ollama.
// Until now that meant a terminal (`ollama pull nomic-embed-text`) and typing
// the name into Settings › Recall; with none, both fall back to plain keyword
// search and nothing said so. This section is the guided way:
//
//   - a short list of suitable models with their rough download size, and
//     which are already installed;
//   - Install (asks first, shows progress, can be stopped), Use this one
//     (asks first: another model empties the stored numbers and they are
//     rebuilt in the background), Turn meaning search off;
//   - what is in use right now: which model, how many pages / kept items are
//     understood, what the index takes on disk, which features use it;
//   - the fallback, in words.
//
// It uses the same setting Recall already has (Recall.setMeaningModel, key
// vex.recall.meaningModel); it keeps no setting of its own except the switch for
// this section. Models are pulled by YOUR Ollama from its own library; page
// text never leaves this PC. Sizes are the sizes Ollama lists, rounded; the
// installed size shown is read from Ollama.
//
// Pure helpers (catalog, matching, lines) are tested directly
// (tests/renderer/embeddingManager.test.js).

const VexEmbedManager = {
  FEATURE: 'embedding-manager',
  KEY_ENABLED: 'vex.embedManager.enabled',

  // [name, about MB, one line]. Rough sizes of the Ollama downloads.
  CATALOG: [
    { name: 'nomic-embed-text', mb: 274, note: 'The usual choice. Good for English text and notes.' },
    { name: 'all-minilm', mb: 46, note: 'Tiny and quick. Weaker on long pages.' },
    { name: 'mxbai-embed-large', mb: 670, note: 'More accurate for English; slower and bigger.' },
    { name: 'bge-m3', mb: 1200, note: 'Many languages at once, Turkish included. Biggest.' },
  ],
  USED_BY: [
    { id: 'recall', label: 'Recall: finding a page you read by what it was about' },
    { id: 'knowledge-base', label: 'Knowledge base: search and "ask my library" over what you keep' },
    { id: 'ask-tabs', label: 'Ask across my tabs, when it also uses your library' },
  ],
  FALLBACK: 'With no embedding model, Recall and the knowledge base use keyword search only: they still work, but a page is found only by words it contains.',

  enabled() { try { return localStorage.getItem(this.KEY_ENABLED) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.KEY_ENABLED, on ? 'on' : 'off'); }
    catch (err) { throw new Error('The setting could not be saved: ' + err.message, { cause: err }); }
  },

  // ---- pure helpers ---------------------------------------------------------------
  sameModel(a, b) {
    const norm = (x) => String(x || '').trim().toLowerCase().replace(/:latest$/, '');
    return !!norm(a) && norm(a) === norm(b);
  },
  sizeText(mb) { return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB'; },

  // installed: [{ name, size }] from Ollama. -> catalog rows with their state.
  rows(installed, current) {
    const have = Array.isArray(installed) ? installed : [];
    const rows = this.CATALOG.map(c => {
      const hit = have.find(m => this.sameModel(m.name, c.name));
      return { ...c, installed: !!hit, installedBytes: hit ? hit.size : 0, active: this.sameModel(current, c.name) };
    });
    // A model the person set by hand that is not in the list is still shown.
    if (current && !rows.some(r => r.active)) {
      const hit = have.find(m => this.sameModel(m.name, current));
      rows.push({ name: current, mb: hit && hit.size ? hit.size / 1048576 : 0, note: 'Set by hand in Settings › Recall.', installed: !!hit, installedBytes: hit ? hit.size : 0, active: true, custom: true });
    }
    return rows;
  },

  // One sentence on the state of meaning search.
  statusLine(current, installed, recallStatus) {
    if (!current) return 'Meaning search is off. ' + this.FALLBACK;
    const have = (installed || []).some(m => this.sameModel(m.name, current));
    if (!have) return 'The model "' + current + '" is set but is not installed in Ollama, so searches use keywords only until it is. Install it below.';
    if (!recallStatus) return 'Using "' + current + '".';
    const understood = recallStatus.understood || 0, pages = recallStatus.pages || 0;
    const left = Math.max(0, pages - understood);
    let line = 'Using "' + current + '": ' + understood.toLocaleString() + ' of ' + pages.toLocaleString() + ' pages understood';
    if (left) line += ', ' + left.toLocaleString() + ' to go (done in the background while Vex is idle and no game is running)';
    return line + '.';
  },

  // ---- reading the state ---------------------------------------------------------------
  async state() {
    const out = { ok: false, installed: [], current: '', recall: null, kb: null, error: null };
    out.current = (typeof Recall !== 'undefined' && Recall.meaningModel) ? Recall.meaningModel() : '';
    if (typeof Ollama === 'undefined') { out.error = 'Ollama support is not loaded.'; return out; }
    if (!(await Ollama.ping())) { out.error = 'Ollama is not running. Start it from Settings › AI, then come back.'; return out; }
    out.ok = true;
    out.installed = await Ollama.listModels();
    if (typeof Recall !== 'undefined' && Recall.meaningStatus) out.recall = await Recall.meaningStatus();
    if (typeof Knowledge !== 'undefined' && Knowledge.enabled && Knowledge.enabled()) {
      try { out.kb = await Knowledge.status(); } catch (err) { out.kbError = err.message; }
    }
    return out;
  },

  // ---- actions ----------------------------------------------------------------------------------
  async install(row, { onProgress, signal } = {}) {
    if (typeof Ollama === 'undefined') throw new Error('Ollama support is not loaded.');
    if (typeof vexConfirm !== 'function') throw new Error('Vex could not ask you, so nothing was downloaded.');
    const ok = await vexConfirm({
      title: 'Download ' + row.name + '?',
      message: 'Your Ollama will download about ' + this.sizeText(row.mb) + ' from its own model library. Search by meaning stays off until you press "Use this one". You can stop the download at any time.',
      okLabel: 'Download',
    });
    if (!ok) return false;
    await Ollama.pullModel(row.name, onProgress, signal);
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    return true;
  },

  async use(row) {
    if (typeof Recall === 'undefined' || !Recall.setMeaningModel) throw new Error('Recall is not available here.');
    if (!row.installed) throw new Error('Install ' + row.name + ' first.');
    const current = Recall.meaningModel();
    if (this.sameModel(current, row.name)) return false;
    if (typeof vexConfirm !== 'function') throw new Error('Vex could not ask you, so nothing was changed.');
    const ok = await vexConfirm({
      title: 'Use ' + row.name + ' for search by meaning?',
      message: current
        ? 'The numbers stored for "' + current + '" cannot be used by another model, so they are deleted and rebuilt in the background while Vex is idle. Until then searches use keywords.'
        : 'Pages and kept items are understood a few at a time in the background while Vex is idle and no game is running. Until then searches use keywords.',
      okLabel: 'Use it',
    });
    if (!ok) return false;
    Recall.setMeaningModel(row.name);
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    return true;
  },

  async turnOff() {
    if (typeof Recall === 'undefined' || !Recall.setMeaningModel) throw new Error('Recall is not available here.');
    if (typeof vexConfirm !== 'function') throw new Error('Vex could not ask you, so nothing was changed.');
    const ok = await vexConfirm({ title: 'Turn search by meaning off?', message: this.FALLBACK + ' Nothing is deleted from Ollama.', okLabel: 'Turn off' });
    if (!ok) return false;
    Recall.setMeaningModel('');
    return true;
  },

  // ---- the Settings section ------------------------------------------------------------------------
  async render(host) {
    host.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    if (!this.enabled()) {
      host.appendChild(VexSettingsGroups.note('This helper is switched off. Search by meaning keeps working with the model already chosen in Settings › Recall.'));
      host.appendChild(VexSettingsGroups.button('Switch it on', () => { try { this.setEnabled(true); } catch (err) { window.showToast?.(err.message, 'error'); } this.render(host); }));
      return;
    }
    host.appendChild(VexSettingsGroups.note('Search by meaning (Recall and the knowledge base) needs one small embedding model in your own Ollama. Pick one here; Vex asks before downloading anything.'));
    const statusEl = el('div', 'vex-platform-note', 'Reading Ollama…');
    statusEl.setAttribute('role', 'status');
    host.appendChild(statusEl);
    const list = el('div'); host.appendChild(list);
    const prog = el('div', 'vex-platform-note'); prog.hidden = true; prog.setAttribute('role', 'status'); host.appendChild(prog);
    const usedBy = el('div', 'vex-platform-note');
    usedBy.textContent = 'Used by: ' + this.USED_BY.map(u => u.label).join('; ') + '.';
    host.appendChild(usedBy);
    let s;
    try { s = await this.state(); } catch (err) { statusEl.textContent = 'Could not read Ollama: ' + err.message; return; }
    if (!s.ok) { statusEl.textContent = s.error + ' ' + this.FALLBACK; return; }
    statusEl.textContent = this.statusLine(s.current, s.installed, s.recall);
    if (s.kb) {
      const kb = el('div', 'vex-platform-note', 'Knowledge base index: ' + (typeof Knowledge !== 'undefined' ? Knowledge.statusLine(s.kb) : '') + '.');
      host.insertBefore(kb, usedBy);
    }
    if (s.recall && s.recall.configured && s.recall.bytes) host.insertBefore(el('div', 'vex-platform-note', 'Recall numbers on disk: ' + (typeof Recall !== 'undefined' ? Recall.formatBytes(s.recall.bytes) : s.recall.bytes + ' bytes') + '.'), usedBy);
    const redraw = () => this.render(host);
    for (const r of this.rows(s.installed, s.current)) {
      const row = el('div', 'vex-embed-row');
      row.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border)';
      const info = el('div'); info.style.cssText = 'flex:1;min-width:200px';
      info.appendChild(el('div', null, r.name + (r.active ? ' (in use)' : '')));
      const sub = el('div', 'vex-platform-note', (r.mb ? 'about ' + this.sizeText(r.mb) + ' · ' : '') + r.note + (r.installed ? ' · installed' : ''));
      info.appendChild(sub);
      row.appendChild(info);
      if (!r.installed) {
        row.appendChild(VexSettingsGroups.button('Download', async () => {
          const ctl = new AbortController();
          prog.hidden = false; prog.textContent = 'Starting…';
          const stop = VexSettingsGroups.button('Stop', () => ctl.abort());
          host.insertBefore(stop, usedBy);
          try {
            const did = await this.install(r, { signal: ctl.signal, onProgress: (e) => {
              const pct = e.total ? Math.round((e.completed || 0) / e.total * 100) : null;
              prog.textContent = (e.status || 'working') + (pct != null ? ' — ' + pct + '%' : '');
            } });
            if (did) window.showToast?.(r.name + ' is installed. Press "Use this one" to turn search by meaning on.');
          } catch (err) {
            if (!ctl.signal.aborted) { window.showToast?.('Could not download it: ' + err.message, 'error'); VexProblems?.note('Embedding models', 'Could not download ' + r.name, err); }
            else window.showToast?.('Download stopped');
          }
          stop.remove();
          redraw();
        }));
      } else if (!r.active) {
        row.appendChild(VexSettingsGroups.button('Use this one', async () => {
          try { if (await this.use(r)) window.showToast?.('Search by meaning will use ' + r.name); }
          catch (err) { window.showToast?.(err.message, 'error'); }
          redraw();
        }, { primary: true }));
      } else {
        row.appendChild(VexSettingsGroups.button('Turn off', async () => {
          try { if (await this.turnOff()) window.showToast?.('Search by meaning is off'); }
          catch (err) { window.showToast?.(err.message, 'error'); }
          redraw();
        }));
      }
      list.appendChild(row);
    }
    host.insertBefore(VexSettingsGroups.note(this.FALLBACK), usedBy);
  },
};

if (typeof window !== 'undefined') window.VexEmbedManager = VexEmbedManager;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexEmbedManager };
if (typeof VexSettingsGroups !== 'undefined') {
  VexSettingsGroups.register({ id: 'embedding-manager', title: 'Search by meaning (embedding model)', keywords: 'embedding model ollama recall knowledge base nomic meaning semantic download', render: (el) => { VexEmbedManager.render(el).catch((err) => { el.textContent = 'This section could not be shown: ' + err.message; }); } });
}
