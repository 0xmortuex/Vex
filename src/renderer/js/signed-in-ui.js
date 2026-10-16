// === What am I signed in to, and "My session leaked" (T2-087, T2-088) =================
//
// The list (read-only): each site that looks signed in, the containers holding its
// sign-in cookie, whether it ends when Vex closes or on a date, and whether a login is
// saved. Beside each site: "Account page" (the site's own page for its sessions) and
// "My session leaked".
//
// "My session leaked" removes the site's cookies and stored data in every container
// (one confirm), says plainly if any part failed, then walks through the rest, because
// only the site can end a session on its own server: open its sign-out-of-all-devices
// page, change the password, check two-step verification. The steps are ticked by hand.
// "Why was I signed out?" is told, so the sign-in you lose is explained afterwards.
const VexSignedIn = {
  KEY: 'vex.signedIn.enabled',     // '0' = off
  FEATURE: 'signed-in',

  enabled() { try { return localStorage.getItem(this.KEY) !== '0'; } catch (err) { console.error('[SignedIn] the switch could not be read:', err.message); return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? '1' : '0'); },

  endsText(site, now = Date.now()) {
    if (site.sessionOnly) return 'ends when Vex closes';
    const days = Math.ceil((site.expires - now) / 86400000);
    return days <= 1 ? 'ends within a day' : 'lasts about ' + days + ' more days';
  },

  _openTab(url) {
    if (!/^https:\/\//.test(url)) throw new Error('Only a secure site address can be opened here');
    if (typeof TabManager === 'undefined' || typeof TabManager.createTab !== 'function') throw new Error('Tabs are not available');
    TabManager.createTab(url, true);
  },

  async open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const { body } = VexSettingsGroups.dialog({ id: 'vex-signed-in', title: 'What am I signed in to', sub: 'Sites with a sign-in cookie in Vex. Only cookie names and dates are read, never their values or your passwords.' });
    body.appendChild(VexSettingsGroups.note('Loading...'));
    let data;
    try { data = await window.vex.hygieneSignedIn(); }
    catch (err) { body.textContent = ''; body.appendChild(VexSettingsGroups.note('Could not read the sign-ins: ' + err.message)); return; }
    this._draw(body, data);
  },

  _draw(body, data) {
    body.textContent = '';
    const bits = [data.sites.length + (data.sites.length === 1 ? ' site' : ' sites') + ' look signed in'];
    if (data.savedWithoutSession) bits.push(data.savedWithoutSession + ' with a saved login but no session now');
    if (!data.vault.ok) bits.push('saved logins not shown: ' + data.vault.error);
    body.appendChild(VexSettingsGroups.note(bits.join('; ') + '.'));
    const wrap = document.createElement('div');
    wrap.className = 'vexsr-list';
    for (const s of data.sites) {
      const row = document.createElement('div');
      row.className = 'vexsr-rule vex-signedin-row';
      row.dataset.domain = s.domain;
      const text = document.createElement('span');
      text.className = 'vexsr-host';
      const t = document.createElement('div'); t.textContent = s.links.known ? s.links.name + ' (' + s.domain + ')' : s.domain;
      const d = document.createElement('div'); d.className = 'vexsr-mode'; d.style.whiteSpace = 'normal';
      d.textContent = s.containers.map(c => c.label).join(', ') + '; ' + this.endsText(s, data.at) + (s.saved ? '; login saved in Vex' : '');
      text.append(t, d);
      row.appendChild(text);
      row.appendChild(VexSettingsGroups.button('Account page', () => {
        try { this._openTab(s.links.where); } catch (err) { window.showToast?.(err.message, 'error'); }
      }, { label: 'Open the account page of ' + s.domain }));
      row.appendChild(VexSettingsGroups.button('My session leaked', () => this.kill(s.domain).then(() => this.open()).catch(err => window.showToast?.(err.message, 'error')), { danger: true, label: 'My session leaked: ' + s.domain }));
      wrap.appendChild(row);
    }
    if (!data.sites.length) wrap.appendChild(VexSettingsGroups.note('No sign-in cookies were found in the main profile or the containers.'));
    body.appendChild(wrap);
    if (data.more) body.appendChild(VexSettingsGroups.note('and ' + data.more + ' more sites not shown.'));
  },

  // Asks for a site by name (the playbook's first step and the Ctrl+K command).
  async killPrompt() {
    const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    let start = '';
    try { start = new URL(tab && tab.url).hostname.replace(/^www\./, ''); } catch { start = ''; }   // vex-allow-empty-catch: no web page open; the box just starts empty
    const answer = await vexPrompt({ title: 'My session leaked', message: 'Which site? Vex clears its cookies and stored data in every container, then opens its own sign-out and password pages.', label: 'Site (for example discord.com)', value: start, okLabel: 'Continue' });
    if (!answer) return false;
    return this.kill(this.siteOf(answer));
  },

  // "https://www.Discord.com/x" or "discord.com" -> "discord.com". Throws on anything else.
  siteOf(text) {
    const s = String(text || '').trim();
    if (!s) throw new Error('Type a site');
    let host;
    try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s).hostname; }
    catch { throw new Error('That is not a site: ' + s.slice(0, 60)); }
    host = host.replace(/^www\./, '').toLowerCase();
    if (!host.includes('.') || /^\d+(\.\d+){3}$/.test(host)) throw new Error('That is not a site: ' + s.slice(0, 60));
    return host;
  },

  async kill(domain) {
    const ok = await vexConfirm({
      title: 'Clear ' + domain + ' everywhere?',
      message: 'This removes the cookies and stored data of ' + domain + ' in the main profile and every container. You will be signed out of it in Vex. It cannot end the session on ' + domain + '\'s own servers; Vex opens the site\'s pages for that next.',
      okLabel: 'Clear it', danger: true,
    });
    if (!ok) return false;
    const r = await window.vex.hygieneKillSite(domain);
    if (!r.ok) {
      await vexAlert({ title: 'Not everything was cleared', message: r.errors.join('\n') });
    } else {
      window.showToast?.('Cleared ' + r.total + (r.total === 1 ? ' cookie' : ' cookies') + ' of ' + r.domain + ' in ' + r.containers.length + ' sessions');
    }
    this.guide(r.domain, r.links);
    return true;
  },

  // The steps after the clear. Ticked by hand; nothing here ends a session for you.
  guide(domain, links) {
    const { body } = VexSettingsGroups.dialog({ id: 'vex-session-guide', title: 'Now end the session on ' + domain, sub: 'Vex cleared this computer. The site still has the session until you end it there.' });
    const steps = [
      { text: 'Open the page where ' + links.name + ' lets you sign out of other devices.', label: 'Open it', url: links.where, hint: links.steps },
      { text: 'Change the password.', label: 'Open it', url: links.password, hint: 'Use a long, unique one. The password generator in Vex can make it.' },
      { text: 'Check two-step verification, recovery email and phone, and any connected apps.' },
      { text: 'If the same password is used on other sites, change it there too.' },
    ];
    steps.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'vexsr-rule';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.setAttribute('aria-label', 'Done: ' + s.text);
      const text = document.createElement('span');
      text.className = 'vexsr-host';
      text.style.wordBreak = 'normal';
      const t = document.createElement('div'); t.textContent = (i + 1) + '. ' + s.text;
      text.appendChild(t);
      if (s.hint) { const h = document.createElement('div'); h.className = 'vexsr-mode'; h.style.whiteSpace = 'normal'; h.textContent = s.hint; text.appendChild(h); }
      row.append(box, text);
      if (s.url) row.appendChild(VexSettingsGroups.button(s.label, () => { try { this._openTab(s.url); } catch (err) { window.showToast?.(err.message, 'error'); } }, { label: s.text }));
      body.appendChild(row);
    });
    if (!links.known) body.appendChild(VexSettingsGroups.note('Vex does not know this site\'s account pages: ' + links.steps));
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('A read-only list of the sites you look signed in to (cookie names and dates only) with a button to clear one site everywhere and be walked through ending its session.'));
    el.appendChild(VexSettingsGroups.button('What am I signed in to', () => this.open().catch(err => window.showToast?.(err.message, 'error')), { primary: true }));
    el.appendChild(VexSettingsGroups.button('My session leaked', () => this.killPrompt().catch(err => window.showToast?.(err.message, 'error')), { danger: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexSignedIn = VexSignedIn;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'signed-in', title: 'What am I signed in to', keywords: 'signed in sessions cookies logout leaked kill switch accounts sign out everywhere', before: 'about', build: (el) => VexSignedIn.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'signed-in', label: 'What am I signed in to', hint: 'Sites with a sign-in cookie, by container, with their own account pages', icon: 'key', action: () => VexSignedIn.open() });
    VexExtras.registerCommand({ id: 'session-leaked', label: 'My session leaked', hint: 'Clear one site everywhere and be walked through ending its session', icon: 'shield', action: () => VexSignedIn.killPrompt() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSignedIn };
