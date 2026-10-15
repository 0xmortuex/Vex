// === Start page widgets: the shelf and its components =======================
//
// A small shelf of widgets for the New Tab page. This file is the data model
// and the components; it does not touch the start page. The integrator
// mounts a component with
//
//     VexWidgets.mount(el, { id, type, cfg }, ctx)      // -> { dispose() }
//
// or one type directly: VexWidgets.TYPES.quote.mount(el, cfg, ctx).
//
// ctx is how a component reaches the world, so the same code runs in the
// main window and in the start page's own document:
//     now()            -> Date            (default: new Date())
//     storage          -> { get(key), set(key, value) }   (default: localStorage)
//
// Types
//   quote      quote of the day from a bundled list (no network; the same
//              quote all day, the next one tomorrow)
//   countdown  { label, date: 'YYYY-MM-DD' }: days to go, or days since
//   photo      a picture you chose from this PC, shrunk and kept on this PC
//   habit      { label }: one habit, seven days of dots, today one tap away
//
// The shelf is stored under 'vex.startWidgets' (this device). It is empty
// and the start page shows none until the person adds one: off by default.
const VexWidgets = {
  KEY: 'vex.startWidgets',
  MAX: 8,
  PHOTO_MAX_EDGE: 720,
  PHOTO_MAX_CHARS: 500000,

  QUOTES: [
    { t: 'The journey of a thousand miles begins with a single step.', a: 'Lao Tzu' },
    { t: 'Well done is better than well said.', a: 'Benjamin Franklin' },
    { t: 'Lost time is never found again.', a: 'Benjamin Franklin' },
    { t: 'Do the thing and you shall have the power.', a: 'Ralph Waldo Emerson' },
    { t: 'Nothing great was ever achieved without enthusiasm.', a: 'Ralph Waldo Emerson' },
    { t: 'What stands in the way becomes the way.', a: 'Marcus Aurelius' },
    { t: 'We suffer more often in imagination than in reality.', a: 'Seneca' },
    { t: 'It is not that we have a short time to live, but that we waste a lot of it.', a: 'Seneca' },
    { t: 'The question is not what you look at, but what you see.', a: 'Henry David Thoreau' },
    { t: 'Go confidently in the direction of your dreams. Live the life you have imagined.', a: 'Henry David Thoreau' },
    { t: 'It is never too late to be what you might have been.', a: 'George Eliot' },
    { t: 'Whatever you are, be a good one.', a: 'Abraham Lincoln' },
    { t: 'Courage is grace under pressure.', a: 'Ernest Hemingway' },
    { t: 'A smooth sea never made a skilled sailor.', a: '' },
    { t: 'Slow down and everything you are chasing will come around and catch you.', a: '' },
    { t: 'Fall seven times, stand up eight.', a: 'Japanese proverb' },
    { t: 'A river cuts through rock not because of its power, but because of its persistence.', a: '' },
    { t: 'The best time to plant a tree was twenty years ago. The second best time is now.', a: 'Proverb' },
    { t: 'Simplicity is the ultimate sophistication.', a: '' },
    { t: 'Make it work, make it right, make it fast.', a: 'Kent Beck' },
    { t: 'Premature optimization is the root of all evil.', a: 'Donald Knuth' },
    { t: 'Programs must be written for people to read, and only incidentally for machines to execute.', a: 'Harold Abelson' },
    { t: 'The details are not the details. They make the design.', a: 'Charles Eames' },
    { t: 'Have no fear of perfection, you will never reach it.', a: 'Salvador Dali' },
    { t: 'Every moment is a fresh beginning.', a: 'T. S. Eliot' },
    { t: 'Not all those who wander are lost.', a: 'J. R. R. Tolkien' },
    { t: 'You can only see what you are prepared to see.', a: '' },
    { t: 'Begin anywhere.', a: 'John Cage' },
    { t: 'Small deeds done are better than great deeds planned.', a: 'Peter Marshall' },
    { t: 'The obstacle is the path.', a: 'Zen proverb' },
  ],

  // ---- helpers (pure) ---------------------------------------------------------
  dayKey(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },
  parseDay(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
  },
  _hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; },

  quoteOfDay(date, list = this.QUOTES) {
    return list[this._hash(this.dayKey(date)) % list.length];
  },

  // Whole days from today to `target` (negative once it has passed).
  daysUntil(target, today) {
    const a = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const b = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    return Math.round((b - a) / 86400000);
  },
  countdownText(days) {
    if (days === 0) return 'Today';
    const n = Math.abs(days);
    const unit = n === 1 ? 'day' : 'days';
    return days > 0 ? n + ' ' + unit + ' to go' : n + ' ' + unit + ' ago';
  },

  // Consecutive days ending today (or yesterday: an untapped today does not
  // break it yet, as in Habits). days: array of 'YYYY-MM-DD'.
  streak(days, today) {
    const set = new Set(days);
    let d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (!set.has(this.dayKey(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (set.has(this.dayKey(d))) { n += 1; d.setDate(d.getDate() - 1); }
    return n;
  },

  _ctx(ctx) {
    const c = ctx || {};
    return {
      now: typeof c.now === 'function' ? c.now : () => new Date(),
      storage: c.storage || {
        get: (k) => localStorage.getItem(k),
        set: (k, v) => localStorage.setItem(k, v),
      },
    };
  },
  _mk(doc, tag, cls, text) { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },

  // ---- components --------------------------------------------------------------
  TYPES: {
    quote: {
      title: 'Quote of the day',
      icon: 'sparkles',
      defaults: () => ({}),
      validate: () => ({}),
      mount(el, cfg, ctx) {
        const c = VexWidgets._ctx(ctx), doc = el.ownerDocument;
        const q = VexWidgets.quoteOfDay(c.now());
        el.textContent = '';
        const box = VexWidgets._mk(doc, 'figure', 'vex-widget vex-widget-quote');
        box.appendChild(VexWidgets._mk(doc, 'blockquote', 'vex-widget-quote-text', q.t));
        if (q.a) box.appendChild(VexWidgets._mk(doc, 'figcaption', 'vex-widget-quote-by', q.a));
        el.appendChild(box);
        return { dispose() { el.textContent = ''; } };
      },
    },

    countdown: {
      title: 'Countdown',
      icon: 'calendar',
      defaults: () => ({ label: '', date: '' }),
      validate(cfg) {
        const label = String((cfg && cfg.label) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (!label) throw new Error('Give the countdown a name');
        if (!VexWidgets.parseDay(cfg && cfg.date)) throw new Error('Give the date as YYYY-MM-DD');
        return { label, date: String(cfg.date).trim() };
      },
      mount(el, cfg, ctx) {
        const c = VexWidgets._ctx(ctx), doc = el.ownerDocument;
        const target = VexWidgets.parseDay(cfg && cfg.date);
        el.textContent = '';
        const box = VexWidgets._mk(doc, 'div', 'vex-widget vex-widget-countdown');
        if (!target) {
          box.appendChild(VexWidgets._mk(doc, 'div', 'vex-widget-muted', 'This countdown has no valid date.'));
        } else {
          const days = VexWidgets.daysUntil(target, c.now());
          box.appendChild(VexWidgets._mk(doc, 'div', 'vex-widget-count', VexWidgets.countdownText(days)));
          box.appendChild(VexWidgets._mk(doc, 'div', 'vex-widget-label', String(cfg.label || '')));
        }
        el.appendChild(box);
        return { dispose() { el.textContent = ''; } };
      },
    },

    photo: {
      title: 'Photo',
      icon: 'image',
      defaults: () => ({ key: '' }),
      validate(cfg) { return { key: String((cfg && cfg.key) || '') }; },
      mount(el, cfg, ctx) {
        const c = VexWidgets._ctx(ctx), doc = el.ownerDocument;
        el.textContent = '';
        const box = VexWidgets._mk(doc, 'div', 'vex-widget vex-widget-photo');
        const data = cfg && cfg.key ? c.storage.get(cfg.key) : null;
        if (data && /^data:image\/(jpeg|png|webp);base64,/.test(data)) {
          const img = doc.createElement('img');
          img.src = data;
          img.alt = String((cfg && cfg.alt) || 'Your photo');
          box.appendChild(img);
        } else {
          box.appendChild(VexWidgets._mk(doc, 'div', 'vex-widget-muted', 'No photo chosen yet.'));
        }
        el.appendChild(box);
        return { dispose() { el.textContent = ''; } };
      },
    },

    habit: {
      title: 'Habit',
      icon: 'check',
      defaults: () => ({ label: '', key: '' }),
      validate(cfg) {
        const label = String((cfg && cfg.label) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (!label) throw new Error('Give the habit a name');
        return { label, key: String((cfg && cfg.key) || '') };
      },
      read(ctx, key) {
        const raw = VexWidgets._ctx(ctx).storage.get(key);
        if (raw == null) return [];
        let a;
        try { a = JSON.parse(raw); } catch (err) { throw new Error('This habit could not be read', { cause: err }); }
        return Array.isArray(a) ? a.filter(x => typeof x === 'string') : [];
      },
      // Tap today: on <-> off. Returns the new list.
      toggle(ctx, key, day) {
        const c = VexWidgets._ctx(ctx);
        const days = VexWidgets.TYPES.habit.read(ctx, key);
        const i = days.indexOf(day);
        if (i >= 0) days.splice(i, 1); else days.push(day);
        days.sort();
        c.storage.set(key, JSON.stringify(days.slice(-400)));
        return days;
      },
      mount(el, cfg, ctx) {
        const c = VexWidgets._ctx(ctx), doc = el.ownerDocument;
        const self = VexWidgets.TYPES.habit;
        const paint = () => {
          el.textContent = '';
          const today = c.now();
          const days = cfg && cfg.key ? self.read(ctx, cfg.key) : [];
          const set = new Set(days);
          const box = VexWidgets._mk(doc, 'div', 'vex-widget vex-widget-habit');
          const head = VexWidgets._mk(doc, 'div', 'vex-widget-label', String((cfg && cfg.label) || ''));
          const dots = VexWidgets._mk(doc, 'div', 'vex-widget-dots');
          for (let i = 6; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
            const key = VexWidgets.dayKey(d);
            const isToday = i === 0;
            const b = VexWidgets._mk(doc, 'button', 'vex-widget-dot' + (set.has(key) ? ' is-done' : '') + (isToday ? ' is-today' : ''));
            b.type = 'button';
            b.setAttribute('aria-pressed', set.has(key) ? 'true' : 'false');
            b.setAttribute('aria-label', (cfg.label || 'Habit') + ', ' + key + (set.has(key) ? ', done' : ', not done'));
            b.addEventListener('click', () => {
              try { self.toggle(ctx, cfg.key, key); paint(); }
              catch (err) { console.error('[VexWidgets]', err); head.textContent = err.message; }
            });
            dots.appendChild(b);
          }
          const n = VexWidgets.streak([...set], today);
          box.append(head, dots, VexWidgets._mk(doc, 'div', 'vex-widget-muted', n ? n + (n === 1 ? ' day in a row' : ' days in a row') : 'Tap a dot to tick the day'));
          el.appendChild(box);
        };
        paint();
        return { dispose() { el.textContent = ''; } };
      },
    },
  },

  mount(el, widget, ctx) {
    const type = this.TYPES[widget && widget.type];
    if (!type) throw new Error('Unknown widget type: ' + (widget && widget.type));
    return type.mount(el, widget.cfg || {}, ctx);
  },

  // Every widget on the shelf into `container`, one cell each.
  mountAll(container, ctx) {
    const doc = container.ownerDocument;
    container.textContent = '';
    const handles = [];
    const errors = [];
    for (const w of this.list()) {
      const cell = doc.createElement('div');
      cell.className = 'vex-widget-cell';
      cell.dataset.widgetId = w.id;
      container.appendChild(cell);
      try { handles.push(this.mount(cell, w, ctx)); } catch (err) { errors.push(w.type + ': ' + err.message); cell.textContent = err.message; }
    }
    return { errors, dispose() { handles.forEach(h => h.dispose()); container.textContent = ''; } };
  },

  // ---- the shelf (data model) --------------------------------------------------
  list() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return [];
    let s;
    try { s = JSON.parse(raw); } catch (err) { throw new Error('Your start page widgets could not be read', { cause: err }); }
    const a = s && Array.isArray(s.widgets) ? s.widgets : [];
    return a.filter(w => w && typeof w.id === 'string' && this.TYPES[w.type]);
  },
  _save(widgets) {
    localStorage.setItem(this.KEY, JSON.stringify({ v: 1, widgets }));
    try { document.dispatchEvent(new CustomEvent('vex:widgets-changed')); } catch { /* no document */ }
  },
  _id() { return window.vexId ? window.vexId('wdg') : 'wdg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7); },

  add(type, cfg) {
    const t = this.TYPES[type];
    if (!t) throw new Error('Unknown widget type: ' + type);
    const list = this.list();
    if (list.length >= this.MAX) throw new Error('That is ' + this.MAX + ' widgets already');
    const w = { id: this._id(), type, cfg: t.validate(cfg || t.defaults()) };
    // Habit and photo widgets keep their data under a key of their own.
    if (type === 'habit') w.cfg.key = 'vex.startWidgets.habit.' + w.id;
    if (type === 'photo') w.cfg.key = 'vex.startWidgets.photo.' + w.id;
    list.push(w);
    this._save(list);
    return w;
  },
  update(id, cfg) {
    const list = this.list();
    const w = list.find(x => x.id === id);
    if (!w) throw new Error('That widget is gone');
    const next = this.TYPES[w.type].validate({ ...w.cfg, ...cfg });
    if (w.cfg.key) next.key = w.cfg.key;
    w.cfg = next;
    this._save(list);
    return w;
  },
  remove(id) {
    const list = this.list();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) throw new Error('That widget is gone');
    const [w] = list.splice(i, 1);
    this._save(list);
    if (w.cfg && w.cfg.key) localStorage.removeItem(w.cfg.key);
    return w;
  },
  move(id, delta) {
    const list = this.list();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) throw new Error('That widget is gone');
    const j = Math.max(0, Math.min(list.length - 1, i + delta));
    const [w] = list.splice(i, 1);
    list.splice(j, 0, w);
    this._save(list);
  },

  // A picture from the person's own disk: shrunk and kept as a data URL on
  // this PC. Nothing is uploaded.
  async setPhoto(id, file) {
    const list = this.list();
    const w = list.find(x => x.id === id);
    if (!w || w.type !== 'photo') throw new Error('That is not a photo widget');
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Pick a JPEG, PNG or WebP picture');
    const url = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('The picture could not be read'));
      r.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not a readable picture'));
      i.src = url;
    });
    const scale = Math.min(1, this.PHOTO_MAX_EDGE / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL('image/jpeg', 0.82);
    if (out.length > this.PHOTO_MAX_CHARS) throw new Error('That picture is too large even after shrinking');
    localStorage.setItem(w.cfg.key, out);
    this._save(list);
    return out;
  },

  // ---- Settings (rendered into the module-owned group) --------------------------
  renderSettings(container) {
    if (!container) return;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const wrap = el('div', 'vex-delight-widgets');
    wrap.setAttribute('data-widgets', '');
    const redraw = () => this.renderSettings(container);
    const guard = async (fn) => { try { await fn(); } catch (err) { window.showToast?.(err.message, 'error'); } redraw(); };
    let list;
    try { list = this.list(); } catch (err) { wrap.appendChild(el('div', 'setting-info', err.message)); container.querySelector('[data-widgets]')?.remove(); container.appendChild(wrap); return; }
    if (!list.length) wrap.appendChild(el('div', 'setting-info', 'No widgets yet. The start page stays as it is until you add one.'));
    for (const w of list) {
      const row = el('div', 'setting-toggle-row');
      const t = this.TYPES[w.type];
      const name = w.cfg.label ? t.title + ': ' + w.cfg.label : t.title;
      row.appendChild(el('span', '', name));
      const right = el('span', 'vex-delight-inline');
      const icon = (label, ic, fn) => {
        const b = el('button', 'btn-secondary vex-delight-iconbtn');
        b.type = 'button'; b.setAttribute('aria-label', label); b.title = label;
        if (typeof VexIcons !== 'undefined') b.innerHTML = VexIcons.svg(ic, { size: 14 }); else b.textContent = label;
        b.addEventListener('click', () => guard(fn));
        return b;
      };
      if (w.type === 'photo') {
        right.appendChild(icon('Choose picture', 'image', async () => {
          const input = document.createElement('input');
          input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
          const file = await new Promise(resolve => { input.addEventListener('change', () => resolve(input.files[0] || null)); input.click(); });
          if (file) await this.setPhoto(w.id, file);
        }));
      }
      if (w.type === 'countdown') {
        right.appendChild(icon('Change date', 'calendar', async () => {
          const d = await window.vexPrompt({ title: 'Countdown date', label: 'Date (YYYY-MM-DD)', value: w.cfg.date, okLabel: 'Save' });
          if (d) this.update(w.id, { date: d });
        }));
      }
      right.appendChild(icon('Move up', 'chevron-up', () => this.move(w.id, -1)));
      right.appendChild(icon('Move down', 'chevron-down', () => this.move(w.id, 1)));
      right.appendChild(icon('Remove', 'trash', async () => {
        const ok = await window.vexConfirm({ title: 'Remove this widget?', message: name, okLabel: 'Remove', danger: true });
        if (ok) this.remove(w.id);
      }));
      row.appendChild(right);
      wrap.appendChild(row);
    }
    const add = el('div', 'setting-toggle-row');
    add.appendChild(el('span', '', 'Add a widget'));
    const right = el('span', 'vex-delight-inline');
    for (const type of Object.keys(this.TYPES)) {
      const b = el('button', 'btn-secondary vex-delight-btn');
      b.type = 'button';
      if (typeof VexIcons !== 'undefined') b.innerHTML = VexIcons.svg(this.TYPES[type].icon, { size: 14 });
      b.appendChild(el('span', '', this.TYPES[type].title));
      b.addEventListener('click', () => guard(async () => {
        let cfg = {};
        if (type === 'countdown' || type === 'habit') {
          const label = await window.vexPrompt({ title: this.TYPES[type].title, label: 'Name', okLabel: type === 'habit' ? 'Add' : 'Next' });
          if (!label) return;
          cfg.label = label;
          if (type === 'countdown') {
            const d = await window.vexPrompt({ title: label, label: 'Date (YYYY-MM-DD)', okLabel: 'Add' });
            if (!d) return;
            cfg.date = d;
          }
        }
        this.add(type, cfg);
      }));
      right.appendChild(b);
    }
    add.appendChild(right);
    wrap.appendChild(add);
    container.querySelector('[data-widgets]')?.remove();
    container.appendChild(wrap);
  },
};

if (typeof window !== 'undefined') window.VexWidgets = VexWidgets;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexWidgets };
