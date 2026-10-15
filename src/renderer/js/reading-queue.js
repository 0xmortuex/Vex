// === Reading queue with time ================================================
//
// Read Later (js/readlater.js) already keeps the links and works out how long
// each takes ("6 min"). This adds the three things a queue needs to be used:
//
//   "I have 20 minutes"   picks the unread links that fit, as full as it can
//                         get without going over, oldest first when it is a tie
//   finished              opening a link is not reading it; "Finished" is its
//                         own mark (item.finishedAt) and is what the week's
//                         tally counts
//   missing times         links saved before their length was measured can be
//                         measured now, a few at a time, from your own click
//
// It reads and writes ReadLater.items through ReadLater.save(), so the
// Library panel, the badge and a second window's delta-merge all stay right.
const ReadingQueue = {
  WORDS_PER_MINUTE: 220,
  MAX_BUDGET: 600,
  MEASURE_BATCH: 5,

  // ---- pure ---------------------------------------------------------------
  estimateMinutes(text) {
    const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean).length;
    return words ? Math.max(1, Math.round(words / this.WORDS_PER_MINUTE)) : 0;
  },

  // "I have 20 minutes", "got half an hour", "an hour", "1h 30" → minutes or 0.
  parseMinutes(text) {
    const s = String(text == null ? '' : text).toLowerCase();
    let m;
    if ((m = s.match(/\b(\d{1,2})\s*(?:h|hr|hrs|hours?)\s*(?:and\s*)?(\d{1,2})\s*(?:m|min|mins|minutes?)?\b/))) return Number(m[1]) * 60 + Number(m[2]);
    if ((m = s.match(/\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/))) return Math.round(Number(m[1]) * 60);
    if ((m = s.match(/\b(\d{1,3})\s*(?:m|min|mins|minutes?)\b/))) return Number(m[1]);
    if (/\bhalf an hour\b|\bhalf hour\b/.test(s)) return 30;
    if (/\b(?:an|one) hour\b/.test(s)) return 60;
    if (/\ba quarter of an hour\b|\bquarter hour\b/.test(s)) return 15;
    return 0;
  },

  isUnread(i) { return !!i && !i.read && !i.finishedAt; },

  // The links that fit in `minutes`. → { picks, total, left, unmeasured, tooLong }
  fit(items, minutes) {
    const budget = Math.min(this.MAX_BUDGET, Math.max(0, Math.floor(Number(minutes) || 0)));
    const unread = (items || []).filter(i => this.isUnread(i));
    // Oldest first: when two sets fill the time equally, the older links win.
    const known = unread.filter(i => i.minutes > 0).sort((a, b) => (a.at || 0) - (b.at || 0));
    const usable = known.filter(i => i.minutes <= budget);
    const n = usable.length;
    // 0/1 knapsack, weight = minutes, value = minutes first, then age.
    const best = new Array(budget + 1).fill(null).map(() => ({ value: 0, pick: [] }));
    usable.forEach((it, idx) => {
      const w = Math.round(it.minutes), v = w * 1000 + (n - idx);
      for (let c = budget; c >= w; c--) {
        const cand = best[c - w].value + v;
        if (cand > best[c].value) best[c] = { value: cand, pick: best[c - w].pick.concat(idx) };
      }
    });
    const top = best[budget];
    const picks = top.pick.map(i => usable[i]);
    const total = picks.reduce((s, i) => s + Math.round(i.minutes), 0);
    return {
      picks, total, left: budget - total,
      unmeasured: unread.filter(i => !(i.minutes > 0)).length,
      tooLong: known.filter(i => i.minutes > budget).length,
    };
  },

  stats(items, now = Date.now()) {
    const weekAgo = now - 7 * 86400000;
    const all = items || [];
    const unread = all.filter(i => this.isUnread(i));
    const done = all.filter(i => i.finishedAt && i.finishedAt >= weekAgo);
    return {
      unread: unread.length,
      unreadMinutes: unread.reduce((s, i) => s + (i.minutes > 0 ? Math.round(i.minutes) : 0), 0),
      unmeasured: unread.filter(i => !(i.minutes > 0)).length,
      finishedWeek: done.length,
      finishedMinutesWeek: done.reduce((s, i) => s + (i.minutes > 0 ? Math.round(i.minutes) : 0), 0),
    };
  },

  fmt(minutes) {
    const m = Math.round(minutes);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60), r = m % 60;
    return h + ' h' + (r ? ' ' + r + ' min' : '');
  },

  // ---- on the real queue ----------------------------------------------------
  _items() {
    if (typeof ReadLater === 'undefined') throw new Error('Read Later is not available in this window');
    return ReadLater.items;
  },

  suggest(minutes) { return this.fit(this._items(), minutes); },

  // Marked finished: also counts as opened, so it leaves the unread list.
  finish(id, now = Date.now()) {
    const item = this._items().find(i => i.id === id);
    if (!item) throw new Error('That link is no longer in Read Later');
    item.read = true;
    item.finishedAt = now;
    ReadLater.save();
    return item;
  },

  // Back to unread, as it was never touched.
  unfinish(id) {
    const item = this._items().find(i => i.id === id);
    if (!item) throw new Error('That link is no longer in Read Later');
    delete item.finishedAt;
    item.read = false;
    ReadLater.save();
    return item;
  },

  finishActive() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (!tab || !tab.url) throw new Error('Open the page you finished reading first');
    const item = this._items().find(i => i.url === tab.url && !i.finishedAt);
    if (!item) throw new Error('This page is not in your Read Later list');
    this.finish(item.id);
    return item;
  },

  _gaming() {
    return (typeof GameMode !== 'undefined' && !!GameMode.gaming) || (typeof GameSession !== 'undefined' && !!GameSession.active);
  },

  // Measure links that have no length yet: a handful, one at a time, from a
  // click. → how many now have a length.
  async measureMissing(max = this.MEASURE_BATCH) {
    if (this._gaming()) throw new Error('Not while a game is running');
    const todo = this._items().filter(i => this.isUnread(i) && !(i.minutes > 0)).slice(0, max);
    let n = 0;
    for (const it of todo) {
      const m = await ReadLater.measure(it.id);
      if (m) n++;
    }
    return n;
  },

  // ---- the window -----------------------------------------------------------
  open({ minutes = 0 } = {}) {
    document.querySelector('.vex-readq-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-readq-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.4);display:grid;place-items:start center;padding-top:9vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="What fits the time you have"
           style="width:min(560px,94vw);max-height:76vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1;font-size:13.5px;font-weight:650;color:var(--text)">I have a few minutes</div>
          <button data-close type="button" aria-label="Close" style="width:26px;height:26px;border:none;background:none;color:var(--text-muted);cursor:pointer;border-radius:6px">${VexIcons.svg('x', { size: 14 })}</button>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--border)">
          <label for="readq-min" style="font-size:12px;color:var(--text-muted)">Minutes</label>
          <input id="readq-min" data-min type="number" min="1" max="${this.MAX_BUDGET}" style="width:70px">
          <span data-chips style="display:flex;gap:5px"></span>
        </div>
        <div data-list style="overflow-y:auto;padding:6px;flex:1"></div>
        <div data-foot style="padding:8px 14px;border-top:1px solid var(--border);font-size:11.5px;color:var(--text-muted)"></div>
      </div>`;
    const inputEl = overlay.querySelector('[data-min]');
    const listEl = overlay.querySelector('[data-list]');
    const footEl = overlay.querySelector('[data-foot]');
    const small = (label, fn, title) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; if (title) b.title = title;
      b.style.cssText = 'font-size:11px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;cursor:pointer';
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
      return b;
    };
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const chips = overlay.querySelector('[data-chips]');
    [5, 10, 20, 30, 60].forEach(m => chips.appendChild(small(m + '', () => { inputEl.value = String(m); draw(); }, m + ' minutes')));

    const draw = () => {
      listEl.textContent = '';
      let items;
      try { items = this._items(); } catch (err) { listEl.textContent = err.message; return; }
      const st = this.stats(items);
      const want = Math.floor(Number(inputEl.value) || 0);
      if (want > 0) {
        const r = this.fit(items, want);
        if (!r.picks.length) {
          listEl.innerHTML = `<div style="padding:18px;text-align:center;font-size:12.5px;color:var(--text-muted)">Nothing measured fits ${want} minutes${r.tooLong ? ' — ' + r.tooLong + ' longer link' + (r.tooLong === 1 ? ' is' : 's are') + ' waiting' : ''}.</div>`;
        } else {
          const head = document.createElement('div');
          head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:12px;color:var(--text-muted)';
          head.innerHTML = `<span style="flex:1">${r.picks.length} link${r.picks.length === 1 ? '' : 's'} · ${esc(this.fmt(r.total))}${r.left > 0 ? ' · ' + esc(this.fmt(r.left)) + ' to spare' : ''}</span>`;
          head.appendChild(small('Open them all', () => {
            if (typeof ReadLater === 'undefined') return;
            r.picks.forEach((it) => { it.read = true; TabManager.createTab(it.url, it === r.picks[0]); });
            ReadLater.save();
            close();
          }, 'Each opens in its own tab'));
          listEl.appendChild(head);
          for (const it of r.picks) listEl.appendChild(this._row(it, small, esc, draw, close));
        }
      } else {
        listEl.innerHTML = '<div style="padding:18px;text-align:center;font-size:12.5px;color:var(--text-muted)">Say how long you have, in minutes.</div>';
      }
      const parts = [st.unread + ' unread' + (st.unreadMinutes ? ' · ' + this.fmt(st.unreadMinutes) + ' of reading' : '')];
      if (st.finishedWeek) parts.push('finished ' + st.finishedWeek + ' this week' + (st.finishedMinutesWeek ? ' (' + this.fmt(st.finishedMinutesWeek) + ')' : ''));
      footEl.textContent = '';
      const t = document.createElement('span');
      t.textContent = parts.join(' · ');
      footEl.appendChild(t);
      if (st.unmeasured && !this._gaming()) {
        footEl.appendChild(document.createTextNode(' · '));
        footEl.appendChild(small('Work out ' + Math.min(st.unmeasured, this.MEASURE_BATCH) + ' missing time' + (st.unmeasured === 1 ? '' : 's'), async (b) => {
          b.disabled = true; b.textContent = 'Reading…';
          try { await this.measureMissing(); } catch (err) { window.showToast?.(err.message, 'error'); }
          draw();
        }, st.unmeasured + ' saved link' + (st.unmeasured === 1 ? ' has' : 's have') + ' no length yet'));
      }
    };
    inputEl.addEventListener('input', draw);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-close]').addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    if (minutes > 0) inputEl.value = String(Math.min(this.MAX_BUDGET, Math.round(minutes)));
    draw();
    inputEl.focus();
    return overlay;
  },

  _row(it, small, esc, redraw, close) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:8px';
    let host = it.url; try { host = new URL(it.url).hostname.replace(/^www\./, ''); } catch { /* keep the address */ }
    row.innerHTML = `<div style="flex:1;min-width:0">
      <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.title || it.url)}</div>
      <div style="font-size:10.5px;color:var(--text-muted)">${esc(host)} · ${esc(this.fmt(it.minutes))}</div></div>`;
    row.appendChild(small('Open', () => { close(); ReadLater.open(it); }));
    row.appendChild(small('Finished', () => {
      try { this.finish(it.id); } catch (err) { window.showToast?.(err.message, 'error'); }
      redraw();
    }, 'Mark it read and done'));
    return row;
  },

  section: {
    id: 'reading-queue',
    title: 'Reading queue',
    isEnabled() { return true; },
    async build() {
      if (typeof ReadLater === 'undefined') return null;
      const st = ReadingQueue.stats(ReadLater.items);
      if (!st.unread) return null;
      return {
        id: 'reading-queue', title: 'Reading queue',
        text: st.unread + ' unread' + (st.unreadMinutes ? ' · ' + ReadingQueue.fmt(st.unreadMinutes) : ''),
        items: [10, 20].map(m => ({ text: 'I have ' + m + ' minutes', cmd: { type: 'command', id: 'read-minutes' } })),
      };
    },
  },
};

if (typeof window !== 'undefined') window.ReadingQueue = ReadingQueue;
if (typeof module !== 'undefined' && module.exports) module.exports = { ReadingQueue };
