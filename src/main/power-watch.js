// === Is this PC running on its battery? =====================================
//
// Electron's powerMonitor says when Windows switches between mains and battery
// ('on-battery' / 'on-ac') and answers isOnBatteryPower(). It says nothing
// else: no charge level, no "this PC has no battery", and no Windows Battery
// Saver flag. So:
//
//   on battery / on mains   powerMonitor, no polling, no process.
//   has a battery, charge   ONE read of Win32_Battery (Windows' own WMI class),
//                           the first time somebody asks, then cached. A
//                           desktop has no Win32_Battery row, which is how
//                           "no battery here" is known rather than guessed.
//   charge afterwards       the renderer follows navigator.getBattery()
//                           level events (Chromium's own, no process).
//   Battery Saver           NOT exposed by Electron; not read, and not
//                           pretended about.
//
// The module only reports. What Vex does about being on battery is decided in
// the interface (js/battery-mode.js), because the opt-in lives there.

const PROBE_SCRIPT = '$b=@(Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop); '
  + 'if ($b.Count -eq 0) { "none" } else { $c=$b[0].EstimatedChargeRemaining; $s=$b[0].BatteryStatus; '
  + '"battery " + $(if ($null -eq $c) { -1 } else { $c }) + " " + $(if ($null -eq $s) { -1 } else { $s }) }';

// -> Promise<{ hasBattery: boolean, percent: number|null, charging: boolean|null }>; rejects when Windows would not say.
function probeBattery({ execFile = require('child_process').execFile } = {}) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PROBE_SCRIPT], { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      if (err) { reject(new Error('Windows did not say whether this PC has a battery: ' + err.message)); return; }
      resolve(parseProbe(stdout));
    });
  });
}

function parseProbe(stdout) {
  const text = String(stdout || '').trim();
  if (text === 'none') return { hasBattery: false, percent: null, charging: null };
  const m = /^battery\s+(-?\d+)\s+(-?\d+)$/.exec(text);
  if (!m) throw new Error('Windows gave an answer about the battery that Vex cannot read: ' + JSON.stringify(text.slice(0, 80)));
  const pct = Number(m[1]);
  const percent = pct < 0 ? null : Math.min(100, pct);
  // BatteryStatus 1 = discharging; 2 = on AC; 6-9 = charging. -1 = not said.
  const status = Number(m[2]);
  return { hasBattery: true, percent, charging: status < 0 ? null : status !== 1 };
}

// deps: powerMonitor (EventEmitter with isOnBatteryPower), send(channel, payload), probe() -> Promise
function createPowerWatch(deps) {
  const { powerMonitor, send } = deps;
  const probe = deps.probe || (() => probeBattery());
  if (!powerMonitor || typeof powerMonitor.isOnBatteryPower !== 'function' || typeof powerMonitor.on !== 'function') {
    throw new TypeError('createPowerWatch: powerMonitor with isOnBatteryPower and on is required');
  }
  if (typeof send !== 'function') throw new TypeError('createPowerWatch: send is required');
  let started = false;
  let lean = false;
  let probed = null;                       // the one WMI read, kept

  const onBattery = () => send('power:state', { onBattery: true });
  const onAc = () => send('power:state', { onBattery: false });

  return {
    start() {
      if (started) return;
      started = true;
      powerMonitor.on('on-battery', onBattery);
      powerMonitor.on('on-ac', onAc);
    },
    stop() {
      if (!started) return;
      started = false;
      powerMonitor.removeListener('on-battery', onBattery);
      powerMonitor.removeListener('on-ac', onAc);
    },
    listening() { return started; },
    async status() {
      if (!probed) probed = Promise.resolve().then(probe).catch(err => { probed = null; throw err; });
      const p = await probed;
      return { onBattery: !!powerMonitor.isOnBatteryPower(), hasBattery: p.hasBattery, percent: p.percent, charging: p.charging };
    },
    // The interface says whether it is saving power right now, so the
    // extension updater and other main-process schedules can wait too.
    setLean(on) { lean = !!on; return lean; },
    lean() { return lean; },
  };
}

module.exports = { createPowerWatch, probeBattery, parseProbe };
