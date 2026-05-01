import { describe, it, expect, vi } from 'vitest';
import {
  decideFullscreenAction,
  handleFullscreenShortcut,
} from '../../src/main-helpers.js';

// === The "isFullScreen() lies on transparent windows" bug ===
// Electron's BrowserWindow.isFullScreen() returns false on transparent +
// frameless windows even after setFullScreen(true) succeeds. Vex therefore
// tracks fullscreen state in a separate variable (`isFullscreenTracked`),
// updated from the native enter-/leave-full-screen events. The handler must
// read that tracked state, NOT the lying API. These tests pin that contract.

function mockWindow() {
  const calls = [];
  return {
    setFullScreen: vi.fn((v) => calls.push(v)),
    // isFullScreen() intentionally lies — handler MUST not consult it.
    isFullScreen: () => false,
    _calls: calls,
  };
}

const noModInput = (over) => ({
  type: 'keyDown',
  key: 'F11',
  control: false,
  alt: false,
  shift: false,
  meta: false,
  ...over,
});

const fakeEvent = () => ({ preventDefault: vi.fn() });

describe('decideFullscreenAction (pure)', () => {
  it('F11 keyDown from non-fullscreen → toggle to true', () => {
    expect(
      decideFullscreenAction(noModInput(), { isFullscreenTracked: false })
    ).toEqual({ consumed: true, action: 'toggle', to: true });
  });

  it('F11 keyDown from fullscreen → toggle to false', () => {
    expect(
      decideFullscreenAction(noModInput(), { isFullscreenTracked: true })
    ).toEqual({ consumed: true, action: 'toggle', to: false });
  });

  it('F11 keyUp → consumed:false (handler ignores keyUp)', () => {
    expect(
      decideFullscreenAction(noModInput({ type: 'keyUp' }), { isFullscreenTracked: false })
    ).toEqual({ consumed: false });
  });

  it('F11 with Ctrl modifier → consumed:false', () => {
    expect(
      decideFullscreenAction(noModInput({ control: true }), { isFullscreenTracked: false })
    ).toEqual({ consumed: false });
  });

  it('F11 with Shift modifier → consumed:false', () => {
    expect(
      decideFullscreenAction(noModInput({ shift: true }), { isFullscreenTracked: false })
    ).toEqual({ consumed: false });
  });

  it('Esc keyDown when fullscreen → exit', () => {
    expect(
      decideFullscreenAction(noModInput({ key: 'Escape' }), { isFullscreenTracked: true })
    ).toEqual({ consumed: true, action: 'exit' });
  });

  it('Esc keyDown when NOT fullscreen → consumed:false (must not eat normal Esc)', () => {
    expect(
      decideFullscreenAction(noModInput({ key: 'Escape' }), { isFullscreenTracked: false })
    ).toEqual({ consumed: false });
  });

  it('null input → consumed:false', () => {
    expect(decideFullscreenAction(null, { isFullscreenTracked: false }))
      .toEqual({ consumed: false });
  });
});

describe('handleFullscreenShortcut (with mocked window)', () => {
  it('F11 from non-fullscreen → calls setFullScreen(true), preventDefault, returns true', () => {
    const w = mockWindow();
    const ev = fakeEvent();
    const result = handleFullscreenShortcut(ev, noModInput(), {
      mainWindow: w,
      isFullscreenTracked: false,
    });
    expect(result).toBe(true);
    expect(w.setFullScreen).toHaveBeenCalledWith(true);
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('F11 from fullscreen → calls setFullScreen(false), returns true', () => {
    const w = mockWindow();
    const result = handleFullscreenShortcut(fakeEvent(), noModInput(), {
      mainWindow: w,
      isFullscreenTracked: true,
    });
    expect(result).toBe(true);
    expect(w.setFullScreen).toHaveBeenCalledWith(false);
  });

  it('Esc from fullscreen → calls setFullScreen(false), returns true', () => {
    const w = mockWindow();
    const result = handleFullscreenShortcut(fakeEvent(), noModInput({ key: 'Escape' }), {
      mainWindow: w,
      isFullscreenTracked: true,
    });
    expect(result).toBe(true);
    expect(w.setFullScreen).toHaveBeenCalledWith(false);
  });

  it('Esc from non-fullscreen → does NOT call setFullScreen and does NOT preventDefault', () => {
    const w = mockWindow();
    const ev = fakeEvent();
    const result = handleFullscreenShortcut(ev, noModInput({ key: 'Escape' }), {
      mainWindow: w,
      isFullscreenTracked: false,
    });
    expect(result).toBe(false);
    expect(w.setFullScreen).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it('Ctrl+F11 → no action', () => {
    const w = mockWindow();
    const ev = fakeEvent();
    const result = handleFullscreenShortcut(ev, noModInput({ control: true }), {
      mainWindow: w,
      isFullscreenTracked: false,
    });
    expect(result).toBe(false);
    expect(w.setFullScreen).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it('mainWindow=null short-circuits to false (no throw)', () => {
    expect(
      handleFullscreenShortcut(fakeEvent(), noModInput(), {
        mainWindow: null,
        isFullscreenTracked: false,
      })
    ).toBe(false);
  });

  it('handler relies on the injected tracked state, not window.isFullScreen()', () => {
    // The mock's isFullScreen() lies (always returns false). If the handler
    // had consulted it, F11 from a fullscreen state would mistakenly toggle
    // from "false" back to true. We assert the handler honours the tracked
    // arg instead.
    const w = mockWindow();
    handleFullscreenShortcut(fakeEvent(), noModInput(), {
      mainWindow: w,
      isFullscreenTracked: true,
    });
    expect(w.setFullScreen).toHaveBeenCalledWith(false); // honoured tracked=true
  });
});
