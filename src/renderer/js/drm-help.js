// === Protected playback (DRM) that explains itself and repairs what it can =============================
//
// Netflix, Spotify, Prime Video and the like fail with "DRM failed" and no way forward. The diagnosis is made in
// the main process (src/main/drm-health.js: the Widevine module, the build, the signature file, what the page
// said); this file is what a person sees:
//   * a calm, dismissible note on the tab when a known streaming site reported a playback problem, or when
//     Vex already knows protected playback cannot work here, offering "Why isn't this playing?";
//   * that screen: the answer in plain words, the safe repairs Vex can do itself (check again, turn component
//     updates on, clear this one site's saved player data and reload, re-download the Widevine module), and,
//     when the cause is the build's castLabs signature, an honest "only whoever builds Vex can fix this" with
//     the exact steps;
//   * Settings > Video and music playback (DRM) and Ctrl+K "Why isn't this playing?".
// Nothing here is faked: a repair that did not help says so, a failed repair shows its error, and no network
// request is made except what Electron's own component updater does.
//
//   VexDrmHelp.siteOf(url)                    pure: the streaming service a page belongs to, or null
//   VexDrmHelp.looksLikeDrmError(msg, level)  pure: whether a console line is a protected-playback error
//   VexDrmHelp.open({ tabId })                the screen
//   VexDrmHelp.note(tab, consoleEvent)        called by webview.js for every console line of every tab
const VexDrmHelp = {
  OFFER_KEY: 'vex.drmHelp.offer',
  OFFER_MS: 25000,

  // [name, host suffixes]. Amazon's video pages live on amazon.* under a path, handled in siteOf.
  SITES: [
    ['Netflix', ['netflix.com']],
    ['Spotify', ['spotify.com']],
    ['Prime Video', ['primevideo.com']],
    ['Disney+', ['disneyplus.com', 'hotstar.com']],
    ['Max', ['max.com', 'hbomax.com']],
    ['Apple TV', ['tv.apple.com']],
    ['Apple Music', ['music.apple.com']],
    ['Tidal', ['tidal.com']],
    ['Hulu', ['hulu.com']],
    ['Paramount+', ['paramountplus.com']],
    ['Peacock', ['peacocktv.com']],
    ['Crunchyroll', ['crunchyroll.com']],
    ['BluTV', ['blutv.com']],
    ['Exxen', ['exxen.com']],
    ['Gain', ['gain.tv']],
    ['Tabii', ['tabii.com']],
  ],
  AMAZON_VIDEO: /^\/(?:gp\/(?:video|prime)|Prime-Video|video\/)/i,

  // The service a page belongs to -> { name, host }, or null for any other page.
  siteOf(url) {
    let u;
    try { u = new URL(String(url || '')); } catch { return null; }
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    for (const [name, suffixes] of this.SITES) {
      if (suffixes.some(s => host === s || host.endsWith('.' + s))) return { name, host };
    }
    if (/(^|\.)amazon\.[a-z.]+$/.test(host) && this.AMAZON_VIDEO.test(u.pathname)) return { name: 'Prime Video', host };
    return null;
  },

  // Chromium and the players say these when the decryption module or a license is the problem. A phrase that
  // only EME/Widevine code uses counts as a warning; a general word ("license", "DRM") counts only as an error.
  STRONG: /requestMediaKeySystemAccess|MediaKeySystemAccess|createMediaKeys|key ?system|widevine|\bCDM\b/i,
  GENERAL: /\bDRM\b|\bEME\b|MediaKeys?\b|licen[sc]e (?:request|server|error|failed)|decrypt/i,
  looksLikeDrmError(message, level) {
    const m = String(message == null ? '' : message);
    if (!m || m.startsWith('VEX_CMD:')) return false;
    const lv = Number(level);
    if (lv >= 2 && this.STRONG.test(m)) return true;
    return lv >= 3 && this.GENERAL.test(m);
  },

  _L(s) {
    const hit = typeof VexI18nUI !== 'undefined' && typeof VexI18nUI.lookup === 'function' ? VexI18nUI.lookup(s) : null;
    return hit || s;
  },
  // A sentence from main: translate its template, then fill the {0}, {1} holes.
  _T(template, args) {
    return String(this._L(template)).replace(/\{(\d+)\}/g, (_, i) => (args && args[+i] != null ? String(args[+i]) : ''));
  },
  _el(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  },
  _icon(name, size) { return typeof VexIcons !== 'undefined' ? VexIcons.svg(name, { size }) : ''; },
  _confirm(opts) {
    if (typeof window.vexConfirm !== 'function') throw new Error('The confirmation dialog is not available');
    return window.vexConfirm(opts);
  },
  _fail(err) { window.showToast?.((err && err.message) || String(err), 'error'); },

  enabled() { return typeof VexLifeKit !== 'undefined' ? VexLifeKit.flag(this.OFFER_KEY, true) : localStorage.getItem(this.OFFER_KEY) !== 'off'; },
  setEnabled(on) {
    if (typeof VexLifeKit !== 'undefined') VexLifeKit.setFlag(this.OFFER_KEY, !!on);
    else localStorage.setItem(this.OFFER_KEY, on ? 'on' : 'off');
  },

  _api() {
    const v = window.vex;
    if (!v || typeof v.drmStatus !== 'function' || typeof v.drmRepair !== 'function') throw new Error('Protected-playback checks are not available in this window');
    return v;
  },

  // ---- what each tab has said -------------------------------------------------------------------------
  _reports: new Map(),   // tab id -> { host, message }
  _offered: new Set(),   // 'tab id|host': offered once per tab and site, until the window closes
  _peeked: null,         // the first status, asked once the first streaming page speaks

  note(tab, e) {
    if (!tab || !e || !this.enabled()) return;
    const site = this._siteCached(tab.url);
    if (!site) return;
    const message = String(e.message || '');
    if (this.looksLikeDrmError(message, e.level)) {
      this._reports.set(tab.id, { host: site.host, message: message.replace(/\s+/g, ' ').trim().slice(0, 300) });
      this._offer(tab, site, 'reported');
      return;
    }
    if (!this._peeked) {
      this._peeked = this._api().drmStatus().catch((err) => { this._peeked = null; window.VexProblems?.note('Protected playback', 'Could not read the protected-playback status', err); return null; });
    }
    this._peeked.then((st) => { if (st && st.state === 'broken') this._offer(tab, site, 'broken'); });
  },
  _siteCached(url) {
    if (this._lastUrl !== url) { this._lastUrl = url; this._lastSite = this.siteOf(url); }
    return this._lastSite;
  },

  _offer(tab, site, why) {
    const key = tab.id + '|' + site.host;
    if (this._offered.has(key)) return;
    this._offered.add(key);
    if (typeof TabManager !== 'undefined' && TabManager.activeTabId !== tab.id) return;
    this.banner(tab.id, site, why);
  },

  banner(tabId, site, why) {
    if (typeof VexLayer === 'undefined') throw new Error('The overlay manager is not loaded, so the playback note cannot show');
    const L = (s) => this._L(s);
    VexLayer.close('vex-drm-banner');
    const el = this._el('div', 'drm-banner');
    el.id = 'vex-drm-banner';
    el.setAttribute('role', 'status');
    const icon = this._el('span', 'drm-banner-icon');
    icon.innerHTML = this._icon('tv', 16);
    const text = this._el('span', 'drm-banner-text', why === 'reported'
      ? this._T('{0} reported a playback problem.', [site.name])
      : this._T('Protected video cannot play in this copy of Vex, so {0} may not start.', [site.name]));
    const ask = this._el('button', 'btn-primary drm-banner-btn', L('Why isn\'t this playing?'));
    ask.type = 'button';
    const close = this._el('button', 'drm-banner-x');
    close.type = 'button';
    close.setAttribute('aria-label', L('Dismiss'));
    close.title = L('Dismiss');
    close.innerHTML = this._icon('x', 12);
    el.append(icon, text, ask, close);
    VexLayer.open(el, { tier: 'panel', id: 'vex-drm-banner', dismissible: true });
    const timer = setTimeout(() => VexLayer.close(el), this.OFFER_MS);
    const done = () => { clearTimeout(timer); VexLayer.close(el); };
    close.addEventListener('click', done);
    ask.addEventListener('click', () => { done(); this.open({ tabId }).catch(err => this._fail(err)); });
    return el;
  },

  // ---- the page in front, for the repairs that act on a site --------------------------------------------
  _pageOf(tabId) {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') return null;
    const id = tabId != null ? tabId : TabManager.activeTabId;
    const wv = WebviewManager.webviews.get(id);
    if (!wv || typeof wv.getWebContentsId !== 'function') return null;
    const tab = typeof TabManager.tabs?.find === 'function' ? TabManager.tabs.find(t => t.id === id) : null;
    const site = this.siteOf(tab && tab.url);
    return { id, wv, wcId: wv.getWebContentsId(), tab, site };
  },

  // ---- the screen ---------------------------------------------------------------------------------------
  async open(opts = {}) {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('Settings sections are not loaded, so this screen cannot open');
    const v = this._api();
    // The Turkish is its own late file (js/drm-help-tr.js): it joins the Turkish table as it loads.
    if (typeof VexLazy !== 'undefined') await VexLazy.ensure('js/drm-help-tr.js');
    const L = (s) => this._L(s);
    const page = this._pageOf(opts.tabId);
    const reported = page ? this._reports.get(page.id) : null;
    const dlg = VexSettingsGroups.dialog({ id: 'vex-drm-help', title: L('Why isn\'t this playing?'), sub: L('What Vex can tell about protected video and music (Netflix, Spotify, Prime Video and similar), and what it can repair by itself.') });
    dlg.overlay.classList.add('drm-ov');
    const body = dlg.body;
    const notice = this._el('div', 'drm-notice');
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    const view = this._el('div', 'drm-view');
    body.append(view, notice);

    const say = (text, bad) => { notice.textContent = text; notice.classList.toggle('drm-notice-bad', !!bad); };
    const busy = (on) => { for (const b of view.querySelectorAll('button')) b.disabled = on; };
    const run = async (label, fn) => {
      busy(true);
      say(label);
      try { return await fn(); }
      catch (err) { say((err && err.message) || String(err), true); this._fail(err); return null; }
      finally { busy(false); }
    };
    const after = (result, before) => {
      draw(result);
      if (result.state === 'ok') say(L('Checked again: the Widevine module is installed. Try playing again. Vex cannot promise the site will accept it.'));
      else if (before && result.state === before) say(L('Checked again: it is still not fixed. What is left is listed above.'), true);
      else say(L('Checked again. This is what Vex sees now.'));
    };

    const draw = (st) => {
      view.textContent = '';
      const pill = this._el('div', 'drm-state drm-state-' + st.state, L({ ok: 'Working', degraded: 'Needs attention', broken: 'Not working' }[st.state]));
      view.append(pill, this._el('p', 'drm-headline', L(st.headline)));
      const list = this._el('ul', 'drm-reasons');
      for (const r of st.reasons) {
        const li = this._el('li', 'drm-reason drm-reason-' + r.level, this._T(r.template, r.args));
        list.appendChild(li);
      }
      view.appendChild(list);

      const repairs = st.fix.repairs;
      const actions = this._el('div', 'drm-actions');
      const guarded = (fn) => () => Promise.resolve().then(fn).catch((err) => { say((err && err.message) || String(err), true); this._fail(err); });
      const btn = (label, fn, primary) => { const b = VexSettingsGroups.button(L(label), guarded(fn), { primary: !!primary }); actions.appendChild(b); return b; };
      btn('Check now', () => run(L('Checking...'), async () => after(await v.drmRepair('recheck', reported || undefined), st.state)), repairs.length === 0);
      if (repairs.includes('enable-updates')) {
        btn('Turn component updates on', () => run(L('Turning updates on and checking...'), async () => after(await v.drmRepair('enable-updates', reported || undefined), st.state)), true);
      }
      if (repairs.includes('reset-component')) {
        btn('Re-download the Widevine module (restarts Vex)', async () => {
          const ok = await this._confirm({ title: L('Re-download the Widevine module?'), message: L('This deletes the downloaded Widevine module and its update record, then restarts Vex so Electron fetches it again. Your tabs come back after the restart. It needs an internet connection.'), okLabel: L('Re-download and restart') });
          if (!ok) return;
          await run(L('Restarting...'), async () => { const r = await v.widevineRetry(); if (!r || r.ok === false) throw new Error((r && r.error) || 'Vex could not reset the Widevine module'); });
        });
      }
      if (repairs.includes('clear-site') && page && page.site) {
        btn(this._T('Clear {0}\'s saved player data and reload', [page.site.name]), async () => {
          const ok = await this._confirm({ title: L('Clear this site\'s saved player data?'), message: this._T('This removes {0}\'s service workers, caches and stored files from this profile. You stay signed in. {0} may take a little longer to start once.', [page.site.name]), okLabel: L('Clear and reload') });
          if (!ok) return;
          await run(L('Clearing...'), async () => {
            await v.drmClearSite(page.wcId);
            page.wv.reload();
            after(await v.drmRepair('recheck', reported || undefined), st.state);
            say(L('Cleared and reloaded the page. Try playing again.'));
          });
        }, true);
      }
      if (repairs.includes('reload') && page) {
        btn('Reload the page', () => { try { page.wv.reload(); say(L('Reloaded. Try playing again.')); } catch (err) { say(err.message, true); this._fail(err); } });
      }
      view.appendChild(actions);

      if (st.fix.owner) {
        const o = st.fix.owner;
        const box = this._el('div', 'drm-owner');
        box.appendChild(this._el('div', 'drm-owner-title', L(o.needed === 'yes' ? 'This one cannot be repaired from inside Vex' : 'If the repairs above do not help')));
        box.appendChild(this._el('p', 'drm-owner-text', this._T(o.template, [])));
        const det = this._el('details', 'drm-builder');
        det.appendChild(this._el('summary', '', L('For whoever builds Vex: the exact steps')));
        const ol = this._el('ol', 'drm-steps');
        for (const s of o.builderSteps) ol.appendChild(this._el('li', '', L(s)));
        det.appendChild(ol);
        box.appendChild(det);
        view.appendChild(box);
      }

      const facts = this._el('details', 'drm-facts');
      facts.appendChild(this._el('summary', '', L('Technical details')));
      facts.appendChild(this._el('pre', 'drm-facts-pre', JSON.stringify(st.facts, null, 2)));
      view.appendChild(facts);
    };

    say(L('Checking...'));
    const first = await v.drmStatus(reported || undefined);
    draw(first);
    say('');
    return dlg;
  },

  // ---- Settings ---------------------------------------------------------------------------------------
  group(el) {
    const L = (s) => this._L(s);
    el.appendChild(VexSettingsGroups.note(L('Netflix, Spotify, Prime Video and similar need a decryption module (Widevine) that only works when this copy of Vex was signed by castLabs. This shows whether it is working, and repairs what Vex can repair.')));
    const line = this._el('div', 'drm-settings-line', L('Checking...'));
    line.setAttribute('role', 'status');
    el.appendChild(line);
    const paint = (st) => { line.className = 'drm-settings-line drm-state-' + st.state; line.textContent = L(st.headline); };
    const check = () => {
      line.textContent = L('Checking...');
      return Promise.resolve().then(() => this._api().drmStatus()).then(paint).catch(err => { line.className = 'drm-settings-line drm-state-broken'; line.textContent = err.message; this._fail(err); });
    };
    check();
    el.appendChild(VexSettingsGroups.button(L('Check now'), () => check(), {}));
    el.appendChild(VexSettingsGroups.button(L('Explain and repair'), () => this.open().catch(err => this._fail(err)), { primary: true }));

    const row = this._el('div', 'setting-toggle-row');
    const lab = this._el('label', 'toggle');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.enabled();
    input.setAttribute('aria-label', L('Offer help when protected video does not play'));
    input.addEventListener('change', () => { try { this.setEnabled(input.checked); } catch (err) { input.checked = !input.checked; this._fail(err); } });
    lab.append(input, this._el('span', 'toggle-slider'));
    row.append(this._el('span', 'setting-label-text', L('Offer help when protected video does not play')), lab);
    el.appendChild(row);
  },
};

if (typeof window !== 'undefined') {
  window.VexDrmHelp = VexDrmHelp;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'drm-help', title: 'Video and music playback (DRM)', keywords: 'drm widevine netflix spotify prime video disney playback protected video music not playing cdm signature castlabs', before: 'about', build: (el) => VexDrmHelp.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'drm-help', label: 'Why isn\'t this playing?', hint: 'Checks why Netflix, Spotify or Prime Video will not play, and repairs what Vex can', keywords: 'drm widevine netflix spotify prime video not playing protected cdm playback fix repair', icon: 'tv', action: () => VexDrmHelp.open().catch(err => VexDrmHelp._fail(err)) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDrmHelp };
