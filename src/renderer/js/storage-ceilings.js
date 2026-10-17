// === What each feature keeps, against what it may keep (T2-004) =================
//
// Every feature manifest (js/feature-manifests.js) already says which storage keys
// it owns and a storageKB budget. This page puts the two side by side so the numbers
// are visible, and carries the one cap that was a real problem: Recall's page index
// (recall.json), which is now bounded by size, page count and how long pages are kept
// (set in src/main.js, changed here), and no longer writes a second copy (.bak).
//
//   StorageCeilings.usage()        -> [{ id, title, bytes, budgetKB, over, keys }] biggest first
//   StorageCeilings.recall()       -> the index numbers from main { pages, bytes, maxBytes, retainMs ... }
//   StorageCeilings.limits()       -> { days, maxMB, maxPages } the saved Recall limits
//   StorageCeilings.setLimits(l)   -> saves them and applies them now (the oldest pages go first)
//   StorageCeilings.sendLimits()   -> told to main at start
//
// Nothing is deleted from the feature rows: a feature over its budget is shown, and its
// own page (Settings, or the feature) is where it is trimmed. Only Recall's index trims
// itself, because it is rebuilt from the pages read.
const StorageCeilings = {
  KEY: 'vex.storage.recallLimits',
  DEFAULT_LIMITS: { days: 90, maxMB: 12, maxPages: 3000 },
  RANGE: { days: [7, 3650], maxMB: [1, 64], maxPages: [100, 10000] },

  _note(what, err) { window.VexProblems?.note('Storage', what, err); },

  limits() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return { ...this.DEFAULT_LIMITS };
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The saved Recall limits could not be read', { cause: err }); }
    return { ...this.DEFAULT_LIMITS, ...(o && typeof o === 'object' ? o : {}) };
  },
  setLimits(l) {
    const next = { ...this.limits(), ...l };
    for (const k of Object.keys(this.RANGE)) {
      const [lo, hi] = this.RANGE[k];
      if (!(Number.isFinite(next[k]) && next[k] >= lo && next[k] <= hi)) throw new Error('Recall ' + ({ days: 'days kept', maxMB: 'size (MB)', maxPages: 'pages' }[k]) + ' has to be between ' + lo + ' and ' + hi);
    }
    if (!Number.isInteger(next.days) || !Number.isInteger(next.maxPages)) throw new Error('Days kept and pages have to be whole numbers');
    const clean = { days: next.days, maxMB: next.maxMB, maxPages: next.maxPages };
    localStorage.setItem(this.KEY, JSON.stringify(clean));
    return clean;
  },
  async sendLimits() {
    const b = window.vex;
    if (!b || typeof b.recallLimits !== 'function') throw new Error('Recall limits cannot be applied in this window');
    return b.recallLimits(this.limits());
  },
  async recall() {
    const b = window.vex;
    if (!b || typeof b.recallStats !== 'function') throw new Error('Recall numbers are not available in this window');
    return b.recallStats();
  },

  // Bytes held under a manifest's keys (a key ending in "." is a prefix). Counted as stored text.
  bytesOf(keys) {
    let total = 0;
    for (const k of keys) {
      if (k.endsWith('.')) {
        for (let i = 0; i < localStorage.length; i++) { const name = localStorage.key(i); if (name.startsWith(k)) total += name.length + (localStorage.getItem(name) || '').length; }
      } else {
        const v = localStorage.getItem(k);
        if (v !== null) total += k.length + v.length;
      }
    }
    return total;
  },
  usage() {
    if (typeof VexRegistry === 'undefined') throw new Error('The feature records are not loaded');
    return VexRegistry.all().map((m) => {
      const bytes = this.bytesOf(m.storageKeys);
      const budgetKB = m.budget.storageKB;
      return { id: m.id, title: m.title, bytes, budgetKB, over: bytes > budgetKB * 1024, keys: m.storageKeys.length };
    }).filter(r => r.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  },

  fmt(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'; },

  group(section) {
    const el = document.createElement('div');
    section.appendChild(el);
    const mk = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
    const draw = async () => {
      el.textContent = '';
      el.appendChild(mk('p', 'setting-info muted', 'What each feature keeps in this window\'s storage, against the budget its record gives it. A feature over its budget is shown, not trimmed: trim it where it lives.'));
      // Recall's index
      const recall = mk('div', 'storage-recall');
      el.appendChild(recall);
      try {
        const s = await this.recall();
        recall.appendChild(mk('p', 'setting-info', 'Recall index: ' + (s.pages || 0).toLocaleString() + ' pages, ' + this.fmt(s.bytes || 0) + (s.maxBytes ? ' of ' + this.fmt(s.maxBytes) : '') + (s.retainMs ? ', kept ' + Math.round(s.retainMs / 86400000) + ' days' : '') + '. No second copy is written.'));
      } catch (err) { recall.appendChild(mk('p', 'setting-info muted', err.message)); }
      let lim;
      try { lim = this.limits(); } catch (err) { el.appendChild(mk('p', 'setting-info muted', err.message)); lim = { ...this.DEFAULT_LIMITS }; }
      const row = mk('div', 'setting-toggle-row');
      const inputs = {};
      for (const [k, label, step] of [['days', 'Days kept', 1], ['maxMB', 'Size, MB', 1], ['maxPages', 'Pages', 100]]) {
        const lab = mk('label', null, label + ' ');
        const inp = mk('input'); inp.type = 'number'; inp.value = String(lim[k]); inp.step = String(step); inp.min = String(this.RANGE[k][0]); inp.max = String(this.RANGE[k][1]); inp.setAttribute('aria-label', 'Recall ' + label);
        lab.appendChild(inp); inputs[k] = inp; row.appendChild(lab);
      }
      const apply = mk('button', 'btn-secondary', 'Apply'); apply.type = 'button';
      apply.addEventListener('click', async () => {
        try {
          this.setLimits({ days: Number(inputs.days.value), maxMB: Number(inputs.maxMB.value), maxPages: Number(inputs.maxPages.value) });
          const r = await this.sendLimits();
          window.showToast?.(r && r.dropped ? 'Recall trimmed: ' + r.dropped + ' older page' + VexPlural.s(r.dropped) + ' removed' : 'Recall limits saved');
        } catch (err) { this._note('Could not apply the Recall limits', err); window.showToast?.(err.message, 'error'); }
        draw();
      });
      row.appendChild(apply);
      el.appendChild(row);
      // Features
      let rows = [];
      try { rows = this.usage(); } catch (err) { el.appendChild(mk('p', 'setting-info muted', err.message)); }
      for (const r of rows.slice(0, 25)) {
        el.appendChild(mk('div', 'setting-info' + (r.over ? '' : ' muted'), r.title + ': ' + this.fmt(r.bytes) + ' of ' + r.budgetKB + ' KB' + (r.over ? ' (over its budget)' : '')));
      }
    };
    draw();
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    // Main starts with the defaults; the saved ones are sent once the window is up.
    this.sendLimits().catch((err) => this._note('Could not send the Recall limits', err));
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.StorageCeilings = StorageCeilings;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'storage-ceilings', title: 'Storage',
      keywords: 'storage space size disk recall index cap retention days megabytes budget how much',
      before: 'about',
      build: (el) => StorageCeilings.group(el),
    });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => StorageCeilings.init());
    else StorageCeilings.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { StorageCeilings };
