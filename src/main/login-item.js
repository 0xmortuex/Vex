// === Start Vex when you sign in to Windows ================================
//
// The truth is the operating system's Run entry (app.getLoginItemSettings),
// not a copy of it in Vex's own settings: what Settings shows is read back
// from Windows every time, so it cannot drift from what will really happen
// (the entry removed from Task Manager > Startup shows as off here too).
//
// "Start minimised" lives in the entry itself, as one more argument on the
// command line it launches (--vex-start-minimised). There is no second place
// to keep in step. A launch from the entry always carries --vex-login-start,
// which is how a second copy started that way (Vex already running) is told
// from a person starting it: that one does nothing, rather than bringing the
// window forward.
//
// Only the installed app: an unpackaged run would register electron.exe with
// this project's path as a startup program. Settings says so instead.
//
// VEX_LOGIN_ITEM_STUB=1 keeps the state in memory and never touches the
// system — for tests and for driving the real window without changing the
// owner's startup programs.

const LOGIN_ARG = '--vex-login-start';
const MINIMISED_ARG = '--vex-start-minimised';

// One entry per profile, so two profiles can both start with Windows.
function entryName(profileId) {
  if (!profileId || profileId === 'default') return 'Vex';
  if (!/^p-[a-z0-9]{8}$/.test(String(profileId))) throw new Error('Profile id is not safe for a startup entry');
  return 'Vex ' + profileId;
}

function entryArgs(profileId, startMinimised) {
  const args = [LOGIN_ARG];
  if (profileId && profileId !== 'default') args.push('--profile=' + profileId);
  if (startMinimised) args.push(MINIMISED_ARG);
  return args;
}

function createLoginItem({ app, platform = process.platform, packaged, stub = false, profileId = 'default', execPath = process.execPath }) {
  const memory = { openAtLogin: false, startMinimised: false };
  const name = entryName(profileId);

  function support() {
    if (stub) return { supported: true, reason: '' };
    if (platform !== 'win32') return { supported: false, reason: 'Starting with the computer is set up for Windows only.' };
    if (!packaged) return { supported: false, reason: 'This copy of Vex is running from its source folder, not the installed app, so it will not register itself to start with Windows.' };
    return { supported: true, reason: '' };
  }

  function query(startMinimised) {
    const s = app.getLoginItemSettings({ path: execPath, args: entryArgs(profileId, startMinimised), name });
    return !!(s && (s.executableWillLaunchAtLogin !== undefined ? s.executableWillLaunchAtLogin : s.openAtLogin));
  }

  function read() {
    const sup = support();
    if (!sup.supported) return { ok: true, supported: false, reason: sup.reason, openAtLogin: false, startMinimised: false, stub: false };
    if (stub) return { ok: true, supported: true, reason: '', ...memory, stub: true };
    const hidden = query(true);
    const shown = !hidden && query(false);
    return { ok: true, supported: true, reason: '', openAtLogin: hidden || shown, startMinimised: hidden, stub: false };
  }

  function write(openAtLogin, startMinimised) {
    const sup = support();
    if (!sup.supported) throw new Error(sup.reason);
    if (typeof openAtLogin !== 'boolean' || typeof startMinimised !== 'boolean') throw new Error('Starting with Windows needs two on/off values');
    if (stub) {
      memory.openAtLogin = openAtLogin;
      memory.startMinimised = openAtLogin && startMinimised;
      return read();
    }
    app.setLoginItemSettings({ openAtLogin, path: execPath, args: entryArgs(profileId, startMinimised), name });
    // Read back: what Windows now holds is the answer, and a refused write (a
    // policy, a security product) must show as off, not as a lie.
    const now = read();
    if (now.openAtLogin !== openAtLogin) throw new Error(openAtLogin
      ? 'Windows did not accept the startup entry (a policy or a security program may be blocking it).'
      : 'Windows still has Vex in its startup list. Remove it in Task Manager > Startup apps.');
    return now;
  }

  return { read, write, support, entryName: name };
}

// Whether this launch is the startup entry's, and whether it asked for the
// window to stay out of the way.
const isLoginLaunch = (argv) => (argv || []).includes(LOGIN_ARG);
const wantsMinimised = (argv) => isLoginLaunch(argv) && (argv || []).includes(MINIMISED_ARG);

module.exports = { createLoginItem, isLoginLaunch, wantsMinimised, entryName, entryArgs, LOGIN_ARG, MINIMISED_ARG };
