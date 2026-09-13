#!/usr/bin/env node
// Live check that a reminder actually reaches the person.
//
//   VEX_SMOKE_REMINDERS=1 node scripts/verify-reminders.js            # Vex running
//   VEX_SMOKE_REMINDERS=1 node scripts/verify-reminders.js --closed   # Vex quit; Windows must wake it
//
// Unit tests cannot cover the one thing that matters here: Windows showing the
// toast, and Task Scheduler launching Vex when it is not running. This boots
// the real app from source on a throwaway profile, sets a reminder two minutes
// out through the same bridge the dialog uses, and then proves each step —
// the Windows task exists, the toast was delivered (the store says so, written
// by Electron's own 'show' event), the task removed itself. With --closed the
// app is killed after the reminder is set, and the store can only say
// "delivered" if a Vex that this script did not start came up and showed it.
//
// Gated behind an environment variable because it takes two and a half
// minutes, talks to Task Scheduler, and puts a toast on whoever's screen this
// is. Windows only. Exit 0 on pass, 1 on any failed step, with the reason.
const { spawn, execFileSync } = require('child_process');
const path = require('path'); const os = require('os'); const fs = require('fs'); const http = require('http');

if (process.env.VEX_SMOKE_REMINDERS !== '1') {
  console.log('verify-reminders: skipped (set VEX_SMOKE_REMINDERS=1 to run; it takes ~2.5 minutes and shows a real toast)');
  process.exit(0);
}
if (process.platform !== 'win32') { console.log('verify-reminders: Windows only'); process.exit(0); }

const closed = process.argv.includes('--closed');
const root = path.resolve(__dirname, '..');
const CDP = 9571;
const udd = path.join(os.tmpdir(), 'vex-verify-reminders-' + Date.now());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const get = (u) => new Promise((res, rej) => http.get(u, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));
const ps = (cmd) => { try { return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd + '; exit 0'], { encoding: 'utf8', windowsHide: true }).trim(); } catch (e) { return 'PS-ERR ' + String(e.stderr || e.message).trim().split(/\r?\n/)[0]; } };
const taskFor = (id) => ps(`try { $t = Get-ScheduledTask -TaskPath '\\Vex\\' -TaskName 'Vex Reminder ${id}' -ErrorAction Stop; ($t | Get-ScheduledTaskInfo).NextRunTime.ToString('s') } catch { 'absent' }`);
// A -like pattern takes backslashes literally, so the profile path goes in as
// is; only a single quote needs escaping in a single-quoted PowerShell string.
const launchedVex = () => ps(`Get-CimInstance Win32_Process -Filter "Name='electron.exe' OR Name='Vex.exe'" | Where-Object { $_.CommandLine -like '*--reminder=*' -and $_.CommandLine -like '*${udd.replace(/'/g, "''")}*' } | ForEach-Object { $_.ProcessId }`);
const store = () => { try { return JSON.parse(fs.readFileSync(path.join(udd, 'reminders.json'), 'utf8')).data; } catch { return null; } };

const steps = [];
const step = (name, ok, detail) => { steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) throw new Error(name); };

let child;
(async () => {
  child = spawn(require(path.join(root, 'node_modules/electron')), ['.', `--user-data-dir=${udd}`, `--remote-debugging-port=${CDP}`],
    { cwd: root, env: { ...process.env, VEX_SKIP_VMP_VERIFY: '1' }, stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 60 && !t; i++) { await sleep(1000); try { t = (await get(`http://127.0.0.1:${CDP}/json/list`)).find(x => /renderer\/index\.html/.test((x.url || '').split('?')[0])); } catch {} }
  step('Vex boots from source', !!t);

  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = (x) => send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true, timeout: 30000 })
    .then(m => (m.result && m.result.exceptionDetails) ? { __err: ((m.result.exceptionDetails.exception || {}).description || '').split('\n')[0] } : (m.result && m.result.result || {}).value);
  await send('Runtime.enable'); await sleep(5000);

  const created = await ev(`window.vex.reminders.create('verify-reminders ${closed ? 'closed' : 'running'} path', Date.now() + 2 * 60 * 1000)`);
  step('reminder created through the bridge', !!(created && created.id), created && created.__err);
  step('Windows Task Scheduler holds the wake-up task', created.os && created.os.scheduled === true, created.os && (created.os.error || taskFor(created.id)));
  ws.close();

  if (closed) {
    child.kill('SIGKILL'); child = null; await sleep(2000);
    step('Vex is not running', !launchedVex(), 'killed');
  }

  let fired = null;
  for (let i = 0; i < 200 && !fired; i++) {
    await sleep(1000);
    const r = (store() || []).find(x => x.id === created.id);
    if (r && r.firedAt) fired = r;
  }
  step('the reminder fired at the minute', !!fired, fired ? new Date(fired.firedAt).toISOString() + (Math.abs(fired.firedAt - created.at) < 5000 ? '' : ' (late by ' + Math.round((fired.firedAt - created.at) / 1000) + 's)') : 'never fired');
  step('Windows showed the toast', fired.delivered === 'toast', fired.delivered === 'toast' ? "Electron reported 'show'" : (fired.error || fired.delivered));
  if (closed) step('a Vex this script did not start came up for it', !!launchedVex(), 'launched by Task Scheduler');
  await sleep(3000);
  step('the wake-up task removed itself', taskFor(created.id) === 'absent', taskFor(created.id));

  console.log(`\nverify-reminders: ${steps.length} steps passed (${closed ? 'Vex closed' : 'Vex running'})`);
  process.exitCode = 0;
})().catch(e => {
  console.log(`\nverify-reminders: FAILED at "${e.message}"`);
  process.exitCode = 1;
}).finally(async () => {
  try { child && child.kill('SIGKILL'); } catch {}
  for (const pid of (launchedVex() || '').split(/\r?\n/).map(Number).filter(Boolean)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  await sleep(1500);
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
});
