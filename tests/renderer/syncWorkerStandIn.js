// The real sync worker (workers/vex-sync-worker/worker.js) with in-memory
// storage, reached through window.VexNet.fetch the way sync-engine.js calls
// it. Every rule the server enforces (codes used once, pending sessions, the
// revision check, the 4 MiB body cap) is the real one.
import { syncSystem } from '../workers/syncHarness.js';
import * as worker from '../../workers/vex-sync-worker/worker.js';

export const WORKER_URL = 'http://localhost';

export function workerStandIn() {
  const system = syncSystem();
  const calls = [];
  window.VexNet = {
    fetch: async (url, opts = {}) => {
      const method = opts.method || 'GET';
      calls.push({ method, path: new URL(url).pathname });
      const r = await worker.default.fetch(new Request(url, { method, headers: opts.headers || {}, body: opts.body }), system.env);
      const text = await r.text();
      return { ok: r.ok, status: r.status, json: async () => JSON.parse(text), text: async () => text };
    },
  };
  window.VexConfig = { ...(window.VexConfig || {}), syncWorkerUrl: () => WORKER_URL };
  return { system, calls };
}
