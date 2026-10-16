// Preloaded into Vex's MAIN process by the smoke matrix (`electron -r`), before
// src/main.js runs. It makes a probe that opens every feature unable to do the
// things that reach outside the throwaway profile or block on a person:
//
//   * native dialogs (open/save/message boxes) answer "cancelled" at once
//     instead of waiting for a click nobody will make;
//   * shell.openExternal / openPath / showItemInFolder only record the call;
//   * default-browser and start-with-Windows registration only record the call.
//
// Every stubbed call is appended to the list the matrix reads back from
// globalThis.__vexProbeStubbed (the matrix prints it so the stubs are visible).
// Nothing here sends keys or mouse input to the OS.
'use strict';

const electron = require('electron');

const calls = [];
globalThis.__vexProbeStubbed = calls;
const note = (name, args) => { calls.push({ name, args: args.map(a => (typeof a === 'string' ? a.slice(0, 120) : typeof a)), at: Date.now() }); };

const { dialog, shell, app } = electron;

dialog.showOpenDialog = async (...a) => { note('dialog.showOpenDialog', a); return { canceled: true, filePaths: [] }; };
dialog.showOpenDialogSync = (...a) => { note('dialog.showOpenDialogSync', a); return undefined; };
dialog.showSaveDialog = async (...a) => { note('dialog.showSaveDialog', a); return { canceled: true, filePath: undefined }; };
dialog.showSaveDialogSync = (...a) => { note('dialog.showSaveDialogSync', a); return undefined; };
dialog.showMessageBox = async (...a) => { note('dialog.showMessageBox', a); return { response: 0, checkboxChecked: false }; };
dialog.showMessageBoxSync = (...a) => { note('dialog.showMessageBoxSync', a); return 0; };
dialog.showErrorBox = (...a) => { note('dialog.showErrorBox', a); };

shell.openExternal = async (...a) => { note('shell.openExternal', a); };
shell.openPath = async (...a) => { note('shell.openPath', a); return ''; };
shell.showItemInFolder = (...a) => { note('shell.showItemInFolder', a); };

app.setAsDefaultProtocolClient = (...a) => { note('app.setAsDefaultProtocolClient', a); return true; };
app.removeAsDefaultProtocolClient = (...a) => { note('app.removeAsDefaultProtocolClient', a); return true; };
app.setLoginItemSettings = (...a) => { note('app.setLoginItemSettings', a); };

process.stdout.write('[probe-main-hook] native dialogs, shell and default-app registration are stubbed\n');
