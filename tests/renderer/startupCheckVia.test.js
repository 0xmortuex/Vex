// @vitest-environment jsdom
//
// T3-122 (Wave 6): the window says which way a program was found when a task or a shortcut led to it.
import { describe, it, expect } from 'vitest';
const { VexStartupCheck } = require('../../src/renderer/js/startup-check.js');

describe('signatureNotes', () => {
  it('adds the way to the line for a task and a shortcut, and to nothing else', () => {
    const m = VexStartupCheck.signatureNotes([
      { id: 'a', status: 'NotSigned', via: 'task' }, { id: 'b', status: 'Valid', signer: 'X', via: 'shortcut' },
      { id: 'c', status: 'Valid', signer: 'Y' }, { id: 'd', status: 'unchecked', why: 'z', via: 'task' },
    ]);
    expect(m.get('a').text).toMatch(/scheduled task runs\)$/);
    expect(m.get('a').unsigned).toBe(true);
    expect(m.get('b').text).toMatch(/shortcut starts\)$/);
    expect(m.get('c').text).toBe('Signed by Y');
    expect(m.get('d').text).toBe('Not checked: z');
  });
});
