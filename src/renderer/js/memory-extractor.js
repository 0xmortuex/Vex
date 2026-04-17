// === Vex Phase 17A: Memory Recorder — AI extraction ===
// When a conversation finalizes, pull structured info (title, summary,
// memories, action items, people, topics, sentiment) via AIRouter.

const MemoryExtractor = (() => {
  const SYSTEM_PROMPT = `You analyze conversation transcripts and extract structured info.

Return ONLY this JSON (no markdown fences):
{
  "reply": "not used — set to empty string",
  "title": "Short title (4-8 words)",
  "summary": "2-3 sentence summary of what was discussed",
  "memories": ["fact 1", "fact 2"],
  "actionItems": ["Follow up with X about Y"],
  "people": ["Names mentioned"],
  "topics": ["topic1", "topic2"],
  "sentiment": "positive | neutral | negative | mixed",
  "language": "en | tr | ..."
}

Only include items actually mentioned — don't invent. If the transcript is garbled or too short, return empty arrays and a title like "(unclear)". Match the transcript's language in title/summary/memories.`;

  function _aiEnabled() {
    try {
      const raw = localStorage.getItem('vex.memoryAIEnabled');
      return raw === null ? true : JSON.parse(raw) === true;
    } catch { return true; }
  }

  async function extractFromConversation(conversationId) {
    if (!_aiEnabled()) return null;
    if (typeof AIRouter === 'undefined') return null;

    const conv = await window.vex.memoryLoad(conversationId);
    if (!conv || !conv.transcript || conv.transcript.length < 20) return null;

    try {
      const res = await AIRouter.callAI('chat', {
        message: `Analyze this conversation transcript:\n\n"${conv.transcript.substring(0, 6000)}"`,
        persona: { systemPrompt: SYSTEM_PROMPT, temperature: 0.3 }
      });
      let parsed;
      try {
        const str = String(res.result || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
        parsed = JSON.parse(str);
      } catch { return null; }

      await window.vex.memoryUpdateMeta(conversationId, {
        title: parsed.title || null,
        summary: parsed.summary || null,
        memories: Array.isArray(parsed.memories) ? parsed.memories : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
        people: Array.isArray(parsed.people) ? parsed.people : [],
        topics: Array.isArray(parsed.topics) ? parsed.topics : [],
        sentiment: parsed.sentiment || null,
        language: parsed.language || null,
        processed: true,
        processedAt: new Date().toISOString()
      });

      // Tell any open panel to refresh
      window.dispatchEvent(new CustomEvent('vex-memory-extracted', { detail: { id: conversationId } }));
      return parsed;
    } catch (err) {
      console.error('[MemoryExtractor] failed:', err.message);
      return null;
    }
  }

  async function processUnextracted() {
    if (!_aiEnabled()) return;
    const index = await window.vex.memoryList();
    const todo = (index || []).filter(e => !e.processed);
    for (const entry of todo) {
      await extractFromConversation(entry.id);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Auto-extract on finalize
  if (window.vex && window.vex.onMemoryConversationFinalized) {
    window.vex.onMemoryConversationFinalized((data) => {
      setTimeout(() => extractFromConversation(data.id), 2000);
    });
  }

  return { extractFromConversation, processUnextracted };
})();

window.MemoryExtractor = MemoryExtractor;
