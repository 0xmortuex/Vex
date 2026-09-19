// Ctrl+Alt+D pressed while a web page has the focus. Dictation types into web
// pages, so the page has the focus while you use it; main.js passes this one
// key up to Vex from the guest's before-input-event. Exactly Ctrl+Alt+D — not
// Ctrl+Shift+Alt+D, not Ctrl+D (bookmark), not a key release.
function isDictateKey(input) {
  if (!input || input.type !== 'keyDown') return false;
  if (!(input.control || input.meta) || !input.alt || input.shift) return false;
  return String(input.key || '').toLowerCase() === 'd';
}

module.exports = { isDictateKey };
