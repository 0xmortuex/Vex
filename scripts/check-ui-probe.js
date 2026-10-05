// Preloaded into the Vex main process by scripts/check-ui.js (`electron -r`),
// before src/main.js runs. It keeps the measured window rendering at full speed
// while other windows cover it.
//
// Why: Chromium on Windows works out when a window is fully covered
// ("native window occlusion") and then stops drawing it and throttles its
// renderer. A check run behind an editor stalled for 7 to 30+ minutes, because
// every requestAnimationFrame it waits on simply never fired.
//
// --disable-features is a single list: Chromium keeps only the last occurrence,
// and src/main.js sets its own. So the call is wrapped, and whatever main.js
// asks to disable gets CalculateNativeWinOcclusion added to it, rather than one
// list replacing the other.
'use strict';

const { app } = require('electron');

const EXTRA_DISABLED = ['CalculateNativeWinOcclusion'];

const cl = app.commandLine;
const original = cl.appendSwitch.bind(cl);

function merged(value) {
  const have = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const f of EXTRA_DISABLED) if (!have.includes(f)) have.push(f);
  return have.join(',');
}

cl.appendSwitch = function appendSwitch(name, value) {
  if (name === 'disable-features') {
    const list = merged(value);
    // check-ui.js reads this line to know the probe really ran. Straight to
    // stdout: src/diagnostics.js (main.js's first line) quiets console.log.
    process.stdout.write('[check-ui-probe] disable-features=' + list + '\n');
    return original(name, list);
  }
  return value === undefined ? original(name) : original(name, value);
};

// In case main.js ever stops setting the list itself.
cl.appendSwitch('disable-features', cl.getSwitchValue('disable-features'));
original('disable-backgrounding-occluded-windows');
original('disable-renderer-backgrounding');
