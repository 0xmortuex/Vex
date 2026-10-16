// === Bypass preflight, and "site down or my bypass?" (T2-076) ==================
//
// Two things, both read-only:
//
//   1. "Site down or my bypass?" (Ctrl+K): asks the main process to request the
//      address once straight from this computer and once through the bypass the
//      person already runs (src/main/bypass-probe.js), and says which side is
//      broken. It never starts, stops or changes a bypass.
//   2. A look at Discord shortly after start: when the Discord bypass is Off and
//      discord.com does not answer, ONE line in the Attention Inbox says no bypass
//      is running ("Zapret does not seem to be running") with a button that turns
//      ByeDPI on after a confirm. That button is the person's own action; it is
//      refused while a game is running (Vex does not start or stop a bypass, and
//      never winws, during a game).
const BypassDoctor = {
  KEYS: { on: 'vex.bypassDoctor.enabled', last: 'vex.bypassDoctor.lastPreflight', startup: 'vex.bypassDoctor.startupProbe' },
  PREFLIGHT_EVERY_MS: 12 * 3600 * 1000,
  START_DELAY_MS: 25 * 1000,

  _note(what, err) { window.VexProblems?.note('Bypass check', what, err); },
  _now() { return Date.now(); },

  enabled() { return localStorage.getItem(this.KEYS.on) !== 'off'; },
  setEnabled(on) { localStorage.setItem(this.KEYS.on, on ? 'on' : 'off'); },
  // The request to discord.com after every start is OFF until the person turns it on, on every profile
  // (a third-party request nobody asked for). The check they run by hand, and the offer after a page
  // that would not load, do not need it.
  startupProbe() { return localStorage.getItem(this.KEYS.startup) === 'on'; },
  setStartupProbe(on) { localStorage.setItem(this.KEYS.startup, on ? 'on' : 'off'); },

  _busy() {
    return (typeof GameMode !== 'undefined' && !!GameMode.gaming) || (typeof GameSession !== 'undefined' && !!GameSession.active);
  },

  async check(url) {
    const b = typeof window !== 'undefined' ? window.vex : null;
    if (!b || typeof b.probeBypass !== 'function') throw new Error('The bypass check is not available in this window');
    const r = await b.probeBypass(String(url));
    if (!r || !r.direct || typeof r.verdict !== 'string') throw new Error('The bypass check answered in a form Vex did not expect');
    return r;
  },

  describe(r) {
    const side = (s, label) => label + ': ' + (s ? (s.ok ? 'answers (' + s.ms + ' ms)' : 'no answer' + (s.error ? ' (' + s.error + ')' : '')) : 'not tried');
    const lines = [r.text, '', side(r.direct, 'Straight from this computer')];
    lines.push(r.bypassed ? side(r.bypassed, 'Through ' + (r.bypassLabel || 'your bypass')) : 'Through a bypass: none is on for this site');
    return lines.join('\n');
  },

  async run(url) {
    const target = url || (() => { try { const t = TabManager.getActiveTab(); return t && t.url; } catch { return ''; } })();
    if (!target || !/^https:/i.test(target)) throw new Error('Open an https page first');
    window.showToast?.('Checking both routes…');
    const r = await this.check(target);
    const { body } = VexSettingsGroups.dialog({ id: 'vex-bypass-doctor', title: 'Site down or my bypass?', sub: r.host });
    for (const line of this.describe(r).split('\n')) body.appendChild(VexSettingsGroups.note(line || ' '));
    return r;
  },

  // ---- the look at Discord after start ------------------------------------------------------
  async preflight(now = this._now()) {
    if (!this.enabled() || !this.startupProbe() || this._busy()) return null;
    if (typeof DiscordBypass === 'undefined') return null;
    if (DiscordBypass.choice().mode !== 'off') return null;
    const last = Number(localStorage.getItem(this.KEYS.last)) || 0;
    if (now - last < this.PREFLIGHT_EVERY_MS) return null;
    localStorage.setItem(this.KEYS.last, String(now));
    const r = await this.check('https://discord.com/');
    if (r.direct.ok) return r;
    if (typeof VexAttention === 'undefined') throw new Error('VexAttention is not loaded');
    VexAttention.suggest({
      feature: 'bypass-doctor', id: 'discord', label: 'Discord',
      title: 'Discord does not answer and no bypass is running',
      body: 'The Discord bypass is Off and discord.com is not reachable from here. Zapret does not seem to be running. Vex can turn on ByeDPI for the Discord panel.',
      action: { label: 'Use ByeDPI', key: 'byedpi' },
    });
    return r;
  },

  // The inbox button: after a confirm, and never during a game.
  async useByeDpi() {
    if (this._busy()) throw new Error('A game is running. Vex does not start or stop a bypass during one; try again after it.');
    if (typeof DiscordBypass === 'undefined') throw new Error('The Discord bypass is not loaded');
    const ok = await window.vexConfirm({ title: 'Turn on ByeDPI for Discord?', message: 'This starts ByeDPI and points the Discord panel at it. You can turn it off again in Settings > Privacy.', okLabel: 'Turn on' });
    if (!ok) return false;
    const choice = { mode: 'strong' };
    DiscordBypass.save(choice);
    const r = await DiscordBypass.apply(choice);
    if (r && r.ok === false) throw new Error(r.error || 'ByeDPI could not be started');
    return true;
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle('bypass-doctor', (key) => {
        const job = key === 'byedpi' ? this.useByeDpi() : this.run('https://' + String(key).replace(/^check:/, '') + '/');
        job.catch((err) => { this._note('The bypass action failed', err); window.showToast?.(err.message, 'error'); });
      });
    }
    setTimeout(() => this.preflight().catch(err => this._note('The look at Discord failed', err)), this.START_DELAY_MS);
    // A page that would not load, on a site the bypass is for: one line offering the check.
    document.addEventListener('vex:page-load-failed', (e) => {
      try {
        const d = e.detail || {};
        if (!this.enabled() || this._busy() || typeof DiscordBypass === 'undefined' || !DiscordBypass.looksBlocked(d.code)) return;
        const host = new URL(d.url).hostname;
        if (!/(^|\.)(discord(app)?|roblox)\.com$/i.test(host) || DiscordBypass.choice().mode === 'off') return;
        VexAttention.suggest({ feature: 'bypass-doctor', id: 'fail:' + host, label: 'Bypass', title: host + ' did not load', body: 'Check whether the site is down or your bypass is in the way.', action: { label: 'Check', key: 'check:' + host } });
      } catch (err) { this._note('Could not offer the check', err); }
    });
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.BypassDoctor = BypassDoctor;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'bypass-check', title: 'Bypass check', keywords: 'discord bypass probe start-up zapret byedpi site down', render: (body) => {
      body.textContent = '';
      body.appendChild(VexSettingsGroups.note('Ctrl+K "Site down or my bypass?" checks a page straight and through your bypass. The look at discord.com after Vex starts sends one request to Discord each time, so it is off until you turn it on here.'));
      const row = document.createElement('div');
      row.className = 'setting-toggle-row';
      const text = document.createElement('span');
      text.textContent = 'Look at discord.com after Vex starts';
      const sw = document.createElement('label');
      sw.className = 'toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = BypassDoctor.startupProbe();
      input.setAttribute('aria-label', 'Look at discord.com after Vex starts');
      input.addEventListener('change', () => { try { BypassDoctor.setStartupProbe(input.checked); } catch (err) { input.checked = !input.checked; window.showToast?.(err.message, 'error'); } });
      const slider = document.createElement('span');
      slider.className = 'toggle-slider';
      sw.append(input, slider);
      row.append(text, sw);
      body.appendChild(row);
    } });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'site-or-bypass', label: 'Site down or my bypass?', hint: 'Try this page straight and through your bypass, and say which side is broken (changes nothing)', icon: 'activity', action: () => BypassDoctor.run().catch((err) => { BypassDoctor._note('The check failed', err); window.showToast?.(err.message, 'error'); }) });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => BypassDoctor.init());
    else BypassDoctor.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { BypassDoctor };
