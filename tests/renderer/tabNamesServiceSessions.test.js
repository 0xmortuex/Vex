// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const { VexTabNames: N } = require('../../src/renderer/js/tab-names.js');
const tab = partition => ({id:'discord-tab',url:'https://discord.com/channels/@me/123',title:'Discord',partition});
beforeEach(() => { localStorage.clear(); delete window.VexTabPolicy; });
afterEach(() => { vi.unstubAllGlobals(); delete window.VexTabPolicy; });
describe('saved names in built-in service tabs', () => {
  it.each(['persist:discord','persist:whatsapp','persist:claude','persist:spotify','persist:netflix','persist:roblox'])('allows an ordinary %s service session', partition => {
    const t=tab(partition); expect(N.allowed(t)).toBe(true);
    N.set(t,'Friends'); expect(N.display({...t})).toBe('Friends');
  });
  it.each(['private-1','otr-1','tor-1','persist:route-tor','persist:route-proxy','persist:container-work','persist:container-tor-a','persist:unknown-service'])('keeps %s out of the saved name store', partition => {
    expect(N.allowed(tab(partition))).toBe(false);
    expect(()=>N.set(tab(partition),'Do not save')).toThrow();
    expect(localStorage.getItem(N.KEY)).toBeNull();
  });
  it('rejects a private window even if its tab record says persist:main or a normal service session', () => {
    window.VexTabPolicy={isPrivateWindow:true};
    expect(N.allowed(tab('persist:main'))).toBe(false); expect(N.allowed(tab('persist:discord'))).toBe(false);
  });
  it('honors the shared persistence and routing refusals', () => {
    window.VexTabPolicy={canPersist:()=>false}; expect(N.allowed(tab('persist:discord'))).toBe(false);
    window.VexTabPolicy={canPersist:()=>true,isRouted:()=>true}; expect(N.allowed(tab('persist:discord'))).toBe(false);
  });
  it('still rejects internal pages and supports the main profile', () => {
    expect(N.allowed({...tab('persist:discord'),url:'vex://start'})).toBe(false);
    expect(N.allowed(tab('persist:main'))).toBe(true); expect(N.allowed(tab(null))).toBe(true);
  });
  it('opens the rename prompt, saves the service-tab name and rebuilds the strip', async () => {
    const t=tab('persist:discord'); vi.stubGlobal('TabManager',{getActiveTab:()=>t,rebuildAllTabs:vi.fn()});
    vi.stubGlobal('vexPrompt',vi.fn(async()=>'Friends')); window.showToast=vi.fn();
    expect(await N.rename()).toBe('Friends'); expect(N.display(t)).toBe('Friends');
    expect(TabManager.rebuildAllTabs).toHaveBeenCalledOnce();
  });
});
