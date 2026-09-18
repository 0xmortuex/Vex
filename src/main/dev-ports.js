// === What is running on this machine =======================================
//
// A dev server is started in a terminal and then hunted for: which port was it,
// is it still up, did the other one die? The browser is where you go to look,
// and it is the one thing that cannot tell you.
//
// This knocks on the usual ports and reports which answer. It is a local TCP
// connect and nothing more: no request is sent, nothing is read, and nothing
// leaves the machine — so it cannot disturb whatever is listening.
const COMMON = [
  3000, 3001, 3002, 3003, 4000, 4200, 4321, 5000, 5001, 5173, 5174, 5273,
  6006, 7000, 7777, 8000, 8001, 8008, 8080, 8081, 8085, 8088, 8090, 8787,
  8888, 9000, 9090, 9200, 11434, 1420, 1313, 2368, 4321,
];

// A port that is listening, and what most likely put it there. The guess is
// labelled as a guess: a wrong name is worse than no name.
const KNOWN = {
  3000: 'Next.js, Create React App or Express',
  3001: 'a second Node server',
  4200: 'Angular',
  4321: 'Astro',
  5173: 'Vite',
  5174: 'Vite (second)',
  6006: 'Storybook',
  8000: 'Django, Python http.server or Laravel',
  8080: 'a Java, Go or webpack server',
  8787: 'a Cloudflare Worker (wrangler dev)',
  8888: 'Jupyter',
  9090: 'Prometheus',
  11434: 'Ollama',
  1313: 'Hugo',
  1420: 'Tauri',
  2368: 'Ghost',
};

function createPortScanner({ net, timeoutMs = 250, ports = COMMON }) {
  function knock(port) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const done = (open) => { if (settled) return; settled = true; try { socket.destroy(); } catch {} resolve(open); };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
      try { socket.connect(port, '127.0.0.1'); } catch { done(false); }
    });
  }

  // → [{ port, url, guess }] for whatever answered, lowest port first.
  async function scan() {
    const list = [...new Set(ports)].sort((a, b) => a - b);
    const open = await Promise.all(list.map(async (port) => ((await knock(port)) ? port : null)));
    return open.filter(p => p != null).map(port => ({
      port,
      url: 'http://localhost:' + port + '/',
      guess: KNOWN[port] || '',
    }));
  }

  return { scan, knock, ports: [...COMMON], KNOWN };
}

module.exports = { createPortScanner, COMMON, KNOWN };
