// === Discord's block bypass: the saved choice ================================
//
// Main starts every launch on 'light' (the built-in proxy, main.js
// _applyDiscordBypass). What the user picked is kept here and replayed at
// start:
//   vex.discordBypassMode    'light' | 'off' | 'strong'
//   vex.discordBypassPreset  the ByeDPI preset number, with 'strong'
//   vex.discordBypassCustom  raw ciadpi flags, with 'strong' (wins over the preset)
//
// Auto-configure (the sweep that tries every method) used to save only the
// word 'auto' and run the whole sweep again on every launch — a minute of
// Discord going nowhere each time, even after the sweep had found nothing.
// Now the sweep runs when asked and its RESULT is saved: the preset that got
// through, or 'light' when nothing did. A saved 'auto' from before is turned
// into a result by running the sweep one last time.
const DiscordBypass = {
  KEY: 'vex.discordBypassMode',
  PRESET_KEY: 'vex.discordBypassPreset',
  CUSTOM_KEY: 'vex.discordBypassCustom',
  // ByeDPI presets in src/byedpi.js (PRESETS). Shown 1-based.
  PRESETS: 10,

  choice() {
    const mode = localStorage.getItem(this.KEY);
    if (mode === 'off') return { mode: 'off' };
    if (mode === 'auto') return { mode: 'auto' };          // from before: swept once more at start
    if (mode === 'strong') {
      const custom = (localStorage.getItem(this.CUSTOM_KEY) || '').trim();
      if (custom) return { mode: 'strong', custom };
      const preset = Number(localStorage.getItem(this.PRESET_KEY));
      return { mode: 'strong', preset: Number.isInteger(preset) && preset >= 0 ? preset : 0 };
    }
    return { mode: 'light' };
  },

  save(choice) {
    if (!choice || !['light', 'off', 'strong'].includes(choice.mode)) throw new Error('The bypass is Off, Light or Strong');
    localStorage.setItem(this.KEY, choice.mode);
    if (choice.mode === 'strong') {
      if (choice.custom && String(choice.custom).trim()) {
        localStorage.setItem(this.CUSTOM_KEY, String(choice.custom).trim());
      } else {
        if (!Number.isInteger(choice.preset) || choice.preset < 0) throw new Error('Pick a preset');
        localStorage.setItem(this.PRESET_KEY, String(choice.preset));
        localStorage.removeItem(this.CUSTOM_KEY);
      }
    }
    return this.choice();
  },

  // What a finished sweep leaves saved: the preset that got through, light
  // when built-in light did, and light when nothing did (main has set no
  // proxy then; light is what every launch starts on anyway).
  choiceFromSweep(r) {
    if (r && r.ok && r.via === 'byedpi' && Number.isInteger(r.preset)) return { mode: 'strong', preset: r.preset };
    return { mode: 'light' };
  },

  _api() {
    const api = window.vex;
    if (!api || typeof api.setDiscordBypassMode !== 'function') throw new Error('The bypass cannot be changed from this window');
    return api;
  },

  // Put a choice into effect in main. Resolves to main's answer.
  apply(choice) {
    const api = this._api();
    if (choice.mode === 'strong') return api.setDiscordBypassMode('strong', choice.custom ? { custom: choice.custom } : { preset: choice.preset });
    return api.setDiscordBypassMode(choice.mode, {});
  },

  // Run the sweep, save what it found, and leave Discord on it.
  async sweep() {
    const api = this._api();
    const r = await api.setDiscordBypassMode('auto', {});
    const choice = this.save(this.choiceFromSweep(r));
    // Nothing got through: main left Discord with no proxy. Light is the
    // saved answer, so put it back in effect too.
    if (!(r && r.ok)) await this.apply(choice);
    return { result: r, choice };
  },

  // At start: replay the saved choice. Light is what main starts on, so it
  // needs nothing. Resolves to main's answer, or null when nothing was sent.
  async replay() {
    const c = this.choice();
    if (c.mode === 'light') return null;
    if (c.mode === 'auto') return (await this.sweep()).result;
    return this.apply(c);
  },

  label(c = this.choice()) {
    if (c.mode === 'off') return 'Off';
    if (c.mode === 'strong') return c.custom ? 'Strong — your own flags' : 'Strong — preset ' + (c.preset + 1);
    if (c.mode === 'auto') return 'Auto-configure (runs at start)';
    return 'Light';
  },

  // Settings › Privacy: where the feature list's "Censorship bypass" points.
  renderSetting(host) {
    host = host || document.getElementById('discord-bypass-setting');
    if (!host) return;
    const presets = Array.from({ length: this.PRESETS }, (_, i) => `<option value="${i}">Strong — preset ${i + 1}</option>`).join('');
    host.innerHTML = `
      <div class="setting-row-label">Discord and Roblox block bypass</div>
      <p class="setting-info muted" style="margin:2px 0 8px;font-size:11px">For networks that block Discord. Light is a built-in proxy that hides which site you are going to; Strong runs ByeDPI, which also breaks up the connection so blocking equipment cannot read it. Off is for when you run Zapret or a VPN yourself. Roblox's bypass uses the same ByeDPI.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select data-bypass-mode aria-label="Discord bypass">
          <option value="light">Light (built-in)</option>
          <option value="off">Off (use Zapret or a VPN)</option>
          ${presets}
          <option value="custom">Strong — your own ByeDPI flags</option>
        </select>
        <button type="button" class="btn-secondary" data-bypass-sweep>Find one that works</button>
      </div>
      <div data-bypass-custom-row style="display:none;margin-top:6px;gap:8px;align-items:center">
        <input type="text" data-bypass-custom spellcheck="false" placeholder="ciadpi flags, e.g. --fake -1 --ttl 8 --tlsrec 1+s" aria-label="ByeDPI flags" style="flex:1;min-width:220px">
        <button type="button" class="btn-secondary" data-bypass-custom-apply>Use these</button>
      </div>
      <p class="setting-info muted" data-bypass-state style="margin:6px 0 0;font-size:11px"></p>`;
    const sel = host.querySelector('[data-bypass-mode]');
    const customRow = host.querySelector('[data-bypass-custom-row]');
    const customIn = host.querySelector('[data-bypass-custom]');
    const state = host.querySelector('[data-bypass-state]');
    const say = (t) => { state.textContent = t; };
    const show = () => {
      const c = this.choice();
      sel.value = c.mode === 'strong' ? (c.custom ? 'custom' : String(c.preset)) : (c.mode === 'auto' ? 'light' : c.mode);
      customIn.value = localStorage.getItem(this.CUSTOM_KEY) || '';
      customRow.style.display = sel.value === 'custom' ? 'flex' : 'none';
      say('Now: ' + this.label(c));
    };
    const use = async (choice, busyText) => {
      say(busyText);
      const r = await this.apply(choice);
      if (!r || !r.ok) throw new Error((r && r.error) || 'It did not start');
      this.save(choice);
      SidebarManager.reloadDiscordForBypass();
      show();
      window.showToast?.('Discord bypass: ' + this.label());
    };
    const failed = (err) => { show(); window.showToast?.('Bypass not changed — ' + err.message, 'error'); };
    sel.addEventListener('change', () => {
      if (sel.value === 'custom') { customRow.style.display = 'flex'; customIn.focus(); return; }
      customRow.style.display = 'none';
      const choice = /^\d+$/.test(sel.value) ? { mode: 'strong', preset: Number(sel.value) } : { mode: sel.value };
      use(choice, 'Switching…').catch(failed);
    });
    host.querySelector('[data-bypass-custom-apply]').addEventListener('click', () => {
      const flags = customIn.value.trim();
      if (!flags) { say('Type the flags first'); customIn.focus(); return; }
      use({ mode: 'strong', custom: flags }, 'Starting ByeDPI with your flags…').catch(failed);
    });
    host.querySelector('[data-bypass-sweep]').addEventListener('click', () => {
      SidebarManager._enableBypassAuto().finally(show);
    });
    show();
  },
};

if (typeof window !== 'undefined') window.DiscordBypass = DiscordBypass;
if (typeof module !== 'undefined' && module.exports) module.exports = { DiscordBypass };
