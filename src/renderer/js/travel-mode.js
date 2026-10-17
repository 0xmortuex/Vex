// === Travel mode and the trip workspace ======================================
//
// On the way to a station or an airport you need three things at once, and
// fast: the ticket, the booking reference and the time. The trip workspace
// holds them:
//
//   - tickets, QR codes, booking references and notes, each with an optional
//     departure time; the ticket view lists them by next departure
//   - an image you attach (a QR screenshot) is kept inside Vex (up to 250 KB each)
//     and shown on a white page so a scanner can read it; a page you add can be
//     made available offline with one press (js/offline-pages.js)
//   - the time in the place you are going, next to the time here
//   - a "time to leave" notice an hour (you can change it) before a departure
//   - with travel mode on, notices that are not urgent wait in the Attention
//     Inbox (the same as Focus or Away do); reminders and the leave notice still ring
//
// Travel mode never changes your tabs, your sync or your network. It is off
// until you turn it on, and the tickets stay on this computer.
// Shifted reminders (Wave 5): a reminder is kept as an exact moment, so nothing is rewritten by itself. In the
// trip workspace, "Shift my reminders to the time there" lists the timed reminders of the next 14 days (not the
// repeating or site ones), each with its new moment (the same clock time in the trip's time zone); you tick the
// ones to move, confirm, and each gets a new reminder before the old one is removed. One ledger line puts them
// back.
//
//   VexTravel.sortItems(items, now)        pure: next departure first
//   VexTravel.leaveDue(item, now, lead)    pure
//   VexTravel.clock(tz, now)               pure: the time in that zone

const VexTravel = {
  KEY: 'vex.travel',
  PREF: 'vex.travel.enabled',   // 'off' hides the commands and ends travel mode
  JOB: 'Travel: leave now',
  MAX_ITEMS: 40,
  MAX_IMAGE: 250 * 1024,
  MAX_IMAGES: 8,
  KINDS: ['ticket', 'qr', 'booking', 'hotel', 'other'],
  KIND_LABEL: { ticket: 'Ticket', qr: 'QR code', booking: 'Booking', hotel: 'Hotel', other: 'Other' },

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    this._changed();
    return !!on;
  },

  // ---- pure ----------------------------------------------------------------------------
  make({ kind, title, ref, url, image, departAt, note, now = Date.now(), id } = {}) {
    const k = kind || 'ticket';
    if (!this.KINDS.includes(k)) throw new Error('Unknown kind: ' + kind);
    const t = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
    if (!t) throw new Error('Give it a name, like "Train to Ankara"');
    if (t.length > 100) throw new Error('Keep the name to 100 characters');
    let link = '';
    if (url) {
      let u;
      try { u = new URL(String(url)); } catch { throw new Error('That is not a web address'); }
      if (!/^https?:$/.test(u.protocol)) throw new Error('Only a web address can be attached');
      link = u.href.slice(0, 2048);
    }
    if (image) {
      if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image)) throw new Error('That is not a PNG, JPEG, WebP or GIF image');
      if (image.length > this.MAX_IMAGE * 1.4) throw new Error('Make the image smaller: Vex keeps images under 250 KB');
    }
    const dep = departAt == null || departAt === '' || departAt === 0 ? 0 : Number(departAt);
    if (departAt && !Number.isFinite(dep)) throw new Error('That is not a time');
    return { id: id || 'tr_' + now.toString(36) + Math.random().toString(36).slice(2, 6), kind: k, title: t, ref: String(ref == null ? '' : ref).trim().slice(0, 60), url: link, image: image || '', departAt: dep, note: String(note == null ? '' : note).trim().slice(0, 300) };
  },
  sortItems(items, now = Date.now()) {
    const GRACE = 60 * 60 * 1000;
    const rank = (i) => (i.departAt && i.departAt >= now - GRACE ? 0 : i.departAt ? 2 : 1);
    return [...items].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.departAt - b.departAt : rank(a) === 2 ? b.departAt - a.departAt : a.title.localeCompare(b.title)));
  },
  leaveDue(item, now = Date.now(), leadMin = 60) {
    return !!item.departAt && now >= item.departAt - leadMin * 60000 && now < item.departAt + 30 * 60000;
  },
  validZone(tz) {
    try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch { return false; }
  },
  clock(tz, now = Date.now()) {
    if (!tz) throw new Error('No time zone is set for this trip');
    if (!this.validZone(tz)) throw new Error('"' + tz + '" is not a time zone (try Europe/Istanbul or Asia/Tokyo)');
    const fmt = (zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short', day: 'numeric', month: 'short' }).format(now);
    const off = (zone) => { const d = new Date(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now) + ' UTC'); return (d.getTime() - Math.floor(now / 1000) * 1000) / 60000; };
    const diff = Math.round(off(tz) - off(Intl.DateTimeFormat().resolvedOptions().timeZone));
    return { there: fmt(tz), here: fmt(Intl.DateTimeFormat().resolvedOptions().timeZone), diffMin: diff, diffText: (diff === 0 ? 'same time as here' : (diff > 0 ? '+' : '-') + Math.floor(Math.abs(diff) / 60) + (Math.abs(diff) % 60 ? ':' + String(Math.abs(diff) % 60).padStart(2, '0') : '') + ' h from here') };
  },

  // ---- storage -------------------------------------------------------------------------
  state() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return { v: 1, on: false, trip: { name: '', tz: '', leadMin: 60 }, items: [], fired: {} };
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('Your trip could not be read: ' + err.message); }
    if (!v || v.v !== 1 || !Array.isArray(v.items)) throw new Error('Your trip is in a shape this version does not know');
    return { v: 1, on: !!v.on, trip: { name: String((v.trip && v.trip.name) || ''), tz: String((v.trip && v.trip.tz) || ''), leadMin: Number(v.trip && v.trip.leadMin) > 0 ? Number(v.trip.leadMin) : 60 }, items: v.items.filter(i => i && i.id && typeof i.title === 'string'), fired: v.fired && typeof v.fired === 'object' ? v.fired : {} };
  },
  _save(st) {
    try { localStorage.setItem(this.KEY, JSON.stringify(st)); }
    catch (err) { throw new Error('Your trip could not be saved: ' + err.message + (st.items.some(i => i.image) ? ' (images take room; remove one)' : '')); }
  },
  on() { return this.enabled() && this.state().on; },
  // For the attention state: travel mode quiets notices that are not urgent.
  quiet() { try { return this.on(); } catch { return false; } },
  _changed() {
    try { if (typeof AttentionState !== 'undefined') AttentionState.changed(); }
    catch (err) { console.error('[Travel] the attention state could not be told:', err); }
  },
  setOn(on) {
    const st = this.state();
    if (on && !this.enabled()) throw new Error('Travel mode is switched off in Settings');
    st.on = !!on;
    this._save(st);
    this._changed();
    if (typeof VexLedger !== 'undefined') VexLedger.note({ feature: 'travel-mode', what: on ? 'Travel mode on' : 'Travel mode off', why: 'You switched it ' + (on ? 'on' : 'off'), undo: { kind: 'travel-mode-set', on: !on } });
    return st.on;
  },
  setTrip(trip) {
    const st = this.state();
    const name = String(trip.name == null ? st.trip.name : trip.name).trim().slice(0, 60);
    const tz = String(trip.tz == null ? st.trip.tz : trip.tz).trim();
    if (tz && !this.validZone(tz)) throw new Error('"' + tz + '" is not a time zone (try Europe/Istanbul or Asia/Tokyo)');
    const lead = trip.leadMin == null ? st.trip.leadMin : Number(trip.leadMin);
    if (!Number.isFinite(lead) || lead < 5 || lead > 720) throw new Error('The leave notice is 5 to 720 minutes before');
    st.trip = { name, tz, leadMin: Math.round(lead) };
    this._save(st);
    return st.trip;
  },
  add(fields) {
    const st = this.state();
    if (st.items.length >= this.MAX_ITEMS) throw new Error('That is ' + this.MAX_ITEMS + ' items; remove some first');
    const item = this.make(fields);
    if (item.image && st.items.filter(i => i.image).length >= this.MAX_IMAGES) throw new Error('That is ' + this.MAX_IMAGES + ' images; remove one first');
    st.items.push(item);
    this._save(st);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('travel-mode');
    return item;
  },
  remove(id) {
    const st = this.state();
    if (!st.items.some(i => i.id === id)) throw new Error('That item is gone');
    st.items = st.items.filter(i => i.id !== id);
    delete st.fired[id];
    this._save(st);
  },

  // ---- the leave notice -------------------------------------------------------------------
  tick(now = Date.now()) {
    if (!this.on()) return 0;
    const st = this.state();
    let n = 0;
    for (const it of st.items) {
      if (st.fired[it.id] || !this.leaveDue(it, now, st.trip.leadMin)) continue;
      const mins = Math.max(0, Math.round((it.departAt - now) / 60000));
      const title = 'Time to leave: ' + it.title + (mins ? ' in ' + mins + ' min' : ' now');
      if (typeof VexAttention === 'undefined') throw new Error('The attention gate is not loaded');
      // You asked for this notice, so it is the "asked" class: it is not held back by quiet modes.
      VexAttention.notify({ feature: 'travel-mode', label: 'Travel', urgency: 'asked', id: it.id, title }, () => window.showToast?.(title, 'info', 20000, { action: { label: 'Show tickets', run: () => this.openTickets() } }));
      st.fired[it.id] = now;
      n++;
    }
    if (n) this._save(st);
    return n;
  },

  // ---- the ticket view ---------------------------------------------------------------------
  async _openItem(it) {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    if (!it.url) throw new Error('This item has no page');
    if (typeof VexOfflinePages !== 'undefined' && VexOfflinePages.isOffline(it.url)) { await VexOfflinePages.open(it.url); return; }
    TabManager.createTab(it.url, true);
  },
  openTickets() {
    if (!this.enabled()) { window.showToast?.('Travel mode is switched off in Settings', 'info'); return; }
    let st;
    try { st = this.state(); } catch (err) { window.showToast?.(err.message, 'error'); return; }
    document.getElementById('vex-travel-tickets')?.remove();
    const now = Date.now();
    // A white page with black text on purpose: a scanner reads a QR code best from a bright, plain screen.
    const ov = document.createElement('div');
    ov.id = 'vex-travel-tickets';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Tickets');
    ov.style.cssText = 'position:fixed;inset:0;z-index:100060;background:#fff;color:#000;overflow:auto;padding:20px 20px 40px;font-family:inherit';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:12px';
    const h = document.createElement('div');
    h.style.cssText = 'flex:1;font-size:20px;font-weight:700';
    h.textContent = st.trip.name || 'Tickets';
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = 'Close'; close.setAttribute('aria-label', 'Close the tickets');
    close.style.cssText = 'font:inherit;font-size:15px;padding:8px 16px;border:2px solid #000;background:#fff;color:#000;border-radius:8px;cursor:pointer';
    head.append(h, close);
    ov.appendChild(head);
    if (st.trip.tz) {
      try {
        const c = this.clock(st.trip.tz, now);
        const p = document.createElement('div');
        p.style.cssText = 'font-size:16px;margin-bottom:14px';
        p.textContent = 'There ' + c.there + '  |  Here ' + c.here + '  (' + c.diffText + ')';
        ov.appendChild(p);
      } catch (err) { const p = document.createElement('div'); p.textContent = err.message; ov.appendChild(p); }
    }
    const items = this.sortItems(st.items, now);
    if (!items.length) { const p = document.createElement('div'); p.style.fontSize = '16px'; p.textContent = 'Nothing here yet. Add tickets in Ctrl+K › Trip workspace.'; ov.appendChild(p); }
    for (const it of items) {
      const card = document.createElement('section');
      card.style.cssText = 'border:2px solid #000;border-radius:12px;padding:14px;margin-bottom:14px';
      const t = document.createElement('div'); t.style.cssText = 'font-size:20px;font-weight:700'; t.textContent = it.title;
      card.appendChild(t);
      if (it.departAt) {
        const d = document.createElement('div'); d.style.fontSize = '16px';
        const mins = Math.round((it.departAt - now) / 60000);
        d.textContent = new Date(it.departAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + (mins > 0 ? '  (in ' + (mins >= 120 ? Math.round(mins / 60) + ' h' : mins + ' min') + ')' : '  (departed)');
        card.appendChild(d);
      }
      if (it.ref) { const r = document.createElement('div'); r.style.cssText = 'font-size:32px;font-weight:700;font-family:ui-monospace,Consolas,monospace;letter-spacing:2px;margin:8px 0'; r.textContent = it.ref; r.setAttribute('aria-label', 'Booking reference ' + it.ref.split('').join(' ')); card.appendChild(r); }
      if (it.image) { const im = document.createElement('img'); im.src = it.image; im.alt = 'Code for ' + it.title; im.style.cssText = 'display:block;max-width:min(80vmin,100%);height:auto;background:#fff;margin:8px 0;image-rendering:pixelated'; card.appendChild(im); }
      if (it.note) { const n = document.createElement('div'); n.style.fontSize = '15px'; n.textContent = it.note; card.appendChild(n); }
      if (it.url) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = (typeof VexOfflinePages !== 'undefined' && VexOfflinePages.isOffline(it.url) ? 'Open the saved copy' : 'Open the page');
        b.style.cssText = 'font:inherit;font-size:15px;margin-top:8px;padding:8px 16px;border:2px solid #000;background:#fff;color:#000;border-radius:8px;cursor:pointer';
        b.addEventListener('click', () => { ov.remove(); this._openItem(it).catch(err => window.showToast?.(err.message, 'error')); });
        card.appendChild(b);
      }
      ov.appendChild(card);
    }
    const onKey = (e) => { if (!ov.isConnected) { document.removeEventListener('keydown', onKey, true); return; } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } };
    const done = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
    close.addEventListener('click', done);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
    if (typeof VexLayer !== 'undefined') VexLayer.track(ov, { tier: 'dialog', id: 'travel-mode' });
    close.focus({ preventScroll: true });
  },

  // ---- the workspace screen ------------------------------------------------------------------
  open() {
    if (!this.enabled()) { window.showToast?.('Travel mode is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('travel-mode');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-travel', title: 'Trip workspace', sub: 'Tickets, QR codes and booking references in one place. Everything stays on this computer.' });
    const draw = () => {
      body.textContent = '';
      let st;
      try { st = this.state(); } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      const mk = (tag, props = {}) => Object.assign(document.createElement(tag), props);
      const top = mk('div'); top.className = 'vexsr-rule'; top.style.flexWrap = 'wrap';
      const name = mk('input', { type: 'text', placeholder: 'Trip name', maxLength: 60, value: st.trip.name }); name.setAttribute('aria-label', 'Trip name');
      const tz = mk('input', { type: 'text', placeholder: 'Europe/Istanbul', value: st.trip.tz }); tz.setAttribute('aria-label', 'Time zone of the place you are going');
      const lead = mk('input', { type: 'number', min: '5', max: '720', value: String(st.trip.leadMin) }); lead.setAttribute('aria-label', 'Minutes before departure for the leave notice'); lead.style.width = '70px';
      top.append(name, tz, lead, VexSettingsGroups.button('Save trip', () => { try { this.setTrip({ name: name.value, tz: tz.value, leadMin: lead.value }); window.showToast?.('Saved', 'success'); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
      body.appendChild(top);
      const onRow = mk('div'); onRow.className = 'vexsr-rule';
      onRow.append(VexSettingsGroups.button(st.on ? 'Turn travel mode off' : 'Turn travel mode on', () => { try { this.setOn(!st.on); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { primary: !st.on }),
        VexSettingsGroups.button('Show tickets', () => this.openTickets(), { primary: st.on }));
      body.appendChild(onRow);
      body.appendChild(VexSettingsGroups.note(st.on ? 'Travel mode is on: notices that are not urgent wait in the Attention Inbox.' : 'Travel mode is off. Turning it on quiets notices that are not urgent.'));
      if (st.trip.tz) { try { const c = this.clock(st.trip.tz); body.appendChild(VexSettingsGroups.note('There ' + c.there + ' | Here ' + c.here + ' (' + c.diffText + ')')); } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); } }
      if (st.trip.tz) body.appendChild(VexSettingsGroups.button('Shift my reminders to the time there...', () => { this.openShift().catch(err => window.showToast?.(err.message, 'error')); }));

      const f = mk('div'); f.className = 'vexsr-rule'; f.style.flexWrap = 'wrap';
      const kind = mk('select'); kind.setAttribute('aria-label', 'Kind'); for (const k of this.KINDS) kind.append(new Option(this.KIND_LABEL[k], k));
      const title = mk('input', { type: 'text', placeholder: 'Train to Ankara', maxLength: 100 }); title.setAttribute('aria-label', 'Name');
      const ref = mk('input', { type: 'text', placeholder: 'Booking ref', maxLength: 60 }); ref.setAttribute('aria-label', 'Booking reference');
      const dep = mk('input', { type: 'datetime-local' }); dep.setAttribute('aria-label', 'Departure');
      const url = mk('input', { type: 'url', placeholder: 'https:// (optional)' }); url.setAttribute('aria-label', 'Page address');
      const img = mk('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' }); img.setAttribute('aria-label', 'Image of the code');
      const add = async () => {
        try {
          let image = '';
          const file = img.files && img.files[0];
          if (file) {
            if (file.size > this.MAX_IMAGE) throw new Error('Make the image smaller: Vex keeps images under 250 KB');
            image = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('The image could not be read')); r.readAsDataURL(file); });
          }
          this.add({ kind: kind.value, title: title.value, ref: ref.value, departAt: dep.value ? new Date(dep.value).getTime() : 0, url: url.value, image });
          draw();
        } catch (err) { window.showToast?.(err.message, 'error'); }
      };
      f.append(kind, title, ref, dep, url, img, VexSettingsGroups.button('Add', add, { primary: true }));
      body.appendChild(f);
      body.appendChild(VexSettingsGroups.button('Add the page in front (and keep a copy offline)', async () => {
        try {
          const t = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
          if (!t || !/^https?:/i.test(t.url || '')) throw new Error('Open the ticket page first');
          const it = this.add({ kind: 'ticket', title: (t.title || t.url).slice(0, 100), url: t.url });
          if (typeof VexOfflinePages !== 'undefined') {
            try { await VexOfflinePages.markActive(); window.showToast?.('Added, and a copy is kept for when there is no internet', 'success'); }
            catch (err) { window.showToast?.('Added, but no offline copy: ' + err.message, 'info', 7000); }
          } else window.showToast?.('Added ' + it.title, 'success');
          draw();
        } catch (err) { window.showToast?.(err.message, 'error'); }
      }));

      const items = this.sortItems(st.items, Date.now());
      if (!items.length) body.appendChild(VexSettingsGroups.note('Nothing here yet.'));
      for (const it of items) {
        const row = mk('div'); row.className = 'vexsr-rule';
        const text = mk('span', { textContent: it.title + '  (' + this.KIND_LABEL[it.kind] + (it.ref ? ', ' + it.ref : '') + (it.departAt ? ', ' + new Date(it.departAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '') + (it.image ? ', has a code image' : '') + (it.url && typeof VexOfflinePages !== 'undefined' && VexOfflinePages.isOffline(it.url) ? ', saved offline' : '') + ')' });
        text.className = 'vexsr-host'; text.style.wordBreak = 'normal';
        row.append(text, VexSettingsGroups.button('Remove', () => { try { this.remove(it.id); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { danger: true, label: 'Remove ' + it.title }));
        body.appendChild(row);
      }
    };
    draw();
  },

  // ---- shifted reminders ---------------------------------------------------------------------------------
  // Minutes east of UTC that `tz` is at the moment `at`.
  zoneOffsetMin(tz, at) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(new Date(at)).map(x => [x.type, x.value]));
    return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at / 1000) * 1000) / 60000);
  },
  homeZone() { return Intl.DateTimeFormat().resolvedOptions().timeZone; },
  // The same wall-clock time (09:00 on Tuesday) in another zone: the moment at which `toTz` reads what `fromTz` read at `at`.
  shiftTime(at, fromTz, toTz) {
    const wall = at + this.zoneOffsetMin(fromTz, at) * 60000;
    const t0 = wall - this.zoneOffsetMin(toTz, at) * 60000;
    return wall - this.zoneOffsetMin(toTz, t0) * 60000;
  },
  // Which pending reminders would move, and to when. Only a timed reminder that has not fired, within `days`, that does not
  // repeat and is not tied to a site; and only when the new moment is still ahead. -> { rows, skipped }
  shiftPlan(reminders, toTz, now = Date.now(), days = 14, fromTz = this.homeZone()) {
    if (!this.validZone(toTz)) throw new Error('"' + toTz + '" is not a time zone (try Europe/Istanbul or Asia/Tokyo)');
    const rows = [];
    let skipped = 0;
    for (const r of Array.isArray(reminders) ? reminders : []) {
      if (!r || typeof r.id !== 'string' || typeof r.message !== 'string' || !Number.isFinite(r.at) || r.firedAt || r.at <= now || r.at > now + days * 86400000) continue;
      if (r.repeat || r.site) { skipped++; continue; }
      const newAt = this.shiftTime(r.at, fromTz, toTz);
      if (Math.abs(newAt - r.at) < 60000) continue;
      if (newAt <= now + 60000) { skipped++; continue; }
      rows.push({ id: r.id, message: r.message, at: r.at, newAt, url: typeof r.url === 'string' ? r.url : '', urgent: !!r.urgent, kind: typeof r.kind === 'string' ? r.kind : '' });
    }
    return { rows: rows.sort((a, b) => a.at - b.at).slice(0, 40), skipped };
  },
  _extra(r) { return { ...(r.url ? { url: r.url } : {}), ...(r.urgent ? { urgent: true } : {}), ...(r.kind ? { kind: r.kind } : {}) }; },
  // Moves the chosen reminders: a new one at the new moment, then the old one removed. A reminder whose old one cannot be removed
  // is not left twice. One ledger line with an Undo. -> { moved, failed: [text] }
  async applyShift(rows, toTz) {
    const b = typeof window !== 'undefined' && window.vex && window.vex.reminders;
    if (!b || typeof b.create !== 'function' || typeof b.delete !== 'function') throw new Error('Reminders are not available in this window');
    const pairs = [], failed = [];
    for (const r of rows) {
      let made;
      try { made = await b.create(r.message, r.newAt, this._extra(r)); }
      catch (err) { failed.push(r.message.slice(0, 40) + ': ' + err.message); continue; }
      const newId = made && made.id;
      if (!newId) { failed.push(r.message.slice(0, 40) + ': Vex did not say which reminder it made'); continue; }
      try { await b.delete(r.id); }
      catch (err) {
        failed.push(r.message.slice(0, 40) + ': the old reminder could not be removed (' + err.message + ')');
        try { await b.delete(newId); } catch (e2) { failed.push(r.message.slice(0, 40) + ': and the new one could not be removed either, so it is there twice'); }
        continue;
      }
      pairs.push({ n: newId, m: r.message.slice(0, 80), a: r.at, u: r.url || '', g: r.urgent ? 1 : 0 });
    }
    if (pairs.length && typeof VexLedger !== 'undefined') {
      VexLedger.note({ feature: 'travel-mode', what: 'Moved ' + pairs.length + ' reminder' + (pairs.length === 1 ? '' : 's') + ' to the time in ' + toTz, why: 'You pressed Shift in the trip workspace',
        undo: { kind: 'travel-shift-undo', pairs: pairs.slice(0, 12) } });
    }
    return { moved: pairs.length, failed };
  },
  async undoShift(token) {
    const b = window.vex && window.vex.reminders;
    if (!b) throw new Error('Reminders are not available in this window');
    let back = 0, late = 0;
    for (const p of Array.isArray(token.pairs) ? token.pairs : []) {
      await b.delete(p.n);
      if (p.a > Date.now() + 60000) { await b.create(p.m, p.a, { ...(p.u ? { url: p.u } : {}), ...(p.g ? { urgent: true } : {}) }); back++; } else late++;
    }
    if (late) window.showToast?.(late + ' reminder' + (late === 1 ? ' was' : 's were') + ' past its old time, so it was not put back', 'info', 7000);
    return back;
  },
  async openShift() {
    if (!this.enabled()) { window.showToast?.('Travel mode is switched off in Settings', 'info'); return; }
    const st = this.state();
    if (!st.trip.tz) { window.showToast?.('Set the time zone of the place you are going first', 'error'); return; }
    const b = window.vex && window.vex.reminders;
    if (!b || typeof b.list !== 'function') { window.showToast?.('Reminders are not available in this window', 'error'); return; }
    let plan;
    try { plan = this.shiftPlan(await b.list(), st.trip.tz); }
    catch (err) { window.showToast?.(err.message, 'error'); return; }
    const { body } = VexSettingsGroups.dialog({ id: 'vex-travel-shift', title: 'Shift reminders to ' + st.trip.tz, sub: 'A reminder keeps the clock time you gave it, moved to the time there. Pick the ones to move; nothing else changes, and the ledger can put them back.' });
    if (!plan.rows.length) body.appendChild(VexSettingsGroups.note('No timed reminder in the next 14 days would move.' + (plan.skipped ? ' ' + plan.skipped + ' repeating, site, or too-soon reminder' + (plan.skipped === 1 ? ' is' : 's are') + ' left alone.' : '')));
    const boxes = [];
    const fmt = (ms, tz) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz });
    for (const r of plan.rows) {
      const row = document.createElement('label');
      row.className = 'vexsr-rule';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = true; cb.setAttribute('aria-label', 'Move ' + r.message);
      const text = document.createElement('span');
      text.className = 'vexsr-host'; text.style.wordBreak = 'normal';
      text.textContent = r.message.slice(0, 70) + '  (' + fmt(r.at) + ' here, to ' + fmt(r.newAt) + ' here = ' + fmt(r.newAt, st.trip.tz) + ' there)';
      row.append(cb, text);
      body.appendChild(row);
      boxes.push([cb, r]);
    }
    if (plan.rows.length) {
      body.appendChild(VexSettingsGroups.button('Move the ticked reminders', async () => {
        const chosen = boxes.filter(([cb]) => cb.checked).map(([, r]) => r);
        if (!chosen.length) { window.showToast?.('Tick at least one'); return; }
        const ok = await window.vexConfirm({ title: 'Move ' + chosen.length + ' reminder' + (chosen.length === 1 ? '' : 's') + '?', message: 'Each gets a new time in the time zone ' + st.trip.tz + ' and the old one is removed. Ctrl+K "Why did that happen?" can put them back.', okLabel: 'Move' });
        if (!ok) return;
        try {
          const r = await this.applyShift(chosen, st.trip.tz);
          window.showToast?.('Moved ' + r.moved + (r.failed.length ? '; ' + r.failed.length + ' could not be: ' + r.failed[0] : ''), r.failed.length ? 'error' : 'success', 9000);
        } catch (err) { window.showToast?.(err.message, 'error'); }
      }, { primary: true }));
    }
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Tickets, QR codes and booking references in one bright view, sorted by next departure, with the time where you are going and a "time to leave" notice. Travel mode also quiets notices that are not urgent.'));
    el.appendChild(VexSettingsGroups.button('Open the trip workspace', () => this.open(), { primary: true }));
    el.appendChild(VexSettingsGroups.button('Show tickets', () => this.openTickets()));
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('travel-mode-set', async (token) => { this.setOn(!!token.on); });
      VexLedger.registerUndo('travel-shift-undo', (token) => this.undoShift(token));
    }
    if (typeof VexJobs !== 'undefined') VexJobs.every(this.JOB, 2 * 60 * 1000, () => this.tick(), { feature: 'travel-mode' });
    this._changed();
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexTravel = VexTravel;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'travel-mode', title: 'Travel mode', keywords: 'travel trip tickets qr booking departure leave now time zone offline station airport', before: 'about', build: (el) => VexTravel.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'travel', label: 'Trip workspace', hint: 'Tickets, QR codes, booking references and travel mode', icon: 'map', action: () => VexTravel.open() });
    VexExtras.registerCommand({ id: 'travel-tickets', label: 'Show tickets', hint: 'A bright full-screen list of your tickets by next departure', icon: 'map', action: () => VexTravel.openTickets() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTravel };
