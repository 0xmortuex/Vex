// === Receipt and warranty locker =============================================
//
// T2-086. For things you bought: the shop, the product, the day, how long you
// can send it back, when the warranty ends, and where the receipt file is. Vex
// keeps only those few facts (and the file's path); the receipt itself stays
// wherever you saved it, in a file you pick. Nothing is copied, uploaded, read
// or scanned.
//
// It counts: "return window closes in N days" (14 days by default, the usual
// right to withdraw from a distance sale; you can change it per item, or set 0
// for none) and "warranty ends on". Reminders are set 3 days before a return
// window closes and 30 and 7 days before a warranty ends. This is a helper, not
// legal advice: the shop's own terms and the law decide your rights.
const ReceiptLocker = {
  KEY: 'vex.receipts',
  ON_KEY: 'vex.receipts.enabled',
  MAX: 300,
  DEFAULT_RETURN_DAYS: 14,

  enabled() { return VexLifeKit.flag(this.ON_KEY, true); },
  setEnabled(on) { VexLifeKit.setFlag(this.ON_KEY, !!on); },

  // ---- pure --------------------------------------------------------------------------
  // -> the stored form, with returnEnd / warrantyEnd worked out. Throws with the reason.
  clean(input) {
    const store = String(input.store || '').trim();
    const product = String(input.product || '').trim();
    if (!store) throw new Error('Which shop?');
    if (!product) throw new Error('What did you buy?');
    if (store.length > 80 || product.length > 120) throw new Error('The shop is up to 80 characters and the product up to 120');
    const boughtMs = VexLifeKit.parseDay(input.boughtDay);
    const rd = input.returnDays === '' || input.returnDays == null ? this.DEFAULT_RETURN_DAYS : Number(input.returnDays);
    if (!Number.isInteger(rd) || rd < 0 || rd > 365) throw new Error('Return days are a whole number from 0 to 365');
    let warrantyEnd = '';
    if (String(input.warrantyEnd || '').trim()) warrantyEnd = VexLifeKit.dayString(VexLifeKit.parseDay(input.warrantyEnd));
    else if (String(input.warrantyMonths || '').trim()) {
      const m = Number(input.warrantyMonths);
      if (!Number.isInteger(m) || m < 1 || m > 120) throw new Error('Warranty months are a whole number from 1 to 120');
      const d = new Date(boughtMs);
      warrantyEnd = VexLifeKit.dayString(new Date(d.getFullYear(), d.getMonth() + m, d.getDate()).getTime());
    }
    const price = String(input.price || '').trim().slice(0, 30);
    const note = String(input.note || '').trim().slice(0, 300);
    const filePath = String(input.filePath || '').trim();
    if (filePath && (filePath.length > 1024 || !/^[A-Za-z]:[\\/]/.test(filePath) && !filePath.startsWith('\\\\'))) throw new Error('The receipt file must be a full path');
    return {
      id: input.id || VexLifeKit.uid('rc'), store, product, price, note, filePath,
      boughtDay: VexLifeKit.dayString(boughtMs), returnDays: rd,
      returnEnd: rd > 0 ? VexLifeKit.dayString(VexLifeKit.addDays(boughtMs, rd)) : '',
      warrantyEnd, remindIds: Array.isArray(input.remindIds) ? input.remindIds : [],
    };
  },
  // "closes in 3 days" / "closed 2 days ago" / "".
  returnState(r, now = Date.now()) {
    if (!r.returnEnd) return '';
    const left = VexLifeKit.daysLeft(VexLifeKit.parseDay(r.returnEnd), now);
    return left >= 0 ? 'Return window closes ' + VexLifeKit.words(left) + ' (' + r.returnEnd + ')' : 'Return window closed ' + VexLifeKit.words(left) + ' (' + r.returnEnd + ')';
  },
  warrantyState(r, now = Date.now()) {
    if (!r.warrantyEnd) return '';
    const left = VexLifeKit.daysLeft(VexLifeKit.parseDay(r.warrantyEnd), now);
    return left >= 0 ? 'Warranty ends ' + VexLifeKit.words(left) + ' (' + r.warrantyEnd + ')' : 'Warranty ended ' + VexLifeKit.words(left) + ' (' + r.warrantyEnd + ')';
  },

  // ---- storage -------------------------------------------------------------------------
  all() { const d = VexLifeKit.read(this.KEY, null); return d && Array.isArray(d.items) ? d.items : []; },
  _save(items) { VexLifeKit.write(this.KEY, { v: 1, items }); },

  async add(input, now = Date.now()) {
    if (!this.enabled()) throw new Error('The receipt locker is switched off');
    const items = this.all();
    if (items.length >= this.MAX) throw new Error('The locker holds ' + this.MAX + ' items; delete some');
    const r = this.clean(input);
    const failed = [];
    const set = async (text, endDay, lead) => {
      const when = VexLifeKit.addDays(VexLifeKit.parseDay(endDay), -lead);
      if (new Date(when).setHours(9, 0, 0, 0) <= now) return;
      try { const res = await VexLifeKit.remind(text, when, { now }); if (res.id) r.remindIds.push(res.id); }
      catch (err) { failed.push(text + ' ' + err.message); }
    };
    if (r.returnEnd) await set('The return window for "' + r.product + '" (' + r.store + ') closes on ' + r.returnEnd + '. Decide before then.', r.returnEnd, 3);
    if (r.warrantyEnd) {
      await set('The warranty for "' + r.product + '" ends on ' + r.warrantyEnd + ' (30 days left). Anything wrong with it?', r.warrantyEnd, 30);
      await set('The warranty for "' + r.product + '" ends on ' + r.warrantyEnd + ' (7 days left).', r.warrantyEnd, 7);
    }
    items.push(r);
    this._save(items);
    return { item: r, failed };
  },
  async remove(id) {
    const items = this.all();
    const r = items.find(x => x.id === id);
    if (!r) return;
    this._save(items.filter(x => x.id !== id));
    const errs = [];
    for (const rid of r.remindIds || []) { try { await VexLifeKit.unremind(rid); } catch (err) { errs.push(err.message); } }
    if (errs.length) throw new Error('Removed, but ' + errs.length + ' reminder(s) could not be deleted: ' + errs[0]);
  },
  // Soonest thing that ends, for other surfaces.
  snapshot(now = Date.now()) {
    const out = [];
    for (const r of this.all()) {
      if (r.returnEnd && VexLifeKit.daysLeft(VexLifeKit.parseDay(r.returnEnd), now) >= 0) out.push({ id: r.id, what: r.product + ': return window', end: r.returnEnd });
      if (r.warrantyEnd && VexLifeKit.daysLeft(VexLifeKit.parseDay(r.warrantyEnd), now) >= 0) out.push({ id: r.id, what: r.product + ': warranty', end: r.warrantyEnd });
    }
    return out.sort((a, b) => a.end.localeCompare(b.end)).slice(0, 5);
  },

  // The file you picked: its full path (Electron's own lookup), nothing read.
  pickFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (!f) { resolve(''); return; }
        try {
          if (!window.vex || typeof window.vex.pathForFile !== 'function') throw new Error('Choosing a file is not available here');
          resolve(window.vex.pathForFile(f));
        } catch (err) { reject(err); }
      });
      input.click();
    });
  },

  async edit() {
    let filePath = '';
    const v = await VexLifeKit.form({
      id: 'vex-receipt-form', title: 'Add a receipt', sub: 'Only these facts are kept. The receipt file stays where it is.',
      fields: [
        { name: 'product', label: 'What did you buy', required: true },
        { name: 'store', label: 'Shop', required: true },
        { name: 'boughtDay', label: 'Bought on (year-month-day)', required: true, value: VexLifeKit.dayString(Date.now()) },
        { name: 'returnDays', label: 'Days you can send it back', type: 'number', value: String(this.DEFAULT_RETURN_DAYS), hint: '14 is the usual distance-sale right. 0 for none. Not legal advice.' },
        { name: 'warrantyMonths', label: 'Warranty in months', type: 'number', placeholder: 'optional' },
        { name: 'warrantyEnd', label: 'or the warranty end date', placeholder: 'optional' },
        { name: 'price', label: 'Price', placeholder: 'optional' },
        { name: 'note', label: 'Note', type: 'textarea' },
      ],
      validate: (vals) => this.clean(vals),
    });
    if (!v) return null;
    if (await window.vexConfirm({ title: 'Point to the receipt file?', message: 'Choose the file on your disk. Vex remembers where it is; it does not copy or read it.', okLabel: 'Choose a file', cancelLabel: 'Not now' })) {
      filePath = await this.pickFile();
    }
    return this.add({ ...v, filePath });
  },
  open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('receipt-locker');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-receipts', title: 'Receipts and warranties', sub: 'Dates and where the file is. Informational, not legal advice.' });
    const draw = () => {
      body.textContent = '';
      const bar = document.createElement('div');
      bar.style.cssText = 'margin-bottom:10px';
      bar.appendChild(VexSettingsGroups.button('Add a receipt', async () => {
        try { const r = await this.edit(); if (r && r.failed.length) window.showToast?.(r.failed[0], 'error'); draw(); } catch (err) { window.showToast?.(err.message, 'error'); }
      }, { primary: true }));
      body.appendChild(bar);
      const items = this.all().slice().sort((a, b) => (a.returnEnd || a.warrantyEnd || 'z').localeCompare(b.returnEnd || b.warrantyEnd || 'z'));
      if (!items.length) body.appendChild(VexSettingsGroups.note('Nothing here yet.'));
      for (const r of items) {
        const lines = [r.product + ' from ' + r.store + (r.price ? ' (' + r.price + ')' : '') + ', bought ' + r.boughtDay, this.returnState(r), this.warrantyState(r)].filter(Boolean);
        if (r.note) lines.push(r.note);
        const buttons = [];
        if (r.filePath) buttons.push(VexSettingsGroups.button('Show file', () => { try { window.vex.downloadsShowInFolder(r.filePath); } catch (err) { window.showToast?.(err.message, 'error'); } }));
        buttons.push(VexSettingsGroups.button('Delete', async () => {
          if (!await window.vexConfirm({ title: 'Delete this entry?', message: 'Only the entry is removed; the receipt file stays on your disk.', okLabel: 'Delete', danger: true })) return;
          try { await this.remove(r.id); } catch (err) { window.showToast?.(err.message, 'error'); }
          draw();
        }, { danger: true }));
        body.appendChild(VexLifeKit.row(lines, buttons));
      }
    };
    draw();
  },
};

if (typeof window !== 'undefined') {
  window.ReceiptLocker = ReceiptLocker;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'receipt-locker', title: 'Receipts and warranties', keywords: 'receipt warranty return invoice guarantee purchase refund window', before: 'about',
      build: (el) => {
        el.appendChild(VexSettingsGroups.note('Shop, product, dates and where the receipt file is, with reminders before a return window or warranty ends. The files stay where you keep them. Not legal advice.'));
        el.appendChild(VexSettingsGroups.button('Open the locker', () => ReceiptLocker.open(), { primary: true }));
      },
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'receipt-locker', label: 'Receipts and warranties', hint: 'Return windows and warranty dates for what you bought', icon: 'receipt', action: () => { if (ReceiptLocker.enabled()) ReceiptLocker.open(); else window.showToast?.('The receipt locker is switched off'); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ReceiptLocker };
