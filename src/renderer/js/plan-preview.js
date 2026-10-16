// === Dry-run preview for bulk actions (T3-051) ================================
//
// A tidy-up, a bulk close or a clean-out that touches many things shows the
// list first: "this will do N things", each with a tick you can take off, and
// nothing happens until you press the button. One dialog for all of them, so
// the evening tab tidy-up, the downloads tidy-up and the bulk tab closes read
// and behave the same.
//
//   const r = await VexPlan.confirm({
//     title: 'Tidy 12 tabs?', intro: 'They go to the Library archive.',
//     items: [{ id: 't1', label: 'Some page', detail: 'idle 9 days' }, ...],
//     okLabel: 'Archive them',
//     selectable: true,             // false: the list is read-only, all or nothing
//     snapshot: async () => state,  // taken AFTER you confirm and BEFORE anything runs
//   });
//   if (r.ok) apply(r.chosen /* ids still ticked */, r.snapshot);
//
// Cancelling, Escape and closing the dialog all answer { ok: false }. If
// snapshot() throws, the answer is a rejected promise carrying its message:
// the action is not run without the safety copy it asked for.
//
// snapshotTabs(tabs) is the ready-made snapshot for actions that close tabs:
// it remembers their addresses and titles so restore() can reopen them.
const VexPlan = {
  MAX_SHOWN: 200,

  // Pure: the ids ticked, in list order.
  chosen(items, ticked) {
    const on = ticked instanceof Set ? ticked : new Set(ticked);
    return items.filter(i => on.has(i.id)).map(i => i.id);
  },

  // "Do these 12 things" wording, one place.
  countLine(n, noun = 'thing') {
    return n === 0 ? 'Nothing is ticked.' : 'This will do ' + n + ' ' + noun + (n === 1 ? '' : 's') + '.';
  },

  snapshotTabs(tabs) {
    const kept = (tabs || []).map(t => ({ url: t.url, title: t.title || '' })).filter(t => /^https?:/i.test(t.url || ''));
    return {
      count: kept.length,
      restore() {
        if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
        for (const t of kept) TabManager.createTab(t.url, false);
        return kept.length;
      },
    };
  },

  validate(opts) {
    if (!opts || typeof opts !== 'object') throw new Error('A preview needs its options');
    if (!opts.title) throw new Error('A preview needs a title');
    if (!Array.isArray(opts.items)) throw new Error('A preview needs a list of items');
    const seen = new Set();
    for (const i of opts.items) {
      if (!i || typeof i.id !== 'string' || !i.id) throw new Error('Every item in a preview needs an id');
      if (seen.has(i.id)) throw new Error('Two items in a preview share the id "' + i.id + '"');
      seen.add(i.id);
    }
  },

  // -> Promise<{ ok: false } | { ok: true, chosen: string[], snapshot: any }>
  confirm(opts) {
    this.validate(opts);
    if (typeof VexSettingsGroups === 'undefined') return Promise.reject(new Error('The platform dialog is not loaded (js/vex-settings-groups.js)'));
    const selectable = opts.selectable !== false;
    const items = opts.items;
    const ticked = new Set(items.filter(i => i.checked !== false).map(i => i.id));
    return new Promise((resolve, reject) => {
      const { body, overlay, close } = VexSettingsGroups.dialog({ id: 'vex-plan-preview', title: opts.title, sub: opts.intro || '' });
      let settled = false;
      const done = (fn, v) => { if (settled) return; settled = true; obs.disconnect(); fn(v); };
      // Closing by the X, Escape or a click outside removes the overlay: that is a cancel.
      const obs = new MutationObserver(() => { if (!overlay.isConnected) done(resolve, { ok: false }); });
      obs.observe(document.body, { childList: true });

      const count = document.createElement('div');
      count.className = 'vex-platform-note';
      count.setAttribute('role', 'status');
      const list = document.createElement('div');
      list.className = 'vexsr-list';
      list.style.cssText = 'max-height:300px;overflow-y:auto';
      const ok = VexSettingsGroups.button(opts.okLabel || 'Do it', () => {}, { primary: !opts.danger, danger: !!opts.danger });

      const refresh = () => {
        const n = selectable ? ticked.size : items.length;
        count.textContent = this.countLine(n, opts.noun || 'thing');
        ok.disabled = n === 0;
      };
      items.slice(0, this.MAX_SHOWN).forEach(i => {
        const row = document.createElement('label');
        row.className = 'vexsr-rule';
        if (selectable) {
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = ticked.has(i.id);
          box.setAttribute('aria-label', i.label);
          box.addEventListener('change', () => { if (box.checked) ticked.add(i.id); else ticked.delete(i.id); refresh(); });
          row.appendChild(box);
        }
        const name = document.createElement('span');
        name.className = 'vexsr-host';
        name.textContent = i.label;
        row.appendChild(name);
        if (i.detail) {
          const d = document.createElement('span');
          d.className = 'vexsr-mode';
          d.textContent = i.detail;
          row.appendChild(d);
        }
        list.appendChild(row);
      });
      if (items.length > this.MAX_SHOWN) list.appendChild(VexSettingsGroups.note('... and ' + (items.length - this.MAX_SHOWN) + ' more' + (selectable ? ' (they stay ticked)' : '') + '.'));

      ok.addEventListener('click', async () => {
        ok.disabled = true;
        let snap = null;
        try {
          if (typeof opts.snapshot === 'function') snap = await opts.snapshot(this.chosen(items, ticked));
        } catch (err) {
          obs.disconnect();
          close();
          done(reject, new Error('Nothing was changed: the safety copy could not be made (' + ((err && err.message) || err) + ')'));
          return;
        }
        obs.disconnect();
        close();
        done(resolve, { ok: true, chosen: selectable ? this.chosen(items, ticked) : items.map(i => i.id), snapshot: snap });
      });
      const cancel = VexSettingsGroups.button(opts.cancelLabel || 'Not now', () => { close(); });
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:6px;margin-top:10px';
      bar.append(ok, cancel);
      body.append(count, list, bar);
      refresh();
      (items.length ? ok : cancel).focus({ preventScroll: true });
    });
  },
};

if (typeof window !== 'undefined') window.VexPlan = VexPlan;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPlan };
