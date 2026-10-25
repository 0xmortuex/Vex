// === Vex's own image viewer: the switch and its Settings section ===============
//
// A picture a tab or panel meets on its own (an image address, or an image file) is shown by a page of Vex's own
// (src/renderer/image-viewer, served by src/main/image-viewer.js) instead of Chromium's bare picture on a dark page: fit, actual
// size and fill, zoom and pan, turn and flip, a details panel (size, type, colour profile, camera and place when the picture says),
// copy, save, the pictures beside it, a slideshow, full screen and a crop and resize that saves a new copy. It reads the picture
// through the tab it is in, and nothing leaves the computer.
//
// This file is only what the window itself owns: the on/off switch (told to main, which is what catches the picture), the Settings
// section, and the Ctrl+K command. The window's own part of the work, keeping the picture's address in the address bar and sending
// the viewer the theme, is in js/webview.js (imageViewerAddress, imageOriginal, sendImageTheme).
//
//   vex.imageViewer.prefs = { enabled }       on unless it was switched off
const VexImageViewer = {
  PREF: 'vex.imageViewer.prefs',
  FEATURE: 'image-viewer',

  enabled() {
    try { const raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); return !raw || raw.enabled !== false; }
    catch (err) { console.error('[ImageViewer]', err.message); return true; }
  },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: !!on })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    this.apply();
    return !!on;
  },

  // Main is what catches a picture from the web, and the window is what sends a picture file to the viewer: both are told.
  apply() {
    const on = this.enabled();
    window.VexImageViewerOff = !on;
    if (window.vex && typeof window.vex.imageviewSetEnabled === 'function') {
      window.vex.imageviewSetEnabled(on).catch((err) => console.error('[ImageViewer] main could not be told:', err && err.message));
    }
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('A picture you open on its own opens in Vex\'s own viewer: fit, actual size and fill, zoom and drag, turn and flip, a details panel, copy and save, the pictures next to it in the same folder, a slideshow, full screen, and a crop and resize that saves a new copy. It reads the picture through the tab it is in, so a picture behind a sign-in works and a private tab\'s picture stays in that tab. Nothing is sent anywhere, and the picture itself is never changed.'));
    const row = document.createElement('label');
    row.className = 'vexsr-rule';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.enabled();
    box.addEventListener('change', () => {
      try { this.setEnabled(box.checked); window.showToast?.(box.checked ? 'Pictures open in Vex\'s own viewer' : 'Pictures open in the browser\'s own view again', 'info'); }
      catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); }
    });
    row.append(box, document.createTextNode(' Show pictures in Vex\'s own viewer'));
    el.appendChild(row);
    el.appendChild(G.note('Switched off, a picture opens as Chromium\'s plain picture page. The viewer\'s More menu also has "Open in the browser\'s own view" for a single picture. A picture inside a page is never touched, only a tab that is a picture.'));
    el.appendChild(G.button('Forget the view settings', async () => {
      try {
        if (!window.vex || typeof window.vex.imageviewForgetSettings !== 'function') throw new Error('This window cannot do that');
        const r = await window.vex.imageviewForgetSettings();
        if (!r || !r.ok) throw new Error((r && r.error) || 'It did not work');
        window.showToast?.('Vex forgot the viewer\'s view settings', 'success');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }));
    el.appendChild(G.note('The viewer remembers three things on this computer only: the checkerboard, the details panel and the slideshow speed. Private and Tor tabs never keep them. They are not synced.'));
  },
};

if (typeof window !== 'undefined') {
  window.VexImageViewer = VexImageViewer;
  VexImageViewer.apply();
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'image-viewer', title: 'Image viewer', keywords: 'image viewer picture photo png jpeg gif webp svg zoom rotate flip exif slideshow crop resize checkerboard', before: 'about', build: (el) => VexImageViewer.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({
      id: 'image-viewer-settings', label: 'Image viewer', hint: 'Settings for the viewer that opens your pictures', icon: 'image',
      action: () => { if (typeof SettingsUI !== 'undefined' && typeof SettingsUI.openSection === 'function') SettingsUI.openSection('vex-sg-image-viewer'); },
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexImageViewer };
