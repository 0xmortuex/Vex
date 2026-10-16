// === The guide on the second screen ==========================================
//
// T2-049. The renderer half of src/main/second-screen.js: it gathers the pages
// for a game (its Game mode guide pages and its loadout cards' sources) and
// asks the main process to show them in a window of their own, big text and no
// chrome, on the monitor that is not the game's.
//
// The window is never always-on-top, never fullscreen and never an overlay, and
// it refuses to open over a game on a single monitor (the reason is shown).
// Where it was, and the zoom, are remembered. Keys inside it: Ctrl+Tab and
// Ctrl+Shift+Tab for the next and previous page, Ctrl+= Ctrl+- Ctrl+0 for zoom,
// Ctrl+W to close.
const VexSecondScreen = {
  ON_KEY: 'vex.secondScreen.enabled',

  enabled() { return VexLifeKit.flag(this.ON_KEY, true); },
  setEnabled(on) {
    VexLifeKit.setFlag(this.ON_KEY, !!on);
    if (!on) this.close().catch(err => window.VexProblems?.note('Second screen', 'Could not close the window', err));
  },

  _bridge(name) {
    const b = window.vex;
    if (!b || typeof b[name] !== 'function') throw new Error('The second-screen window is not available here');
    return b;
  },

  // Pages for a game: guide pages first, then card sources. gameId may be omitted
  // (the current game, or the only one in the list).
  pagesFor(gameId) {
    const id = gameId || (typeof GameSession !== 'undefined' && GameSession.defaultGame() ? GameSession.defaultGame().id : '');
    if (!id) throw new Error('Choose a game first: Settings, Game mode');
    const pages = typeof GameLoadouts !== 'undefined'
      ? GameLoadouts.pagesFor(id)
      : (typeof GameSession !== 'undefined' ? GameSession.pages(id).map(p => ({ title: p.title, url: p.url })) : []);
    if (!pages.length) throw new Error('This game has no guide pages yet. Ctrl+K, "Add this page to a game’s guide", or add a loadout card with a link.');
    return pages.slice(0, 12);
  },

  async open(gameId, index = 0) {
    if (!this.enabled()) throw new Error('The second-screen window is switched off');
    if (typeof VexUsage !== 'undefined') VexUsage.touch('second-screen');
    const b = this._bridge('secondScreenOpen');
    return b.secondScreenOpen({ pages: this.pagesFor(gameId), index });
  },
  async close() { return this._bridge('secondScreenClose').secondScreenClose(); },
  async state() { return this._bridge('secondScreenState').secondScreenState(); },

  async openOrSay(gameId) {
    try { await this.open(gameId); }
    catch (err) { window.showToast?.(err.message, 'error'); }
  },
};

if (typeof window !== 'undefined') {
  window.VexSecondScreen = VexSecondScreen;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'second-screen',
      title: 'Guide on a second screen',
      keywords: 'second screen monitor companion guide game window loadout',
      before: 'about',
      build: (el) => {
        el.appendChild(VexSettingsGroups.note('Shows a game’s guide pages in a separate window with big text, meant for your other monitor. It is a normal window: never on top, never full screen, never over a game, and it will not open over a game on a single monitor.'));
        el.appendChild(VexSettingsGroups.button('Open the guide now', () => VexSecondScreen.openOrSay(), { primary: true }));
        el.appendChild(VexSettingsGroups.button('Close it', () => VexSecondScreen.close().catch(err => window.showToast?.(err.message, 'error'))));
      },
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'second-screen', label: 'Guide on the second screen', hint: 'Show this game’s guide pages in a window for your other monitor', icon: 'monitor', action: () => VexSecondScreen.openOrSay() });
    VexExtras.registerCommand({ id: 'second-screen-close', label: 'Close the second-screen window', hint: '', icon: 'x', action: () => VexSecondScreen.close().catch(err => window.showToast?.(err.message, 'error')) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSecondScreen };
