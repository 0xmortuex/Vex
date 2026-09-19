// === Expenses — where did the money go this month? ===
//
// A log of what you spent: an amount, a category, a note, a day. The month
// view answers the two questions people actually ask — how much this month,
// and on what — and says how that compares with last month. Everything stays
// on this computer; Export CSV hands it to a spreadsheet.
//
// Amounts are kept in whole cents (minor units), never as floating point, so
// forty coffees add up to exactly what the receipts say.

const Expenses = {
  KEY: 'vex.expenses',
  CURRENCY_KEY: 'vex.expenses.currency',
  CATEGORIES: ['Food', 'Groceries', 'Transport', 'Bills', 'Shopping', 'Fun', 'Health', 'Other'],
  CURRENCIES: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'TRY', 'INR', 'AED', 'SAR', 'EGP', 'LBP', 'JOD', 'BRL', 'MXN'],
  MAX_CENTS: 100000000 * 100,          // one hundred million: a typo, not a coffee

  // --- storage ---------------------------------------------------------------------
  list() {
    // Unreadable data is an error, not an empty log that the next save would
    // write over.
    let a;
    try { a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); }
    catch (err) { throw new Error('Your expenses could not be read', { cause: err }); }
    return Array.isArray(a) ? a.filter(e => e && typeof e.id === 'string' && Number.isInteger(e.cents) && /^\d{4}-\d{2}-\d{2}$/.test(e.day)) : [];
  },
  _save(items) { localStorage.setItem(this.KEY, JSON.stringify(items)); },

  currency() {
    const c = localStorage.getItem(this.CURRENCY_KEY);
    return this.CURRENCIES.includes(c) ? c : 'USD';
  },
  setCurrency(code) {
    if (!this.CURRENCIES.includes(code)) throw new Error('Not a currency Vex knows: ' + code);
    localStorage.setItem(this.CURRENCY_KEY, code);
  },

  // --- amounts ---------------------------------------------------------------------
  // The chosen currency's own marks: its symbol ("$", "£", "€") and its code.
  _marks(currency) {
    const sym = new Intl.NumberFormat(undefined, { style: 'currency', currency }).formatToParts(1).find(p => p.type === 'currency');
    return new Set([currency.toLowerCase(), sym ? sym.value.toLowerCase() : currency.toLowerCase()]);
  },

  // "12.50", "12,50", "1,234.56", "1.234,56", "£12" → cents. A lone comma
  // followed by one or two digits is a decimal comma; otherwise commas and
  // dots before the last separator are thousands.
  parseAmount(text, currency = this.currency()) {
    // "£12" is fine when you keep GBP. When you keep USD it is not twelve
    // dollars, and quietly calling it that would make every total wrong.
    const mark = String(text == null ? '' : text).replace(/\s/g, '').replace(/^-/, '').replace(/[\d.,]+/, '').toLowerCase();
    if (mark && /\d/.test(String(text)) && !this._marks(currency).has(mark)) throw new Error('“' + text + '” is not in ' + currency + ' — Expenses are kept in ' + currency + ' (change it at the top)');
    let s = String(text == null ? '' : text).replace(/[\s ]/g, '').replace(/^[^\d.,-]+|[^\d.,]+$/g, '');
    if (!s || s.startsWith('-')) throw new Error('Write the amount spent, like 12.50');
    const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    let whole = s, frac = '';
    if (lastSep >= 0 && s.length - lastSep - 1 <= 2 && s.length - lastSep - 1 > 0) {
      whole = s.slice(0, lastSep); frac = s.slice(lastSep + 1);
    } else if (lastSep >= 0 && s.length - lastSep - 1 !== 3) {
      throw new Error('That amount does not look right: ' + text);
    }
    // Thousands come in groups of three, with one separator that is not the
    // decimal one: "1,234.5" yes, "1,23,4.5" or "1.234.5" no.
    const decimalSep = frac ? s[lastSep] : null;
    if (!/^\d*$/.test(whole) && (!/^\d{1,3}([.,]\d{3})+$/.test(whole) || (decimalSep && whole.includes(decimalSep)) || (whole.includes('.') && whole.includes(',')))) {
      throw new Error('That amount does not look right: ' + text);
    }
    whole = whole.replace(/[.,]/g, '');
    if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac) || (!whole && !frac)) throw new Error('That amount does not look right: ' + text);
    const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
    if (!cents) throw new Error('The amount cannot be zero');
    if (cents > this.MAX_CENTS) throw new Error('That amount is too large — check for a typo');
    return cents;
  },

  format(cents, currency = this.currency()) {
    const digits = currency === 'JPY' ? 0 : 2;
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(cents / 100);
  },

  dayKey(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  // --- the log ---------------------------------------------------------------------
  add({ amount, category, note, day } = {}) {
    const cents = this.parseAmount(amount);
    const cat = String(category == null ? '' : category).replace(/\s+/g, ' ').trim().slice(0, 40) || 'Other';
    const d = day || this.dayKey(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Not a day: ' + d);
    const items = this.list();
    const e = { id: window.vexId ? window.vexId('exp') : 'exp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), cents, category: cat, note: String(note == null ? '' : note).replace(/\s+/g, ' ').trim().slice(0, 200), day: d, at: Date.now() };
    items.push(e);
    this._save(items);
    return e;
  },

  remove(id) {
    const items = this.list();
    const i = items.findIndex(e => e.id === id);
    if (i < 0) throw new Error('That expense is gone');
    const [gone] = items.splice(i, 1);
    this._save(items);
    return gone;
  },

  // month is "YYYY-MM".
  month(items, month) {
    const inMonth = items.filter(e => e.day.startsWith(month + '-')).sort((a, b) => b.day.localeCompare(a.day) || b.at - a.at);
    const byCat = new Map();
    for (const e of inMonth) byCat.set(e.category, (byCat.get(e.category) || 0) + e.cents);
    const total = inMonth.reduce((s, e) => s + e.cents, 0);
    return { month, items: inMonth, total, categories: [...byCat.entries()].map(([name, cents]) => ({ name, cents, share: total ? cents / total : 0 })).sort((a, b) => b.cents - a.cents) };
  },

  shiftMonth(month, by) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + by, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  },

  toCsv(items, currency = this.currency()) {
    const q = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
    const rows = [['Date', 'Amount', 'Currency', 'Category', 'Note']];
    for (const e of [...items].sort((a, b) => a.day.localeCompare(b.day) || a.at - b.at)) rows.push([e.day, (e.cents / 100).toFixed(2), currency, e.category, e.note]);
    return rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
  },

  // --- the sheet -------------------------------------------------------------------
  open() {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { head, body } = window.PageExport._sheet('Expenses', 'vex-expenses-overlay');
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    head.insertAdjacentHTML('beforeend', `
      <select data-currency aria-label="Currency" style="font-size:11.5px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:2px 4px">${this.CURRENCIES.map(c => `<option ${c === this.currency() ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <button data-csv type="button" style="${btn}">Export CSV</button>`);
    let month = this.dayKey(new Date()).slice(0, 7);

    head.querySelector('[data-currency]').addEventListener('change', (e) => { this.setCurrency(e.target.value); draw(); });
    head.querySelector('[data-csv]').addEventListener('click', () => {
      const items = this.list();
      if (!items.length) { window.showToast?.('Nothing to export yet', 'error'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([this.toCsv(items)], { type: 'text/csv' }));
      a.download = 'vex-expenses-' + this.dayKey(new Date()) + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });

    const draw = () => {
      const all = this.list();
      const cur = this.month(all, month);
      const prev = this.month(all, this.shiftMonth(month, -1));
      const label = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      const isNow = month === this.dayKey(new Date()).slice(0, 7);
      const diff = cur.total - prev.total;
      const cats = [...new Set([...this.CATEGORIES, ...all.map(e => e.category)])];
      const field = 'font:inherit;font-size:13px;padding:7px 9px;border-radius:7px;border:1px solid var(--border);background:var(--surface);color:var(--text)';
      body.innerHTML = `
        <form data-add style="display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border)">
          <input data-amount type="text" inputmode="decimal" placeholder="12.50" aria-label="Amount" style="${field};width:90px">
          <input data-category type="text" list="vex-exp-cats" placeholder="Category" aria-label="Category" style="${field};width:120px">
          <datalist id="vex-exp-cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
          <input data-note type="text" maxlength="200" placeholder="What for (optional)" aria-label="Note" style="${field};flex:1;min-width:120px">
          <input data-day type="date" value="${this.dayKey(new Date())}" max="${this.dayKey(new Date())}" aria-label="Day" style="${field}">
          <button type="submit" style="font:inherit;font-size:12px;padding:6px 12px;border-radius:7px;border:none;background:var(--primary);color:#fff;cursor:pointer">Add</button>
        </form>
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px 4px">
          <button data-prev type="button" aria-label="Previous month" style="display:inline-flex;${btn}">${VexIcons.svg('arrow-left', { size: 12 })}</button>
          <div style="flex:1;text-align:center">
            <div style="font-size:12px;color:var(--text-muted)">${esc(label)}</div>
            <div data-total style="font-size:22px;font-weight:700;color:var(--text)">${esc(this.format(cur.total))}</div>
            <div style="font-size:11.5px;color:var(--text-muted)">${prev.total ? `${esc(this.format(Math.abs(diff)))} ${diff > 0 ? 'more' : diff < 0 ? 'less' : 'the same'} than last month (${esc(this.format(prev.total))})` : 'Nothing logged the month before'}</div>
          </div>
          <button data-next type="button" aria-label="Next month" ${isNow ? 'disabled' : ''} style="display:inline-flex;${btn};${isNow ? 'opacity:0.4;cursor:default' : ''}">${VexIcons.svg('arrow-right', { size: 12 })}</button>
        </div>
        <div style="padding:8px 14px">${cur.categories.map(c => `
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;margin:5px 0">
            <div style="width:90px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</div>
            <div style="flex:1;height:8px;border-radius:4px;background:var(--surface);overflow:hidden"><div style="height:100%;width:${Math.max(2, Math.round(c.share * 100))}%;background:var(--primary)"></div></div>
            <div style="width:110px;text-align:right;color:var(--text)">${esc(this.format(c.cents))} <span style="color:var(--text-muted)">${Math.round(c.share * 100)}%</span></div>
          </div>`).join('')}</div>
        <div data-rows style="padding:0 6px 10px">${cur.items.length ? '' : `<div style="padding:18px 12px;text-align:center;font-size:12.5px;color:var(--text-muted)">Nothing logged in ${esc(label)}.</div>`}</div>`;

      const rows = body.querySelector('[data-rows]');
      for (const e of cur.items) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 8px;border-top:1px solid var(--border);font-size:12.5px';
        row.innerHTML = `
          <div style="width:52px;color:var(--text-muted);font-size:11px">${esc(new Date(e.day + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</div>
          <div style="flex:1;min-width:0;overflow-wrap:anywhere;color:var(--text)">${esc(e.note || e.category)} ${e.note ? `<span style="color:var(--text-muted);font-size:11px">· ${esc(e.category)}</span>` : ''}</div>
          <div style="color:var(--text);font-variant-numeric:tabular-nums">${esc(this.format(e.cents))}</div>
          <button data-remove type="button" aria-label="Remove ${esc(this.format(e.cents) + ' ' + (e.note || e.category))}" style="display:inline-flex;background:none;border:none;cursor:pointer;color:var(--text-muted);padding:3px">${VexIcons.svg('trash', { size: 13 })}</button>`;
        row.querySelector('[data-remove]').addEventListener('click', () => {
          const gone = this.remove(e.id);
          draw();
          window.showToast?.('Removed ' + this.format(gone.cents));
        });
        rows.appendChild(row);
      }

      body.querySelector('[data-add]').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const f = body.querySelector('[data-add]');
        try {
          const e = this.add({ amount: f.querySelector('[data-amount]').value, category: f.querySelector('[data-category]').value, note: f.querySelector('[data-note]').value, day: f.querySelector('[data-day]').value });
          month = e.day.slice(0, 7);
          draw();
          body.querySelector('[data-amount]').focus();
        } catch (err) { window.showToast?.(err.message, 'error'); }
      });
      body.querySelector('[data-prev]').addEventListener('click', () => { month = this.shiftMonth(month, -1); draw(); });
      body.querySelector('[data-next]').addEventListener('click', () => { if (!isNow) { month = this.shiftMonth(month, 1); draw(); } });
    };
    draw();
    return body;
  },
};

if (typeof window !== 'undefined') window.Expenses = Expenses;
if (typeof module !== 'undefined') module.exports = { Expenses };
