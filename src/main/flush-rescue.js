'use strict';
// === The "cannot quit" dead end: saving failed while Vex was closing ===========
//
// When the window cannot save its data at close (a full disk, a locked or failing drive), Vex used to show a toast
// and stay open: allowClose stayed false, so the only way out was to kill it. Now the owner is asked, in a dialog
// drawn by the main process (it works even when the page is stuck):
//   Save an emergency copy to Documents and quit  -> a normal Vex backup file (the same one Settings > Backup
//                                                    makes, restorable from there) is written to Documents, then Vex closes
//   Quit without saving                           -> closes now; what was not saved is lost
//   Try again                                     -> the close is attempted again
// If the emergency copy cannot be written either, that is said and the owner is asked again: they are never stuck,
// and nothing is closed on a failed copy without their saying "Quit without saving".
//
// Everything with a side effect is injected, so the tests simulate the disk errors and never touch a real disk.
const path = require('path');

const BTN_SAVE = 'Save an emergency copy to Documents and quit';
const BTN_QUIT = 'Quit without saving';
const BTN_RETRY = 'Try again';

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// dialog: Electron's. win: the window that is closing. snapshot(): Promise<string> the backup text.
// documentsDir(): the Documents folder. writeNewFile(file, text): writes a NEW file (throws on any failure).
// closeNow(): lets the window close for good. retryClose(): asks the window to save and close again.
async function offerFlushRescue({ dialog, win, reason = '', snapshot, documentsDir, writeNewFile, closeNow, retryClose, now = () => new Date(), log = console }) {
  const parent = win && !win.isDestroyed() ? win : undefined;
  let detail = 'The disk may be full or not writable, so your latest changes were not saved. You can keep an emergency copy of your settings in Documents (Settings > Backup can restore it), quit anyway, or try again after freeing some space.';
  for (;;) {
    const { response } = await dialog.showMessageBox(parent, {
      type: 'warning', title: 'Vex could not save', message: 'Vex could not save your changes.',
      detail, buttons: [BTN_SAVE, BTN_QUIT, BTN_RETRY], defaultId: 2, cancelId: 2, noLink: true,
    });
    if (response === 1) { log.warn('[FlushRescue] the owner chose to quit without saving' + (reason ? ' (' + reason + ')' : '')); closeNow(); return { action: 'quit' }; }
    if (response === 2) { retryClose(); return { action: 'retry' }; }
    try {
      const text = await snapshot();
      if (typeof text !== 'string' || !text) throw new Error('The copy was empty');
      const file = path.join(documentsDir(), `Vex-emergency-copy-${stamp(now())}.json`);
      writeNewFile(file, text);
      log.warn('[FlushRescue] emergency copy written to ' + file);
      closeNow();
      return { action: 'saved', file };
    } catch (err) {
      log.error('[FlushRescue] the emergency copy could not be written:', err.message);
      detail = 'The emergency copy could not be saved: ' + err.message + '. Free some space and try again, or quit without saving.';
    }
  }
}

module.exports = { offerFlushRescue, BTN_SAVE, BTN_QUIT, BTN_RETRY };
