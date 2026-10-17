// === Safer browsing helpers: one Settings group and the Ctrl+K commands ===============
//
// Ten small protections around the scams a gamer meets (fake cheats and updates, fake
// giveaways, QR links, look-alike sign-in pages, trading-site fraud). Each has its own
// module and its own switch; this file only gives them one place in Settings and in Ctrl+K.
//
//   T3-010  cheat tools and fake updates   src/main/download-guard.js (part of Web safety)
//   T3-077  cookie-banner auto-reject      page-extras.js (ConsentBlock)
//   T3-088  vault hygiene                  vault-hygiene.js
//   T3-098  marketplace red flags          marketplace-signs.js
//   T3-100  new domain from a chat         chat-links.js (VexChatFlag)
//   T3-101  QR verdict                     qr-verdict.js
//   T3-102  throwaway session for chats    chat-links.js (VexChatThrowaway)
//   T3-110  Scan with Windows Security     download-safety.js (VexDefenderShortcut)
//   T3-111  internet-mark check            download-safety.js (VexMotwCheck)
//   T3-114  screen-share safe mode         screen-share-safe.js
//
// Every warning these show says why it was shown, and can be silenced for one site.
const VexSecurityHelpers = {
  _toggle(parent, label, hint, get, set) {
    const row = document.createElement('div');
    row.className = 'setting-toggle-row';
    const span = document.createElement('span');
    span.textContent = label;
    if (hint) span.title = hint;
    const sw = document.createElement('label');
    sw.className = 'toggle';
    sw.innerHTML = '<input type="checkbox"><span class="toggle-slider"></span>';
    const box = sw.querySelector('input');
    box.setAttribute('aria-label', label);
    box.checked = !!get();
    box.addEventListener('change', () => {
      try { set(box.checked); }
      catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); }
    });
    row.append(span, sw);
    parent.appendChild(row);
    return row;
  },
  _info(parent, text) { const p = document.createElement('p'); p.className = 'setting-info muted'; p.textContent = text; parent.appendChild(p); return p; },
  _button(parent, text, fn) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn-secondary'; b.textContent = text;
    b.addEventListener('click', () => { Promise.resolve().then(fn).catch(err => window.showToast?.((err && err.message) || String(err), 'error')); });
    parent.appendChild(b);
    return b;
  },
  // A list with a Remove button per row.
  _list(parent, items, empty, remove) {
    if (!items.length) { this._info(parent, empty); return; }
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'setting-toggle-row';
      const t = document.createElement('span'); t.textContent = it;
      row.appendChild(t);
      this._button(row, 'Remove', async () => { remove(it); });
      parent.appendChild(row);
    }
  },

  _activeHost() {
    if (typeof TabManager === 'undefined') return '';
    const t = TabManager.getActiveTab();
    try { const u = new URL(t && t.url); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase().replace(/^www\./, '') : ''; } catch { return ''; }
  },

  render(body) {
    body.textContent = '';
    const again = () => this.render(body);
    this._info(body, 'Small protections that stay quiet unless they are sure. Each says why it spoke, and each can be switched off for one site or altogether. Nothing here looks anything up: the checks run on this computer.');

    this._info(body, 'Downloads. Files named like game cheats, executors, injectors or cracks, and fake "update" installers, are held and explained before they are kept (Web safety decides how often: Settings > Web safety).');
    if (typeof VexDefenderShortcut !== 'undefined') this._toggle(body, 'Scan with Windows Security button on downloads', 'A shield button on a finished program or archive. It opens Windows Security and shows the file; Vex starts no scan.', () => VexDefenderShortcut.enabled(), (on) => VexDefenderShortcut.setEnabled(on));
    if (typeof VexDefenderShortcut !== 'undefined') {
      this._toggle(body, 'Scan now with Microsoft Defender (off until you switch it on)', 'A second button on the same downloads runs Defender\'s own scanner (MpCmdRun.exe) on that one file, after a box that shows the exact command. Nothing is uploaded; Defender may quarantine a file it flags.', () => VexDefenderShortcut.scanEnabled(), (on) => VexDefenderShortcut.setScanEnabled(on));
      this._button(body, 'Scan a file with Defender...', () => VexDefenderShortcut.scan('pick'));
    }
    if (typeof VexMotwCheck !== 'undefined') {
      this._toggle(body, 'Check the "downloaded from the internet" mark', 'Vex keeps the mark when it moves a download. This lists any download that has lost it. It changes no file.', () => VexMotwCheck.enabled(), (on) => VexMotwCheck.setEnabled(on));
      this._button(body, 'Check the marks on my downloads now', () => VexMotwCheck.show());
    }

    if (typeof ConsentBlock !== 'undefined') {
      this._toggle(body, 'Reject cookie banners for me', 'Presses the site\'s own Reject or Necessary-only button where it knows the banner. It never accepts, and never touches a bank, payment or sign-in page.', () => ConsentBlock.enabled(), (on) => ConsentBlock.setEnabled(on));
      let off = [];
      try { off = ConsentBlock.sitesOff(); } catch (err) { this._info(body, err.message); }
      try { this._info(body, 'Banners rejected for you in the last 7 days: ' + ConsentBlock.weekCount() + '.'); } catch (err) { this._info(body, 'The count of rejected banners could not be read: ' + err.message); }
      this._list(body, off, 'Banners are handled on every site that is not a bank, payment or sign-in page.', (h) => { ConsentBlock.setSiteOff(h, false); again(); });
      const host = this._activeHost();
      if (host) this._button(body, ConsentBlock.siteOff(host) ? 'Handle banners on ' + host + ' again' : 'Leave banners alone on ' + host, async () => { ConsentBlock.setSiteOff(host, !ConsentBlock.siteOff(host)); again(); });
    }

    if (typeof VexMarketplaceSigns !== 'undefined') {
      this._toggle(body, 'Red-flag checklist on marketplace listings', 'On the trading sites you list, shows five signs to check before you contact a seller. Signs, not a verdict.', () => VexMarketplaceSigns.enabled(), (on) => VexMarketplaceSigns.setEnabled(on));
      let hosts = [];
      try { hosts = VexMarketplaceSigns.hosts(); } catch (err) { this._info(body, err.message); }
      this._list(body, hosts, 'No marketplace sites listed.', (h) => { VexMarketplaceSigns.removeHost(h); again(); });
      const row = document.createElement('div');
      this._button(row, 'Add a marketplace site…', async () => {
        const h = await window.vexPrompt({ title: 'Add a marketplace site', label: 'Site address', message: 'For example itemsatis.com', okLabel: 'Add' });
        if (h == null) return;
        VexMarketplaceSigns.addHost(h); again();
      });
      const here = this._activeHost();
      if (here) this._button(row, 'Check this page now', async () => { const r = await VexMarketplaceSigns.check(TabManager.getActiveTab(), { quiet: false }); if (!r.shown) window.showToast?.('No listing could be checked here'); });
      body.appendChild(row);
    }

    if (typeof VexChatFlag !== 'undefined') {
      this._toggle(body, 'Flag a new site opened from a chat', 'A link from Discord, WhatsApp Web and similar chats to a site that is not in your history gets a small "new" mark, and a note if the page asks you to sign in.', () => VexChatFlag.enabled(), (on) => VexChatFlag.setEnabled(on));
      let quiet = [];
      try { quiet = VexChatLinks.quietHosts(); } catch (err) { this._info(body, err.message); }
      this._list(body, quiet, 'No site is excused from the new-site note.', (h) => { VexChatLinks.removeQuiet(h); again(); });
    }
    if (typeof VexChatThrowaway !== 'undefined') {
      this._toggle(body, 'Open chat links in a throwaway session', 'Off until you turn it on. A link from a chat opens in its own session that forgets everything when the tab closes, so it cannot see your other logins. "Move to Daily" opens it normally.', () => VexChatThrowaway.enabled(), (on) => { VexChatThrowaway.setEnabled(on); again(); });
      if (VexChatThrowaway.enabled()) {
        this._toggle(body, 'Only for sites I have never visited', 'On: sites already in your history open as usual, so your logins keep working. Off: every chat link is throwaway.', () => VexChatLinks.throwMode() === 'unknown', (on) => VexChatLinks.setThrowMode(on ? 'unknown' : 'all'));
      }
    }

    if (typeof VexQrVerdict !== 'undefined') {
      this._toggle(body, 'QR code checker', 'Pick or paste a picture of a QR code and see where it goes, judged by Web safety, before anything opens.', () => VexQrVerdict.enabled(), (on) => VexQrVerdict.setEnabled(on));
      this._button(body, 'Check a QR code…', () => VexQrVerdict.open());
    }

    if (typeof VexScreenShareSafe !== 'undefined') {
      this._toggle(body, 'Screen-share safe mode', 'While a tab or panel shares your screen, non-urgent notices wait, toasts are hidden, and the titles of bank, sign-in, mail and chat tabs are blurred.', () => VexScreenShareSafe.enabled(), (on) => VexScreenShareSafe.setEnabled(on));
      this._toggle(body, 'Also hold sign-in offers while sharing', 'The saved-login fill, the account list, the remembered email and the strong-password card wait until the share ends, so no user name appears on the shared screen.', () => VexScreenShareSafe.vaultOn(), (on) => VexScreenShareSafe.setVault(on));
      this._toggle(body, 'Also hide the New Tab history list while sharing', 'The Recent list of the New Tab page is emptied while a share lasts and comes back when it ends.', () => VexScreenShareSafe.historyOn(), (on) => VexScreenShareSafe.setHistory(on));
    }

    if (typeof VexVaultHygiene !== 'undefined') {
      this._toggle(body, 'Vault hygiene', 'A calm view of reused, weak and old passwords and missing 2FA, and once a week one quiet line when there is something to change. No password is shown.', () => VexVaultHygiene.enabled(), (on) => VexVaultHygiene.setEnabled(on));
      this._button(body, 'Open the vault hygiene view', () => VexVaultHygiene.open());
      this._toggle(body, 'Weekly safety check', 'Once a week, one quiet card when something needs a look: passwords and the mailbox that recovers them, permissions that end soon, odd files in Downloads. Counts and names only.', () => VexVaultHygiene.rollupEnabled(), (on) => VexVaultHygiene.setRollupEnabled(on));
      this._button(body, 'Run the weekly safety check now', () => VexVaultHygiene.openRollup());
    }
  },

  _commands() {
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const run = (fn) => () => { Promise.resolve().then(fn).catch(fail); };
    return [
      { id: 'safeweb:qr', label: 'Check a QR code', hint: 'Read a QR picture here and judge the address before anything opens', icon: 'shield', action: run(() => VexQrVerdict.open()) },
      { id: 'safeweb:marketplace', label: 'Check this listing for red flags', hint: 'Five signs to look at before you contact a seller (marketplace sites you listed)', icon: 'shield', action: run(async () => { const r = await VexMarketplaceSigns.check(TabManager.getActiveTab(), { quiet: false }); return r; }) },
      { id: 'safeweb:cookies-site', label: 'Cookie banners: leave this site alone, or handle it again', hint: 'Per-site switch for rejecting cookie banners', icon: 'shield', action: run(() => {
        const host = this._activeHost();
        if (!host) throw new Error('Open a website first');
        const off = !ConsentBlock.siteOff(host);
        ConsentBlock.setSiteOff(host, off);
        window.showToast?.(off ? 'Banners are left alone on ' + host : 'Banners on ' + host + ' are handled again');
      }) },
      { id: 'safeweb:move-daily', label: 'Move this throwaway tab to my normal session', hint: 'Opens the same address with your usual logins and closes the throwaway', icon: 'shield', action: run(() => {
        const tab = TabManager.getActiveTab();
        if (!tab || !tab.chatLink || !tab.chatLink.throwaway) throw new Error('This tab is not a throwaway one from a chat');
        return VexChatLinks.moveToDaily(tab);
      }) },
      { id: 'safeweb:vault-hygiene', label: 'Vault hygiene', hint: 'What to rotate this week, reuse blast radius, 2FA coverage, recovery email', icon: 'shield', action: run(() => VexVaultHygiene.open()) },
      { id: 'safeweb:safety-rollup', label: 'Weekly safety check', hint: 'Vault, permissions and downloads in one roll-up', icon: 'shield', action: run(() => VexVaultHygiene.openRollup()) },
      { id: 'safeweb:download-marks', label: 'Check the marks on my downloads', hint: 'Which downloaded files lost the "from the internet" mark (read-only)', icon: 'shield', action: run(() => VexMotwCheck.show()) },
      { id: 'safeweb:share-safe-off', label: 'Share-safe mode: off for this share', hint: 'Shows notices and titles again until the screen share ends', icon: 'shield', action: run(() => {
        if (!VexScreenShareSafe.sharing()) throw new Error('Your screen is not being shared');
        VexScreenShareSafe.pauseForThisShare();
      }) },
    ];
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    if (window.VexSettingsGroups) VexSettingsGroups.register({ id: 'safer-browsing', title: 'Safer browsing helpers', keywords: 'cheat executor injector fake update cookie banner qr marketplace itemsatis scam chat discord throwaway defender windows security screen share vault hygiene password', render: (body) => this.render(body) });
    if (window.VexModuleCommands) VexModuleCommands.set('safeweb:', this._commands());
    return true;
  },
};

if (typeof window !== 'undefined') { window.VexSecurityHelpers = VexSecurityHelpers; VexSecurityHelpers.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSecurityHelpers };
