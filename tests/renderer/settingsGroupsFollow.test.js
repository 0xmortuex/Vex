// @vitest-environment jsdom
//
// A Settings section is built again every time Settings opens. A document listener added by each build closed over the section it drew, so
// every build kept its section alive for good (the smoke matrix saw about 65 nodes and 11 listeners an open). VexSettingsGroups.follow keeps
// ONE listener per section and event and calls the newest build's function.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { VexSettingsGroups } = require('../../src/renderer/js/vex-settings-groups.js');

beforeEach(() => { VexSettingsGroups._following.clear(); });

describe('VexSettingsGroups.follow', () => {
  it('adds one document listener however many times a section is built, and calls only the newest build', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const first = vi.fn(), second = vi.fn(), third = vi.fn();
    VexSettingsGroups.follow('demo', 'vex:demo-event', first);
    VexSettingsGroups.follow('demo', 'vex:demo-event', second);
    VexSettingsGroups.follow('demo', 'vex:demo-event', third);
    expect(add.mock.calls.filter(c => c[0] === 'vex:demo-event').length).toBe(1);
    document.dispatchEvent(new Event('vex:demo-event'));
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledTimes(1);
    add.mockRestore();
  });

  it('keeps sections and events apart', () => {
    const a = vi.fn(), b = vi.fn(), c = vi.fn();
    VexSettingsGroups.follow('one', 'vex:demo-a', a);
    VexSettingsGroups.follow('two', 'vex:demo-a', b);
    VexSettingsGroups.follow('one', 'vex:demo-b', c);
    document.dispatchEvent(new Event('vex:demo-a'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).not.toHaveBeenCalled();
  });

  it('refuses something that cannot be called', () => {
    expect(() => VexSettingsGroups.follow('x', 'vex:demo-c', null)).toThrow(/function/);
  });

  it('lets the old section be freed: the listener holds only the newest build', () => {
    // The listener is registered once and reads slot.fn each time, so replacing fn drops the reference to the older closure.
    VexSettingsGroups.follow('mem', 'vex:demo-d', () => 'old');
    VexSettingsGroups.follow('mem', 'vex:demo-d', () => 'new');
    expect(VexSettingsGroups._following.get('mem|vex:demo-d').fn()).toBe('new');
    expect(VexSettingsGroups._following.size).toBe(1);
  });
});
