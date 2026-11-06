// === Page automations: the runner =============================================
//
// Replays one recording in a page window the caller provides (a "driver"), one
// step at a time, and ends in exactly one of:
//
//   ok              every step ran (skipped steps are logged as skipped)
//   failed          a step could not be done; says which, why, and has a
//                   screenshot of the page at that moment
//   stopped         the person pressed Stop, or the kill switch was used
//   needs-approval  a step that asks was left waiting; NOTHING was done for it
//   needs-you       a CAPTCHA appeared: the run stops and asks, it never
//                   tries to get past one
//   limit           a limit ended it (duration, steps)
//
// The rules this file enforces (each has a test in tests/main/automationsRun.test.js):
//   * a control that is not found, is ambiguous, hidden or disabled STOPS the
//     run; it never clicks something else
//   * a consequential step (submit, buy, pay, send, post, delete, transfer,
//     confirm) asks every time; payment/delete/transfer/send are not switchable
//   * a secret field is never typed into; its step asks the person
//   * the page is re-checked right before the action: a control that turned
//     consequential since the recording asks
//   * no loops: each step runs at most once, in order
//   * a duration budget that does not count the time spent waiting for a person
//
// Everything outside the steps is injected (the page, the clock, the person's
// answer) so the module is tested without Electron.
const Model = require('../renderer/js/automations-model.js');
const Guest = require('../renderer/js/automations-guest.js');

const LEVEL = { none: 0, soft: 1, locked: 2 };
const REASON_TEXT = {
  'not-found': 'The control was not found on the page',
  ambiguous: 'More than one control on the page matches, and Vex will not guess which',
  hidden: 'The control is on the page but is hidden',
  disabled: 'The control is switched off on the page',
  'sensitive-field': 'It is a password, code or card field; Vex never fills those',
  'not-approved': 'The control became more serious than it was when you approved it',
  'option-not-found': 'The list no longer has that choice',
  'not-a-list': 'The control is not a list',
  captcha: 'A CAPTCHA appeared. Vex does not try to get past those; open the page and do it yourself',
  'navigation-refused': 'That address cannot be opened by an automation',
  'load-failed': 'The page did not load',
  'wait-timeout': 'The text you waited for did not appear',
  'page-error': 'The page raised an error while the step ran',
  duration: 'The run took longer than its time limit',
  steps: 'The run reached its step limit',
};

function createRunner({ now = () => Date.now(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), allowLocal = false, isPrivateHost } = {}) {
  async function run(rec, { driver, approve, isStopped = () => false, onStep = () => {}, trigger = 'manual', runId = 'run' }) {
    if (!driver) throw new Error('A run needs a page to work in');
    const startedAt = now();
    const log = [];
    const reads = [];
    let waited = 0;        // time spent waiting for a person: not part of the budget
    let executed = 0;
    let approvedLevel = 0;
    const budget = rec.maxRunMs || Model.LIMITS.maxRunMs;
    const result = { runId, recId: rec.id, name: rec.name, trigger, startedAt, endedAt: null, status: 'ok', log, reads, failure: null, summariseRequested: false, stepsRun: 0, finalUrl: null };

    const add = (i, step, outcome, detail, extra) => {
      const e = { i, stepId: step ? step.id : null, label: step ? (step.label || Model.describeStep(step)) : '', outcome, detail: detail ? Model.redact(detail) : '', at: now(), ...(extra || {}) };
      log.push(e); try { onStep(e); } catch (err) { console.error('[Automations] progress callback failed:', err.message); }
      return e;
    };
    const finish = (status) => { result.status = status; result.endedAt = now(); result.stepsRun = executed; return result; };
    const fail = async (i, step, reason, message, extra) => {
      let shot = null;
      try { shot = await driver.screenshot(); } catch (err) { console.error('[Automations] could not take the failure screenshot:', err.message); }
      let url = null; try { url = driver.currentUrl(); } catch { url = null; }   // vex-allow-empty-catch: the address is only for the log
      result.failure = { index: i, stepId: step ? step.id : null, label: step ? (step.label || Model.describeStep(step)) : '', reason, message: Model.redact(message || REASON_TEXT[reason] || reason), url, screenshot: shot, ...(extra || {}) };
      add(i, step, 'failed', result.failure.message, { reason });
      return finish(reason === 'captcha' ? 'needs-you' : (reason === 'duration' || reason === 'steps') ? 'limit' : 'failed');
    };
    const evalKit = async (method, args, { retry = false } = {}) => {
      try { return await driver.evaluate(Guest.call(method, args)); }
      catch (err) {
        if (!retry) throw err;
        await driver.settle();
        return driver.evaluate(Guest.call(method, args));
      }
    };
    const captchaCheck = async (i, step) => {
      let c;
      try { c = await evalKit('captcha', [], { retry: true }); } catch (err) { return fail(i, step, 'page-error', 'Could not check the page for a CAPTCHA: ' + err.message); }
      if (c && c.found) return fail(i, step, 'captcha');
      return null;
    };

    const steps = rec.steps;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      // ---- limits and stop, before anything is touched
      if (isStopped()) { add(i, step, 'stopped', 'Stopped'); return finish('stopped'); }
      if (executed >= Model.LIMITS.maxSteps) return fail(i, step, 'steps');
      if (now() - startedAt - waited > budget) return fail(i, step, 'duration', 'The run took longer than ' + Math.round(budget / 1000) + ' seconds');
      executed++;

      // Waits for a person: returns 'approve' | 'skip' | 'stop' | 'timeout'.
      const ask = async (kind, why, extra) => {
        let shot = null;
        try { shot = await driver.screenshot(); } catch { shot = null; }   // vex-allow-empty-catch: the prompt is shown without a picture
        const t0 = now();
        add(i, step, 'asking', why);
        let decision;
        try { decision = await approve({ runId, recId: rec.id, name: rec.name, index: i, total: steps.length, stepId: step.id, label: step.label || Model.describeStep(step), kind, why, screenshot: shot, url: (() => { try { return driver.currentUrl(); } catch { return null; } })(), ...(extra || {}) }); }   // vex-allow-empty-catch: the address is only shown to the person
        finally { waited += now() - t0; }
        return decision || 'timeout';
      };

      try {
        if (step.type === 'open') {
          const why = Model.urlRefusal(step.url, { allowLocal, isPrivateHost });
          if (why) return await fail(i, step, 'navigation-refused', why);
          try { await driver.load(step.url); }
          catch (err) { return await fail(i, step, 'load-failed', 'The page did not load: ' + err.message); }
          const c = await captchaCheck(i, step); if (c) return c;
          add(i, step, 'ok', 'Opened');
          continue;
        }
        if (step.type === 'wait') {
          if (step.waitFor) {
            const w = await evalKit('waitFor', [step.waitFor, Math.min(step.ms || 10000, Model.LIMITS.maxWaitMs)]);
            if (!w || !w.ok) return await fail(i, step, 'wait-timeout', 'The text "' + step.waitFor + '" did not appear');
          } else {
            let left = step.ms;
            while (left > 0) { if (isStopped()) break; const d = Math.min(left, 250); await sleep(d); left -= d; }
          }
          add(i, step, 'ok', 'Waited');
          continue;
        }
        if (step.type === 'pause') {
          const d = await ask('pause', 'This recording pauses here until you continue');
          if (d === 'stop') { add(i, step, 'stopped', 'You stopped the run'); return finish('stopped'); }
          if (d === 'timeout') { add(i, step, 'needs-approval', 'Nobody answered'); return finish('needs-approval'); }
          add(i, step, d === 'skip' ? 'skipped' : 'ok', d === 'skip' ? 'Skipped' : 'Continued');
          continue;
        }
        if (step.type === 'summarise') { result.summariseRequested = true; add(i, step, 'ok', 'The summary is made after the run, only because this step is here'); continue; }
        if (step.type === 'read') {
          const r = await evalKit('read', [step, Model.LIMITS.maxReadChars], { retry: true });
          if (!r || !r.ok) return await fail(i, step, r && r.reason ? r.reason : 'page-error');
          reads.push({ as: step.as || step.label || 'value', text: Model.redact(r.text) });
          add(i, step, 'ok', 'Read ' + r.text.length + ' characters');
          continue;
        }

        // ---- acting steps: look first, then decide, then act
        const exactNeeded = step.locked === true || !!(step.consequence && step.consequence.level !== 'none');
        const probe = await evalKit('probe', [{ target: step.target, exact: exactNeeded }], { retry: true });
        if (!probe || probe.status !== 'found') {
          const reason = probe && probe.status === 'ambiguous' ? 'ambiguous' : probe && probe.status === 'hidden' ? 'hidden' : 'not-found';
          return await fail(i, step, reason, undefined, { probe: probe ? { how: probe.how, count: probe.count } : null });
        }
        if (probe.disabled) return await fail(i, step, 'disabled');
        if ((step.type === 'type' || step.type === 'select') && probe.sensitive && !step.ask) return await fail(i, step, 'sensitive-field', 'The field is now a password, code or card field; Vex never fills those');

        const live = probe.consequence || { level: 'none' };
        const recorded = step.consequence || { level: 'none' };
        const level = LEVEL[live.level] >= LEVEL[recorded.level] ? live : recorded;   // the worse of the two
        const locked = level.level === 'locked' || step.locked === true;

        if (step.ask) {
          // A secret: the person fills it in. Nothing is typed by Vex.
          if (typeof driver.reveal === 'function') await driver.reveal();
          const d = await ask('fill', 'Fill in "' + (step.target.name || step.target.label || 'this field') + '" yourself, then continue', { secret: step.secret || 'secret' });
          if (d === 'stop') { add(i, step, 'stopped', 'You stopped the run'); return finish('stopped'); }
          if (d === 'timeout') { add(i, step, 'needs-approval', 'Nobody filled it in'); return finish('needs-approval'); }
          add(i, step, d === 'skip' ? 'skipped' : 'ok', d === 'skip' ? 'Skipped' : 'You filled it in');
          continue;
        }

        const needAsk = locked || step.confirm === 'ask' || (level.level === 'soft' && step.confirm !== 'run');
        approvedLevel = 0;
        if (needAsk) {
          const d = await ask('consequence', level.why || 'You set this step to ask first', { consequence: level.kind || null, locked, how: probe.how, control: probe.desc && probe.desc.name });
          if (d === 'stop') { add(i, step, 'stopped', 'You stopped the run'); return finish('stopped'); }
          if (d === 'timeout') { add(i, step, 'needs-approval', 'Not done: waiting for your approval'); return finish('needs-approval'); }
          if (d === 'skip') { add(i, step, 'skipped', 'You skipped this step'); continue; }
          approvedLevel = LEVEL[level.level];
        } else approvedLevel = LEVEL[level.level];   // a soft step the person set to "run"

        if (isStopped()) { add(i, step, 'stopped', 'Stopped'); return finish('stopped'); }
        const act = await driver.evaluate(Guest.call('act', [{ ...step, exact: exactNeeded }, { approvedLevel }]));
        if (!act || !act.ok) return await fail(i, step, act && act.reason ? act.reason : 'page-error', act && act.message);
        add(i, step, 'ok', (probe.how === 'similar' ? 'Matched by similar name (' + probe.score + ')' : 'Matched by ' + probe.how), { how: probe.how });
        await driver.settle();
        const c = await captchaCheck(i, step); if (c) return c;
      } catch (err) {
        return await fail(i, step, 'page-error', 'The page raised an error: ' + err.message);
      }
    }
    try { result.finalUrl = driver.currentUrl(); } catch { result.finalUrl = null; }   // vex-allow-empty-catch: informational only
    return finish('ok');
  }
  return { run, REASON_TEXT };
}

module.exports = { createRunner, REASON_TEXT };
