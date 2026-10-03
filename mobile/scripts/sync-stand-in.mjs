// A Vex Sync worker on this machine, for trying sync without touching the
// real one: the shipping worker code (workers/vex-sync-worker/worker.js,
// syncHandler) over in-memory storage, in development mode — a sign-in code
// comes back in the response (`devCode`) instead of by email.
//
//   EMAIL_HASH_SECRET=<32+ characters> node scripts/sync-stand-in.mjs [port]
//
// Then set the Sync Worker URL to http://127.0.0.1:<port> (default 8787). The
// phone build serves its chrome over https://localhost, which may not call a
// plain-http worker (mixed content): on a phone, put an https tunnel in front
// of this (e.g. `cloudflared tunnel --url http://127.0.0.1:8787`) or use
// `wrangler dev`. The desktop app and `npm run dev` can use it directly.
//
// Storage lives as long as the process; nothing is written to disk.
import http from 'node:http';
import { syncHandler } from '../../workers/vex-sync-worker/worker.js';

const port = Number(process.argv[2]) || 8787;
const secret = process.env.EMAIL_HASH_SECRET || '';
if (secret.length < 32) {
  console.error('Set EMAIL_HASH_SECRET to 32 or more characters (any value: this is a stand-in).');
  process.exit(1);
}

function memoryKV() {
  const map = new Map();
  return {
    async get(key) {
      const row = map.get(key);
      if (!row) return null;
      if (row.expires && row.expires <= Date.now()) { map.delete(key); return null; }
      return row.value;
    },
    async put(key, value, options = {}) {
      map.set(key, { value: String(value), expires: options.expirationTtl ? Date.now() + options.expirationTtl * 1000 : 0 });
    },
    async delete(key) { map.delete(key); }
  };
}

const env = {
  EMAIL_HASH_SECRET: secret,
  DEVELOPMENT_MODE: 'true',
  VEX_AUTH_KV: memoryKV(),
  VEX_SYNC_KV: memoryKV()
};

// One request at a time, as the worker's Durable Object runs them.
let chain = Promise.resolve();

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    chain = chain.then(async () => {
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request('http://127.0.0.1:' + port + req.url, {
        method: req.method,
        headers: Object.fromEntries(Object.entries(req.headers).filter(([, value]) => typeof value === 'string')),
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
      });
      const response = await syncHandler.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      console.log(req.method, req.url, response.status);
    }).catch(error => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(error && error.message || error) }));
    });
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log('Vex Sync stand-in on http://127.0.0.1:' + port + ' — the real worker code, in memory, sign-in codes in the response');
});
