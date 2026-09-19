// === Calendar — what is on, and when ===
//
// Vex already holds dated things in two places: reminders (main process,
// src/main/reminders.js) and to-dos in notes that carry a date (@2026-10-03,
// @tomorrow — src/renderer/js/open-tasks.js). Each has its own list; neither
// shows a month. This is that month: both, on the days they fall, with a
// repeating reminder shown on every day it will repeat.
//
// It reads, and it adds reminders through the same main-process API every
// other part of Vex uses; it keeps no data of its own. It is not a synced
// calendar — Google and Outlook calendars need your account — and it says so.

const Calendar = {
  MAX_REPEATS: 62,        // occurrences drawn per repeating reminder per month

  dayKey(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  // The week starts where the person's locale starts it (Sunday in the US,
  // Monday in most of Europe). 0 = Sunday.
  firstWeekday() {
    const first = new Intl.Locale(navigator.language || 'en-US').getWeekInfo().firstDay;   // 1 = Monday … 7 = Sunday
    return first % 7;
  },

  // The days drawn for a month: whole weeks, from the first weekday on or
  // before the 1st to the last on or after the last day.
  grid(year, month, firstWeekday = this.firstWeekday()) {
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - ((first.getDay() - firstWeekday + 7) % 7));
    const last = new Date(year, month + 1, 0);
    const days = [];
    const d = new Date(start);
    while (d <= last || days.length % 7) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
    return days;
  },

  // Every time a reminder falls in [from, to). A repeating reminder's `at` is
  // its next occurrence; the steps are the same as main's nextRepeat.
  occurrences(r, from, to) {
    if (r.at == null || r.site) return [];
    if (!r.repeat || r.firedAt) return r.at >= from && r.at < to ? [r.at] : [];
    const out = [];
    const d = new Date(r.at);
    const days = Array.isArray(r.repeat) ? r.repeat : null;
    const step = () => {
      d.setDate(d.getDate() + (r.repeat === 'weekly' ? 7 : 1));
      if (r.repeat === 'weekdays') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      if (days) while (!days.includes(d.getDay())) d.setDate(d.getDate() + 1);
    };
    while (d.getTime() < to && out.length < this.MAX_REPEATS) {
      if (d.getTime() >= from) out.push(d.getTime());
      step();
    }
    return out;
  },

  // day key → [{ type, ... }] for the month on screen.
  collect({ reminders = [], tasks = [], from, to }) {
    const byDay = new Map();
    const put = (key, item) => { const a = byDay.get(key) || []; a.push(item); byDay.set(key, a); };
    for (const r of reminders) {
      // Alarms and timers belong to the clock, and a daily alarm on every
      // square says nothing. Reviews are Vex's own.
      if (r.kind && r.kind !== 'reminder') continue;
      for (const at of this.occurrences(r, from, to)) put(this.dayKey(new Date(at)), { type: 'reminder', id: r.id, text: r.message, at, repeat: r.repeat || null, done: !!r.firedAt });
    }
    for (const t of tasks) {
      if (t.due == null || t.due < from || t.due >= to) continue;
      put(this.dayKey(new Date(t.due)), { type: 'task', text: t.text.replace(/(?:^|\s)@(\d{4}-\d{2}-\d{2}|today|tomorrow)\b/i, '').trim() || t.text, noteId: t.noteId, index: t.index, noteTitle: t.noteTitle, done: t.done });
    }
    for (const list of byDay.values()) list.sort((a, b) => (a.type === 'task') - (b.type === 'task') || (a.at || 0) - (b.at || 0));
    return byDay;
  },

  // --- the sheet -------------------------------------------------------------------
  async open() {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { overlay, head, body } = window.PageExport._sheet('Calendar', 'vex-calendar-overlay');
    const box = head.closest('[role="dialog"]');
    if (box) box.style.width = 'min(860px,96vw)';
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    const now = new Date();
    let year = now.getFullYear(), month = now.getMonth(), selected = this.dayKey(now);
    const firstWeekday = this.firstWeekday();

    const draw = async () => {
      const days = this.grid(year, month, firstWeekday);
      const from = new Date(days[0]).getTime(), to = new Date(days[days.length - 1].getFullYear(), days[days.length - 1].getMonth(), days[days.length - 1].getDate() + 1).getTime();
      const reminders = await window.vex.reminders.list();
      if (!overlay.isConnected) return;
      const tasks = window.OpenTasks.collect(window.OpenTasks._notes(), { includeDone: true });
      const byDay = this.collect({ reminders, tasks, from, to });
      const today = this.dayKey(new Date());
      const title = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      const names = days.slice(0, 7).map(d => d.toLocaleDateString(undefined, { weekday: 'short' }));

      body.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 14px">
          <button data-prev type="button" aria-label="Previous month" style="display:inline-flex;${btn}">${VexIcons.svg('arrow-left', { size: 12 })}</button>
          <div style="flex:1;text-align:center;font-size:14px;font-weight:650;color:var(--text)">${esc(title)}</div>
          <button data-today type="button" style="${btn}">Today</button>
          <button data-next type="button" aria-label="Next month" style="display:inline-flex;${btn}">${VexIcons.svg('arrow-right', { size: 12 })}</button>
        </div>
        <div role="grid" aria-label="${esc(title)}" style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px;padding:0 12px">
          ${names.map(n => `<div role="columnheader" style="font-size:10.5px;text-align:center;color:var(--text-muted);padding:2px 0">${esc(n)}</div>`).join('')}
          ${days.map(d => {
            const k = this.dayKey(d), items = byDay.get(k) || [];
            const other = d.getMonth() !== month;
            return `<button data-day="${k}" type="button" role="gridcell" aria-selected="${k === selected}" aria-label="${esc(d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + (items.length ? ', ' + items.length + ' item' + (items.length === 1 ? '' : 's') : ''))}"
              style="min-height:66px;text-align:left;vertical-align:top;display:flex;flex-direction:column;gap:2px;padding:4px 5px;border-radius:7px;cursor:pointer;font:inherit;
                     border:${k === selected ? '2px solid var(--primary)' : '1px solid var(--border)'};background:${other ? 'transparent' : 'var(--surface)'};opacity:${other ? 0.55 : 1}">
              <span style="font-size:11px;font-weight:${k === today ? 800 : 500};color:${k === today ? 'var(--primary)' : 'var(--text)'}">${d.getDate()}</span>
              ${items.slice(0, 2).map(it => `<span style="font-size:10px;line-height:1.25;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;${it.done ? 'text-decoration:line-through;opacity:0.6' : ''}">${it.type === 'reminder' ? esc(new Date(it.at).toTimeString().slice(0, 5)) + ' ' : ''}${esc(it.text)}</span>`).join('')}
              ${items.length > 2 ? `<span style="font-size:10px;color:var(--text-muted)">+${items.length - 2} more</span>` : ''}
            </button>`;
          }).join('')}
        </div>
        <div data-dayview style="padding:12px 14px 6px"></div>
        <div style="padding:4px 14px 12px;font-size:11px;color:var(--text-muted)">Shows your reminders and the to-dos in your notes that have a date. It is not linked to Google or Outlook — that needs your account there — but any reminder can be saved to them as a calendar file.</div>`;

      body.querySelector('[data-prev]').addEventListener('click', () => { month--; if (month < 0) { month = 11; year--; } draw(); });
      body.querySelector('[data-next]').addEventListener('click', () => { month++; if (month > 11) { month = 0; year++; } draw(); });
      body.querySelector('[data-today]').addEventListener('click', () => { const n = new Date(); year = n.getFullYear(); month = n.getMonth(); selected = this.dayKey(n); draw(); });
      body.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
        selected = b.dataset.day;
        const [y, m] = selected.split('-').map(Number);
        if (m - 1 !== month) { year = y; month = m - 1; }
        draw();
      }));
      this._drawDay(body.querySelector('[data-dayview]'), selected, byDay.get(selected) || [], draw, esc);
    };
    await draw();
    return body;
  },

  _drawDay(el, key, items, redraw, esc) {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const isPast = key < this.dayKey(new Date());
    const field = 'font:inherit;font-size:12.5px;padding:6px 8px;border-radius:7px;border:1px solid var(--border);background:var(--surface);color:var(--text)';
    el.innerHTML = `
      <div style="font-size:12px;font-weight:650;color:var(--text);margin-bottom:6px">${esc(date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
      <div data-items>${items.length ? '' : `<div style="font-size:12px;color:var(--text-muted);padding:2px 0 6px">Nothing on this day.</div>`}</div>
      ${isPast ? '' : `<form data-remind style="display:flex;gap:6px;margin-top:6px">
        <input data-time type="time" value="09:00" aria-label="Time" style="${field}">
        <input data-text type="text" maxlength="2000" placeholder="Remind me to…" aria-label="Reminder" style="${field};flex:1">
        <button type="submit" style="font:inherit;font-size:12px;padding:5px 11px;border-radius:7px;border:none;background:var(--primary);color:#fff;cursor:pointer">Add reminder</button>
      </form>`}`;
    const list = el.querySelector('[data-items]');
    for (const it of items) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12.5px;color:var(--text)';
      if (it.type === 'task') {
        row.innerHTML = `<input type="checkbox" ${it.done ? 'checked' : ''} aria-label="Done: ${esc(it.text)}" style="accent-color:var(--primary);cursor:pointer">
          <span style="flex:1;${it.done ? 'text-decoration:line-through;opacity:0.6' : ''}">${esc(it.text)}</span>
          <span style="font-size:10.5px;color:var(--text-muted)">to-do · ${esc(it.noteTitle)}</span>`;
        row.querySelector('input').addEventListener('change', () => {
          try { window.OpenTasks.toggle(it.noteId, it.index); } catch (err) { window.showToast?.(err.message, 'error'); }
          redraw();
        });
      } else {
        const repeat = it.repeat ? (Array.isArray(it.repeat) ? 'repeats on set days' : 'repeats ' + (it.repeat === 'weekdays' ? 'on weekdays' : it.repeat)) : '';
        row.innerHTML = `<span style="display:inline-flex;color:var(--text-muted)">${VexIcons.svg('bell', { size: 13 })}</span>
          <span style="width:40px;font-variant-numeric:tabular-nums;color:var(--text-muted)">${esc(new Date(it.at).toTimeString().slice(0, 5))}</span>
          <span style="flex:1;${it.done ? 'text-decoration:line-through;opacity:0.6' : ''}">${esc(it.text)}</span>
          <span style="font-size:10.5px;color:var(--text-muted)">${esc(it.done ? 'reminded' : 'reminder')}${repeat ? ' · ' + esc(repeat) : ''}</span>`;
      }
      list.appendChild(row);
    }
    el.querySelector('[data-remind]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = el.querySelector('[data-text]').value.trim();
      const [hh, mm] = el.querySelector('[data-time]').value.split(':').map(Number);
      if (!text) { window.showToast?.('Write what to be reminded of', 'error'); return; }
      const at = new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
      if (at <= Date.now()) { window.showToast?.('That time has already passed', 'error'); return; }
      try { await window.vex.reminders.create(text, at); }
      catch (err) { window.showToast?.((err && err.message) || 'Could not add the reminder', 'error'); return; }
      window.showToast?.('Reminder set for ' + new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }));
      redraw();
    });
  },
};

if (typeof window !== 'undefined') window.Calendar = Calendar;
if (typeof module !== 'undefined') module.exports = { Calendar };
