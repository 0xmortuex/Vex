// === Habits — did I do it today? ===
//
// A habit is a name and the days you did it. The sheet shows the last seven
// days as tick boxes (so a forgotten yesterday can still be ticked), the streak
// you are on, and your best. Nothing nags: a streak is only broken once a whole
// day has passed without a tick, so an unticked today still counts as "on it".
//
// Days are local calendar dates, "YYYY-MM-DD", not timestamps — a habit done at
// 23:50 belongs to that day wherever the clock later says you are.

const Habits = {
  KEY: 'vex.habits',
  MAX: 50,
  MAX_NAME: 80,
  WINDOW: 7,                 // days you can tick: today and the six before

  dayKey(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  _shift(d, days) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + days); return x; },

  list() {
    // Unreadable data is an error, not an empty list: an empty list would be
    // saved over it on the next tick.
    let a;
    try { a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); }
    catch (err) { throw new Error('Your habits could not be read', { cause: err }); }
    return Array.isArray(a) ? a.filter(h => h && typeof h.id === 'string' && typeof h.name === 'string' && Array.isArray(h.done)) : [];
  },

  _save(habits) {
    localStorage.setItem(this.KEY, JSON.stringify(habits));
    try { document.dispatchEvent(new CustomEvent('vex:habits-changed')); } catch {}
  },

  add(name) {
    const n = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    if (!n) throw new Error('Give the habit a name');
    if (n.length > this.MAX_NAME) throw new Error('That name is too long — keep it short enough to read at a glance');
    const habits = this.list();
    if (habits.length >= this.MAX) throw new Error('That is ' + this.MAX + ' habits already');
    if (habits.some(h => h.name.toLowerCase() === n.toLowerCase())) throw new Error('“' + n + '” is already a habit');
    const h = { id: window.vexId ? window.vexId('habit') : 'habit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), name: n, done: [], createdAt: Date.now() };
    habits.push(h);
    this._save(habits);
    return h;
  },

  remove(id) {
    const habits = this.list();
    const i = habits.findIndex(h => h.id === id);
    if (i < 0) throw new Error('That habit is gone');
    habits.splice(i, 1);
    this._save(habits);
  },

  // Tick or untick one day. Only today and the six days before: further back
  // is rewriting history, and the future has not happened.
  toggle(id, day, now = new Date()) {
    const today = this.dayKey(now);
    const oldest = this.dayKey(this._shift(now, -(this.WINDOW - 1)));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new Error('Not a day: ' + day);
    if (day > today) throw new Error('That day has not happened yet');
    if (day < oldest) throw new Error('Only the last ' + this.WINDOW + ' days can be changed');
    const habits = this.list();
    const h = habits.find(x => x.id === id);
    if (!h) throw new Error('That habit is gone');
    const on = h.done.includes(day);
    h.done = on ? h.done.filter(d => d !== day) : [...h.done, day].sort();
    this._save(habits);
    return !on;
  },

  // Days in a row up to today. An unticked today does not break it yet — it
  // runs to yesterday until today is over.
  streak(h, now = new Date()) {
    const done = new Set(h.done);
    let d = done.has(this.dayKey(now)) ? now : this._shift(now, -1);
    let n = 0;
    while (done.has(this.dayKey(d))) { n++; d = this._shift(d, -1); }
    return n;
  },

  best(h) {
    const days = [...new Set(h.done)].sort();
    let best = 0, run = 0, prev = null;
    for (const k of days) {
      const [y, m, d] = k.split('-').map(Number);
      const cur = new Date(y, m - 1, d);
      run = (prev && this.dayKey(this._shift(prev, 1)) === k) ? run + 1 : 1;
      if (run > best) best = run;
      prev = cur;
    }
    return best;
  },

  // The tickable days, oldest first.
  days(now = new Date()) {
    const out = [];
    for (let i = this.WINDOW - 1; i >= 0; i--) out.push(this._shift(now, -i));
    return out;
  },

  // --- the sheet -------------------------------------------------------------------
  open() {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { body } = window.PageExport._sheet('Habits', 'vex-habits-overlay');
    const draw = () => {
      const now = new Date();
      const days = this.days(now);
      const today = this.dayKey(now);
      const habits = this.list();
      const cell = 'width:30px;text-align:center';
      body.innerHTML = `
        <form data-add style="display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border)">
          <input data-new type="text" maxlength="${this.MAX_NAME}" placeholder="A new habit — read 20 pages, walk, no phone after 11" aria-label="New habit"
                 style="flex:1;font:inherit;font-size:13px;padding:7px 9px;border-radius:7px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
          <button type="submit" style="font:inherit;font-size:12px;padding:6px 12px;border-radius:7px;border:none;background:var(--primary);color:#fff;cursor:pointer">Add</button>
        </form>
        ${habits.length ? `
        <table style="width:100%;border-collapse:collapse;font-size:12.5px;color:var(--text)">
          <thead><tr style="color:var(--text-muted);font-size:10.5px">
            <th style="text-align:left;padding:8px 12px;font-weight:600">Habit</th>
            ${days.map(d => `<th style="${cell};font-weight:${this.dayKey(d) === today ? 700 : 500}" title="${esc(d.toLocaleDateString())}">${esc(this.dayKey(d) === today ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' }))}</th>`).join('')}
            <th style="text-align:right;padding:8px 12px;font-weight:600">Streak</th><th></th>
          </tr></thead>
          <tbody>${habits.map(h => {
            const s = this.streak(h, now), b = this.best(h);
            return `<tr data-id="${esc(h.id)}" style="border-top:1px solid var(--border)">
              <td style="padding:7px 12px;overflow-wrap:anywhere">${esc(h.name)}</td>
              ${days.map(d => { const k = this.dayKey(d); return `<td style="${cell}"><input type="checkbox" data-day="${k}" ${h.done.includes(k) ? 'checked' : ''} aria-label="${esc(h.name + ', ' + d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}" style="cursor:pointer;accent-color:var(--primary)"></td>`; }).join('')}
              <td style="text-align:right;padding:7px 12px;white-space:nowrap">
                <span style="display:inline-flex;align-items:center;gap:3px;color:${s ? 'var(--primary)' : 'var(--text-muted)'}">${s ? VexIcons.svg('flame', { size: 12 }) : ''}${s} ${s === 1 ? 'day' : 'days'}</span>
                <div style="font-size:10.5px;color:var(--text-muted)">best ${b}</div>
              </td>
              <td style="padding:0 10px 0 0"><button data-remove type="button" title="Remove this habit" aria-label="Remove ${esc(h.name)}" style="display:inline-flex;background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px">${VexIcons.svg('trash', { size: 13 })}</button></td>
            </tr>`;
          }).join('')}</tbody>
        </table>` : `<div style="padding:22px 14px;font-size:12.5px;color:var(--text-muted);text-align:center">No habits yet. Add one above, then tick it off each day.</div>`}
        <div style="padding:10px 14px;font-size:11px;color:var(--text-muted)">Tick today or any of the six days before. A streak only breaks once a whole day passes unticked.</div>`;

      body.querySelector('[data-add]').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = body.querySelector('[data-new]');
        try { this.add(input.value); draw(); body.querySelector('[data-new]').focus(); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      });
      body.querySelectorAll('tr[data-id]').forEach(row => {
        const id = row.dataset.id;
        row.querySelectorAll('input[data-day]').forEach(box => box.addEventListener('change', () => {
          try { this.toggle(id, box.dataset.day); } catch (err) { window.showToast?.(err.message, 'error'); }
          draw();
        }));
        row.querySelector('[data-remove]').addEventListener('click', async () => {
          const h = this.list().find(x => x.id === id);
          if (!h) { draw(); return; }
          const ok = await window.vexConfirm({ title: 'Remove “' + h.name + '”?', message: 'Its ' + h.done.length + ' ticked ' + (h.done.length === 1 ? 'day goes' : 'days go') + ' with it.', okLabel: 'Remove', danger: true });
          if (!ok) return;
          this.remove(id);
          draw();
        });
      });
    };
    draw();
    return body;
  },
};

if (typeof window !== 'undefined') window.Habits = Habits;
if (typeof module !== 'undefined') module.exports = { Habits };
