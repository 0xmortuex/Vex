// @vitest-environment jsdom
// The Authenticator's clock line: a code made from a wrong PC clock is refused by the site,
// so the panel says the clock is wrong, says whether Vex is correcting the codes, and holds
// the switch. The fill path warns too when correction is off.
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/authenticator.js');
const { TotpAutofill } = require('../../src/renderer/js/totp-autofill.js');
const A = () => window.Authenticator;
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

let el;
async function mount(accounts, clockCheck, extra = {}) {
  document.body.innerHTML = '<div id="p"></div>';
  el = document.getElementById('p');
  A()._accounts = null;
  localStorage.clear();
  window.showToast = vi.fn();
  window.vex = { totpList: vi.fn(async () => accounts), totpCodes: vi.fn(async () => []), ...extra };
  if (clockCheck) window.vex.totpClockCheck = clockCheck;
  vi.spyOn(A(), '_startTicking').mockImplementation(() => {});
  await A().renderPanel(el);
  await tick();
  return el.querySelector('#auth-clock');
}
const one = [{ id: 'd', issuer: '', label: 'Discord', digits: 6, period: 30 }];
const fast = (corrected) => ({ offsetSeconds: 19, wrong: true, ahead: true, corrected });

describe('the clock line', () => {
  it('a wrong clock that is being corrected: says so calmly and offers to stop', async () => {
    const box = await mount(one, vi.fn(async () => fast(true)));
    expect(box.style.display).toBe('');
    expect(box.querySelector('.auth-clock-text').textContent).toBe('Your PC clock is 19 seconds fast. Vex is correcting the codes, so they still work.');
    expect(box.classList.contains('corrected')).toBe(true);
    expect(box.getAttribute('role')).toBe('status');
    expect(box.querySelector('[data-clock="off"]').textContent).toBe('Stop correcting');
  });
  it('a wrong clock that is not corrected: warns and offers to correct', async () => {
    const box = await mount(one, vi.fn(async () => fast(false)));
    expect(box.querySelector('.auth-clock-text').textContent).toBe('Your PC clock is 19 seconds fast, so sites may refuse these codes.');
    expect(box.classList.contains('corrected')).toBe(false);
    expect(box.getAttribute('role')).toBe('alert');
    expect(box.querySelector('[data-clock="on"]').textContent).toBe('Correct the codes');
  });
  it('says slow, and minutes for a big difference', async () => {
    const box = await mount(one, vi.fn(async () => ({ offsetSeconds: -300, wrong: true, ahead: false, corrected: true })));
    expect(box.textContent).toMatch(/5 minutes slow/);
  });
  it('stays hidden when the clock is right', async () => {
    const box = await mount(one, vi.fn(async () => ({ offsetSeconds: 1, wrong: false, ahead: true, corrected: false })));
    expect(box.style.display).toBe('none');
    expect(box.textContent).toBe('');
  });
  it('stays hidden when the check is switched off in Settings', async () => {
    const box = await mount(one, vi.fn(async () => ({ off: true, offsetSeconds: 0, wrong: false, ahead: false, corrected: false })));
    expect(box.style.display).toBe('none');
  });
  it('stays hidden, and logs, when the clock could not be checked', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const box = await mount(one, vi.fn(async () => { throw new Error('offline'); }));
    expect(box.style.display).toBe('none');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
  it('does not ask at all with no accounts', async () => {
    const ask = vi.fn(async () => fast(true));
    await mount([], ask);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('the switch', () => {
  it('"Stop correcting" saves the choice at once, then shows the warning and fresh codes', async () => {
    let corrected = true;
    const persistSet = vi.fn(async (_k, v) => { corrected = JSON.parse(v); return true; });
    const box = await mount(one, vi.fn(async () => fast(corrected)), { persistSet });
    const panel = document.createElement('div'); panel.id = 'panel-authenticator'; document.body.appendChild(panel);
    window.vex.totpCodes.mockClear();
    box.querySelector('[data-clock="off"]').click();
    await tick();
    expect(persistSet).toHaveBeenCalledWith('vex.totpClockCorrect', 'false');
    expect(localStorage.getItem('vex.totpClockCorrect')).toBe('false');
    expect(box.querySelector('[data-clock="on"]')).toBeTruthy();
    expect(box.textContent).toMatch(/may refuse these codes/);
    expect(window.vex.totpCodes).toHaveBeenCalled();
  });
  it('"Correct the codes" turns it back on', async () => {
    let corrected = false;
    const persistSet = vi.fn(async (_k, v) => { corrected = JSON.parse(v); return true; });
    const box = await mount(one, vi.fn(async () => fast(corrected)), { persistSet });
    box.querySelector('[data-clock="on"]').click();
    await tick();
    expect(persistSet).toHaveBeenCalledWith('vex.totpClockCorrect', 'true');
    expect(box.textContent).toMatch(/Vex is correcting the codes/);
  });
  it('a choice main never took (a private window keeps its settings to itself) says so instead of looking done', async () => {
    const box = await mount(one, vi.fn(async () => fast(true)), { persistSet: vi.fn(async () => true) });
    box.querySelector('[data-clock="off"]').click();
    await tick();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Could not save that: this window cannot change it/), 'error');
    expect(box.querySelector('[data-clock="off"]')).toBeTruthy();        // still corrected, and it says so
  });
  it('a choice that cannot be saved says so', async () => {
    const box = await mount(one, vi.fn(async () => fast(true)), { persistSet: vi.fn(async () => { throw new Error('disk full'); }) });
    box.querySelector('[data-clock="off"]').click();
    await tick();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Could not save that: disk full/), 'error');
  });
  it('"Windows time settings" asks main to open it, and says when it could not', async () => {
    const open = vi.fn(async () => ({ ok: true }));
    let box = await mount(one, vi.fn(async () => fast(true)), { totpOpenTimeSettings: open });
    box.querySelector('[data-clock="settings"]').click();
    await tick();
    expect(open).toHaveBeenCalledTimes(1);
    expect(window.showToast).not.toHaveBeenCalled();
    box = await mount(one, vi.fn(async () => fast(true)), { totpOpenTimeSettings: vi.fn(async () => ({ ok: false, error: 'Only on Windows' })) });
    box.querySelector('[data-clock="settings"]').click();
    await tick();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Only on Windows/), 'error');
  });
  it('without the opener there is no such button', async () => {
    const box = await mount(one, vi.fn(async () => fast(true)));
    expect(box.querySelector('[data-clock="settings"]')).toBeNull();
  });
});

describe('the fill path', () => {
  let asked;
  beforeEach(() => {
    TotpAutofill._clockWarnedAt = 0; window.showToast = vi.fn(); window.VexI18n = undefined;
    asked = [];
    globalThis.VexAttention = { notify: (opts, show) => { asked.push(opts); show(); } };
  });
  it('asks the attention gate as a critical message (a 2FA code that will be refused)', async () => {
    window.vex = { totpClockCheck: vi.fn(async () => fast(false)) };
    await TotpAutofill._warnIfClockWrong();
    expect(asked).toEqual([{ feature: 'authenticator', urgency: 'critical', id: 'clock-wrong' }]);
  });
  it('warns when the code was made from a wrong clock that is not corrected, once in ten minutes', async () => {
    window.vex = { totpClockCheck: vi.fn(async () => fast(false)) };
    await TotpAutofill._warnIfClockWrong();
    expect(window.showToast).toHaveBeenCalledWith('Your PC clock is 19 seconds fast, so the site may refuse this code. The Authenticator panel can correct it.', 'warning', 9000);
    await TotpAutofill._warnIfClockWrong();
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(window.vex.totpClockCheck).toHaveBeenCalledTimes(1);
  });
  it('says minutes and slow', async () => {
    window.vex = { totpClockCheck: vi.fn(async () => ({ offsetSeconds: -180, wrong: true, ahead: false, corrected: false })) };
    await TotpAutofill._warnIfClockWrong();
    expect(window.showToast.mock.calls[0][0]).toMatch(/^Your PC clock is 3 minutes slow,/);
  });
  it('is quiet when the code was corrected, when the clock is right and when it could not be checked', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const answer of [async () => fast(true), async () => ({ offsetSeconds: 0, wrong: false, ahead: false, corrected: false }), async () => { throw new Error('offline'); }]) {
      window.vex = { totpClockCheck: vi.fn(answer) };
      await TotpAutofill._warnIfClockWrong();
    }
    expect(window.showToast).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it('both fills end by checking the clock', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/renderer/js/totp-autofill.js'), 'utf8');
    expect(src.match(/this\._warnIfClockWrong\(\);/g)).toHaveLength(2);
  });
});
