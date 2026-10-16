// === Download safety shortcuts: "Scan with Windows Security" and the internet-mark check =====
//
// T3-110  VexDefenderShortcut
//   A shield button on a finished download that can run code (a program, a script, an installer or
//   an archive). It opens Windows Security's "Virus & threat protection" page and shows the file in
//   its folder, where right-click > "Scan with Microsoft Defender" is. Vex starts no scan, runs no
//   program and reads nothing back (src/main/defender-shortcut.js: one fixed address).
//
// T3-111  VexMotwCheck
//   Windows marks a file that came from the internet (the "mark of the web", an alternate stream on
//   the file) so SmartScreen looks at it before it runs. Vex keeps that mark across the moves it does
//   itself (src/main/mark-of-the-web.js). This is the read-only side: "Check the marks on my downloads"
//   lists which of the files Vex downloaded no longer carry it (for example after another program
//   copied them). It writes nothing; it only tells you.
const VexDefenderShortcut = {
  KEY: 'vex.defenderShortcut',      // 'off' turns it off
  SCANNABLE: /\.(exe|msi|msix|msixbundle|appx|appxbundle|bat|cmd|com|scr|ps1|vbs|js|jse|wsf|hta|reg|jar|dll|lnk|iso|img|vhd|vhdx|zip|7z|rar|cab|apk)$/i,

  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? 'on' : 'off'); return !!on; },
  // Whether a download row gets the button: this is on, the file is one that can run code, and this is Windows.
  offers(fileName) { return this.enabled() && this.SCANNABLE.test(String(fileName || '')) && /Win/i.test((typeof navigator !== 'undefined' && navigator.platform) || ''); },

  async open(filePath) {
    if (!window.vex || typeof window.vex.downloadsOpenDefender !== 'function') throw new Error('Windows Security cannot be opened from this window');
    const r = await window.vex.downloadsOpenDefender(filePath);
    if (!r || !r.ok) throw new Error((r && r.error) || 'Windows Security could not be opened');
    window.showToast?.(r.revealed
      ? 'Windows Security is open. To scan this file, right-click it in the folder that just opened and choose Scan with Microsoft Defender.'
      : 'Windows Security is open on Virus & threat protection.', 'info', 9000);
    return r;
  },
};

const VexMotwCheck = {
  KEY: 'vex.motwCheck',             // 'off' turns it off
  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? 'on' : 'off'); return !!on; },

  // → { supported, checked, marked, gone, missing: [names], missingCount }
  async check() {
    if (!window.vex || typeof window.vex.downloadsMotwCheck !== 'function') throw new Error('The check is not available in this window');
    const r = await window.vex.downloadsMotwCheck();
    if (!r || !r.ok) throw new Error((r && r.error) || 'The downloads could not be checked');
    return r;
  },

  summary(r) {
    if (!r.supported) return 'Windows keeps this mark, so there is nothing to check on this system.';
    if (!r.checked) return 'None of the files Vex downloaded are still on disk to check.';
    if (!r.missingCount) return 'All ' + r.checked + ' file' + (r.checked === 1 ? '' : 's') + ' Vex downloaded still carry the "downloaded from the internet" mark.';
    return r.missingCount + ' of ' + r.checked + ' file' + (r.checked === 1 ? '' : 's') + ' no longer carry the mark, so Windows will not treat them as downloaded:\n\n'
      + r.missing.join('\n') + (r.missingCount > r.missing.length ? '\n…and ' + (r.missingCount - r.missing.length) + ' more' : '')
      + '\n\nThis can happen when another program copied them. Vex does not change them; treat them as you would any download.';
  },

  async show() {
    const r = await this.check();
    await window.vexConfirm({ title: 'Marks on your downloads', message: this.summary(r), okLabel: 'Close', cancelLabel: '' });
    return r;
  },
};

if (typeof window !== 'undefined') { window.VexDefenderShortcut = VexDefenderShortcut; window.VexMotwCheck = VexMotwCheck; }
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDefenderShortcut, VexMotwCheck };
