// === Vex's own PDF viewer: the switch and its Settings section ===============
//
// A PDF a tab or panel meets is shown by a page of Vex's own (src/renderer/pdf-viewer, built on pdf.js, served by
// src/main/pdf-viewer.js) instead of Chromium's sealed viewer: a slim toolbar in the theme, thumbnails, the outline,
// search, marks (highlight, underline, strikethrough, drawing, notes, shapes, a signature stamp), forms, a saved copy that
// never overwrites the original, print, presentation, and a page tone that follows the theme. It fetches the PDF through the
// tab's own session, and nothing leaves the computer.
//
// This file is only what the window itself owns: the on/off switch (told to main, which is what catches the PDF), the
// Settings section, and the Ctrl+K command. The window's own part of the work, keeping the PDF's address in the address bar
// and sending the viewer the theme, is in js/webview.js.
//
//   vex.pdfViewer.prefs = { enabled }       on unless it was switched off
const VexPdfViewer = {
  PREF: 'vex.pdfViewer.prefs',
  FEATURE: 'pdf-viewer',

  enabled() {
    try { const raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); return !raw || raw.enabled !== false; }
    catch (err) { console.error('[PdfViewer]', err.message); return true; }
  },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: !!on })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    this.apply();
    return !!on;
  },

  // Main is what catches a PDF, and the window is what sends a PDF file to the viewer: both are told.
  apply() {
    const on = this.enabled();
    window.VexPdfViewerOff = !on;
    if (window.vex && typeof window.vex.pdfviewSetEnabled === 'function') {
      window.vex.pdfviewSetEnabled(on).catch((err) => console.error('[PdfViewer] main could not be told:', err && err.message));
    }
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('PDFs open in Vex\'s own viewer: thumbnails, an outline, search, marks you can save into a copy, forms, print and a presentation mode, in the colours of your theme. It reads the PDF through the tab it is in, so a PDF behind a sign-in works and a private tab\'s PDF stays in that tab. Nothing is sent anywhere. Your original file is never changed: a copy is saved where you choose.'));
    const row = document.createElement('label');
    row.className = 'vexsr-rule';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.enabled();
    box.addEventListener('change', () => {
      try { this.setEnabled(box.checked); window.showToast?.(box.checked ? 'PDFs open in Vex\'s own viewer' : 'PDFs open in the browser\'s own viewer again', 'info'); }
      catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); }
    });
    row.append(box, document.createTextNode(' Show PDFs in Vex\'s own viewer'));
    el.appendChild(row);
    el.appendChild(G.note('Switched off, PDFs open in Chromium\'s viewer as before. The viewer\'s More menu also has "Open in the browser\'s viewer" for a single PDF.'));
    el.appendChild(G.button('Forget the pages I was on', async () => {
      try {
        if (!window.vex || typeof window.vex.pdfviewForgetPlaces !== 'function') throw new Error('This window cannot do that');
        const r = await window.vex.pdfviewForgetPlaces();
        if (!r || !r.ok) throw new Error((r && r.error) || 'It did not work');
        window.showToast?.('Vex forgot where you were in each PDF', 'success');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }));
    el.appendChild(G.note('Vex remembers the page and zoom of each PDF on this computer only. Private and Tor tabs never keep them. They are not synced.'));
  },
};

if (typeof window !== 'undefined') {
  window.VexPdfViewer = VexPdfViewer;
  VexPdfViewer.apply();
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'pdf-viewer', title: 'PDF viewer', keywords: 'pdf viewer reader annotate highlight sign form print thumbnails outline page tone dark mode', before: 'about', build: (el) => VexPdfViewer.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({
      id: 'pdf-viewer-settings', label: 'PDF viewer', hint: 'Settings for the viewer that opens your PDFs', icon: 'file',
      action: () => { if (typeof SettingsUI !== 'undefined' && typeof SettingsUI.openSection === 'function') SettingsUI.openSection('vex-sg-pdf-viewer'); },
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPdfViewer };
