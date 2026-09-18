// === Is there room on the graphics card? ===================================
//
// A local model lives in video memory. When a game has the card — measured
// here on an 8 GB RTX 4060 with a game and OBS running: 7.7 GB of 8 GB used,
// 92% busy — the model is pushed out and Ollama falls back to the processor.
// The same agent task that took 30 seconds then ran past the two-minute limit
// and came back with nothing, twice, and there was no way to tell that from
// "the AI is broken".
//
// So Vex asks the card. nvidia-smi ships with every NVIDIA driver, needs no
// permissions and answers in milliseconds; anything else returns null and Vex
// simply says nothing about it.
const CACHE_MS = 4000;

function parse(text) {
  // "NVIDIA GeForce RTX 4060, 92, 7708, 8188"
  const line = String(text || '').trim().split(/\r?\n/)[0] || '';
  const parts = line.split(',').map(s => s.trim());
  if (parts.length < 4) return null;
  const [name, util, used, total] = parts;
  // '[N/A]' is what the driver reports for a figure it does not have. It must
  // come back as null, not as zero, or a card with no reading looks empty.
  const n = (v) => { const digits = String(v).replace(/[^\d.]/g, ''); if (!digits) return null; const x = Number(digits); return Number.isFinite(x) ? x : null; };
  const usedMB = n(used), totalMB = n(total);
  if (!totalMB) return null;
  return {
    name: name || 'GPU',
    utilization: n(util),
    usedMB, totalMB,
    freeMB: Math.max(0, totalMB - (usedMB || 0)),
    usedPercent: Math.round((usedMB || 0) / totalMB * 100),
  };
}

function createGpuProbe({ execFile, platform = process.platform, now = () => Date.now(), timeoutMs = 2500 }) {
  let cached, cachedAt = 0, inFlight = null;     // cachedAt 0 = never asked

  function ask() {
    return new Promise((resolve) => {
      // -q for a single sample; no formatting, so parsing stays trivial.
      execFile('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
        { timeout: timeoutMs, windowsHide: true },
        (err, stdout) => resolve(err ? null : parse(stdout)));
    });
  }

  // → { name, utilization, usedMB, totalMB, freeMB, usedPercent } or null when
  // there is no NVIDIA card, no driver, or the tool is not on PATH.
  async function read() {
    if (cachedAt && now() - cachedAt < CACHE_MS) return cached;
    if (inFlight) return inFlight;
    inFlight = ask().then(r => { cached = r; cachedAt = now(); inFlight = null; return r; });
    return inFlight;
  }

  return { read, parse };
}

// Can a model of `needMB` reasonably run on the card right now? `null` for
// "no idea", which callers treat as "carry on" — never as a refusal.
function roomFor(gpu, needMB) {
  if (!gpu || !gpu.totalMB) return null;
  if (!needMB) return gpu.freeMB > 1024;
  return gpu.freeMB >= needMB;
}

module.exports = { createGpuProbe, parse, roomFor, CACHE_MS };
