// === Time-of-day layout ======================================================
//
// People use the same sections at the same hours: mail and the day's schedule
// in the morning, news at lunch, GitHub in the afternoon. This counts how often
// each brief section is used in each part of the day (and weekday against
// weekend) and orders the brief by those counts for the part of the day it is
// opened in.
//
// It never overrides an order the person set by hand (BriefActions leaves that
// alone), needs MIN_RECORDS uses before it moves anything, and keeps only
// counts per section id: no pages, no times of individual uses.
// Off until turned on in Settings > Brief actions.
const VexDayLayout = {
  KEY: 'vex.dayLayout',
  MIN_RECORDS: 10,
  CAP: 200,

  // morning 5-11, midday 11-14, afternoon 14-18, evening 18-23, night 23-5.
  BLOCKS: ['morning', 'midday', 'afternoon', 'evening', 'night'],
  blockOf(hour) {
    if (hour >= 5 && hour < 11) return 'morning';
    if (hour >= 11 && hour < 14) return 'midday';
    if (hour >= 14 && hour < 18) return 'afternoon';
    if (hour >= 18 && hour < 23) return 'evening';
    return 'night';
  },
  bucket(now = Date.now()) {
    const d = new Date(now);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    return this.blockOf(d.getHours()) + (weekend ? ':weekend' : ':weekday');
  },

  _read() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { raw = null; }
    if (!raw || typeof raw !== 'object' || typeof raw.u !== 'object' || raw.u === null) return { v: 1, u: {}, total: 0 };
    return { v: 1, u: raw.u, total: Number(raw.total) || 0 };
  },
  _write(m) {
    try { localStorage.setItem(this.KEY, JSON.stringify(m)); return true; }
    catch (err) { window.VexProblems?.note('Day layout', 'Could not save the time-of-day habits', err); return false; }
  },

  record(sectionId, now = Date.now()) {
    if (typeof sectionId !== 'string' || !sectionId) return false;
    const m = this._read();
    const b = this.bucket(now);
    const row = m.u[sectionId] || (m.u[sectionId] = {});
    row[b] = (row[b] || 0) + 1;
    m.total += 1;
    if (row[b] > this.CAP) for (const id of Object.keys(m.u)) for (const k of Object.keys(m.u[id])) m.u[id][k] = Math.floor(m.u[id][k] / 2);
    return this._write(m);
  },

  // ids in the order this part of the day suggests. Sections with no history
  // for the bucket keep their relative order after the ones that have some.
  order(ids, now = Date.now()) {
    const m = this._read();
    if (m.total < this.MIN_RECORDS) return ids;
    const b = this.bucket(now);
    const scored = ids.map((id, i) => ({ id, i, n: (m.u[id] && m.u[id][b]) || 0 }));
    if (!scored.some(s => s.n > 0)) return ids;
    scored.sort((a, c) => (c.n - a.n) || (a.i - c.i));
    return scored.map(s => s.id);
  },

  // The sections you use most in the bucket, for Settings and the note.
  habits(now = Date.now(), n = 3) {
    const m = this._read();
    const b = this.bucket(now);
    return Object.keys(m.u).map(id => ({ id, n: m.u[id][b] || 0 })).filter(x => x.n > 0).sort((a, c) => c.n - a.n).slice(0, n);
  },
  summary() { const m = this._read(); return { total: m.total, ready: m.total >= this.MIN_RECORDS, sections: Object.keys(m.u).length }; },
  reset() { try { localStorage.removeItem(this.KEY); } catch (err) { throw new Error('Could not clear the habits: ' + err.message); } },

  renderSettings(container) {
    if (!container) return;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    container.querySelector('[data-daylayout]')?.remove();
    const box = el('div', 'setting-info');
    box.setAttribute('data-daylayout', '');
    const s = this.summary();
    const hab = this.habits();
    box.appendChild(el('div', '', 'Time-of-day habits: ' + s.total + ' uses counted' + (s.ready ? '' : ' (needs ' + this.MIN_RECORDS + ' before the order changes)') + '.'));
    if (hab.length) box.appendChild(el('div', 'ain-muted', 'Right now you usually use: ' + hab.map(h => h.id).join(', ')));
    const btn = el('button', 'btn-secondary', 'Forget time-of-day habits');
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      const ok = await window.vexConfirm({ title: 'Forget time-of-day habits?', message: 'The brief goes back to its normal order.', okLabel: 'Forget', danger: true });
      if (!ok) return;
      try { this.reset(); } catch (err) { window.showToast?.(err.message, 'error'); return; }
      this.renderSettings(container);
    });
    box.appendChild(btn);
    container.appendChild(box);
  },

  section: {
    id: 'day-layout',
    title: 'Your usual at this hour',
    icon: 'clock',
    order: 95,
    defaultOn: false,
    isEnabled() { return typeof BriefActions !== 'undefined' && BriefActions.isOn('dayLayout'); },
    build(ctx = {}) {
      const hab = VexDayLayout.habits(ctx.now || Date.now());
      if (!hab.length || !VexDayLayout.summary().ready) return null;
      return { note: 'At this time of day you usually use: ' + hab.map(h => h.id).join(', ') + '. The brief puts those first.' };
    },
  },
};

if (typeof window !== 'undefined') window.VexDayLayout = VexDayLayout;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDayLayout };
