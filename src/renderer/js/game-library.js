// === Find the games that are installed, and offer them to Game mode (T2-002) ===
//
// Game mode starts for the programs on the person's own list (js/game-session.js).
// Only two games were on it while Steam, Epic and Roblox have many more. This asks
// the main process for a read-only listing of what the launchers say is installed
// (src/main/game-library.js: manifest files and folder listings only, no registry,
// nothing is started or touched) and OFFERS each one. Nothing is added without the
// person's confirm, one game at a time, and "Not this one" is remembered.
//
//   GameLibrary.scan()           -> { candidates, errors, sources } from main
//   GameLibrary.fresh(result)    -> the candidates not on the list and not skipped
//   GameLibrary.add(candidate)   -> asks, then adds it to the Game mode list
//   GameLibrary.mount(host)      -> the "Find installed games" block under Settings > Game mode
//   GameLibrary.offer()          -> once a week, one Attention Inbox line when there are new ones
const GameLibrary = {
  KEYS: { on: 'vex.gameLibrary.enabled', last: 'vex.gameLibrary.lastScan', skipped: 'vex.gameLibrary.skipped' },
  EVERY_MS: 7 * 24 * 3600 * 1000,
  MAX_SKIPPED: 200,
  SOURCE_LABEL: { steam: 'Steam', epic: 'Epic Games', roblox: 'Roblox' },

  _note(what, err) { window.VexProblems?.note('Game library', what, err); },
  _now() { return Date.now(); },

  // The weekly offer. Looking by hand (the button) works whether this is on or not.
  enabled() { return localStorage.getItem(this.KEYS.on) !== 'off'; },
  setEnabled(on) { localStorage.setItem(this.KEYS.on, on ? 'on' : 'off'); },

  skipped() {
    const raw = localStorage.getItem(this.KEYS.skipped);
    if (raw === null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The list of games you skipped could not be read', { cause: err }); }
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  },
  skip(exe) {
    const key = GameSession.exeKey(exe);
    if (!key) throw new Error('That game has no program name');
    const list = this.skipped();
    if (!list.includes(key)) list.push(key);
    while (list.length > this.MAX_SKIPPED) list.shift();
    localStorage.setItem(this.KEYS.skipped, JSON.stringify(list));
  },
  unskipAll() { localStorage.removeItem(this.KEYS.skipped); },

  _api() {
    const b = typeof window !== 'undefined' ? window.vex : null;
    if (!b || typeof b.gameModeLibrary !== 'function') throw new Error('Listing installed games is not available in this window');
    return b.gameModeLibrary.bind(b);
  },
  async scan() {
    const result = await this._api()();
    if (!result || !Array.isArray(result.candidates)) throw new Error('The game listing came back in a form Vex did not expect');
    return result;
  },

  // Not on the Game mode list yet and not skipped.
  fresh(result) {
    if (typeof GameSession === 'undefined') throw new Error('Game mode is not loaded');
    const have = new Set(GameSession.games().map(g => GameSession.exeKey(g.exe)));
    const skipped = new Set(this.skipped());
    return (result.candidates || []).filter(c => !have.has(GameSession.exeKey(c.exe)) && !skipped.has(GameSession.exeKey(c.exe)));
  },

  async add(c) {
    const ok = await window.vexConfirm({
      title: 'Add this game to Game mode?',
      message: c.name + ' (' + c.exe + '.exe, from ' + (this.SOURCE_LABEL[c.source] || c.source) + '). Game mode will start when this program runs.',
      okLabel: 'Add',
    });
    if (!ok) return null;
    return GameSession.addGame({ name: c.name, exe: c.exe });
  },

  // ---- Settings block -------------------------------------------------------------
  mount(host) {
    if (!host || typeof GameSession === 'undefined') return;
    const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
    const wrap = el('div', 'gs-library');
    const head = el('div', 'setting-label');
    head.appendChild(el('strong', null, 'Installed games'));
    head.appendChild(el('span', 'setting-hint', 'Looks at the Steam, Epic and Roblox install lists (file listing only; nothing is opened, started or changed) and offers each game for the list above. You confirm every one.'));
    wrap.appendChild(head);
    const out = el('div', 'gs-library-list');
    out.setAttribute('aria-live', 'polite');
    const find = el('button', 'btn-secondary', 'Find installed games…');
    find.type = 'button';
    find.addEventListener('click', async () => {
      find.disabled = true;
      out.textContent = 'Looking…';
      try { this._draw(out, await this.scan(), host); }
      catch (err) { out.textContent = ''; this._note('Could not list the installed games', err); window.showToast?.('Could not list the installed games: ' + err.message, 'error'); }
      finally { find.disabled = false; }
    });
    wrap.append(find, out);
    const weekly = el('label', 'setting-toggle-row');
    weekly.appendChild(el('span', null, 'Tell me about new installed games (once a week)'));
    const sw = document.createElement('label');
    sw.className = 'toggle';
    sw.innerHTML = '<input type="checkbox" aria-label="Tell me about new installed games"><span class="toggle-slider"></span>';
    const box = sw.querySelector('input');
    box.checked = this.enabled();
    box.addEventListener('change', () => { try { this.setEnabled(box.checked); } catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); } });
    weekly.appendChild(sw);
    wrap.appendChild(weekly);
    host.appendChild(wrap);
  },

  _draw(out, result, host) {
    out.textContent = '';
    const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
    const found = this.fresh(result);
    const seen = Object.entries(result.sources || {}).filter(([, v]) => v).map(([k]) => this.SOURCE_LABEL[k] || k);
    out.appendChild(el('p', 'setting-info muted', (seen.length ? 'Looked at: ' + seen.join(', ') + '. ' : 'No Steam, Epic or Roblox install was found. ')
      + (found.length ? found.length + ' not on your list yet.' : 'Nothing new to add.')));
    for (const e of result.errors || []) out.appendChild(el('p', 'setting-info muted', 'Could not read part of ' + (this.SOURCE_LABEL[e.source] || e.source) + ': ' + e.message));
    for (const c of found) {
      const row = el('div', 'setting-toggle-row');
      row.appendChild(el('span', null, c.name + ' — ' + c.exe + '.exe (' + (this.SOURCE_LABEL[c.source] || c.source) + ')'));
      const btns = el('span', 'gs-btns');
      const add = el('button', 'btn-secondary', 'Add…');
      add.type = 'button';
      add.addEventListener('click', async () => {
        try { const g = await this.add(c); if (g) { window.showToast?.(g.name + ' added to Game mode'); row.remove(); if (typeof GameSession.renderSettings === 'function') GameSession.renderSettings(host); } }
        catch (err) { window.showToast?.(err.message, 'error'); }
      });
      const no = el('button', 'btn-secondary', 'Not this one');
      no.type = 'button';
      no.addEventListener('click', () => { try { this.skip(c.exe); row.remove(); } catch (err) { window.showToast?.(err.message, 'error'); } });
      btns.append(add, no);
      row.appendChild(btns);
      out.appendChild(row);
    }
  },

  // ---- the weekly offer -------------------------------------------------------------
  _busy() {
    return (typeof GameMode !== 'undefined' && !!GameMode.gaming) || (typeof GameSession !== 'undefined' && !!GameSession.active);
  },
  async offer(now = this._now()) {
    if (!this.enabled() || this._busy()) return null;
    const last = Number(localStorage.getItem(this.KEYS.last)) || 0;
    if (now - last < this.EVERY_MS) return null;
    // Set first: a listing that fails is not retried every minute.
    localStorage.setItem(this.KEYS.last, String(now));
    const found = this.fresh(await this.scan());
    if (!found.length) return null;
    if (typeof VexAttention === 'undefined') throw new Error('VexAttention is not loaded');
    const names = found.slice(0, 3).map(c => c.name).join(', ') + (found.length > 3 ? ' and ' + (found.length - 3) + ' more' : '');
    VexAttention.suggest({
      feature: 'game-library', id: 'found', label: 'Installed games',
      title: found.length + ' installed game' + (found.length === 1 ? ' is' : 's are') + ' not on your Game mode list',
      body: names + '. Review them in Settings > Game mode; you confirm each one.',
      action: { label: 'Review', key: 'review' },
    });
    return found;
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    // The block goes under the games list whenever Game mode's settings are drawn.
    if (typeof GameSession !== 'undefined' && typeof GameSession.renderSettings === 'function' && !GameSession._libraryWrapped) {
      const draw = GameSession.renderSettings;
      GameSession.renderSettings = function (host) {
        draw.apply(this, arguments);
        const h = host || document.getElementById('game-session-settings');
        if (h) GameLibrary.mount(h);
      };
      GameSession._libraryWrapped = true;
    }
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle('game-library', () => { if (typeof SettingsUI !== 'undefined') SettingsUI.openSection('game-session-settings'); });
    }
    if (typeof VexJobs !== 'undefined') {
      VexJobs.every('Game library check', 6 * 3600 * 1000, () => this.offer().catch(err => this._note('The weekly look at the installed games failed', err)), { when: 'background', feature: 'game-library' });
    }
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.GameLibrary = GameLibrary;
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'game-library-find', label: 'Find installed games', hint: 'Look at your Steam, Epic and Roblox installs and offer each game to Game mode', icon: 'gamepad', action: () => { if (typeof SettingsUI !== 'undefined') SettingsUI.openSection('game-session-settings'); } });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => GameLibrary.init());
    else GameLibrary.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { GameLibrary };
