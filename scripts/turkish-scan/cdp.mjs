// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// It starts Vex on a THROWAWAY profile with the interface in Turkish, drives it over the debugging port only (no OS input),
// opens each surface and records every visible text, title, placeholder and aria-label that still reads as English.
// Tiny CDP helper for the Turkish-leftovers scan. Node 24 (global WebSocket, fetch).
import { spawn } from 'node:child_process';
import fs from 'node:fs';

export async function launch({ worktree, profile, port, log }) {
  fs.mkdirSync(profile, { recursive: true });
  const exe = 'C:\\Claude code free\\vex\\node_modules\\electron\\dist\\electron.exe';
  const out = fs.openSync(log, 'a');
  const child = spawn(exe, ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], {
    cwd: worktree, env: { ...process.env, VEX_NO_OS_SCHEDULE: '1' }, stdio: ['ignore', out, out], detached: false,
  });
  return child;
}

export async function targets(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`);
  return r.json();
}

export class Session {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); this.events = []; }
  async open() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws error ' + this.wsUrl)); });
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) { const p = this.pending.get(d.id); this.pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); }
      else this.events.push(d);
    };
    return this;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expression, { awaitPromise = true } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  close() { try { this.ws.close(); } catch { /* closing */ } }
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
