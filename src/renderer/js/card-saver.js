// === Saved payment cards (renderer) ===
//
// The window side of main/cards.js and the card script in preload-webview.js:
//  - save: a page's card form, submitted, is reported ("vex-card-submit") and a "Save this card?" card appears.
//    The security code (CVV) is never read, kept or sent: the person types it at each payment.
//  - fill: a click into a card field ("vex-card-want") shows a small chooser in Vex's window, never on the
//    page; pressing a card fills the fields (the page script does it, in its isolated world) and the cursor
//    moves to the CVV box.
//  - by hand: Settings > Payment cards (and Ctrl+K "Payment cards") adds and edits cards, and for a page whose
//    form Vex did not recognise (card boxes inside another site's frame, for one) types a card's number, name or
//    expiry into whichever box has the focus, or copies the number (cleared after 30 seconds).
// Policy, the same as saved passwords: never in a private or Tor tab, never in a tab routed through Tor or a
// proxy, https pages only; each refusal says why. The full number crosses IPC only when a card is pressed.
const VexCards = {
  NEVER_KEY: 'vex.cardNever',
  OFFER_KEY: 'vex.cardOffer',
  CHOOSER_MS: 20000,

  _t(key, fallback) { return (window.VexI18n && window.VexI18n.t(key, fallback)) || fallback; },
  _fmt(key, fallback, vars) { let text = this._t(key, fallback); for (const [name, value] of Object.entries(vars)) text = text.split('{' + name + '}').join(String(value)); return text; },
  _say(message, kind) { try { window.showToast?.(message, kind); } catch { /* vex-allow-empty-catch: without a toast host there is nowhere to say it */ } },
  _host(value) { return String(value || '').toLowerCase().replace(/^www\./, ''); },

  _never() { try { const v = JSON.parse(localStorage.getItem(this.NEVER_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } },
  _addNever(host) {
    const list = this._never();
    if (list.includes(host)) return;
    list.push(host);
    try { localStorage.setItem(this.NEVER_KEY, JSON.stringify(list)); } catch (err) { console.error('[Cards] could not keep the never-list:', err.message); }
  },
  // Whether Vex offers to save a card after a payment (Settings > Payment cards).
  offering() { try { return localStorage.getItem(this.OFFER_KEY) !== 'false'; } catch { return true; } },
  setOffering(on) { try { localStorage.setItem(this.OFFER_KEY, on ? 'true' : 'false'); } catch (err) { console.error('[Cards] could not keep the setting:', err.message); } },

  // '' when this tab may use cards, else the reason in words.
  refusal(webview) {
    if (!webview) return this._t('cardOpenPage', 'Open a web page first');
    const policy = window.VexTabPolicy;
    if (policy && !policy.canFillWebview(webview)) {
      return this._t('cardPrivate', 'Cards are never saved or filled in a private or Tor tab: nothing typed there is kept');
    }
    const partition = (() => { try { return webview.getAttribute?.('partition') || ''; } catch { return ''; } })();
    if (policy && partition && policy.isRouted(partition)) {
      return this._t('cardRouted', 'Cards are never used in a tab routed through Tor or a proxy: what is typed there stays on that route');
    }
    let url = '';
    try { url = webview.getURL(); } catch { return this._t('cardOpenPage', 'Open a web page first'); }
    if (!/^https:/i.test(url)) return this._t('cardHttps', 'Vex uses cards on secure (https) pages only');
    return '';
  },

  // ---- formatting ----
  expiryText(card) {
    return String(card.expMonth).padStart(2, '0') + '/' + String(card.expYear).slice(-2);
  },
  titleOf(card) { return card.nickname || card.brand; },
  lineOf(card) {
    return this.titleOf(card) + ' •••• ' + card.last4;
  },

  // ---- the page's messages ----
  // Registered through the webview's lifecycle so destroyWebview can take it off again (a handler left on the element keeps it alive).
  attach(webview) {
    if (!webview || webview._vexCardsAttached) return;
    webview._vexCardsAttached = true;
    const on = webview._lifecycle ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn) : (ev, fn) => webview.addEventListener(ev, fn);
    on('ipc-message', async (e) => {
      if (typeof e.channel !== 'string' || !e.channel.startsWith('vex-card-')) return;
      try { await this._onMessage(webview, e.channel, (e.args && e.args[0]) || {}); }
      catch (err) { console.error('[Cards] could not handle ' + e.channel + ':', err); this._say(this._t('cardFailed', 'Cards: ') + (err && err.message), 'error'); }
    });
  },
  // Late-loaded: the tabs that already exist are attached when this file arrives.
  attachAll() { document.querySelectorAll('webview').forEach((wv) => this.attach(wv)); },

  async _onMessage(webview, channel, d) {
    if (this.refusal(webview)) return;
    let actual;
    try { actual = this._host(new URL(webview.getURL()).hostname); } catch { return; }
    if (this._host(d.host) !== actual && channel !== 'vex-card-filled') return;
    if (channel === 'vex-card-submit') return this._onSubmit(webview, d, actual);
    if (channel === 'vex-card-want') return this._onWant(webview, d);
    if (channel === 'vex-card-filled') return this._onFilled(d);
  },

  async _onSubmit(webview, d, host) {
    if (!this.offering() || this._never().includes(host)) return;
    const number = String(d.number || '').replace(/\D/g, '');
    if (number.length < 12 || number.length > 19) return;
    const month = Number(d.expMonth), year = Number(d.expYear);
    if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) return;
    if (await window.vex.cardsHas(number)) return;   // already saved: nothing to ask
    this._offerSave({ host, number, name: String(d.name || '').slice(0, 80), expMonth: month, expYear: year });
  },

  _offerSave(data) {
    document.getElementById('vex-card-offer')?.remove();
    const card = document.createElement('div');
    card.id = 'vex-card-offer';
    card.className = 'vex-card-offer';
    card.setAttribute('role', 'alert');
    const head = document.createElement('div');
    head.className = 'vex-card-offer-head';
    head.insertAdjacentHTML('beforeend', typeof VexIcons !== 'undefined' ? VexIcons.svg('card', { size: 16 }) : '');
    const title = document.createElement('span');
    title.textContent = this._t('cardSaveQ', 'Save this card?');
    head.appendChild(title);
    const body = document.createElement('div');
    body.className = 'vex-card-offer-body';
    const last4 = data.number.slice(-4);
    const exp = String(data.expMonth).padStart(2, '0') + '/' + String(data.expYear).slice(-2);
    const [before, after] = this._fmt('cardOfferLine', '•••• {last4} · {exp} on {host}', { last4, exp }).split('{host}');
    const strong = document.createElement('strong');
    strong.textContent = data.host;
    body.append(before, strong, after || '');
    const note = document.createElement('div');
    note.className = 'vex-card-offer-note';
    note.textContent = this._t('cardNoCvv', 'The security code (CVV) is never saved. You type it at each payment.');
    const row = document.createElement('div');
    row.className = 'vex-card-offer-row';
    const mk = (label, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label; row.appendChild(b); return b; };
    const save = mk(this._t('cardSave', 'Save'), 'vex-card-btn primary');
    const not = mk(this._t('cardNotNow', 'Not now'), 'vex-card-btn');
    const never = mk(this._t('cardNever', 'Never for this site'), 'vex-card-btn muted');
    card.append(head, body, note, row);
    document.body.appendChild(card);
    if (typeof VexLayer !== 'undefined') VexLayer.track(card, { tier: 'panel', id: 'cards-offer', keep: true });
    const close = () => card.remove();
    save.addEventListener('click', async () => {
      const r = await window.vex.cardsSave({ number: data.number, name: data.name, expMonth: data.expMonth, expYear: data.expYear });
      this._say(r && r.ok ? this._t('cardSaved', 'Card saved') : (this._t('cardSaveFailed', 'Could not save the card: ') + ((r && r.error) || '')), r && r.ok ? undefined : 'error');
      close();
    });
    not.addEventListener('click', close);
    never.addEventListener('click', () => { this._addNever(data.host); this._say(this._fmt('cardNeverFor', 'Cards will not be offered on {host}', { host: data.host })); close(); });
    setTimeout(() => { if (document.body.contains(card)) close(); }, 30000);
  },

  // ---- the chooser under a card field ----
  async _onWant(webview, d) {
    const cards = await window.vex.cardsList();
    if (!cards.length) return;
    this._closeChooser();
    const box = document.createElement('div');
    box.id = 'vex-card-chooser';
    box.className = 'vex-card-chooser';
    box.setAttribute('role', 'listbox');
    box.setAttribute('aria-label', this._t('cardChooseAria', 'Saved cards'));
    const heading = document.createElement('div');
    heading.className = 'vex-card-chooser-head';
    heading.textContent = this._t('cardFillWith', 'Fill with a saved card');
    box.appendChild(heading);
    for (const card of cards) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'vex-card-item';
      item.setAttribute('role', 'option');
      const main = document.createElement('span');
      main.className = 'vex-card-item-main';
      main.textContent = this.lineOf(card);
      const sub = document.createElement('span');
      sub.className = 'vex-card-item-sub';
      sub.textContent = [card.name, this.expiryText(card)].filter(Boolean).join(' · ') + (card.expired ? ' · ' + this._t('cardExpired', 'Expired') : '');
      item.append(main, sub);
      item.addEventListener('click', () => { this._closeChooser(); this.fillCard(webview, card.id, { wantId: d.id }).catch((err) => { console.error('[Cards] fill failed:', err); this._say(this._t('cardFailed', 'Cards: ') + err.message, 'error'); }); });
      box.appendChild(item);
    }
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'vex-card-item manage';
    manage.textContent = this._t('cardManage', 'Manage payment cards…');
    manage.addEventListener('click', () => { this._closeChooser(); this.openManager(webview); });
    box.appendChild(manage);
    document.body.appendChild(box);
    if (typeof VexLayer !== 'undefined') VexLayer.track(box, { tier: 'panel', id: 'cards-chooser', keep: true });
    const wv = webview.getBoundingClientRect();
    const width = Math.min(Math.max(Number(d.w) || 280, 280), 380);
    const left = Math.max(8, Math.min(wv.left + (Number(d.x) || 0), window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(wv.top + (Number(d.y) || 0) + 4, window.innerHeight - box.offsetHeight - 8));
    box.style.width = width + 'px';
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    const away = (ev) => { if (!box.contains(ev.target)) this._closeChooser(); };
    const key = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); this._closeChooser(); } };
    this._chooserOff = () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true); clearTimeout(this._chooserTimer); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    this._chooserTimer = setTimeout(() => this._closeChooser(), this.CHOOSER_MS);
    box.querySelector('.vex-card-item')?.focus();
    // A click inside the page does not reach this document; the page taking the focus back is what closes it.
    webview.addEventListener('focus', () => this._closeChooser(), { once: true });
  },
  _closeChooser() {
    if (this._chooserOff) { this._chooserOff(); this._chooserOff = null; }
    document.getElementById('vex-card-chooser')?.remove();
  },

  // ---- filling ----
  // The card's full details leave main only here, after a card was pressed, and go straight to the page script.
  async fillCard(webview, id, opts = {}) {
    const why = this.refusal(webview);
    if (why) { this._say(why, 'info'); return { ok: false, reason: 'refused' }; }
    const full = await window.vex.cardsReveal(id);
    if (!full) { this._say(this._t('cardGone', 'That card is not saved any more'), 'error'); return { ok: false, reason: 'gone' }; }
    if (this._expired(full)) {
      const go = await window.vexConfirm({ title: this._t('cardExpiredTitle', 'This card has expired'), message: this._fmt('cardExpiredMsg', 'It ran out on {date}. Fill it anyway?', { date: this.expiryText(full) }), okLabel: this._t('cardFill', 'Fill') });
      if (!go) return { ok: false, reason: 'cancelled' };
    }
    webview.send('vex-card-fill', { id: opts.wantId || '', now: !opts.wantId, number: full.number, name: full.name, expMonth: full.expMonth, expYear: full.expYear });
    return { ok: true };
  },
  _expired(card) {
    const now = new Date();
    return card.expYear < now.getFullYear() || (card.expYear === now.getFullYear() && card.expMonth < now.getMonth() + 1);
  },
  _onFilled(d) {
    if (!d.found) { this._say(this._t('cardNoFields', 'No card boxes found on this page. Click into the card number box and try again, or use Type number in Payment cards.'), 'info'); return; }
    if (!d.filled) { this._say(this._t('cardNothingFilled', 'The card boxes already hold something, so nothing was filled'), 'info'); return; }
    this._say(this._t('cardFilled', 'Card filled. Type the security code (CVV) yourself: Vex never saves it.'));
  },

  // For a form Vex did not recognise: the text goes into whichever box on the page has the focus (inside another site's frame too).
  async typeInto(webview, id, part) {
    const why = this.refusal(webview);
    if (why) { this._say(why, 'info'); return { ok: false }; }
    const full = await window.vex.cardsReveal(id);
    if (!full) { this._say(this._t('cardGone', 'That card is not saved any more'), 'error'); return { ok: false }; }
    const text = part === 'number' ? full.number : part === 'name' ? full.name : this.expiryText(full);
    if (!text) { this._say(this._t('cardNoName', 'This card has no name saved'), 'info'); return { ok: false }; }
    try { webview.focus(); await webview.insertText(text); }
    catch (err) { console.error('[Cards] could not type into the page:', err); this._say(this._t('cardNoType', 'Could not type into the page: ') + err.message, 'error'); return { ok: false }; }
    return { ok: true };
  },
  async copyNumber(id) {
    const full = await window.vex.cardsReveal(id);
    if (!full) { this._say(this._t('cardGone', 'That card is not saved any more'), 'error'); return; }
    return window.vexCopySecret(full.number, this._t('cardCopied', 'Card number copied'));
  },

  // ---- Settings > Payment cards ----
  async renderPanel(box) {
    if (!box) return;
    box.textContent = '';
    const cards = await window.vex.cardsList();
    const info = document.createElement('div');
    info.className = 'setting-info muted';
    info.textContent = cards.length === 1 ? this._t('cardSavedOne', '1 card is saved on this computer, encrypted by Windows. It is never synced and never leaves this PC.')
      : cards.length ? this._fmt('cardSavedMany', '{n} cards are saved on this computer, encrypted by Windows. They are never synced and never leave this PC.', { n: cards.length })
      : this._t('cardNone', 'No cards saved. When you pay on a site Vex offers to keep the card; you can also add one yourself. The security code (CVV) is never saved.');
    box.appendChild(info);
    const row = document.createElement('div');
    row.className = 'vex-card-settings-row';
    const mk = (label, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'vex-card-btn ' + (cls || ''); b.textContent = label; b.addEventListener('click', fn); row.appendChild(b); return b; };
    mk(this._t('cardManageBtn', 'Manage cards'), () => this.openManager(null, {}), 'primary');
    mk(this._t('cardAddBtn', 'Add a card'), () => this.openManager(null, { add: true }));
    box.appendChild(row);
    const label = document.createElement('label');
    label.className = 'vex-card-offer-switch';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = this.offering();
    cb.addEventListener('change', () => this.setOffering(cb.checked));
    label.append(cb, ' ', this._t('cardOfferSwitch', 'Offer to save a card after I pay'));
    box.appendChild(label);
    const never = this._never();
    if (never.length) {
      const nv = document.createElement('div');
      nv.className = 'setting-info muted';
      nv.textContent = this._t('cardNeverList', 'Not offered on: ') + never.join(', ');
      const clear = document.createElement('button');
      clear.type = 'button'; clear.className = 'vex-card-btn muted'; clear.textContent = this._t('cardNeverClear', 'Offer on these again');
      clear.addEventListener('click', () => { try { localStorage.removeItem(this.NEVER_KEY); } catch (err) { console.error('[Cards] could not clear the never-list:', err.message); } this.renderPanel(box); });
      box.append(nv, clear);
    }
  },

  // ---- the manager ----
  // webview: the page to fill (null from Settings: only the list and the editing). opts.add opens on the add form.
  async openManager(webview, opts = {}) {
    document.getElementById('vex-cards-dialog')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'vex-cards-dialog';
    overlay.className = 'vex-cards-overlay';
    const dlg = document.createElement('div');
    dlg.className = 'vex-cards-dialog';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-label', this._t('cardTitle', 'Payment cards'));
    overlay.appendChild(dlg);
    document.body.appendChild(overlay);
    if (typeof VexLayer !== 'undefined') VexLayer.track(overlay, { tier: 'modal', id: 'cards-dialog', keep: true });
    const close = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); const box = document.getElementById('cards-panel-content'); if (box) this.renderPanel(box).catch((err) => console.error('[Cards] panel:', err)); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });

    const refresh = async (form) => {
      const cards = await window.vex.cardsList();
      dlg.textContent = '';
      this._drawManager(dlg, cards, webview || this._activeWebview(), { form, close, redraw: (f) => refresh(f) });
    };
    await refresh(opts.add ? { mode: 'add' } : null);
  },
  _activeWebview() {
    return typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() || null : null;
  },

  _drawManager(dlg, cards, webview, ctx) {
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const head = el('div', 'vex-cards-head');
    head.appendChild(el('h2', null, this._t('cardTitle', 'Payment cards')));
    const x = el('button', 'vex-card-btn muted', this._t('cardClose', 'Close'));
    x.type = 'button';
    x.addEventListener('click', ctx.close);
    head.appendChild(x);
    dlg.appendChild(head);

    const why = webview ? this.refusal(webview) : this._t('cardNoPage', 'Open a web page to fill a card into it');
    dlg.appendChild(el('div', 'vex-cards-note', this._t('cardNoCvv', 'The security code (CVV) is never saved. You type it at each payment.')));
    if (webview && why) dlg.appendChild(el('div', 'vex-cards-note warn', why));

    if (!cards.length && !ctx.form) dlg.appendChild(el('div', 'vex-cards-empty', this._t('cardNoneShort', 'No cards saved yet.')));
    for (const card of cards) {
      const row = el('div', 'vex-cards-row');
      const top = el('div', 'vex-cards-row-top');
      top.appendChild(el('span', 'vex-cards-row-title', this.lineOf(card)));
      top.appendChild(el('span', 'vex-cards-row-sub', [card.name, this.expiryText(card)].filter(Boolean).join(' · ') + (card.expired ? ' · ' + this._t('cardExpired', 'Expired') : '')));
      row.appendChild(top);
      const actions = el('div', 'vex-cards-actions');
      const btn = (label, fn, enabled = true, cls = '') => { const b = el('button', 'vex-card-btn ' + cls, label); b.type = 'button'; b.disabled = !enabled; b.addEventListener('click', () => { Promise.resolve(fn()).catch((err) => { console.error('[Cards] action failed:', err); this._say(this._t('cardFailed', 'Cards: ') + (err && err.message), 'error'); }); }); actions.appendChild(b); return b; };
      const canFill = !!webview && !why;
      btn(this._t('cardFillForm', 'Fill the form'), async () => { ctx.close(); await this.fillCard(webview, card.id, {}); }, canFill, 'primary');
      btn(this._t('cardTypeNumber', 'Type number'), async () => { ctx.close(); await this.typeInto(webview, card.id, 'number'); }, canFill);
      btn(this._t('cardTypeName', 'Type name'), async () => { ctx.close(); await this.typeInto(webview, card.id, 'name'); }, canFill && !!card.name);
      btn(this._t('cardTypeExpiry', 'Type expiry'), async () => { ctx.close(); await this.typeInto(webview, card.id, 'expiry'); }, canFill);
      btn(this._t('cardCopyNumber', 'Copy number'), () => this.copyNumber(card.id));
      btn(this._t('cardEdit', 'Edit'), () => ctx.redraw({ mode: 'edit', card }));
      btn(this._t('cardDelete', 'Delete'), async () => {
        const go = await window.vexConfirm({ title: this._t('cardDeleteTitle', 'Delete this card?'), message: this._fmt('cardDeleteMsg', '{card} will be removed from Vex. This cannot be undone.', { card: this.lineOf(card) }), okLabel: this._t('cardDelete', 'Delete') });
        if (!go) return;
        const r = await window.vex.cardsDelete(card.id);
        if (!r || !r.ok) throw new Error((r && r.error) || 'could not delete');
        ctx.redraw(null);
      }, true, 'muted');
      row.appendChild(actions);
      dlg.appendChild(row);
    }
    if (webview && !why && cards.length) dlg.appendChild(el('div', 'vex-cards-note', this._t('cardTypeHint', 'On a page Vex did not recognise: click the box first, then press Type number, Type name or Type expiry.')));

    if (ctx.form) { dlg.appendChild(this._form(ctx)); return; }
    const add = el('button', 'vex-card-btn primary add', this._t('cardAddBtn', 'Add a card'));
    add.type = 'button';
    add.addEventListener('click', () => ctx.redraw({ mode: 'add' }));
    dlg.appendChild(add);
  },

  _form(ctx) {
    const editing = ctx.form.mode === 'edit' ? ctx.form.card : null;
    const wrap = document.createElement('form');
    wrap.className = 'vex-cards-form';
    wrap.noValidate = true;
    const field = (label, name, value, attrs = {}) => {
      const l = document.createElement('label');
      l.className = 'vex-cards-field';
      const s = document.createElement('span'); s.textContent = label;
      const i = document.createElement('input');
      i.name = name; i.value = value || ''; i.autocomplete = 'off'; i.spellcheck = false;
      Object.entries(attrs).forEach(([k, v]) => i.setAttribute(k, v));
      l.append(s, i); wrap.appendChild(l);
      return i;
    };
    const title = document.createElement('h3');
    title.textContent = editing ? this._t('cardEditTitle', 'Edit card') : this._t('cardAddTitle', 'Add a card');
    wrap.appendChild(title);
    const number = editing ? null : field(this._t('cardNumber', 'Card number'), 'number', '', { inputmode: 'numeric', maxlength: '23', placeholder: '1234 5678 9012 3456' });
    const name = field(this._t('cardNameOn', 'Name on the card'), 'name', editing ? editing.name : '', { maxlength: '80' });
    const exp = field(this._t('cardExpiry', 'Expiry (MM/YY)'), 'exp', editing ? this.expiryText(editing) : '', { inputmode: 'numeric', maxlength: '7', placeholder: 'MM/YY' });
    const nick = field(this._t('cardNickname', 'Nickname (optional)'), 'nickname', editing ? editing.nickname : '', { maxlength: '40' });
    if (editing) wrap.appendChild(Object.assign(document.createElement('div'), { className: 'vex-cards-note', textContent: this._t('cardNumberFixed', 'The number cannot be changed: a different number is a different card. Delete it and add the new one.') }));
    const err = document.createElement('div');
    err.className = 'vex-cards-note warn';
    err.setAttribute('role', 'alert');
    err.hidden = true;
    wrap.appendChild(err);
    const row = document.createElement('div');
    row.className = 'vex-cards-actions';
    const save = document.createElement('button'); save.type = 'submit'; save.className = 'vex-card-btn primary'; save.textContent = this._t('cardSave', 'Save');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'vex-card-btn muted'; cancel.textContent = this._t('cardCancel', 'Cancel');
    cancel.addEventListener('click', () => ctx.redraw(null));
    row.append(save, cancel);
    wrap.appendChild(row);
    wrap.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      const parsed = /^\s*(\d{1,2})\s*[/\-. ]?\s*(\d{2}|\d{4})\s*$/.exec(exp.value);
      if (!parsed) { err.textContent = this._t('cardBadExpiry', 'Type the expiry as month and year, like 08/27'); err.hidden = false; exp.focus(); return; }
      const r = editing
        ? await window.vex.cardsUpdate({ id: editing.id, name: name.value, expMonth: parsed[1], expYear: parsed[2], nickname: nick.value })
        : await window.vex.cardsSave({ number: number.value, name: name.value, expMonth: parsed[1], expYear: parsed[2], nickname: nick.value });
      if (!r || !r.ok) { err.textContent = (r && r.error) || this._t('cardSaveFailed', 'Could not save the card: '); err.hidden = false; return; }
      this._say(editing ? this._t('cardUpdated', 'Card updated') : (r.updated ? this._t('cardUpdated', 'Card updated') : this._t('cardSaved', 'Card saved')));
      ctx.redraw(null);
    });
    setTimeout(() => (number || name).focus(), 0);
    return wrap;
  },
};

if (typeof window !== 'undefined') {
  window.VexCards = VexCards;
  // Late-loaded: the tabs already open get the listener now.
  try { VexCards.attachAll(); } catch (err) { console.error('[Cards] could not attach to open tabs:', err); }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCards };
