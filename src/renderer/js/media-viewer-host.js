// === Vex's own video and sound player: the switch, its Settings section, and what it asks of the window ===
//
// A video or a sound opened as a document (a link to one, a file, a drag-dropped file) is shown by a page of Vex's own
// (src/renderer/media-viewer, served by src/main/media-viewer.js) instead of Chromium's bare player: a theme-matched surface with
// an auto-hiding control bar, a seek bar with a preview and the buffered parts, speed from 0.25x to 4x, a loop for a section, frame
// stepping, a picture of the frame, picture in picture, subtitles (.srt, .vtt, .ass) with size, colour, position and delay, chapters,
// the media keys, a night mode, a place kept per file, and for sound a cover, a spectrum and a queue of the folder. It reads the media
// through the tab it is in, so a file behind a sign-in works and a private or Tor tab's media stays in that tab. Nothing is sent
// anywhere. A video inside a web page, and any streaming or protected (DRM) player, is never touched.
//
// This file is only what the window itself owns: the on/off switch (told to main, which is what catches web media), the Settings
// section, the Ctrl+K command, the theme it sends the page, and the two things the page asks of the window: its theme, and Night
// mode (js/night-audio.js). The address handling (the media's own address stays in the address bar, history and bookmarks) is in
// js/webview.js (viewerAddress, mediaOriginal).
//
//   vex.mediaViewer.prefs = { enabled }       on unless it was switched off
const VexMediaViewer = {
  PREF: 'vex.mediaViewer.prefs',
  FEATURE: 'media-viewer',

  // The colours and type of the interface as the page needs them: the values this window resolves for the theme, the browser look,
  // the custom theme and the chosen font, so the page matches every one of them without carrying a copy.
  THEME_VARS: ['--vex-bg-base', '--vex-bg-elevated', '--vex-bg-deep', '--vex-glass-strong', '--vex-glass-medium', '--vex-glass-light', '--vex-glass-input',
    '--vex-border-subtle', '--vex-border-medium', '--vex-border-strong', '--vex-border-accent', '--vex-accent', '--vex-accent-dim', '--vex-accent-glow',
    '--vex-text-primary', '--vex-text-secondary', '--vex-text-muted', '--vex-text-accent', '--vex-success', '--vex-danger', '--vex-danger-hover', '--vex-warning',
    '--vex-hover-fill', '--vex-shadow-color', '--vex-radius-sm', '--vex-radius-md', '--vex-radius-lg', '--vex-font-base', '--vex-font-display', '--vex-font-heading',
    '--vex-font-mono', '--on-primary', '--b-font', '--b-btn-radius', '--b-ring-w', '--b-accent-ring',
    // The older names the calm panels (css/ai-panel.css) are written in.
    '--bg', '--bg-2', '--surface', '--border', '--text', '--text-muted', '--primary', '--primary-hover', '--danger', '--success', '--accent'],

  enabled() {
    try { const raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); return !raw || raw.enabled !== false; }
    catch (err) { console.error('[MediaViewer]', err.message); return true; }
  },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: !!on })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    this.apply();
    return !!on;
  },

  // Main is what catches web media, and the window is what sends a media file to the player: both are told.
  apply() {
    const on = this.enabled();
    window.VexMediaViewerOff = !on;
    if (window.vex && typeof window.vex.mediaviewSetEnabled === 'function') {
      window.vex.mediaviewSetEnabled(on).catch((err) => console.error('[MediaViewer] main could not be told:', err && err.message));
    }
  },

  themePayload() {
    const cs = getComputedStyle(document.body);
    const vars = {};
    for (const name of this.THEME_VARS) { const v = cs.getPropertyValue(name).trim(); if (v) vars[name] = v; }
    const root = document.documentElement;
    return {
      vars, lang: root.lang || 'en',
      attrs: { 'data-theme': root.getAttribute('data-theme') || '', 'data-scheme': root.getAttribute('data-scheme') || '', 'data-gui-style': document.body.getAttribute('data-gui-style') || '', 'data-gui-family': document.body.getAttribute('data-gui-family') || '' },
    };
  },
  isPlayerPage(webview) {
    let url = '';
    try { url = webview.getURL(); } catch { return false; }
    return /^vex-media:\/\/view\//i.test(url);
  },
  send(webview, message) {
    try { webview.send('mediaview:from-host', message); }
    catch (err) { if (!/dom-ready|attached/i.test(String(err && err.message))) console.warn('[MediaViewer] the player could not be told:', err && err.message); }
  },
  sendTheme(webview) { this.send(webview, { type: 'theme', payload: this.themePayload() }); },
  sendThemeToAll() {
    if (typeof WebviewManager === 'undefined') return;
    for (const wv of WebviewManager.webviews.values()) if (this.isPlayerPage(wv)) this.sendTheme(wv);
  },

  // The player asks for Night mode (js/night-audio.js evens out loud and quiet sound). A web file's host remembers it, as it does for
  // a page; a file on this computer has no host and is evened out for this tab only. A tab that keeps nothing keeps nothing.
  async night(webview, on) {
    const NA = window.NightAudio;
    if (!NA) throw new Error('Night mode is not available in this window');
    await NA.apply(webview, on);
    let original = '';
    try { original = (WebviewManager.mediaOriginal(webview.getURL()) || '').replace(/#.*$/, ''); } catch { original = ''; }
    if (/^https?:\/\//i.test(original)) {
      const tab = TabManager.tabs.find((t) => WebviewManager.webviews.get(t.id) === webview);
      const mayKeep = !tab || typeof TabManager.windowMayAsk !== 'function' || TabManager.windowMayAsk(tab.partition);
      if (mayKeep && !(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow)) NA.remember(original, on);
    }
  },

  onMessage(event) {
    const webview = event.target;
    if (!webview || webview.tagName !== 'WEBVIEW' || typeof event.channel !== 'string' || !event.channel.startsWith('mediaview:')) return;
    if (!this.isPlayerPage(webview)) return;       // only the player page may ask
    if (event.channel === 'mediaview:need-theme') { this.sendTheme(webview); return; }
    if (event.channel === 'mediaview:night') {
      const on = !!(event.args && event.args[0]);
      this.night(webview, on).then(
        () => this.send(webview, { type: 'night', ok: true, on }),
        (err) => this.send(webview, { type: 'night', ok: false, on: !on, error: err.message }),
      );
    }
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Videos and sounds you open as a document, a link to one, a file or a dropped file, play in Vex\'s own player: a seek bar with a preview, speed from 0.25 to 4, a loop for a section, subtitles with size, colour and delay, a picture of the frame, picture in picture, the media keys and a night mode. It reads the file through the tab it is in, so a file behind a sign-in works and a private tab\'s file stays in that tab. Nothing is sent anywhere. Videos inside web pages and protected streaming players are never touched.'));
    const row = document.createElement('label');
    row.className = 'vexsr-rule';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.enabled();
    box.addEventListener('change', () => {
      try { this.setEnabled(box.checked); window.showToast?.(box.checked ? 'Videos and sounds open in Vex\'s own player' : 'Videos and sounds open in the browser\'s own player again', 'info'); }
      catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); }
    });
    row.append(box, document.createTextNode(' Play videos and sounds in Vex\'s own player'));
    el.appendChild(row);
    el.appendChild(G.note('Switched off, they open in Chromium\'s bare player as before. The speed you keep for a site and the volume rules (Master Volume, the volume kept for a site) apply in this player as they do on the site itself.'));
    el.appendChild(G.button('Forget where I stopped', async () => {
      try {
        if (!window.vex || typeof window.vex.mediaviewForgetPlaces !== 'function') throw new Error('The window could not do that');
        const r = await window.vex.mediaviewForgetPlaces();
        if (!r || !r.ok) throw new Error((r && r.error) || 'That did not work');
        window.showToast?.('Vex forgot where you stopped in each file', 'success');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }));
    el.appendChild(G.note('Vex remembers the place in each file and your subtitle look on this computer only. Private and Tor tabs never keep them. They are not synced.'));
  },
};

if (typeof window !== 'undefined') {
  window.VexMediaViewer = VexMediaViewer;
  VexMediaViewer.apply();
  // <webview> events do not bubble, but they pass through the document on the way down: one capturing listener hears every tab.
  document.addEventListener('ipc-message', (e) => VexMediaViewer.onMessage(e), true);
  const push = () => { try { VexMediaViewer.sendThemeToAll(); } catch (err) { console.warn('[MediaViewer] the players could not be given the theme:', err && err.message); } };
  // This file loads after the window is up: a player opened before that is given the theme now.
  push();
  document.addEventListener('theme-changed', push);
  document.addEventListener('vex:font-changed', push);
  // A look is applied a moment after the event that names it.
  window.addEventListener('vex:gui-style', () => setTimeout(push, 150));
  window.addEventListener('vex:gui-colors', () => setTimeout(push, 150));
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'media-viewer', title: 'Video and sound player', keywords: 'video player audio player music movie mp4 mp3 subtitles srt speed loop picture in picture night mode queue cover', before: 'about', build: (el) => VexMediaViewer.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({
      id: 'media-viewer-settings', label: 'Video and sound player', hint: 'Settings for the player that opens your videos and sounds', icon: 'video',
      action: () => { if (typeof SettingsUI !== 'undefined' && typeof SettingsUI.openSection === 'function') SettingsUI.openSection('vex-sg-media-viewer'); },
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMediaViewer };
