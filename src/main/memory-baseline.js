// === A memory ceiling that means something on THIS machine =================
//
// Vex sleeps idle tabs when it goes over a ceiling, and the ceiling was a
// fixed 1200 MB for everyone. On a 32 GB machine that is Vex tidying itself
// away for no reason; on an 8 GB one shared with a game it is far too late.
//
// So the ceiling is worked out from the machine: a share of what it has, held
// inside sensible bounds, and pulled down when memory is already tight right
// now. It is a suggestion the user can accept or ignore — nothing is changed
// without being told what changed and why.
const MB = 1024 * 1024;

const SHARE = 0.12;          // of total memory, when there is room
const MIN_MB = 600;          // below this, Vex is sleeping tabs constantly
const MAX_MB = 4000;         // above this, the ceiling stops meaning anything
const TIGHT = 0.25;          // free memory below this share is "already tight"

const round100 = (n) => Math.round(n / 100) * 100;

// → { ceilingMB, why } given what the machine has.
function suggest({ totalMB, freeMB }) {
  const total = Math.max(0, Number(totalMB) || 0);
  const free = Math.max(0, Number(freeMB) || 0);
  if (!total) return { ceilingMB: 1200, why: 'this machine did not say how much memory it has, so the ordinary 1200 MB stands' };

  const share = round100(total * SHARE);
  let ceiling = Math.min(MAX_MB, Math.max(MIN_MB, share));
  const gb = Math.round(total / 1024);

  // Already short of memory: a ceiling worked out from the total would let Vex
  // take what is not there.
  const tight = total > 0 && free / total < TIGHT;
  if (tight) {
    ceiling = Math.min(ceiling, Math.max(MIN_MB, round100(free * 0.5)));
    return {
      ceilingMB: ceiling,
      why: 'this machine has ' + gb + ' GB and only ' + Math.round(free / 1024 * 10) / 10 + ' GB of it free right now, so the ceiling is set from what is actually spare',
    };
  }
  if (share > MAX_MB) return { ceilingMB: ceiling, why: 'this machine has ' + gb + ' GB, and past ' + MAX_MB + ' MB a ceiling stops doing anything useful' };
  if (share < MIN_MB) return { ceilingMB: ceiling, why: 'this machine has ' + gb + ' GB, so the ceiling is held at the lowest that is still workable' };
  return { ceilingMB: ceiling, why: 'about a tenth of this machine’s ' + gb + ' GB, which leaves the rest for everything else' };
}

// The reading itself, injected so this is testable without a machine.
function read(os) {
  return { totalMB: Math.round(os.totalmem() / MB), freeMB: Math.round(os.freemem() / MB) };
}

module.exports = { suggest, read, SHARE, MIN_MB, MAX_MB, TIGHT };
