// === Small shared helpers for the hubs that keep a list of dated things =======
//
// The orders hub, the exam calendar, the receipt and warranty locker and the
// loadout cards each keep a short list in the person's own storage, ask for a
// few fields in a dialog, and set a reminder for a date. These are the pieces
// they share, so each module is only its own rules.
//
// Nothing here talks to the network. Dates are plain days ("2026-10-16"), read
// and written in the person's own time zone; a bad date is an error, never a
// guess.
const VexLifeKit = {
  // ---- storage ----------------------------------------------------------------
  // A JSON value, or `fallback` when nothing is saved. Unreadable data throws:
  // an empty list that silently replaces a corrupt one would lose the person's.
  read(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); }
    catch (err) { throw new Error('Your saved data "' + key + '" could not be read', { cause: err }); }
  },
  write(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
  flag(key, def) {
    const v = localStorage.getItem(key);
    return v === null ? !!def : v === 'on';
  },
  setFlag(key, on) { localStorage.setItem(key, on ? 'on' : 'off'); },
  uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },

  // ---- days -------------------------------------------------------------------
  pad(n) { return String(n).padStart(2, '0'); },
  // "2026-10-16" -> local midnight in ms. Throws on anything else.
  parseDay(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || '').trim());
    if (!m) throw new Error('Write the date as year-month-day, like 2026-10-16');
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) throw new Error(text + ' is not a real date');
    return dt.getTime();
  },
  dayString(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + this.pad(d.getMonth() + 1) + '-' + this.pad(d.getDate());
  },
  startOfDay(ms) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); },
  // Whole calendar days from today to `ms` (negative once it has passed).
  daysLeft(ms, now = Date.now()) {
    const a = new Date(this.startOfDay(now)), b = new Date(this.startOfDay(ms));
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  },
  addDays(ms, n) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); },
  // "in 3 days", "today", "2 days ago".
  words(days) {
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days === -1) return 'yesterday';
    return days > 0 ? 'in ' + days + ' days' : Math.abs(days) + ' days ago';
  },

  // ---- reminders --------------------------------------------------------------
  // A reminder at 09:00 on `day` (ms of a day). The main process fires it, so it
  // survives Vex being closed; a day already past is an error, not a silent skip.
  async remind(message, dayMs, { url, hour = 9, now = Date.now() } = {}) {
    const bridge = typeof window !== 'undefined' && window.vex && window.vex.reminders;
    if (!bridge || typeof bridge.create !== 'function') throw new Error('Reminders are not available in this window');
    const d = new Date(dayMs);
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0).getTime();
    if (at <= now) throw new Error('That moment has already passed, so there is nothing to remind you of');
    const payload = { message: String(message).slice(0, 2000) };
    if (url) payload.url = url;
    const made = await bridge.create(payload.message, at, url ? { url } : undefined);
    return { at, id: made && made.id ? made.id : null };
  },
  async unremind(id) {
    if (!id) return;
    const bridge = window.vex && window.vex.reminders;
    if (!bridge || typeof bridge.delete !== 'function') throw new Error('Reminders are not available in this window');
    await bridge.delete(id);
  },

  // ---- a form in the platform dialog -------------------------------------------
  // fields: [{ name, label, type: 'text'|'date'|'number'|'select'|'textarea', value, options, placeholder, required, hint }]
  // -> Promise of { name: value } on Save, null on cancel. `validate(values)` may throw; the message is shown.
  form({ id, title, sub, fields, submit = 'Save', validate }) {
    return new Promise((resolve) => {
      const { overlay, body, close } = VexSettingsGroups.dialog({ id, title, sub });
      let done = false;
      const finish = (v) => { if (done) return; done = true; observer.disconnect(); resolve(v); };
      const observer = new MutationObserver(() => { if (!overlay.isConnected) finish(null); });
      observer.observe(document.body, { childList: true });
      const inputs = {};
      const box = document.createElement('div');
      box.style.cssText = 'display:flex;flex-direction:column;gap:10px';
      for (const f of fields) {
        const wrap = document.createElement('label');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--text-muted)';
        const cap = document.createElement('span');
        cap.textContent = f.label + (f.required ? ' (needed)' : '');
        let el;
        if (f.type === 'select') {
          el = document.createElement('select');
          for (const [v, label] of f.options || []) { const o = document.createElement('option'); o.value = v; o.textContent = label; el.appendChild(o); }
        } else if (f.type === 'textarea') {
          el = document.createElement('textarea');
          el.rows = 3;
        } else {
          el = document.createElement('input');
          el.type = f.type === 'number' ? 'number' : 'text';
        }
        if (f.placeholder) el.placeholder = f.placeholder;
        if (f.value != null) el.value = String(f.value);
        el.style.cssText = 'background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12.5px';
        el.setAttribute('aria-label', f.label);
        inputs[f.name] = el;
        wrap.append(cap, el);
        if (f.hint) { const h = document.createElement('span'); h.textContent = f.hint; h.style.fontSize = '11px'; wrap.appendChild(h); }
        box.appendChild(wrap);
      }
      const err = document.createElement('div');
      err.setAttribute('role', 'alert');
      err.style.cssText = 'color:var(--danger,#e5484d);font-size:12px;min-height:1em';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
      const save = VexSettingsGroups.button(submit, () => {
        try {
          const values = {};
          for (const f of fields) {
            const v = inputs[f.name].value.trim();
            if (f.required && !v) throw new Error(f.label + ' is needed');
            values[f.name] = v;
          }
          if (validate) validate(values);
          finish(values);
          close();
        } catch (e) { err.textContent = e.message; }
      }, { primary: true });
      const cancel = VexSettingsGroups.button('Cancel', () => { finish(null); close(); });
      row.append(cancel, save);
      box.append(err, row);
      body.appendChild(box);
      const first = inputs[fields[0].name];
      if (first) first.focus();
    });
  },

  // A list row: text on the left, small buttons on the right. -> the row element.
  row(lines, buttons = []) {
    const row = document.createElement('div');
    row.className = 'vexsr-rule';
    const text = document.createElement('span');
    text.className = 'vexsr-host';
    text.style.wordBreak = 'normal';
    lines.forEach((l, i) => {
      const d = document.createElement('div');
      if (i) { d.className = 'vexsr-mode'; d.style.whiteSpace = 'normal'; }
      d.textContent = l;
      text.appendChild(d);
    });
    row.appendChild(text);
    for (const b of buttons) row.appendChild(b);
    return row;
  },
};

if (typeof window !== 'undefined') window.VexLifeKit = VexLifeKit;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLifeKit };
