// === Tab roulette ===========================================================
//
// "Pick one of my Read Later pages for me." One unread saved page, chosen at
// random, with a way to say "not that one" and get another. Nothing is opened
// until you press Open; nothing is marked read by looking.
//
//   VexRoulette.pick(items, { skip, rng })   pure: one item or null; never one
//                                            whose id is in `skip`
//   VexRoulette.open()                       the dialog (Ctrl+K: "Pick a page")
//   VexRoulette.candidates()                 the unread Read Later items
//
// Local only: reads ReadLater.items (the Library's queue) and opens the page
// through ReadLater.open, which is what the list itself does. Silent about
// "you have N left": the dialog says how many there are once, in plain words.
const VexRoulette = {
  pick(items, opts) {
    const o = opts || {};
    const skip = o.skip instanceof Set ? o.skip : new Set(o.skip || []);
    const rng = typeof o.rng === 'function' ? o.rng : Math.random;
    const pool = (Array.isArray(items) ? items : []).filter(i => i && i.id != null && !i.read && !skip.has(String(i.id)));
    if (!pool.length) return null;
    const r = rng();
    if (!(r >= 0 && r < 1)) throw new Error('The random source must answer from 0 up to, not including, 1');
    return pool[Math.floor(r * pool.length)];
  },

  candidates() {
    if (typeof ReadLater === 'undefined' || !Array.isArray(ReadLater.items)) throw new Error('Read Later is not loaded');
    return ReadLater.items.filter(i => !i.read);
  },

  _host(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  },

  // A session of rolls: remembers what you passed on so "not that one" never
  // comes straight back. When every page has been passed on, it says so and
  // starts over rather than going quiet.
  session(deps) {
    const d = deps || {};
    const get = d.candidates || (() => this.candidates());
    const rng = d.rng || Math.random;
    const skipped = new Set();
    const self = {
      skipped,
      current: null,
      next() {
        const all = get();
        let it = VexRoulette.pick(all, { skip: skipped, rng });
        let wrapped = false;
        if (!it && all.length) {
          skipped.clear();
          wrapped = true;
          it = VexRoulette.pick(all, { skip: skipped, rng });
        }
        self.current = it;
        return { item: it, wrapped, total: all.length };
      },
      pass() {
        if (self.current) skipped.add(String(self.current.id));
        return self.next();
      },
    };
    return self;
  },

  open() {
    if (typeof VexExpression === 'undefined') throw new Error('The expression helpers are not loaded');
    const X = VexExpression;
    const s = this.session();
    const first = s.next();
    if (!first.item) { X.toast('Nothing waiting in Read Later'); return null; }
    const dlg = X.dialog('Something to read');
    const draw = (res) => {
      const it = res.item;
      if (!it) { dlg.close(); X.toast('Nothing waiting in Read Later'); return; }
      const mins = it.minutes ? it.minutes + ' min' : '';
      const age = typeof ReadLater !== 'undefined' && ReadLater.describeAge ? 'saved ' + ReadLater.describeAge(it.at) : '';
      const meta = [this._host(it.url), mins, age].filter(Boolean).join(' · ');
      dlg.body.innerHTML = `
        <div style="font-size:14px;font-weight:600;margin-bottom:4px;overflow-wrap:anywhere" data-r-title>${X.esc(it.title || it.url)}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px" data-r-meta>${X.esc(meta)}</div>
        ${res.wrapped ? '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">That was all of them, so here they come round again.</div>' : ''}
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button type="button" class="btn-primary" data-r-open>Open it</button>
          <button type="button" class="btn-secondary" data-r-pass>Not that one</button>
          <button type="button" class="btn-secondary" data-r-close style="margin-left:auto">Close</button>
        </div>`;
      dlg.body.querySelector('[data-r-open]').addEventListener('click', () => {
        const cur = s.current;
        dlg.close();
        try {
          if (typeof ReadLater === 'undefined') throw new Error('Read Later is not loaded');
          ReadLater.open(cur);
          X.signal('roulette-first');
        } catch (err) { X.toast('Could not open it: ' + err.message, 'error'); }
      });
      dlg.body.querySelector('[data-r-pass]').addEventListener('click', () => draw(s.pass()));
      dlg.body.querySelector('[data-r-close]').addEventListener('click', () => dlg.close());
      const btn = dlg.body.querySelector('[data-r-open]');
      if (btn) btn.focus();
    };
    draw(first);
    return dlg;
  },

  commands: [
    {
      id: 'roulette', label: 'Pick a Read Later Page for Me',
      hint: 'One unread page you saved, chosen at random; say "not that one" for another',
      icon: 'shuffle',
      action: () => { try { VexRoulette.open(); } catch (err) { window.showToast?.(err.message, 'error'); } },
    },
  ],
};

if (typeof window !== 'undefined') window.VexRoulette = VexRoulette;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexRoulette };
