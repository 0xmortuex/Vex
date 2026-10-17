// @vitest-environment jsdom
//
// The offline lookup tables of the selection decoder (js/selection-decoder-tables.js) and the detectors that use
// them (js/selection-decoder.js): errno, Windows errors, NTSTATUS / HRESULT, EFI_STATUS, HTTP, signals, cron.
import { describe, it, expect } from 'vitest';

const { VexDecodeTables: T } = require('../../src/renderer/js/selection-decoder-tables.js');
const { VexDecode: D } = require('../../src/renderer/js/selection-decoder.js');

const kinds = (s, opts) => D.analyze(s, opts).map(f => f.kind);
const card = (s, kind, opts) => D.analyze(s, opts).find(f => f.kind === kind);
const text = (c) => c.rows.map(r => r.label + ': ' + r.value).join('\n');

describe('HTTP status codes', () => {
  it('names a code, its family and what it means', () => {
    expect(T.http(404)).toMatchObject({ name: 'Not Found', family: 'Client error' });
    expect(T.http(503).family).toBe('Server error');
    expect(T.http(299)).toBeNull();
  });
  it('is found in a selection of the code alone, with the word HTTP, or with its reason phrase', () => {
    for (const s of ['404', 'HTTP 429', 'HTTP/1.1 503', '502 Bad Gateway']) expect(kinds(s), s).toContain('http');
    expect(text(card('429', 'http'))).toContain('Rate limit');
    expect(kinds('299')).not.toContain('http');
    expect(kinds('600')).not.toContain('http');
  });
});

describe('errno and Windows error numbers', () => {
  it('reads a name', () => {
    expect(text(card('ENOENT', 'errno'))).toContain('No such file or directory');
    expect(text(card('Error: EADDRINUSE: address already in use :::3000', 'errno'))).toContain('(98)');
    expect(text(card('WSAECONNRESET', 'errno'))).toContain('10054');
    expect(kinds('EXAMPLEWORD')).not.toContain('errno');
  });
  it('reads a number only when a word says what it is, and shows both systems when it cannot tell', () => {
    const c = card('os error 2', 'errno');
    expect(text(c)).toContain('ENOENT');
    expect(text(c)).toContain('ERROR_FILE_NOT_FOUND');
    expect(c.warnings[0]).toMatch(/differently|different/);
    expect(text(card('WinError 5', 'errno'))).toContain('ERROR_ACCESS_DENIED');
    expect(kinds('2')).toEqual([]);
    expect(card('errno 99999', 'errno')).toBeUndefined();
  });
});

describe('NTSTATUS and HRESULT', () => {
  it('names the codes that end a program', () => {
    const c = card('0xC0000005', 'ntstatus');
    expect(text(c)).toContain('STATUS_ACCESS_VIOLATION');
    expect(text(c)).toContain('Severity: Error');
    expect(text(card('C0000409', 'ntstatus'))).toContain('STATUS_STACK_BUFFER_OVERRUN');
    expect(text(card('0x887A0005', 'ntstatus'))).toContain('DXGI_ERROR_DEVICE_REMOVED');
  });
  it('reads an exit code given as a signed or unsigned decimal', () => {
    expect(text(card('-1073741819', 'ntstatus'))).toContain('STATUS_ACCESS_VIOLATION');
    expect(text(card('exit code 3221225477', 'ntstatus'))).toContain('0xC0000005');
    expect(text(card('-1073740791', 'ntstatus'))).toContain('STATUS_STACK_BUFFER_OVERRUN');
  });
  it('reads the parts of a code that is not in the table, and says so', () => {
    const c = card('0xC0DE1234', 'ntstatus');
    expect(text(c)).toContain('not in the offline table');
    expect(text(c)).toContain('Severity: Error');
    expect(c.warnings[0]).toMatch(/not in the short offline table/);
  });
  it('leaves a plain eight-digit number and a success-looking hex alone', () => {
    expect(kinds('12345678')).not.toContain('ntstatus');
    expect(kinds('0x12345678')).not.toContain('ntstatus');
  });
  it('finds the Win32 error inside an HRESULT, and a name', () => {
    expect(text(card('0x80070005', 'ntstatus'))).toContain('E_ACCESSDENIED');
    expect(text(card('0x80070057', 'ntstatus'))).toContain('Win32 error inside: ERROR_INVALID_PARAMETER');
    expect(text(card('STATUS_DLL_NOT_FOUND', 'ntstatus'))).toContain('0xC0000135');
  });
});

describe('EFI_STATUS', () => {
  it('reads a name and a 64-bit value with the error bit', () => {
    expect(text(card('EFI_NOT_FOUND', 'efi'))).toContain('The item was not found');
    const c = card('0x800000000000000E', 'efi');
    expect(text(c)).toContain('EFI_NOT_FOUND');
    expect(text(c)).toContain('64-bit');
    expect(text(card('0x8000001A', 'efi'))).toContain('EFI_SECURITY_VIOLATION');
  });
  it('reads a warning (no error bit) and refuses what is not a status', () => {
    expect(T.efi(7)).toMatchObject({ name: 'EFI_WARN_RESET_REQUIRED', kind: 'warning' });
    expect(T.efi(0)).toMatchObject({ name: 'EFI_SUCCESS' });
    expect(T.efi('EFI_MADE_UP')).toBeNull();
    expect(T.efi('zzz')).toBeNull();
    expect(T.efi(0x7fff0000)).toBeNull();
  });
});

describe('signals and exit codes', () => {
  it('reads a name, a number with a word, and a shell exit code', () => {
    expect(text(card('SIGSEGV', 'signal'))).toContain('Segmentation fault');
    expect(text(card('signal 9', 'signal'))).toContain('SIGKILL');
    const c = card('exit code 137', 'signal');
    expect(text(c)).toContain('128 + 9');
    expect(text(card('exited with status 139', 'signal'))).toContain('SIGSEGV');
    expect(kinds('exit code 200')).not.toContain('signal');
    expect(kinds('SIGNALLING')).not.toContain('signal');
  });
});

describe('cron', () => {
  const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime();   // Friday 16 Oct 2026, 12:00 local
  it('says it in words and lists the next runs in local time', () => {
    const c = card('*/15 9-17 * * MON-FRI', 'cron', { now: NOW });
    expect(text(c)).toContain('Monday');
    const next = T.cronNext('*/15 9-17 * * MON-FRI', 3, NOW);
    expect(next.map(d => d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'))).toEqual(['12:15', '12:30', '12:45']);
  });
  it('knows the macros and day-of-month with day-of-week as "either"', () => {
    expect(text(card('@daily', 'cron', { now: NOW }))).toContain('0 0 * * *');
    const n = T.cronNext('0 0 13 * 5', 3, NOW);
    expect(n.every(d => d.getDate() === 13 || d.getDay() === 5)).toBe(true);
    expect(T.cronNext('0 0 * * 7', 1, NOW)[0].getDay()).toBe(0);
  });
  it('is not found in five plain numbers, in prose, or in an invalid expression', () => {
    expect(kinds('1 2 3 4 5', { now: NOW })).not.toContain('cron');
    expect(kinds('this is five words long', { now: NOW })).not.toContain('cron');
    expect(kinds('61 * * * *', { now: NOW })).not.toContain('cron');
    expect(() => T.parseCron('* * * *')).toThrow(/five fields/);
    expect(() => T.parseCron('*/0 * * * *')).toThrow(/step/);
    expect(() => T.parseCron('* * * FOO *')).toThrow(/not valid/);
  });
  it('a date that never comes gives no runs rather than looping', () => {
    expect(T.cronNext('0 0 31 2 *', 3, NOW)).toEqual([]);
  });
});

describe('the older decodings still work', () => {
  it('base64, a Unix time and percent-encoding are unchanged', () => {
    expect(kinds('SGVsbG8sIFdvcmxkIQ==')).toContain('base64');
    expect(kinds('1700000000')).toContain('epoch');
    expect(kinds('a%20b%20c')).toContain('url');
  });
  it('an unknown selection finds nothing', () => {
    expect(D.analyze('hello there')).toEqual([]);
  });
});
