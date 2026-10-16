// === Expense capture at checkout, and the monthly close ======================
//
// Expenses (js/expenses.js) already keeps the log, the month view and the CSV.
// What it never had was an easy way in, or a nudge on the 1st. This adds both.
//
// Capture (Ctrl+K › Log expense from this page):
//   - Select the total on the confirmation page first. Vex reads ONLY the text
//     you selected (at most 2,000 characters) when you run the command; it never
//     reads a form field, a card number or the rest of the page. If a text box has
//     the focus, or the selection holds a number that passes the card-number
//     check, it refuses and says why.
//   - It proposes an amount (the one beside "total"/"toplam" if there is one), a
//     category guessed from the site and the words, and a note from the page
//     title. You edit them and press Save. Nothing is saved without that press.
//   - It is opt-in per site: the first time on a site it asks, and you can take
//     the site off the list in Settings.
//   - Expenses keeps one currency; an amount in another is refused by name, not
//     converted on a guess.
//
// Monthly close: on the first open of a new month, one notice in the Attention
// Inbox, "Last month: 4,320 TRY, Food +18%", and a card with the categories and
// an Export CSV for that month. No OCR here: a receipt that is an image is typed
// in the dialog.
//
//   VexExpenseCapture.findAmounts(text)       pure: [{ raw, currency, score }], best first
//   VexExpenseCapture.looksLikeCard(text)     pure: a 13-19 digit run that passes the Luhn check
//   VexExpenseCapture.guessCategory(host, t)  pure
//   VexExpenseCapture.monthClose(items, m)    pure: totals and the category that moved most

const VexExpenseCapture = {
  SITES_KEY: 'vex.expenseCapture.sites',     // [host] the person allowed
  CLOSED_KEY: 'vex.expenseCapture.closed',   // 'YYYY-MM' of the month whose card was last offered
  PREF: 'vex.expenseCapture.enabled',        // 'off' hides the commands and the monthly notice
  MAX_SELECTION: 2000,
  MAX_SITES: 100,
  CATEGORY_WORDS: [
    ['Groceries', /migros|a101|\bbim\b|\bşok\b|carrefour|market|grocery|groceries|getir|bakkal/i],
    ['Food', /yemek|restaurant|restoran|cafe|kafe|coffee|kahve|burger|pizza|doner|döner|trendyolyemek|yemeksepeti|food|lokanta/i],
    ['Transport', /uber|bitaksi|taksi|taxi|otob[uü]s|bilet|train|tren|flight|ucak|uçak|thy|pegasus|yakıt|fuel|parking|otopark|metro|marti|martı/i],
    ['Bills', /fatura|bill|elektrik|electric|su faturası|internet|turkcell|vodafone|t[uü]rk telekom|doğalgaz|natural gas|kira|rent|aidat/i],
    ['Health', /eczane|pharmacy|hospital|hastane|doktor|doctor|clinic|klinik|medical|sağlık|health/i],
    ['Fun', /steam|netflix|spotify|youtube|cinema|sinema|game|oyun|epic games|playstation|xbox|disney|concert|konser|bilet\.?com/i],
    ['Shopping', /amazon|trendyol|hepsiburada|n11|aliexpress|temu|ebay|shop|store|mağaza|cart|sepet|checkout|ödeme|payment|order|sipariş/i],
  ],

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  // ---- pure ----------------------------------------------------------------------------
  looksLikeCard(text) {
    for (const m of String(text == null ? '' : text).matchAll(/(?:\d[ -]?){13,19}/g)) {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length < 13 || digits.length > 19) continue;
      let sum = 0, alt = false;
      for (let i = digits.length - 1; i >= 0; i--) {
        let n = Number(digits[i]);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n; alt = !alt;
      }
      if (sum % 10 === 0) return true;
    }
    return false;
  },
  CUR: { '₺': 'TRY', 'TL': 'TRY', 'TRY': 'TRY', '$': 'USD', 'USD': 'USD', '€': 'EUR', 'EUR': 'EUR', '£': 'GBP', 'GBP': 'GBP' },
  findAmounts(text) {
    const src = String(text == null ? '' : text);
    const out = [];
    const num = '\\d{1,3}(?:[.,\\s]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';
    const cur = '₺|TL|TRY|USD|EUR|GBP|\\$|€|£';
    const patterns = [
      new RegExp('(' + cur + ')\\s?(' + num + ')', 'g'),
      new RegExp('(' + num + ')\\s?(' + cur + ')', 'g'),
    ];
    patterns[0].kind = 'pre'; patterns[1].kind = 'post';
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {
        const sym = re.kind === 'pre' ? m[1] : m[2], n = re.kind === 'pre' ? m[2] : m[1];
        const raw = (re.kind === 'pre' ? sym + n : n + ' ' + sym).trim();
        // The words in the 30 characters before the number say whether it is a total.
        const before = src.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
        const score = (/genel toplam|grand total|total|toplam|tutar|amount due|amount|paid|ödenen|odenen|ödeme/.test(before) ? 2 : 0) + (/ara toplam|subtotal|kdv|vat|tax|shipping|kargo/.test(before) ? -1 : 0);
        out.push({ raw, currency: this.CUR[sym.toUpperCase()] || this.CUR[sym] || '', score, at: m.index });
      }
    }
    return out.sort((a, b) => b.score - a.score || b.at - a.at).slice(0, 5).map(({ raw, currency, score }) => ({ raw, currency, score }));
  },
  guessCategory(host, text) {
    const hay = String(host || '') + ' ' + String(text || '');
    for (const [cat, re] of this.CATEGORY_WORDS) if (re.test(hay)) return cat;
    return 'Other';
  },
  _pct(now, before) { return before > 0 ? Math.round(((now - before) / before) * 100) : null; },
  // items: the Expenses log. -> { month, total, prevTotal, change, categories:[{name,cents,prev,pct}], mover }
  monthClose(items, month, E = (typeof Expenses !== 'undefined' ? Expenses : null)) {
    if (!E) throw new Error('Expenses is not loaded');
    const cur = E.month(items, month), prev = E.month(items, E.shiftMonth(month, -1));
    const prevBy = new Map(prev.categories.map(c => [c.name, c.cents]));
    const categories = cur.categories.map(c => ({ name: c.name, cents: c.cents, prev: prevBy.get(c.name) || 0, pct: this._pct(c.cents, prevBy.get(c.name) || 0) }));
    // The category that rose most, in money, and at least 10 percent.
    const mover = categories.filter(c => c.pct != null && c.pct >= 10).sort((a, b) => (b.cents - b.prev) - (a.cents - a.prev))[0] || null;
    return { month, total: cur.total, prevTotal: prev.total, change: this._pct(cur.total, prev.total), categories, mover, count: cur.items.length };
  },
  closeLine(c, E = (typeof Expenses !== 'undefined' ? Expenses : null)) {
    const money = (cents) => E.format(cents);
    return 'Last month: ' + money(c.total) + (c.mover ? ', ' + c.mover.name + ' +' + c.mover.pct + '%' : '') + (c.change != null && !c.mover ? ' (' + (c.change >= 0 ? '+' : '') + c.change + '% on the month before)' : '');
  },

  // ---- sites the person allowed ----------------------------------------------------------
  sites() {
    const raw = localStorage.getItem(this.SITES_KEY);
    if (raw == null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('Your allowed sites could not be read: ' + err.message); }
    return Array.isArray(v) ? v.filter(s => typeof s === 'string') : [];
  },
  allowSite(host) {
    const h = String(host || '').toLowerCase();
    if (!h) throw new Error('That page has no site name');
    const list = this.sites();
    if (list.includes(h)) return list;
    if (list.length >= this.MAX_SITES) throw new Error('That is ' + this.MAX_SITES + ' sites; remove some first');
    list.push(h);
    try { localStorage.setItem(this.SITES_KEY, JSON.stringify(list)); } catch (err) { throw new Error('Your allowed sites could not be saved: ' + err.message); }
    return list;
  },
  forgetSite(host) {
    const list = this.sites().filter(s => s !== host);
    try { localStorage.setItem(this.SITES_KEY, JSON.stringify(list)); } catch (err) { throw new Error('Your allowed sites could not be saved: ' + err.message); }
    return list;
  },

  // ---- reading the selection ----------------------------------------------------------------
  async readSelection() {
    if (typeof WebviewManager === 'undefined') throw new Error('Pages are not loaded');
    const wv = WebviewManager.getActiveWebview?.();
    if (!wv || typeof wv.executeJavaScript !== 'function') throw new Error('Open the confirmation page first');
    const url = typeof wv.getURL === 'function' ? wv.getURL() : '';
    if (!/^https?:/i.test(url)) throw new Error('Only a web page can be read');
    const r = await Promise.race([
      wv.executeJavaScript('(function(){var a=document.activeElement;if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)){return {blocked:true};}var s=String(window.getSelection()||"").slice(0,' + this.MAX_SELECTION + ');return {blocked:false,text:s,title:String(document.title||"").slice(0,120)};})()'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('The page did not answer in time')), 1500)),
    ]);
    if (!r || r.blocked) throw new Error('A text box has the focus. Click on the page itself, select the total, then run this again. Vex never reads form fields.');
    if (!r.text.trim()) throw new Error('Select the total on the page first (drag over the amount), then run this again');
    if (this.looksLikeCard(r.text)) throw new Error('The selection holds what looks like a card number, so Vex did not use it. Select only the amount.');
    return { url, host: new URL(url).hostname.toLowerCase(), text: r.text, title: r.title };
  },

  // ---- capture ---------------------------------------------------------------------------------
  async capture() {
    if (!this.enabled()) { window.showToast?.('Expense capture is switched off in Settings', 'info'); return; }
    if (typeof Expenses === 'undefined') throw new Error('Expenses is not loaded');
    const t = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    let host = '';
    try { host = new URL((t && t.url) || '').hostname.toLowerCase(); } catch { host = ''; }
    if (!host) throw new Error('Open the confirmation page first');
    if (!this.sites().includes(host)) {
      const ok = await window.vexConfirm({ title: 'Read the total on ' + host + '?', message: 'When you run this on ' + host + ', Vex reads only the text you selected, to fill in an expense you then confirm. It never reads form fields. You can take the site off the list in Settings.', okLabel: 'Allow this site' });
      if (!ok) return;
      this.allowSite(host);
    }
    const sel = await this.readSelection();
    if (typeof VexUsage !== 'undefined') VexUsage.touch('expense-capture');
    const found = this.findAmounts(sel.text);
    this.confirmDialog({ amounts: found, host: sel.host, title: sel.title, text: sel.text });
  },

  confirmDialog({ amounts, host, title, text }) {
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-expense-capture', title: 'Log this expense', sub: 'Check the amount, the category and the note. Nothing is saved until you press Save.' });
    const mk = (tag, props = {}) => Object.assign(document.createElement(tag), props);
    const row = mk('div'); row.className = 'vexsr-rule'; row.style.flexWrap = 'wrap';
    const amount = mk('input', { type: 'text', inputMode: 'decimal', value: amounts[0] ? amounts[0].raw : '', placeholder: '12.50' }); amount.setAttribute('aria-label', 'Amount');
    const cat = mk('input', { type: 'text', value: this.guessCategory(host, title + ' ' + text), maxLength: 40 }); cat.setAttribute('aria-label', 'Category'); cat.setAttribute('list', 'vex-expcap-cats');
    const dl = mk('datalist', { id: 'vex-expcap-cats' }); for (const c of Expenses.CATEGORIES) dl.append(new Option(c));
    const note = mk('input', { type: 'text', value: (title || host).slice(0, 80), maxLength: 200 }); note.setAttribute('aria-label', 'Note');
    const day = mk('input', { type: 'date', value: Expenses.dayKey(new Date()) }); day.setAttribute('aria-label', 'Day');
    row.append(amount, cat, dl, note, day);
    body.appendChild(row);
    if (amounts.length > 1) {
      const alt = mk('div'); alt.className = 'vexsr-rule';
      alt.append(document.createTextNode('Other amounts in the selection: '));
      for (const a of amounts.slice(1)) alt.appendChild(VexSettingsGroups.button(a.raw, () => { amount.value = a.raw; }, { label: 'Use ' + a.raw }));
      body.appendChild(alt);
    }
    if (!amounts.length) body.appendChild(VexSettingsGroups.note('No amount was found in what you selected. Type it above.'));
    body.appendChild(VexSettingsGroups.note('Expenses are kept in ' + Expenses.currency() + '.'));
    body.appendChild(VexSettingsGroups.button('Save', () => {
      try {
        const e = Expenses.add({ amount: amount.value, category: cat.value, note: note.value, day: day.value });
        close();
        window.showToast?.('Logged ' + Expenses.format(e.cents) + ' (' + e.category + ')', 'success');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }, { primary: true }));
    amount.focus();
  },

  // ---- the monthly close ------------------------------------------------------------------------
  prevMonth(now = new Date()) { return Expenses.shiftMonth(Expenses.dayKey(now).slice(0, 7), -1); },
  exportMonth(month) {
    const items = Expenses.list().filter(e => e.day.startsWith(month + '-'));
    if (!items.length) throw new Error('Nothing was logged in ' + month);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([Expenses.toCsv(items)], { type: 'text/csv' }));
    a.download = 'vex-expenses-' + month + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return items.length;
  },
  openClose(month) {
    if (!this.enabled()) { window.showToast?.('Expense capture is switched off in Settings', 'info'); return; }
    if (typeof Expenses === 'undefined') { window.showToast?.('Expenses is not loaded', 'error'); return; }
    const m = month || this.prevMonth();
    let c;
    try { c = this.monthClose(Expenses.list(), m); } catch (err) { window.showToast?.(err.message, 'error'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('expense-capture');
    const label = new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const { body } = VexSettingsGroups.dialog({ id: 'vex-expense-close', title: label + ' in money', sub: c.count ? this.closeLine(c) : 'Nothing was logged in ' + label + '.' });
    for (const k of c.categories) {
      const row = document.createElement('div'); row.className = 'vexsr-rule';
      const t = document.createElement('span'); t.className = 'vexsr-host'; t.style.wordBreak = 'normal';
      t.textContent = k.name + ': ' + Expenses.format(k.cents) + (k.pct != null ? '  (' + (k.pct >= 0 ? '+' : '') + k.pct + '% on the month before)' : '  (new this month)');
      row.appendChild(t);
      body.appendChild(row);
    }
    if (c.count) body.appendChild(VexSettingsGroups.button('Export ' + label + ' as CSV', () => { try { this.exportMonth(m); } catch (err) { window.showToast?.(err.message, 'error'); } }, { primary: true }));
    body.appendChild(VexSettingsGroups.button('Open Expenses', () => Expenses.open()));
  },
  // On the first open of a new month: one notice for the month that just ended.
  offerClose(now = new Date()) {
    if (!this.enabled() || typeof Expenses === 'undefined') return false;
    const month = this.prevMonth(now);
    if (localStorage.getItem(this.CLOSED_KEY) === month) return false;
    const c = this.monthClose(Expenses.list(), month);
    try { localStorage.setItem(this.CLOSED_KEY, month); } catch (err) { throw new Error('Could not remember the month close: ' + err.message); }
    if (!c.count) return false;
    if (typeof VexAttention === 'undefined') throw new Error('The attention gate is not loaded');
    VexAttention.suggest({ feature: 'expense-capture', id: 'close:' + month, title: this.closeLine(c), body: 'Open the month with its categories and a CSV export.', action: { label: 'Open the month', key: 'open:' + month } });
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('On a confirmation page, select the total and run Ctrl+K › Log expense from this page. Vex reads only the text you selected, proposes an amount and category, and saves only after you press Save. On the first open of a month it offers last month\'s total with a CSV export.'));
    el.appendChild(VexSettingsGroups.button('Last month, with export', () => this.openClose(), { primary: true }));
    let sites = [];
    try { sites = this.sites(); } catch (err) { el.appendChild(VexSettingsGroups.note(err.message)); }
    el.appendChild(VexSettingsGroups.note(sites.length ? 'Allowed sites:' : 'No site is allowed yet. Vex asks the first time you use it on a site.'));
    for (const s of sites) {
      const row = document.createElement('div'); row.className = 'vexsr-rule';
      const t = document.createElement('span'); t.className = 'vexsr-host'; t.textContent = s;
      row.append(t, VexSettingsGroups.button('Remove', () => { try { this.forgetSite(s); row.remove(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { danger: true, label: 'Remove ' + s }));
      el.appendChild(row);
    }
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle('expense-capture', (key) => {
        const m = /^open:(\d{4}-\d{2})$/.exec(String(key));
        if (!m) throw new Error('Unknown action ' + key);
        this.openClose(m[1]);
      });
    }
    setTimeout(() => {
      try { this.offerClose(); } catch (err) { window.VexProblems?.note('Expense capture', 'The month close could not be offered', err); }
    }, 15000);
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexExpenseCapture = VexExpenseCapture;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'expense-capture', title: 'Expense capture', keywords: 'expense capture checkout receipt total month close csv export spending lira', before: 'about', build: (el) => VexExpenseCapture.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'expense-capture', label: 'Log expense from this page', hint: 'Select the total on a confirmation page; you confirm the amount and category before it is saved', icon: 'receipt', action: () => VexExpenseCapture.capture().catch(err => window.showToast?.(err.message, 'error')) });
    VexExtras.registerCommand({ id: 'expense-close', label: 'Last month in money (with CSV export)', hint: 'Total, the category that moved most and an export', icon: 'receipt', action: () => VexExpenseCapture.openClose() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexExpenseCapture };
