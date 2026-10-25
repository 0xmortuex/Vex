// === Vex's own viewer for office documents and e-books: the switches and their Settings section ===============
//
// A Word, Excel or PowerPoint file, an OpenDocument file, an RTF or an EPUB that a tab meets is shown by a page of Vex's own (src/renderer/office-viewer,
// served by src/main/office-viewer.js) instead of being downloaded: theme-matched, read-only, with find, print, copy, and a button to download the
// original instead. It fetches the file through the tab's own session, runs no macro, follows no address inside the file, and nothing leaves the computer.
//
// This file is only what the window itself owns: the two switches (told to main, which is what catches the file), the Settings section, and the
// Ctrl+K command. The window's other part of the work, keeping the file's address in the address bar and sending the viewer the theme, is in js/webview.js.
//
//   vex.officeViewer.prefs = { enabled, attachments }   enabled: on unless it was switched off;  attachments: off unless it was switched on
const VexOfficeViewer = {
  PREF: 'vex.officeViewer.prefs',
  FEATURE: 'office-viewer',

  read() {
    try { return JSON.parse(localStorage.getItem(this.PREF) || 'null') || {}; }
    catch (err) { console.error('[OfficeViewer]', err.message); return {}; }
  },
  enabled() { return this.read().enabled !== false; },
  attachments() { return this.read().attachments === true; },
  write(patch) {
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: this.enabled(), attachments: this.attachments(), ...patch })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    this.apply();
  },
  setEnabled(on) { this.write({ enabled: !!on }); return !!on; },
  setAttachments(on) { this.write({ attachments: !!on }); return !!on; },

  // Main is what catches a document, so it is told.
  apply() {
    if (window.vex && typeof window.vex.docviewSetOptions === 'function') {
      window.vex.docviewSetOptions({ enabled: this.enabled(), attachments: this.attachments() }).catch((err) => console.error('[OfficeViewer] main could not be told:', err && err.message));
    }
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Word, Excel and PowerPoint files, OpenDocument files, RTF and e-books (EPUB) open in Vex\'s own viewer instead of being downloaded: in the colours of your theme, with find, print, copy, a sheet grid you can sort and filter, slides with notes and a presentation mode, and a book reader that remembers where you stopped. It reads the file through the tab it is in, so a file behind a sign-in works and a private tab\'s file stays in that tab. Macros are never run, nothing in a document is fetched, and nothing is sent anywhere.'));
    const mk = (label, checked, onChange) => {
      const row = document.createElement('label');
      row.className = 'vexsr-rule';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = checked;
      box.addEventListener('change', () => {
        try { onChange(box.checked); }
        catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); }
      });
      row.append(box, document.createTextNode(' ' + label));
      el.appendChild(row);
    };
    mk('Show office documents and e-books in Vex\'s own viewer', this.enabled(), (on) => {
      this.setEnabled(on);
      window.showToast?.(on ? 'Documents open in Vex\'s own viewer' : 'Documents are downloaded again', 'info');
    });
    el.appendChild(G.note('Switched off, these files are downloaded as before. The viewer\'s "Download original" button saves the file when you want it.'));
    mk('Also use the viewer when a site says the file is a download', this.attachments(), (on) => {
      this.setAttachments(on);
      window.showToast?.(on ? 'The viewer also opens files a site marks as a download' : 'Files a site marks as a download are saved as the site asks', 'info');
    });
    el.appendChild(G.note('Off by default: a "Download" button on a site saves the file, as the site intends. Turn it on if you would rather read those files first.'));
    el.appendChild(G.button('Forget where I stopped in books', async () => {
      try {
        if (!window.vex || typeof window.vex.docviewForgetBooks !== 'function') throw new Error('This window cannot do that');
        const r = await window.vex.docviewForgetBooks();
        if (!r || !r.ok) throw new Error((r && r.error) || 'It did not work');
        window.showToast?.('Vex forgot where you stopped in each book, and your highlights', 'success');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }));
    el.appendChild(G.note('Vex remembers where you stopped in each book, your reading settings and your book highlights on this computer only. Private and Tor tabs never keep them. They are not synced.'));
  },
};

if (typeof window !== 'undefined') {
  window.VexOfficeViewer = VexOfficeViewer;
  VexOfficeViewer.apply();
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'office-viewer', title: 'Documents and e-books', keywords: 'document viewer word docx excel xlsx powerpoint pptx epub ebook book reader rtf odt ods odp spreadsheet slides open download office', before: 'about', build: (el) => VexOfficeViewer.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({
      id: 'office-viewer-settings', label: 'Documents and e-books viewer', hint: 'Settings for the viewer that opens Word, Excel, PowerPoint and e-book files', icon: 'file',
      action: () => { if (typeof SettingsUI !== 'undefined' && typeof SettingsUI.openSection === 'function') SettingsUI.openSection('vex-sg-office-viewer'); },
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexOfficeViewer };
