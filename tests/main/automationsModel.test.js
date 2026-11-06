// Page automations: the step model, the secret-field rule, the confirmation
// heuristics (English and Turkish), the limits and the export that strips values.
import { describe, expect, it } from 'vitest';

const M = require('../../src/renderer/js/automations-model.js');

const field = (extra) => ({ type: 'type', value: 'hello', target: { role: 'textbox', name: 'Search', tag: 'input', type: 'text', css: '#q' }, ...extra });
const rec = (steps, extra) => ({ name: 'My job', partition: 'persist:main', steps: [{ type: 'open', url: 'https://example.com/' }, ...steps], ...extra });

describe('step model', () => {
  it('keeps a clean recording and works out the start address', () => {
    const r = M.normalizeRecording(rec([field(), { type: 'click', target: { role: 'button', name: 'Search', tag: 'button' } }]));
    expect(r.startUrl).toBe('https://example.com/');
    expect(r.steps.map(s => s.type)).toEqual(['open', 'type', 'click']);
    expect(r.steps[1].value).toBe('hello');
    expect(r.enabled).toBe(true);
    expect(r.schedule.kind).toBe('none');
  });
  it('refuses nonsense with a sentence', () => {
    expect(() => M.normalizeRecording(null)).toThrow(/not a recording/);
    expect(() => M.normalizeRecording({ name: '', steps: [] })).toThrow(/name/);
    expect(() => M.normalizeRecording({ name: 'x', steps: [] })).toThrow(/at least one step/);
    expect(() => M.normalizeRecording({ name: 'x', steps: [{ type: 'click', target: { name: 'a' } }] })).toThrow(/starts by opening/);
    expect(() => M.normalizeRecording(rec([{ type: 'fly' }]))).toThrow(/unknown type/);
    expect(() => M.normalizeRecording(rec([{ type: 'click' }]))).toThrow(/which control/);
    expect(() => M.normalizeRecording(rec([{ type: 'open', url: 'javascript:alert(1)' }]))).toThrow(/web address|http/);
    expect(() => M.normalizeRecording(rec([{ type: 'open', url: 'https://u:p@example.com/' }]))).toThrow(/login inside/);
  });
  it('refuses a private, Tor or routed session', () => {
    for (const p of ['persist:route-tor', 'persist:container-tor-1', 'tor-abc', 'private-1', 'persist:discord']) {
      expect(() => M.normalizeRecording(rec([], { partition: p }))).toThrow(/private, Tor or routed/);
    }
    expect(M.normalizeRecording(rec([field()], { partition: 'persist:container-work_1' })).partition).toBe('persist:container-work_1');
  });
  it('has no loops: only the step types that exist, at most 60 steps and 12 addresses, summary last', () => {
    expect(M.STEP_TYPES).not.toContain('loop');
    expect(M.STEP_TYPES).not.toContain('goto');
    const many = Array.from({ length: 60 }, (_, i) => field({ value: 'v' + i, target: { role: 'textbox', name: 'F' + i, css: '#f' + i } }));
    expect(() => M.normalizeRecording(rec(many))).toThrow(/at most 60 steps/);
    const opens = Array.from({ length: 12 }, (_, i) => ({ type: 'open', url: 'https://example.com/' + i }));
    expect(() => M.normalizeRecording(rec(opens))).toThrow(/opens at most 12/);
    expect(() => M.normalizeRecording(rec([{ type: 'summarise' }, field()]))).toThrow(/last step/);
    expect(M.normalizeRecording(rec([field(), { type: 'summarise' }])).steps.at(-1).type).toBe('summarise');
  });
  it('limits one recording to a size, a value to 500 characters and waits to 30 seconds', () => {
    expect(() => M.normalizeRecording(rec([field({ value: 'x'.repeat(501) })]))).toThrow(/longer than 500/);
    expect(M.normalizeRecording(rec([{ type: 'wait', ms: 999999 }])).steps[1].ms).toBe(30000);
    expect(() => M.normalizeRecording(rec([field({ value: 'x'.repeat(400) })], { junk: 'y'.repeat(700000) }))).toThrow(/too large/);
  });
  it('trims secret-looking parts of an address and says so', () => {
    const r = M.normalizeRecording(rec([{ type: 'open', url: 'https://example.com/a?page=2&token=abc123&session_id=9#access_token=zzz' }]));
    expect(r.steps[1].url).toBe('https://example.com/a?page=2');
    expect(r.steps[1].urlTrimmed).toBe(true);
  });
});

describe('secrets are never recorded', () => {
  const secretTargets = {
    'type=password': { type: 'password', name: 'Pass', tag: 'input' },
    'autocomplete=current-password': { type: 'text', name: 'Entry', autocomplete: 'current-password', tag: 'input' },
    'autocomplete=new-password': { type: 'text', name: 'Entry', autocomplete: 'new-password', tag: 'input' },
    'autocomplete=one-time-code': { type: 'text', name: 'Entry', autocomplete: 'one-time-code', tag: 'input' },
    'autocomplete=cc-number': { type: 'text', name: 'Entry', autocomplete: 'cc-number', tag: 'input' },
    'autocomplete=cc-csc': { type: 'text', name: 'Entry', autocomplete: 'cc-csc', tag: 'input' },
    'a password manager filled it': { type: 'text', name: 'Entry', autofilled: true, tag: 'input' },
    'password-manager attribute': { type: 'text', name: 'Entry', pmAttr: true, tag: 'input' },
    'named password in Turkish (parola)': { type: 'text', name: 'Parola', tag: 'input' },
    'named sifre': { type: 'text', name: 'Şifre', tag: 'input' },
    'named credit card': { type: 'text', name: 'Credit card number', tag: 'input' },
    'named kredi karti': { type: 'text', name: 'Kredi Kartı No', tag: 'input' },
    'named cvv': { type: 'text', name: 'CVV', tag: 'input' },
    'named iban': { type: 'text', name: 'IBAN', tag: 'input' },
    'named OTP': { type: 'text', name: 'OTP', tag: 'input' },
    'named dogrulama kodu': { type: 'text', name: 'Doğrulama kodu', tag: 'input' },
    'name attribute pwd': { type: 'text', name: 'Entry', attrName: 'pwd', tag: 'input' },
  };
  for (const [why, target] of Object.entries(secretTargets)) {
    it('drops the typed value and asks at run time: ' + why, () => {
      const r = M.normalizeRecording(rec([{ type: 'type', value: 'hunter2-top-secret', target }]));
      const s = r.steps[1];
      expect(s.ask).toBe(true);
      expect(s.value).toBeUndefined();
      expect(s.confirm).toBe('ask');
      expect(JSON.stringify(r)).not.toContain('hunter2-top-secret');
    });
  }
  it('also refuses a value that looks like a card number or a one-time code, whatever the field is called', () => {
    for (const v of ['4111 1111 1111 1111', '4111111111111111', '123456', '98765432']) {
      const s = M.normalizeRecording(rec([field({ value: v })])).steps[1];
      expect(s.ask, v).toBe(true);
      expect(s.value, v).toBeUndefined();
    }
    expect(M.normalizeRecording(rec([field({ value: 'grades 2026' })])).steps[1].value).toBe('grades 2026');
  });
  it('turns recorder events for a secret into an ask step and never reads a secret field', () => {
    const steps = M.stepsFromEvents([
      { t: 'open', url: 'https://example.com/login' },
      { t: 'type', target: { role: 'textbox', name: 'Email', tag: 'input', type: 'email', css: '#e' }, value: 'me@example.com' },
      { t: 'type', target: { role: 'textbox', name: 'Password', tag: 'input', type: 'password', css: '#p' }, value: 'hunter2-top-secret' },
      { t: 'ask', target: { role: 'textbox', name: 'Code', tag: 'input', css: '#c' }, autofilled: true },
      { t: 'read', target: { role: 'textbox', name: 'Password', tag: 'input', type: 'password', css: '#p' } },
    ]);
    expect(steps.map(s => s.type)).toEqual(['open', 'type', 'type', 'type']);
    expect(steps[2].ask).toBe(true);
    expect(steps[3].ask).toBe(true);
    expect(JSON.stringify(steps)).not.toContain('hunter2');
  });
  it('merges a typing burst in one field into one step', () => {
    const t = { role: 'textbox', name: 'Search', tag: 'input', css: '#q' };
    const steps = M.stepsFromEvents([{ t: 'open', url: 'https://example.com/' }, { t: 'type', target: t, value: 'a' }, { t: 'type', target: t, value: 'abc' }]);
    expect(steps).toHaveLength(2);
    expect(steps[1].value).toBe('abc');
  });
  it('redacts card numbers and codes in anything it logs', () => {
    expect(M.redact('card 4111 1111 1111 1111 ok')).toContain('[card number removed]');
    expect(M.redact('your code is 482913')).toContain('[removed]');
    expect(M.redact('order 12345 shipped')).toBe('order 12345 shipped');
  });
});

describe('consequential steps (English and Turkish)', () => {
  const cls = (text, extra) => M.autoClassify({ text, tag: 'button', role: 'button', type: 'button', ...extra });
  const locked = {
    pay: ['Pay', 'Pay now', 'Buy now', 'Buy', 'Purchase', 'Checkout', 'Place order', 'Place your order', 'Complete purchase', 'Donate', 'Subscribe', 'Satın al', 'SATIN AL', 'Hemen al', 'Öde', 'ÖDE', 'Ödeme yap', 'Ödemeyi tamamla', 'Siparişi tamamla', 'Sipariş ver', 'Sepeti onayla', 'Bağış yap', 'Abone ol'],
    delete: ['Delete', 'DELETE', 'Delete account', 'Remove', 'Erase', 'Cancel subscription', 'Unsubscribe', 'Close my account', 'Sil', 'SİL', 'Sil!', 'Kaldır', 'Hesabı sil', 'İptal et', 'Abonelikten çık'],
    transfer: ['Transfer', 'Send money', 'Wire funds', 'Havale', 'Havale yap', 'Para gönder', 'Aktar', 'EFT'],
    send: ['Send', 'Submit', 'Post', 'Publish', 'Share', 'Reply', 'Gönder', 'GÖNDER', 'Gönderin', 'Yayınla', 'Paylaş', 'Yanıtla', 'Mesaj gönder'],
    confirm: ['Confirm', 'Approve', 'I agree', 'Authorize', 'Apply', 'Onayla', 'ONAYLA', 'Onaylıyorum', 'Kabul et', 'Başvur', 'Tamamla', 'Evet'],
  };
  for (const [kind, texts] of Object.entries(locked)) {
    for (const text of texts) {
      it(`"${text}" is a locked ${kind} step`, () => {
        const c = cls(text);
        expect(c.level, text).toBe('locked');
        expect(c.kind, text).toBe(kind);
      });
    }
  }
  it('finds it in the aria-label or the title when the visible text is an icon', () => {
    expect(M.autoClassify({ text: '', ariaLabel: 'Delete this item', tag: 'button', role: 'button' }).level).toBe('locked');
    expect(M.autoClassify({ text: '', title: 'Gönder', tag: 'button', role: 'button' }).level).toBe('locked');
    expect(M.autoClassify({ text: '', value: 'Satın al', type: 'submit', tag: 'input' }).level).toBe('locked');
  });
  it('flags a submit button by its type and a POST form by its method, whatever it says', () => {
    expect(cls('Proceed', { type: 'submit' }).level).toBe('soft');
    expect(cls('Proceed', { type: '', inForm: true, formMethod: 'post' }).level).toBe('soft');   // a button with no type inside a form submits it
    expect(cls('Proceed', { type: 'button', inForm: true, formMethod: 'post' }).level).toBe('none');   // type=button does not
    expect(cls('Proceed', { type: 'submit', formMethod: 'post' }).kind).toBe('submit');
    expect(cls('Whatever', { type: 'submit', formAction: 'https://shop.example/checkout/pay' }).level).toBe('locked');
    expect(cls('Whatever', { type: 'submit', formAction: 'https://shop.example/account/delete' }).level).toBe('locked');
    expect(cls('Whatever', { type: 'submit', formMethod: 'post', crossOrigin: true }).level).toBe('locked');
    expect(cls('Open', { tag: 'a', role: 'link', type: '', href: 'https://shop.example/orders/123/cancel' }).level).toBe('locked');
  });
  it('lets a plain search or a sign-in through, and a cookie banner', () => {
    for (const t of ['Search', 'Ara', 'Filter', 'Filtrele', 'Next', 'İleri', 'Show', 'Göster', 'Back']) expect(cls(t, { type: 'submit', formMethod: 'get' }).level, t).toBe('none');
    expect(cls('Sign in', { type: 'submit', formMethod: 'get' }).level).toBe('none');
    expect(cls('Giriş yap', { type: 'submit', formMethod: 'get' }).level).toBe('none');
    expect(cls('Accept cookies').level).toBe('none');
    expect(cls('Çerezleri kabul et').level).toBe('none');
    expect(cls('Download report').level).toBe('none');
    expect(cls('Raporu indir').level).toBe('none');
    expect(cls('Next page').level).toBe('none');
  });
  it('a save or an update is a soft step the person may switch to run', () => {
    for (const t of ['Save', 'Save changes', 'Update', 'Kaydet', 'Güncelle']) expect(cls(t).level, t).toBe('soft');
    const s = M.normalizeRecording(rec([{ type: 'click', confirm: 'run', target: { role: 'button', name: 'Kaydet', tag: 'button' } }])).steps[1];
    expect(s.confirm).toBe('run');
    expect(s.locked).toBeUndefined();
  });
  it('a locked step is forced to ask whatever the file says, and cannot be switched off', () => {
    for (const confirm of ['run', undefined, 'nonsense']) {
      const s = M.normalizeRecording(rec([{ type: 'click', confirm, locked: false, consequence: { level: 'none' }, target: { role: 'button', name: 'Satın al', tag: 'button' } }])).steps[1];
      expect(s.confirm).toBe('ask');
      expect(s.locked).toBe(true);
      expect(s.consequence.kind).toBe('pay');
    }
  });
  it('an ordinary acting step runs unless set to ask; a pause and a secret always ask', () => {
    const r = M.normalizeRecording(rec([
      { type: 'click', target: { role: 'button', name: 'Download report', tag: 'button' } },
      { type: 'click', confirm: 'ask', target: { role: 'button', name: 'Download report', tag: 'button' } },
      { type: 'pause' },
    ]));
    expect(r.steps.slice(1).map(s => s.confirm)).toEqual(['run', 'ask', 'ask']);
  });
});

describe('export and import', () => {
  it('an export has no typed value, no session, no schedule and no ids', () => {
    const r = M.normalizeRecording(rec([field({ value: 'my private search words' }), { type: 'select', value: 'Spring 2026', target: { role: 'combobox', name: 'Term', tag: 'select', css: '#t' } }], { partition: 'persist:container-work', schedule: { kind: 'daily', time: '08:00' }, lastStatus: 'ok' }));
    const out = M.exportRecording(r);
    const text = JSON.stringify(out);
    expect(text).not.toContain('my private search words');
    expect(text).not.toContain('Spring 2026');
    expect(text).not.toContain('container-work');
    expect(text).not.toContain('"schedule"');
    expect(out.steps.every(s => s.id === undefined)).toBe(true);
    expect(out.steps.filter(s => s.type === 'type' || s.type === 'select').every(s => s.ask === true && s.value === undefined)).toBe(true);
  });
  it('an import arrives switched off, in the main session, unscheduled and asking before every action', () => {
    const r = M.normalizeRecording(rec([field(), { type: 'click', target: { role: 'button', name: 'Download report', tag: 'button' } }], { partition: 'persist:container-work' }));
    const back = M.importRecording(JSON.stringify(M.exportRecording(r)));
    expect(back.enabled).toBe(false);
    expect(back.imported).toBe(true);
    expect(back.partition).toBe('persist:main');
    expect(back.schedule.kind).toBe('none');
    expect(back.steps.filter(s => M.ACTING.includes(s.type)).every(s => s.confirm === 'ask')).toBe(true);
    expect(back.id).not.toBe(r.id);
  });
  it('an import of something else, or something newer, is refused', () => {
    expect(() => M.importRecording('not json')).toThrow(/not valid JSON/);
    expect(() => M.importRecording('{"format":"other"}')).toThrow(/not a Vex automation/);
    expect(() => M.importRecording('{"format":"vex-automation","version":9}')).toThrow(/newer Vex/);
  });
  it('an imported file that tries to carry a secret value or a switched-off lock is cleaned', () => {
    const evil = { format: 'vex-automation', version: 1, name: 'x', steps: [
      { type: 'open', url: 'https://example.com/' },
      { type: 'type', value: 'secret-from-a-stranger', target: { role: 'textbox', name: 'Password', type: 'password' } },
      { type: 'click', confirm: 'run', locked: false, target: { role: 'button', name: 'Delete', tag: 'button' } },
    ] };
    const back = M.importRecording(JSON.stringify(evil));
    expect(back.steps[1].value).toBeUndefined();
    expect(back.steps[2].confirm).toBe('ask');
    expect(back.steps[2].locked).toBe(true);
  });
});

describe('limits', () => {
  it('allows 6 runs an hour per automation and 20 overall', () => {
    const now = 10 * 3600 * 1000;
    const recent = Array.from({ length: 6 }, (_, i) => now - i * 60000);
    expect(M.rateRefusal({ now, recTimes: recent, allTimes: recent })).toMatch(/6 times/);
    expect(M.rateRefusal({ now, recTimes: recent.slice(0, 5), allTimes: recent })).toBe('');
    const many = Array.from({ length: 20 }, (_, i) => now - i * 1000);
    expect(M.rateRefusal({ now, recTimes: [], allTimes: many })).toMatch(/20 times/);
    expect(M.rateRefusal({ now: now + 3601 * 1000, recTimes: recent, allTimes: many })).toBe('');
  });
  it('refuses downloads, other schemes and (unless allowed for the test site) local addresses', () => {
    expect(M.urlRefusal('https://example.com/setup.exe')).toMatch(/download/);
    expect(M.urlRefusal('file:///C:/x')).toMatch(/http/);
    expect(M.urlRefusal('http://192.168.1.1/admin')).toMatch(/computer or the home network/);
    expect(M.urlRefusal('http://127.0.0.1:8080/', { allowLocal: true })).toBe('');
    expect(M.urlRefusal('https://example.com/report')).toBe('');
  });
  it('the schedule is cleaned: a time, a kind, a day, a missed-run choice', () => {
    expect(M.cleanSchedule({ kind: 'weekly', time: '25:99', day: 9, missed: 'skip' })).toEqual({ kind: 'weekly', time: '09:00', missed: 'skip', day: 1 });
    expect(M.cleanSchedule({ kind: 'hourly' }).kind).toBe('none');
  });
});
