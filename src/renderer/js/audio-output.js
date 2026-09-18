// === Which speakers this tab plays through =================================
//
// Windows picks one output device per program, so a browser sends everything
// to the same place: a Discord call and a music tab cannot be split between
// headphones and desk speakers without moving the whole browser — which moves
// the game's sound with it.
//
// Chromium can do better. Every media element has setSinkId; nothing calls it
// because no web page would. Vex calls it, per tab and per panel, and remembers
// the choice by site so a reopened tab comes back on the right device.
//
// Public: AudioOutput.devices(), .set(tabId, deviceId), .get(tabId), .apply(wv, tabId).
const AudioOutput = {
  KEY: 'vex.audioOutputs',      // { [host]: deviceId }

  // The output devices, named. Chromium only gives real labels once the page
  // has had microphone permission at least once; without it the list is there
  // but the names are empty, so they are numbered instead of left blank.
  async devices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    let list = [];
    try { list = await navigator.mediaDevices.enumerateDevices(); }
    catch (err) { VexProblems?.note('Audio output', 'Could not list the output devices', err); return []; }
    return list.filter(d => d.kind === 'audiooutput').map((d, i) => ({
      id: d.deviceId,
      label: d.label || (d.deviceId === 'default' ? 'System default' : 'Output ' + (i + 1)),
      isDefault: d.deviceId === 'default',
    }));
  },

  // Chromium hides output device ids and names until the page has had
  // microphone permission at least once — measured here: one nameless entry.
  // That is a privacy rule worth keeping, so Vex does not work around it
  // quietly: this asks, once, when the user opens the menu and chooses to.
  // The microphone is opened and stopped in the same breath; nothing is heard,
  // recorded or sent.
  async unlockDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This build cannot list audio devices');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try { stream.getTracks().forEach(t => t.stop()); } catch {}
    return this.devices();
  },

  // Is the list Chromium gave us actually usable, or is it the nameless
  // placeholder it returns before permission?
  usable(devices) { return (devices || []).some(d => d.id && d.id !== 'default'); },

  _map() { try { const m = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return (m && typeof m === 'object') ? m : {}; } catch { return {}; } },
  _save(map) {
    try { localStorage.setItem(this.KEY, JSON.stringify(map)); }
    catch (err) { VexProblems?.note('Audio output', 'Could not save the choice', err); }
  },

  // Remembered per site, not per tab: tabs come and go, "YouTube on the
  // speakers" is the thing the user meant.
  _hostOf(url) { try { return new URL(String(url)).host; } catch { return ''; } },

  get(url) { return this._map()[this._hostOf(url)] || ''; },

  // '' puts the site back on the system default.
  setForUrl(url, deviceId) {
    const host = this._hostOf(url);
    if (!host) throw new Error('That tab has no address yet');
    const map = this._map();
    if (deviceId) map[host] = String(deviceId); else delete map[host];
    this._save(map);
    return deviceId || '';
  },

  // Point one live webview at its site's device. Safe to call on every load.
  apply(webview, url) {
    if (!webview || typeof webview.send !== 'function') return false;
    const id = this.get(url || (webview.getURL ? webview.getURL() : ''));
    try { webview.send('vex-audio-sink', id); return true; }
    catch (err) { VexProblems?.note('Audio output', 'Could not set the device for this tab', err); return false; }
  },

  // Everything playing right now, so a change takes effect without a reload.
  applyAll() {
    let n = 0;
    try {
      if (typeof WebviewManager !== 'undefined' && WebviewManager.webviews) {
        for (const [tabId, wv] of WebviewManager.webviews) { if (this.apply(wv)) n++; }
      }
      if (typeof SidebarManager !== 'undefined' && SidebarManager.panelWebviews) {
        for (const wv of Object.values(SidebarManager.panelWebviews)) { if (wv && this.apply(wv)) n++; }
      }
    } catch (err) { VexProblems?.note('Audio output', 'Could not reach every tab', err); }
    return n;
  },

  // The menu behind the tab's sound icon, and the Media panel.
  async menuFor(url) {
    const devices = await this.devices();
    const chosen = this.get(url);
    return [{ id: '', label: 'System default', isDefault: true, chosen: !chosen }]
      .concat(devices.filter(d => d.id && d.id !== 'default').map(d => ({ ...d, chosen: d.id === chosen })));
  },
};

if (typeof window !== 'undefined') window.AudioOutput = AudioOutput;
if (typeof module !== 'undefined' && module.exports) module.exports = { AudioOutput };
