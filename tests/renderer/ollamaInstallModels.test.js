// The Ollama install guide recommended llama3.2:8b, which does not exist —
// Llama 3.2 comes in 1B and 3B; the 8B model is llama3.1:8b (AI audit
// 2026-10-10). `ollama pull` of a name that does not exist fails.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/ai-settings.js'), 'utf8');

describe('recommended Ollama models', () => {
  it('names only models that exist', () => {
    const named = [...src.matchAll(/<code>(?:ollama pull )?([a-z0-9.]+:[a-z0-9.]+)<\/code>/g)].map(m => m[1]);
    expect(named).toContain('llama3.1:8b');
    for (const tag of named.filter(t => t.startsWith('llama3.2:'))) expect(['llama3.2:1b', 'llama3.2:3b']).toContain(tag);
  });
});
