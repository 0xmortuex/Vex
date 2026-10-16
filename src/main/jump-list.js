// === Windows jump list and taskbar actions (T3-085) =============================
//
// Right-click Vex on the taskbar (or its Start menu entry) and the list shows,
// besides "Start in safe mode", four things to do without opening Vex first:
// a new note, a new workspace, reopen the last closed tab, and quick capture.
//
// Each is a "task": Windows starts Vex with an argument (--vex-jump=<action>), and
// a Vex that is already running hears it as a second start (main.js,
// second-instance) and acts on it. app.setUserTasks is the only thing used: it
// writes the jump list through the shell's own API and nothing to the registry.
//
// What an argument can ask for is this table and nothing else, so a launch
// command written by anyone else can only ever do one of these four things, none
// of which takes a parameter.

const ARG = '--vex-jump=';

const ACTIONS = {
  'new-note':      { title: 'New note', description: 'Open Notes with a new, empty note' },
  'new-workspace': { title: 'New workspace', description: 'Make a new workspace' },
  'reopen-last':   { title: 'Reopen last closed tab', description: 'Bring back the tab you closed last' },
  'quick-capture': { title: 'Quick capture', description: 'A small box for a note, a reminder or a timer' },
};

// → the action named by an argument list, or null. Exact match only.
function actionFromArgv(argv) {
  for (const a of Array.isArray(argv) ? argv : []) {
    if (typeof a !== 'string' || !a.startsWith(ARG)) continue;
    const name = a.slice(ARG.length);
    if (Object.prototype.hasOwnProperty.call(ACTIONS, name)) return name;
  }
  return null;
}

// A command-line argument as Windows reads it: quoted when it has a space in it.
function quote(arg) {
  const s = String(arg);
  return /[\s"]/.test(s) ? '"' + s.replace(/"/g, '\\"') + '"' : s;
}

// The task list for app.setUserTasks. `extraArgs` carry the profile the running Vex
// is on, so an entry wakes the same profile; `keep` are tasks that were there before
// (the safe-mode entry) and are always kept.
function buildTasks({ execPath, extraArgs = [], enabled, keep = [] }) {
  if (!execPath) throw new Error('The program to start is needed');
  const tasks = [];
  if (enabled) {
    for (const [name, a] of Object.entries(ACTIONS)) {
      tasks.push({
        program: execPath,
        arguments: [...extraArgs, ARG + name].map(quote).join(' '),
        iconPath: execPath, iconIndex: 0,
        title: a.title, description: a.description,
      });
    }
  }
  return tasks.concat(keep);
}

module.exports = { ACTIONS, ARG, actionFromArgv, buildTasks };
