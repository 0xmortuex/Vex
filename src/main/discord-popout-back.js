'use strict';

// A "Back to Discord" button for Discord's own Pop Out window (a stream or a
// friend's screen share). That window is a plain Discord page in its own
// window, so it had no way back: closing it left you wherever you were.
// The button sits in the window's corner, in a closed shadow root so Discord's
// styles and scripts cannot reach it. A click writes MARK to the console,
// which main hears (console-message) and turns into: Vex forward, Discord
// shown (panel or tab), pop-out closed (Discord puts the stream back itself).

const MARK = '__vex_discord_popout_back__';

// Runs inside the pop-out page. Safe to run twice: the button exists once.
function buttonScript(label) {
  const text = JSON.stringify(String(label || 'Back to Discord'));
  const mark = JSON.stringify(MARK);
  return '(function(){'
    + 'if(document.getElementById("vex-popout-back"))return;'
    + 'var host=document.createElement("div");host.id="vex-popout-back";'
    + 'host.style.cssText="position:fixed;left:10px;bottom:10px;z-index:2147483647;";'
    + 'var root=host.attachShadow({mode:"closed"});'
    + 'var b=document.createElement("button");b.type="button";b.textContent=' + text + ';'
    + 'b.setAttribute("aria-label",' + text + ');'
    + 'b.style.cssText="font:600 13px system-ui,Segoe UI,sans-serif;color:#fff;background:rgba(20,22,28,.82);'
    + 'border:1px solid rgba(255,255,255,.28);border-radius:999px;padding:7px 14px;cursor:pointer;'
    + 'backdrop-filter:blur(8px);box-shadow:0 2px 10px rgba(0,0,0,.4);opacity:.88;";'
    + 'b.addEventListener("mouseenter",function(){b.style.opacity="1";});'
    + 'b.addEventListener("mouseleave",function(){b.style.opacity=".88";});'
    + 'b.addEventListener("focus",function(){b.style.outline="2px solid #fff";b.style.outlineOffset="2px";});'
    + 'b.addEventListener("blur",function(){b.style.outline="none";});'
    + 'b.addEventListener("click",function(){console.debug(' + mark + ');});'
    + 'root.appendChild(b);(document.body||document.documentElement).appendChild(host);'
    + '})()';
}

// The text of a console-message event: Electron passes either an event with
// .message or the older (event, level, message) arguments.
function messageOf(e, legacyMessage) {
  if (e && typeof e.message === 'string') return e.message;
  return typeof legacyMessage === 'string' ? legacyMessage : '';
}

function isBackMessage(text) { return text === MARK; }

// `win` is the pop-out BrowserWindow. `label()` returns the button text (the
// person's language); `onBack()` does the going back. Errors are logged, not
// swallowed: a button that is missing must show up in the log.
function attach(win, { label, onBack }) {
  const wc = win.webContents;
  const inject = async () => {
    try {
      if (wc.isDestroyed()) return;
      const text = await label();
      if (wc.isDestroyed()) return;
      await wc.executeJavaScript(buttonScript(text));
    } catch (err) { console.error('[discord-popout] could not add the Back to Discord button:', err && err.message); }
  };
  wc.on('did-finish-load', inject);
  wc.on('did-navigate-in-page', inject);
  wc.on('console-message', (e, level, message) => {
    if (!isBackMessage(messageOf(e, message))) return;
    try { onBack(); } catch (err) { console.error('[discord-popout] Back to Discord failed:', err && err.message); }
  });
}

module.exports = { MARK, buttonScript, messageOf, isBackMessage, attach };
