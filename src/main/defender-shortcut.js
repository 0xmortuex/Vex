// === "Scan with Windows Security": a door to the scan page, nothing more (T3-110) ====
//
// Opens Windows Security's own "Virus & threat protection" page through its
// protocol handler, so the person can scan the file there (right-click the file in
// Explorer, or "Scan options" > "Custom scan"). That is all this does:
//
//   - one fixed address, never built from anything a page or the interface sends;
//   - no process is started (no MpCmdRun.exe, no PowerShell), no scan is begun or
//     controlled, nothing is read from Defender, no result is reported;
//   - if the file is one Vex downloaded, its folder is shown in Explorer with the
//     file selected, which is where the right-click "Scan with Microsoft Defender"
//     lives. Any other path is ignored.
//
// Windows only: on another system it says so instead of doing something else.
const DEFENDER_URI = 'windowsdefender://threat/';

function createDefenderShortcut({ shell, platform = process.platform, isDownloadedFile }) {
  if (!shell || typeof shell.openExternal !== 'function') throw new Error('The Defender shortcut needs the shell');
  return {
    URI: DEFENDER_URI,
    async open(filePath) {
      if (platform !== 'win32') throw new Error('Windows Security is part of Windows; there is nothing to open on this system');
      await shell.openExternal(DEFENDER_URI);
      let revealed = false;
      if (typeof filePath === 'string' && filePath && typeof isDownloadedFile === 'function' && isDownloadedFile(filePath)) {
        shell.showItemInFolder(filePath);
        revealed = true;
      }
      return { revealed };
    },
  };
}

module.exports = { createDefenderShortcut, DEFENDER_URI };
