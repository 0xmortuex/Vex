// The documents Vex ships with (PRIVACY.md, TERMS.md, LICENSE, the
// third-party notices), read from the app folder so the agreement at first
// start (js/legal.js) and Settings › About show them inside Vex, without the
// internet. They are listed in package.json build.files, next to main.js's
// parent folder in the packaged app as in the source tree.
const fs = require('fs');
const path = require('path');

const LEGAL_DOCS = ['PRIVACY.md', 'TERMS.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];

function readLegalDoc(root, name) {
  if (!LEGAL_DOCS.includes(name)) throw new Error('Not a document Vex ships: ' + name);
  return fs.readFileSync(path.join(root, name), 'utf8');
}

// Policy: Vex's own windows only (ipc-policy.js, UI_ONLY_CHANNELS).
// app:quit is the agreement's "Quit Vex": the windows close the way their X
// closes them, which saves first.
function registerLegalDocs({ ipcMain, app, root }) {
  ipcMain.handle('legal:read', (_e, name) => readLegalDoc(root, name));
  ipcMain.handle('app:quit', () => { app.quit(); return { ok: true }; });
}

module.exports = { LEGAL_DOCS, readLegalDoc, registerLegalDocs };
