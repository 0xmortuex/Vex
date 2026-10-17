// === What your phone shares lands in Clips ======================================
//
// T3-036, the Vex side. Vex Sync already has a small encrypted mailbox that a
// phone writes to and a desktop empties (docs/SYNC_PROTOCOL.md §7, js/handoff.js):
// each item is a link and a title. Today those items appear as cards on the New
// Tab page. This makes the phone's SHARE SHEET useful on the desktop:
//
//   Shared from my phone   Ctrl+K lists the links that came from a device that looks
//                          like a phone, with Open, Save to Clips and Dismiss. A link comes
//                          with an optional note: the text the phone shared along with it.
//   File them for me       OFF by default. When on, a link from a phone goes straight into
//                          the text Clips inbox (title, link and note as one clip) instead of a
//                          New Tab card, with a Ledger line and an Undo that puts the card back.
//
// There is no new server and no new protocol: the mailbox, its 20-item / 7-day limits and
// its encryption are unchanged, and the optional `note` is one more text field in the same
// encrypted payload (older desktops ignore it).
//
// Wave 5 adds text and small pictures to the same mailbox, still one encrypted payload and
// still the 16 KB limit: { kind: "text", text } (up to 4000 characters) and { kind: "image",
// image: { mime, data } } with a base64 picture of up to 9000 characters (a thumbnail: PNG,
// JPEG, GIF or WebP, checked by its first bytes). A full-size photo does not fit a 16 KB mailbox;
// that needs an attachment endpoint on the sync worker and is documented, not built.
// These are kept in their own short list (vex.phoneShare.items, 20 items, 14 days) because they
// have no address to open: text can be copied or filed into Clips, a picture copied. A link is
// still a New Tab card. What vex-mobile has to send is in docs/PHONE_SHARE.md.
//
// Private windows never fetch the mailbox, so nothing here runs in them.

const VexPhoneShare = {
  PREF: 'vex.phoneShare.prefs',          // { enabled, autoFile }
  ITEMS_KEY: 'vex.phoneShare.items',     // shared text and small pictures (no link)
  MAX_ITEMS: 20,
  KEEP_MS: 14 * 24 * 3600 * 1000,
  TEXT_MAX: 4000,
  IMAGE_MAX: 9000,
  IMAGE_MIMES: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  FEATURE: 'phone-share',

  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); }
    catch (err) { throw new Error('The phone share settings could not be read: ' + err.message, { cause: err }); }
    return { enabled: !raw || raw.enabled !== false, autoFile: !!(raw && raw.autoFile === true) };
  },
  enabled() { try { return this.prefs().enabled; } catch (err) { console.error('[PhoneShare]', err.message); return false; } },
  setPrefs(patch) {
    const next = { ...this.prefs(), ...patch };
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: !!next.enabled, autoFile: !!next.autoFile })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    return this.prefs();
  },
  setEnabled(on) { return this.setPrefs({ enabled: !!on }).enabled; },

  // ---- pure ---------------------------------------------------------------------------
  // The text one clip holds: the title, the link, then what the phone said about it.
  clipText(item) {
    const lines = [String(item.title || '').trim(), String(item.url || '').trim(), String(item.note || '').trim()].filter(Boolean);
    if (!lines.some(l => /^https?:\/\//i.test(l))) throw new Error('That item has no link');
    return lines.join('\n').slice(0, 3900);
  },
  isPhone(item) {
    return typeof Handoff !== 'undefined' && typeof Handoff.looksLikePhone === 'function' && Handoff.looksLikePhone(item && item.from);
  },
  phoneItems() {
    if (typeof Handoff === 'undefined') throw new Error('Send to your devices is not loaded');
    return Handoff.inbox().filter(i => this.isPhone(i));
  },

  // ---- text and pictures (Wave 5) ---------------------------------------------------------
  _shares() {
    const raw = localStorage.getItem(this.ITEMS_KEY);
    if (!raw) return [];
    let list;
    try { list = JSON.parse(raw); } catch (err) { throw new Error('The text and pictures from your phone could not be read: ' + err.message, { cause: err }); }
    if (!Array.isArray(list)) throw new Error('The text and pictures from your phone could not be read');
    const keep = Date.now() - this.KEEP_MS;
    return list.filter(i => this.validShare(i) && (Number(i.receivedAt) || 0) >= keep);
  },
  _saveShares(list) {
    try { localStorage.setItem(this.ITEMS_KEY, JSON.stringify(list.slice(-this.MAX_ITEMS))); }
    catch (err) { throw new Error('Could not keep what your phone shared: ' + err.message, { cause: err }); }
  },
  validShare(i) {
    if (!i || typeof i !== 'object' || typeof i.id !== 'string' || !i.id || i.id.length > 64 || typeof i.from !== 'string') return false;
    if (i.kind === 'text') return typeof i.text === 'string' && i.text.length > 0 && i.text.length <= this.TEXT_MAX;
    if (i.kind === 'image') return !!i.image && this.IMAGE_MIMES.includes(i.image.mime) && typeof i.image.data === 'string' && i.image.data.length > 0 && i.image.data.length <= this.IMAGE_MAX && /^[A-Za-z0-9+/]+={0,2}$/.test(i.image.data);
    return false;
  },
  sharedItems() { return this._shares(); },
  // Items from SyncEngine.dropFetch (already checked there, and checked again here). -> the new entries kept.
  addShared(items, now = Date.now()) {
    const list = this._shares();
    const have = new Set(list.map(i => i.id));
    const fresh = [];
    for (const it of items || []) {
      const id = 's' + String(it.id || now.toString(36) + Math.random().toString(36).slice(2, 7)).replace(/[^\w-]/g, '').slice(0, 40);
      if (have.has(id)) continue;
      const entry = { id, kind: it.kind, from: String(it.fromDeviceName || 'another device').slice(0, 120), title: String(it.title || '').slice(0, 300), at: typeof it.at === 'string' ? it.at : new Date(now).toISOString(), receivedAt: now };
      if (it.kind === 'text') entry.text = String(it.text || '').slice(0, this.TEXT_MAX);
      else if (it.kind === 'image') entry.image = { mime: it.image && it.image.mime, data: it.image && it.image.data };
      if (!this.validShare(entry)) { window.VexProblems?.note('Phone share', 'A shared item from ' + entry.from + ' was not a usable text or picture, so it was dropped', new Error('invalid shared item')); continue; }
      have.add(id); list.push(entry); fresh.push(entry);
    }
    if (fresh.length) this._saveShares(list);
    return fresh;
  },
  takeShared(id) {
    const list = this._shares();
    const hit = list.find(i => i.id === id);
    if (!hit) return null;
    this._saveShares(list.filter(i => i.id !== id));
    return hit;
  },
  shareClipText(item) {
    if (item.kind !== 'text') throw new Error('Only text can be filed as a clip');
    return [String(item.title || '').trim(), item.text].filter(Boolean).join('\n').slice(0, 3900);
  },
  async fileShareToClips(id) {
    const item = this._shares().find(i => i.id === id);
    if (!item) throw new Error('That shared item is gone');
    if (!window.vex || typeof window.vex.clipsInboxAdd !== 'function') throw new Error('The Clips inbox is not available here');
    const r = await window.vex.clipsInboxAdd(this.shareClipText(item));
    if (!r || !r.ok) throw new Error((r && r.error) || 'The Clips inbox did not take that');
    this.takeShared(id);
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    return { item, clipId: r.id };
  },
  restoreShare(entry) {
    const list = this._shares();
    if (!list.some(i => i.id === entry.id)) this._saveShares([...list, entry]);
  },
  // Called with the entries just kept. Text goes straight to Clips when the person chose that; a picture never does
  // (the Clips inbox holds text). Everything else waits in the list, with one quiet notice.
  async onSharedFresh(fresh) {
    let auto = false;
    try { const p = this.prefs(); auto = p.enabled && p.autoFile; } catch (err) { window.VexProblems?.note('Phone share', 'The settings could not be read, so nothing was filed', err); }
    let waiting = 0;
    for (const item of fresh) {
      if (auto && item.kind === 'text') {
        try {
          const { clipId } = await this.fileShareToClips(item.id);
          if (typeof VexLedger !== 'undefined') VexLedger.note({ feature: this.FEATURE, what: 'Filed text from ' + item.from + ' into Clips', why: 'You turned on "file what my phone shares into Clips"', undo: { kind: 'phone-share-unfile-text', clipId, entry: item }, stop: { kind: 'phone-share-stop' } });
          continue;
        } catch (err) { window.VexProblems?.note('Phone share', 'Could not file text from ' + item.from + ' into Clips; it stays in the list', err); }
      }
      waiting++;
    }
    if (waiting && typeof VexAttention !== 'undefined') {
      VexAttention.notify({ feature: this.FEATURE, urgency: 'useful', id: 'shares:' + fresh[0].id }, () => window.showToast?.(waiting + ' item' + VexPlural.s(waiting) + ' shared from your phone: Ctrl+K, Shared from my phone', 'info', 6000));
    }
    return waiting;
  },
  async unfileText(clipId, entry) {
    if (!window.vex || typeof window.vex.clipsInboxRemove !== 'function') throw new Error('The Clips inbox is not available here');
    const r = await window.vex.clipsInboxRemove(clipId);
    if (!r || r.ok === false) throw new Error('The clip is already gone');
    this.restoreShare(entry);
  },

  // ---- filing ---------------------------------------------------------------------------
  async _addClip(item) {
    if (!window.vex || typeof window.vex.clipsInboxAdd !== 'function') throw new Error('The Clips inbox is not available here');
    const r = await window.vex.clipsInboxAdd(this.clipText(item));
    if (!r || !r.ok) throw new Error((r && r.error) || 'The Clips inbox did not take that');
    return r.id;
  },

  // Moves one item from the New Tab cards into Clips. Put back if the clip could not be saved.
  async fileToClips(id) {
    if (typeof Handoff === 'undefined') throw new Error('Send to your devices is not loaded');
    const item = Handoff.inbox().find(i => i.id === id);
    if (!item) throw new Error('That shared link is gone');
    const clipId = await this._addClip(item);
    Handoff.take(id);
    Handoff.pushAll();
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    return { item, clipId };
  },

  // Called by Handoff.receive with the items just taken from the mailbox. -> ids filed.
  async onFresh(fresh) {
    let on = false;
    try { on = this.prefs().enabled && this.prefs().autoFile; } catch (err) { window.VexProblems?.note('Phone share', 'The settings could not be read, so nothing was filed', err); return []; }
    if (!on) return [];
    const filed = [];
    for (const item of fresh) {
      if (!this.isPhone(item)) continue;
      try {
        const { clipId } = await this.fileToClips(item.id);
        filed.push(item.id);
        const token = { kind: 'phone-share-unfile', clipId, entry: { id: item.id, url: item.url, title: String(item.title || '').slice(0, 200), from: item.from, at: item.at, receivedAt: item.receivedAt, note: String(item.note || '').slice(0, 300) } };
        if (typeof VexLedger !== 'undefined') VexLedger.note({ feature: this.FEATURE, what: 'Filed a link from ' + item.from + ' into Clips', why: 'You turned on "file what my phone shares into Clips"', undo: token, stop: { kind: 'phone-share-stop' } });
      } catch (err) { window.VexProblems?.note('Phone share', 'Could not file a link from ' + item.from + ' into Clips; it stays a New Tab card', err); }
    }
    return filed;
  },

  // ---- the list -----------------------------------------------------------------------------
  open() {
    if (!this.enabled()) { window.showToast?.('Phone share is switched off in Settings', 'info'); return null; }
    const { body } = VexSettingsGroups.dialog({ id: 'vex-phone-share', title: 'Shared from my phone', sub: 'Links your phone sent through Vex Sync. Save one to Clips, open it, or dismiss it.' });
    const draw = () => {
      body.textContent = '';
      let items;
      try { items = this.phoneItems(); } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      let shares = [];
      try { shares = this.sharedItems(); } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); }
      if (!items.length && !shares.length) body.appendChild(VexSettingsGroups.note('Nothing is waiting. Share a page, some text or a small picture from your phone to Vex and it shows up here within a couple of minutes. The phone app needs Vex Sync turned on.'));
      for (const s of shares) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        row.style.flexWrap = 'wrap';
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        text.style.whiteSpace = 'pre-wrap';
        if (s.kind === 'text') text.textContent = (s.title ? s.title + ': ' : '') + s.text.slice(0, 300) + (s.text.length > 300 ? '...' : '') + '  (' + s.from + ')';
        else {
          const img = document.createElement('img');
          img.alt = 'A picture shared from ' + s.from;
          img.src = 'data:' + s.image.mime + ';base64,' + s.image.data;
          img.style.cssText = 'max-width:160px;max-height:120px;border-radius:6px;display:block;margin-bottom:4px';
          text.append(img, document.createTextNode((s.title ? s.title + ' ' : '') + '(' + s.from + ')'));
        }
        row.appendChild(text);
        const label = s.kind === 'text' ? 'shared text' : 'shared picture';
        row.appendChild(VexSettingsGroups.button('Copy', async () => {
          try {
            if (s.kind === 'text') await navigator.clipboard.writeText(s.text);
            else {
              const bin = atob(s.image.data);
              const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
              await navigator.clipboard.write([new ClipboardItem({ [s.image.mime]: new Blob([bytes], { type: s.image.mime }) })]);
            }
            window.showToast?.('Copied');
          } catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); }
        }, { primary: s.kind !== 'text', label: 'Copy the ' + label }));
        if (s.kind === 'text') {
          row.appendChild(VexSettingsGroups.button('Save to Clips', async () => {
            try {
              const { clipId } = await this.fileShareToClips(s.id);
              window.VexUndo.offer({ message: 'Saved to Clips', undo: () => this.unfileText(clipId, s) });
              draw();
            } catch (err) { window.showToast?.(err.message, 'error'); }
          }, { primary: true, label: 'Save the ' + label + ' to Clips' }));
        }
        row.appendChild(VexSettingsGroups.button('Dismiss', () => {
          try { this.takeShared(s.id); draw(); window.VexUndo.offer({ message: 'Dismissed a ' + label, undo: () => { this.restoreShare(s); if (body.isConnected) draw(); } }); }
          catch (err) { window.showToast?.(err.message, 'error'); }
        }, { danger: true, label: 'Dismiss the ' + label }));
        body.appendChild(row);
      }
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        row.style.flexWrap = 'wrap';
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        text.textContent = (item.title || item.url) + '  (' + item.from + (item.note ? ': ' + item.note.slice(0, 80) : '') + ')';
        row.appendChild(text);
        row.appendChild(VexSettingsGroups.button('Open', () => {
          try { Handoff.take(item.id); Handoff.pushAll(); TabManager.createTab(item.url, true); draw(); } catch (err) { window.showToast?.(err.message, 'error'); }
        }, { label: 'Open ' + (item.title || item.url) }));
        row.appendChild(VexSettingsGroups.button('Save to Clips', async () => {
          try {
            const { clipId } = await this.fileToClips(item.id);
            window.VexUndo.offer({ message: 'Saved to Clips', undo: () => this.unfile(clipId, item) });
            draw();
          } catch (err) { window.showToast?.(err.message, 'error'); }
        }, { primary: true, label: 'Save ' + (item.title || item.url) + ' to Clips' }));
        row.appendChild(VexSettingsGroups.button('Dismiss', () => {
          try { Handoff.take(item.id); Handoff.pushAll(); draw(); window.VexUndo.offer({ message: 'Dismissed a shared link', undo: () => { this.restoreCard(item); if (body.isConnected) draw(); } }); }
          catch (err) { window.showToast?.(err.message, 'error'); }
        }, { danger: true, label: 'Dismiss ' + (item.title || item.url) }));
        body.appendChild(row);
      }
    };
    draw();
    return body;
  },

  // Undo of filing: the clip out, the New Tab card back.
  async unfile(clipId, entry) {
    if (!window.vex || typeof window.vex.clipsInboxRemove !== 'function') throw new Error('The Clips inbox is not available here');
    const r = await window.vex.clipsInboxRemove(clipId);
    if (!r || r.ok === false) throw new Error('The clip is already gone');
    this.restoreCard(entry);
  },
  restoreCard(entry) {
    const list = Handoff.inbox();
    if (!list.some(i => i.id === entry.id)) { Handoff._save([...list, entry]); }
    Handoff.pushAll();
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Links you share from your phone to Vex (through Vex Sync) can be filed into Clips. Off by default: then they stay New Tab cards. Text and small pictures (a thumbnail that fits the 16 KB mailbox) come through too and wait in the list; a full-size photo cannot. What the phone app has to send is in docs/PHONE_SHARE.md.'));
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;gap:8px;align-items:center;margin:6px 0';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.setAttribute('aria-label', 'File links my phone shares straight into Clips');
    let auto = false;
    try { auto = this.prefs().autoFile; } catch (err) { window.VexProblems?.note('Phone share', 'The settings could not be read', err); }
    box.checked = auto;
    box.addEventListener('change', () => { try { this.setPrefs({ autoFile: box.checked }); } catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); } });
    label.append(box, document.createTextNode('File links my phone shares straight into Clips'));
    el.appendChild(label);
    el.appendChild(VexSettingsGroups.button('Shared from my phone', () => this.open(), { primary: true }));
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('phone-share-unfile', async (token) => { await this.unfile(token.clipId, token.entry); });
      VexLedger.registerUndo('phone-share-unfile-text', async (token) => { await this.unfileText(token.clipId, token.entry); });
      VexLedger.registerStop('phone-share-stop', async () => { this.setPrefs({ autoFile: false }); });
    }
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexPhoneShare = VexPhoneShare;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'phone-share', title: 'Shared from my phone', keywords: 'phone share sheet android clips inbox link send mobile handoff', before: 'about', build: (el) => VexPhoneShare.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'phone-shares', label: 'Shared from my phone', hint: 'Links your phone sent: open, save to Clips or dismiss', icon: 'phone', action: () => VexPhoneShare.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPhoneShare };
