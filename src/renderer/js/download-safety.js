// === Download safety shortcuts: "Scan with Windows Security" and the internet-mark check =====
//
// T3-110  VexDefenderShortcut
//   A shield button on a finished download that can run code (a program, a script, an installer or
//   an archive). It opens Windows Security's "Virus & threat protection" page and shows the file in
//   its folder, where right-click > "Scan with Microsoft Defender" is. By itself Vex starts no scan, runs no
//   program and reads nothing back (src/main/defender-shortcut.js: one fixed address). Wave 6 adds an
//   opt-in "Scan now" (off by default; src/main/defender-scan.js) that runs Defender's own MpCmdRun.exe on one
//   file after a confirm raised in main, with the result shown as text.
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

  // ---- "Scan now" (Wave 6): Defender's own command-line scanner on one file, after a confirm main raises ----
  // OFF until switched on in Settings. The window names no program and no argument: a download's path (main honours it only
  // for a file Vex downloaded) or "pick" (main opens the file dialog). src/main/defender-scan.js has the whole contract.
  SCAN_KEY: 'vex.defenderScan',     // 'on' turns it on
  scanEnabled() { try { return localStorage.getItem(this.SCAN_KEY) === 'on'; } catch { return false; } },
  setScanEnabled(on) { localStorage.setItem(this.SCAN_KEY, on ? 'on' : 'off'); return !!on; },
  offersScan(fileName) { return this.scanEnabled() && this.offers(fileName); },
  // The result as plain words for the box that shows it.
  describeScan(r) {
    const head = r.threat ? 'Defender reports a problem with ' + r.file + '.' : r.clean ? 'Defender found no threat in ' + r.file + '.' : 'The scan of ' + r.file + ' ended with code ' + r.exitCode + '.';
    return head + (r.text ? '\n\n' + r.text : '');
  },
  async scan(source, filePath) {
    if (!this.scanEnabled()) throw new Error('Scanning with Defender is switched off: Settings, Safer browsing helpers');
    if (!window.vex || typeof window.vex.downloadsDefenderScan !== 'function') throw new Error('Defender cannot be run from this window');
    const r = await window.vex.downloadsDefenderScan(source === 'pick' ? { source: 'pick' } : { source: 'download', path: filePath });
    if (r && r.canceled) return r;
    if (!r || !r.ok) throw new Error((r && r.error) || 'The scan could not be run');
    if (typeof VexLedger !== 'undefined') VexLedger.note({ feature: 'defender-shortcut', what: 'Scanned ' + r.file + ' with Microsoft Defender: ' + (r.threat ? 'problem reported' : r.clean ? 'no threat found' : 'code ' + r.exitCode), why: 'You pressed Scan' });
    if (typeof window.vexConfirm === 'function') await window.vexConfirm({ title: 'Microsoft Defender scan', message: this.describeScan(r), okLabel: 'Close', cancelLabel: '' });
    return r;
  },

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
