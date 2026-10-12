// Which Vex windows have the agreement up (renderer/js/legal.js: the setup's
// "Before you start" step, or the "privacy policy and terms have changed"
// dialog). While one has, the keys main acts on for that window do nothing:
// its own (Ctrl+T, Ctrl+K, zoom, F11...), the keys its pages pass up, DevTools
// and the boss key. Ctrl+T opened a tab behind the agreement (release check,
// 2026-10-12). The window says when it comes and goes (legal:gate); the
// window's own keys are held back there as well.
'use strict';

function createAgreementGate() {
  const up = new Set();        // webContents ids of the windows showing it
  const watched = new Set();   // ids whose 'destroyed' is listened for
  return {
    set(contents, on) {
      if (typeof on !== 'boolean') throw new Error('legal:gate takes true or false');
      const id = contents.id;
      if (!on) { up.delete(id); return; }
      up.add(id);
      // A closed window's id can be given to another one later.
      if (watched.has(id)) return;
      watched.add(id);
      contents.once('destroyed', () => { up.delete(id); watched.delete(id); });
    },
    blocks(win) {
      return !!(win && !win.isDestroyed() && up.has(win.webContents.id));
    },
  };
}

module.exports = { createAgreementGate };
