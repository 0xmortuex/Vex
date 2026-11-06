// Page automations: the IPC contract. Every channel has a schema, is for Vex's own window only, and is closed in
// private windows; a page, an extension or a malformed call cannot start, approve or change a run.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const { validate, schemas } = require('../../src/main/ipc-schemas.js');
const policySource = fs.readFileSync('src/main/ipc-policy.js', 'utf8');
const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
const preload = fs.readFileSync('src/preload.js', 'utf8');
const wire = fs.readFileSync('src/main/automations-wire.js', 'utf8');

const channels = [...wire.matchAll(/ipcMain\.handle\('(automations:[a-z-]+)'/g)].map(m => m[1]);

describe('page automations IPC', () => {
  it('the main process answers fifteen channels and the preload offers exactly those', () => {
    expect(channels).toHaveLength(15);
    const offered = [...preload.matchAll(/ipcRenderer\.invoke\('(automations:[a-z-]+)'/g)].map(m => m[1]);
    expect(new Set(offered)).toEqual(new Set(channels));
  });
  it('every channel has a payload schema and is Vex-window-only', () => {
    for (const c of channels) {
      expect(schemas.has(c), c).toBe(true);
      expect(UI_ONLY_CHANNELS.has(c), c).toBe(true);
    }
  });
  it('is closed in private windows', () => {
    const rx = /const PRIVATE_DISABLED = (\/.*\/);/.exec(policySource);
    const re = eval(rx[1]);   // the literal regex from the source
    for (const c of channels) expect(re.test(c), c).toBe(true);
  });
  it('takes ids of the shape main makes, and nothing else', () => {
    expect(() => validate('automations:run', ['a1b2c3'])).not.toThrow();
    for (const bad of [42, '', '../x', 'a b', 'x'.repeat(65), null, { id: 1 }]) {
      expect(() => validate('automations:run', [bad]), String(bad)).toThrow();
      expect(() => validate('automations:delete', [bad]), String(bad)).toThrow();
    }
    expect(() => validate('automations:run', [])).toThrow();
  });
  it('a decision is one of three words', () => {
    for (const d of ['approve', 'skip', 'stop']) expect(() => validate('automations:decide', ['r1', d])).not.toThrow();
    for (const d of ['yes', 'APPROVE', '', 1, undefined]) expect(() => validate('automations:decide', ['r1', d]), String(d)).toThrow();
  });
  it('a recording is an object of bounded size; an import is bounded text', () => {
    expect(() => validate('automations:save', [{ name: 'x', steps: [] }])).not.toThrow();
    expect(() => validate('automations:save', ['text'])).toThrow();
    expect(() => validate('automations:save', [[]])).toThrow();
    expect(() => validate('automations:save', [{ blob: 'x'.repeat(800000) }])).toThrow();
    expect(() => validate('automations:import', ['{"format":"vex-automation"}'])).not.toThrow();
    expect(() => validate('automations:import', ['x'.repeat(700001)])).toThrow();
    expect(() => validate('automations:import', [{}])).toThrow();
  });
  it('the switch takes a boolean; the argument-less ones take nothing', () => {
    expect(() => validate('automations:set-enabled', [true])).not.toThrow();
    expect(() => validate('automations:set-enabled', ['yes'])).toThrow();
    for (const c of ['automations:state', 'automations:kill', 'automations:rearm', 'automations:stop', 'automations:reveal']) {
      expect(() => validate(c, [])).not.toThrow();
      expect(() => validate(c, ['x'])).toThrow();
    }
    expect(() => validate('automations:ack', [['a1', 'b2']])).not.toThrow();
    expect(() => validate('automations:ack', [['a1', '../b2']])).toThrow();
    expect(() => validate('automations:runs', [])).not.toThrow();
  });
});
