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
// encrypted payload (older desktops ignore it). A phone cannot share an image or a link-less
// piece of text this way (the mailbox needs an http(s) address and holds 16 KB): that would
// need a protocol change and is not done here. What vex-mobile has to send is written in
// docs/PHONE_SHARE.md.
//
// Private windows never fetch the mailbox, so nothing here runs in them.

const VexPhoneShare = {
  PREF: 'vex.phoneShare.prefs',          // { enabled, autoFile }
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
      if (!items.length) body.appendChild(VexSettingsGroups.note('Nothing is waiting. Share a page from your phone to Vex and it shows up here within a couple of minutes. The phone app needs Vex Sync turned on.'));
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
    el.appendChild(VexSettingsGroups.note('Links you share from your phone to Vex (through Vex Sync) can be filed into Clips. Off by default: then they stay New Tab cards. Images and text without a link cannot travel this way. What the phone app has to send is in docs/PHONE_SHARE.md.'));
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
