// The cloud worker's prompts carry the same rules as the app's own
// (src/renderer/js/ai-router.js): an instruction is an order, answered in one
// line. The chat prompt still sent people to "the robot button", which is
// long gone (AI audit 2026-10-10). Changing these needs a redeploy of the
// worker to reach anyone.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const worker = fs.readFileSync(path.join(__dirname, '../../workers/vex-ai-worker/worker.js'), 'utf8');
const router = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/ai-router.js'), 'utf8');
const ORDER = 'An instruction is an order: carry it out and say what happened in one line, or say in one sentence that you cannot.';
const AGENT_ORDER = 'You were given an order, so carry it out.';

describe('cloud worker prompts', () => {
  it('no longer mention the robot button', () => {
    expect(worker).not.toMatch(/robot button/i);
  });

  it('carry the same order rules as the app', () => {
    expect(router).toContain(ORDER);
    expect(worker).toContain(ORDER);
    expect(router).toContain(AGENT_ORDER);
    expect(worker).toContain(AGENT_ORDER);
  });
});
