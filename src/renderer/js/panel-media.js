// === Controlling the music without going and finding it ====================
//
// The Spotify panel is a web page, so pausing it meant opening the panel,
// finding the bar and clicking. These do it from anywhere — the command bar,
// or Now Playing — and work on any panel playing something (Spotify, YouTube
// Music, a radio site), because they use two ways round:
//
//   play/pause, volume   the page's own <audio>/<video> elements, which every
//                        player has and which cannot be renamed away
//   next/previous        the player's own buttons, found by what they are
//                        labelled or by the test ids Spotify ships. A site
//                        that has neither is told about, not guessed at.
const PanelMedia = {
  PANELS: ['spotify', 'youtube-music', 'soundcloud', 'apple-music'],

  // The panel that is playing, or the first media panel that is open.
  webview(name) {
    const mgr = typeof SidebarManager !== 'undefined' ? SidebarManager : window.SidebarManager;
    if (!mgr) return null;
    const names = name ? [name] : this.PANELS;
    for (const n of names) {
      const wv = mgr.panelWebviews && mgr.panelWebviews[n];
      const el = document.getElementById('panel-' + n);
      const live = (el && el.querySelector && el.querySelector('webview')) || wv;
      if (live) return live;
    }
    return null;
  },

  NEXT: ['[data-testid="control-button-skip-forward"]', 'button[aria-label*="Next" i]', 'button[title*="Next" i]', '.ytmusic-player-bar .next-button'],
  PREV: ['[data-testid="control-button-skip-back"]', 'button[aria-label*="Previous" i]', 'button[title*="Previous" i]', '.ytmusic-player-bar .previous-button'],

  _clickScript(selectors) {
    return `(() => {
      const found = ${JSON.stringify(selectors)}.map(s => document.querySelector(s)).find(Boolean);
      if (!found) return false;
      found.click();
      return true;
    })()`;
  },

  _mediaScript(what, value) {
    return `(() => {
      const list = [...document.querySelectorAll('video,audio')].filter(m => m.duration || m.currentTime || !m.paused);
      const m = list.find(x => !x.paused) || list[0];
      if (!m) return null;
      ${what === 'toggle' ? 'if (m.paused) m.play(); else m.pause(); return m.paused ? "paused" : "playing";'
        : what === 'volume' ? 'm.volume = Math.min(1, Math.max(0, ' + Number(value) + ')); return Math.round(m.volume * 100);'
        : 'return m.paused ? "paused" : "playing";'}
    })()`;
  },

  async _run(script, name) {
    const wv = this.webview(name);
    if (!wv) throw new Error('Open the music panel once, and these work from anywhere');
    return window.vexGuestEval(wv, script, true, 4000);
  },

  async playPause(name) {
    const state = await this._run(this._mediaScript('toggle'), name);
    if (state == null) throw new Error('Nothing is playing in that panel');
    window.showToast?.(state === 'paused' ? 'Paused' : 'Playing');
    return state;
  },

  async next(name) {
    if (!(await this._run(this._clickScript(this.NEXT), name))) throw new Error('This player has no Next button Vex can find');
    window.showToast?.('Next track');
    return true;
  },

  async previous(name) {
    if (!(await this._run(this._clickScript(this.PREV), name))) throw new Error('This player has no Previous button Vex can find');
    window.showToast?.('Previous track');
    return true;
  },

  // percent 0–100, of the player's own volume (not Vex's).
  async volume(percent, name) {
    const n = Number(percent);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Give a number from 0 to 100');
    const set = await this._run(this._mediaScript('volume', n / 100), name);
    if (set == null) throw new Error('Nothing is playing in that panel');
    window.showToast?.('Volume ' + set + '%');
    return set;
  },
};

if (typeof window !== 'undefined') window.PanelMedia = PanelMedia;
if (typeof module !== 'undefined' && module.exports) module.exports = { PanelMedia };
