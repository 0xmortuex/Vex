const SYSTEM_PROMPTS = {
  chat: `You are Vex AI, a browser assistant embedded in the Vex web browser. You help users understand web pages, answer questions, draft messages, and provide information.

You have access to the content of the current browser tab (provided in the user message as [PAGE CONTEXT]). Use this context to answer questions about the page.

Be concise. Don't over-explain. Match the user's language (if they write in Turkish, respond in Turkish).

If the user asks you to take an action on a page (click, fill, navigate), tell them to use Agent mode — click the robot button or select Ask/Plan/Auto mode in the AI panel.

Return a JSON response:
{
  "reply": "your response text",
  "citations": [{"text": "relevant excerpt from the page", "matchedQuery": "what user asked"}],
  "suggestedFollowUps": ["Follow up 1", "Follow up 2", "Follow up 3"]
}`,

  summarize: `You are a web page summarizer. Given the content of a web page, produce a concise summary.

Return JSON:
{
  "title": "Short descriptive title",
  "summary": "2-3 paragraph summary",
  "keyPoints": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"],
  "readingTime": "X min read",
  "topics": ["topic1", "topic2"]
}

Match the source language in your output unless the user specifies otherwise.`,

  translate: `You are a translator. Translate the given text to the target language. Preserve meaning, tone, and formatting.

Return JSON:
{
  "sourceLanguage": "detected language",
  "targetLanguage": "target language",
  "translation": "full translated text",
  "notes": "any translation notes if needed"
}`,

  explain: `You are a learning assistant. Given a piece of text the user selected from a webpage, explain it clearly and simply. Include context, define technical terms, and provide examples where helpful.

Return JSON:
{
  "explanation": "clear explanation",
  "keyTerms": [{"term": "word", "definition": "meaning"}],
  "context": "why this matters",
  "relatedConcepts": ["concept 1", "concept 2"]
}

Match the user's language preference.`,

  "multi-tab-chat": `You are Vex AI, helping the user reason across multiple browser tabs at once.

You receive content from MULTIPLE tabs separated by "--- TAB N: Title ---" markers. Use info from all tabs to answer.

Tasks: compare info (prices, features), summarize collectively, find contradictions, pick best option, extract structured data.

Return JSON:
{
  "reply": "main response (can use markdown tables)",
  "perTab": [{"tabIndex": 1, "title": "...", "summary": "Brief summary"}],
  "comparisons": [{"dimension": "Price", "values": [{"tab": 1, "value": "$49"}, {"tab": 2, "value": "$59"}]}],
  "recommendation": "top pick or conclusion if applicable",
  "suggestedFollowUps": ["follow-up 1", "follow-up 2"]
}

Be honest about sleeping/unloaded tabs. Match user's language.`,

  agent: `You are Vex AI, an autonomous browser agent that accomplishes tasks using tools.

CRITICAL: You MUST respond with ONLY a JSON object. No markdown fences. No explanation text. No preamble. PURE JSON ONLY.

Required JSON structure:
{"thought":"Brief reasoning","tool":"tool_name","parameters":{},"intent":"safe|action|risky"}

WORKFLOW:
1. Receive: user goal + page state + tools + previous result
2. Respond with ONE tool call as JSON
3. System executes it, sends result
4. Repeat until done, then call "finish"

RULES:
- ONE tool per response
- Use extract_elements BEFORE click or type_text (you need selectors like [data-vex-id="vex-N"])
- For navigation: {"tool":"navigate","parameters":{"url":"https://..."},"intent":"action","thought":"..."}
- When done: {"tool":"finish","parameters":{"summary":"What you did"},"intent":"safe","thought":"Done"}
- Never submit forms with passwords/payments without user asking (mark risky)

INTENT: safe=read-only, action=navigation/clicking/typing, risky=submit/delete/purchase

## CRITICAL: Avoid redundant calls
- NEVER call the same tool with identical arguments more than twice in a row — the result WILL be the same
- If a tool result says "LOOP DETECTED", you MUST pick a DIFFERENT tool or DIFFERENT arguments on the next step — do not retry
- extract_elements is IDEMPOTENT — calling it twice with the same page state is wasted work. Use its result, then act.
- If extract_elements didn't find what you need, the solution is NEVER to call it again. Instead: scroll once, navigate somewhere else, or use search.

## Common task patterns

When the user asks "find/open/search X on [site]":
1. Navigate to [site] if not already there
2. Look for a search input/icon in the current page elements — click the search icon if needed to reveal it
3. Type the query into the search input (clearFirst: true)
4. Submit: press Enter via type_text with "\n" at end, OR click the search submit button
5. Use "wait" with ms: 2000 to let the results page render
6. extract_elements ONCE to find the target result
7. Click the matching result

When the user asks "go to X" or "navigate to X":
1. Try direct URL navigation if you know the URL format
2. If that 404s or redirects to home: STOP guessing URLs. Use search from the site's home page instead.

When an action seems to fail:
- Read the error message from the lastToolResult carefully
- Switch strategy — don't retry the same failing tool

## Site-specific strategies

**Roblox (roblox.com):**
- To find a game: use the search icon in top nav → type game name → Enter → wait → click the first result under "Games"
- Game URLs follow /games/[numericId]/[slug] but IDs aren't guessable. ALWAYS search, never guess URLs.
- The homepage is a curated rotation — don't scroll hoping to find a specific game.

**YouTube:** use the search bar; click the first video unless the query specifies otherwise.

**Amazon / shopping:** search bar → product name → filter. Never scroll the homepage for a specific item.

**Gmail / email:** search bar at top. Never scroll the inbox.

RESPOND WITH PURE JSON ONLY. NO MARKDOWN FENCES. NO EXTRA TEXT.`,

  "summarize-for-history": `You are a web page summarizer for browser history indexing.

Given a page's content, produce:
1. A single-paragraph summary (2-4 sentences) of what the page is about
2. 5-10 topic tags that describe the page (single words or short phrases)
3. A content type classification (article, video, social-post, shopping, forum-thread, documentation, news, tool, game, other)

Keep summaries under 300 characters. Tags should be specific and searchable.

Return JSON:
{
  "summary": "Brief description of the page content",
  "tags": ["tag1", "tag2", "tag3"],
  "contentType": "article"
}

Match the source language. If the page is in Turkish, summarize in Turkish.

Return ONLY valid JSON. No markdown fences.`,

  "search-history": `You are a browser history search assistant. The user will describe a page they're looking for. You'll receive a list of history entries (id, url, title, summary, tags, visitedAt).

Your job: return the IDs of entries most relevant to the user's query, ranked by relevance.

Match on:
- Literal keywords in title/summary/tags
- Semantic meaning (e.g., "that article about money laundering" matches "Inside the $2B Crypto Fraud Scheme")
- Time expressions ("last week", "yesterday") — filter by visitedAt
- Content type hints ("that video", "the reddit thread")

Return JSON:
{
  "matches": [
    { "id": "h_abc", "relevanceScore": 0.95, "whyRelevant": "matches 'DPI bypass' tag and Zapret topic" },
    { "id": "h_xyz", "relevanceScore": 0.72, "whyRelevant": "title mentions VPN which is related" }
  ],
  "interpretation": "I searched for pages about DPI bypass tools visited in the last week."
}

Return at most 15 matches. Only include entries with relevance > 0.5. If nothing matches, return empty matches array and explain in interpretation.

Return ONLY valid JSON.`,

  "group-tabs": `You are a browser tab organizer. Given a list of open tabs (id, title, url, optional summary), cluster them into logical groups.

Rules:
- Propose 2-6 groups (fewer is better — don't over-fragment)
- Each group needs 2+ tabs (single-tab "groups" aren't groups)
- Some tabs can be left ungrouped (belong to no cluster)
- Prefer grouping by TOPIC or PURPOSE, not just domain
- Good group names are 2-4 words, title case, specific: "iPhone Research", "CUSA Bill Drafting", "Roblox Trading", "AI News"
- Bad group names: "Misc", "Other", "Various", "Mixed"
- Assign a color from: indigo, cyan, green, amber, red, violet, rose, teal
- Provide a "pattern" describing what makes a tab belong to this group (used to auto-add matching tabs later)

Return JSON:
{
  "groups": [
    {
      "name": "iPhone Research",
      "color": "indigo",
      "emoji": "\ud83d\udcf1",
      "tabIds": ["tab_abc", "tab_def", "tab_ghi"],
      "pattern": "Pages comparing iPhone models and reviews",
      "confidence": 0.92
    }
  ],
  "ungrouped": ["tab_xyz"],
  "reasoning": "Brief explanation of how you clustered these (1-2 sentences)"
}

Confidence: 0.0-1.0. Only include groups with confidence > 0.6.

If tabs are too diverse to meaningfully group, return { "groups": [], "ungrouped": [...all tabs], "reasoning": "Tabs are too varied — no strong clusters detected." }

Return ONLY valid JSON. No markdown fences.`,

  "screenshot-to-code": `You are an expert front-end engineer. You are given a screenshot of a web page or UI. Reproduce it as faithfully as possible in clean, self-contained code.

Rules:
- Match layout, spacing, colors, typography, and components as closely as you can from the image.
- Use placeholder text/links where real content is unknown. Use inline SVG or simple colored blocks for images/icons.
- Output a SINGLE complete, self-contained file that renders standalone (no external build step).
- Do NOT include explanations, comments about your process, or markdown fences — output ONLY the code, starting at the first character of the document.`
};

// Per-IP rate limit backed by VEX_AI_KV. This worker proxies a PAID model with
// the project's OpenRouter key and its URL ships in the public app, so without a
// limit anyone who reads the URL can drain credits or use it as a free relay.
// Two windows (burst + daily). Fails OPEN if the namespace isn't bound yet, so
// the worker keeps serving while you provision KV — see wrangler.toml.
async function aiRateLimited(env, ip) {
  if (!env.VEX_AI_KV) return false;
  try {
    const windows = [
      { sec: 60, limit: 30 },        // burst: 30 req/min/IP
      { sec: 86400, limit: 1000 },   // daily: 1000 req/day/IP
    ];
    for (const { sec, limit } of windows) {
      const win = Math.floor(Date.now() / (sec * 1000));
      const key = `rl:${ip}:${sec}:${win}`;
      const cur = parseInt(await env.VEX_AI_KV.get(key), 10) || 0;
      if (cur >= limit) return true;
      await env.VEX_AI_KV.put(key, String(cur + 1), { expirationTtl: sec + 60 });
    }
    return false;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: cors });
    }

    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    if (await aiRateLimited(env, clientIp)) {
      return Response.json({ error: "Rate limited — slow down" },
        { status: 429, headers: { ...cors, "Retry-After": "60" } });
    }

    // Reject oversized payloads before they reach the model — a multi-MB body is
    // both an abuse vector and a token-cost blowup. Text actions are tiny (page
    // text is truncated client-side); the only legitimately large body is a
    // downscaled screenshot for screenshot-to-code, so allow up to 4 MB.
    const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
    if (contentLength > 4 * 1024 * 1024) {
      return Response.json({ error: "Request too large" }, { status: 413, headers: cors });
    }

    try {
      const body = await request.json();
      const { action, message, pageContext, selectedText, targetLanguage, conversationHistory,
              userGoal, availableTools, lastToolResult } = body;

      if (!action || !SYSTEM_PROMPTS[action]) {
        return Response.json({ error: "Invalid action" }, { status: 400, headers: cors });
      }

      // Screenshot → code — a vision request. Sends the screenshot as an image
      // content block to the (vision-capable) model and returns generated code.
      if (action === "screenshot-to-code") {
        const image = body.image;
        if (!image || typeof image !== "string" || !/^data:image\//.test(image)) {
          return Response.json({ error: "A screenshot image is required" }, { status: 400, headers: cors });
        }
        const framework = body.framework || "html";
        const fwText = framework === "tailwind"
          ? "Use a single HTML file with Tailwind CSS via the CDN <script src=\"https://cdn.tailwindcss.com\"></script>."
          : framework === "react"
            ? "Use a single HTML file that loads React + Babel from a CDN and defines the UI in one inline <script type=\"text/babel\">."
            : "Use a single HTML file with plain inline CSS in a <style> tag.";
        const msgs = [
          { role: "system", content: SYSTEM_PROMPTS["screenshot-to-code"] },
          { role: "user", content: [
            { type: "text", text: `Reproduce this UI. ${fwText} Output ONLY the complete file.` },
            { type: "image_url", image_url: { url: image } },
          ] },
        ];
        const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.OPENROUTER_API_KEY, "HTTP-Referer": "https://github.com/0xmortuex/Vex", "X-Title": "Vex Screenshot-to-Code" },
          body: JSON.stringify({ model: "anthropic/claude-sonnet-4", max_tokens: 6000, messages: msgs }),
        });
        if (!aiRes.ok) { const s = aiRes.status; return Response.json({ error: s === 429 ? "Rate limited" : "AI request failed" }, { status: s, headers: cors }); }
        const aiData = await aiRes.json();
        let code = aiData.choices?.[0]?.message?.content || "";
        // Strip accidental markdown fences if the model added them.
        code = code.replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
        if (!code) return Response.json({ error: "Empty AI response" }, { status: 502, headers: cors });
        return Response.json({ result: code }, { status: 200, headers: cors });
      }

      // Agent mode — different message construction
      if (action === "agent") {
        const sysContent = SYSTEM_PROMPTS.agent + "\n\nAvailable tools:\n" + JSON.stringify(availableTools || [], null, 2);
        const msgs = [{ role: "system", content: sysContent }];
        if (Array.isArray(conversationHistory)) msgs.push(...conversationHistory.slice(-20));

        let um = "User's goal: " + (userGoal || message || "") + "\n\n";
        if (pageContext) {
          um += "Current page:\nURL: " + (pageContext.url || "") + "\nTitle: " + (pageContext.title || "") + "\n";
          if (pageContext.elements) um += "\nInteractive elements (first 50):\n" + JSON.stringify((pageContext.elements || []).slice(0, 50)) + "\n";
          if (pageContext.text) um += "\nPage text (truncated):\n" + (pageContext.text || "").substring(0, 5000) + "\n";
        }
        if (lastToolResult) um += "\nLast tool result:\n" + JSON.stringify(lastToolResult) + "\n";
        um += "\nWhat's your next action?";
        msgs.push({ role: "user", content: um });

        const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.OPENROUTER_API_KEY, "HTTP-Referer": "https://github.com/0xmortuex/Vex", "X-Title": "Vex AI Agent" },
          body: JSON.stringify({ model: "anthropic/claude-sonnet-4", max_tokens: 2000, messages: msgs }),
        });
        if (!aiRes.ok) { const s = aiRes.status; return Response.json({ error: s === 429 ? "Rate limited" : "AI request failed" }, { status: s, headers: cors }); }
        const aiData = await aiRes.json();
        const aiContent = aiData.choices?.[0]?.message?.content;
        if (!aiContent) return Response.json({ error: "Empty AI response" }, { status: 502, headers: cors });
        return Response.json({ result: aiContent }, { status: 200, headers: cors });
      }

      // Multi-tab chat
      if (action === "multi-tab-chat") {
        const { tabContexts } = body;
        const contextsText = (tabContexts || []).map((c, i) =>
          `--- TAB ${i + 1}: ${c.title} ---\nURL: ${c.url}\n\n${(c.text || "(no content)").substring(0, 8000)}\n`
        ).join("\n\n");
        // Phase 15: if a persona is present, layer its voice on top of the
        // multi-tab JSON schema instructions so the reply adopts its style
        // while still returning the structured fields the client expects.
        const mtBase = SYSTEM_PROMPTS["multi-tab-chat"];
        const mtSystem = body.personaSystemPrompt
          ? `${body.personaSystemPrompt}\n\n---\n\nYou are also operating in multi-tab mode. ${mtBase}`
          : mtBase;
        const msgs = [{ role: "system", content: mtSystem }];
        if (Array.isArray(conversationHistory)) msgs.push(...conversationHistory.slice(-6));
        msgs.push({ role: "user", content: `[${(tabContexts || []).length} TABS]\n\n${contextsText}\n\n---\n\nUser: ${message}` });
        const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.OPENROUTER_API_KEY, "HTTP-Referer": "https://github.com/0xmortuex/Vex", "X-Title": "Vex AI Multi-Tab" },
          body: JSON.stringify({ model: "anthropic/claude-sonnet-4", max_tokens: 4000, ...(typeof body.personaTemperature === "number" ? { temperature: body.personaTemperature } : {}), messages: msgs }),
        });
        if (!aiRes.ok) { const s = aiRes.status; return Response.json({ error: s === 429 ? "Rate limited" : "AI request failed" }, { status: s, headers: cors }); }
        const aiData = await aiRes.json();
        const aiContent = aiData.choices?.[0]?.message?.content;
        if (!aiContent) return Response.json({ error: "Empty AI response" }, { status: 502, headers: cors });
        return Response.json({ result: aiContent }, { status: 200, headers: cors });
      }

      // Phase 12: Page summarization for history indexing
      if (action === "summarize-for-history") {
        if (!pageContext || !pageContext.text) {
          return Response.json({ error: "No page content provided" }, { status: 400, headers: cors });
        }
        const um = `URL: ${pageContext.url || ""}\nTitle: ${pageContext.title || ""}\n\nContent:\n${(pageContext.text || "").substring(0, 8000)}`;
        const msgs = [
          { role: "system", content: SYSTEM_PROMPTS["summarize-for-history"] },
          { role: "user", content: um }
        ];
        const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.OPENROUTER_API_KEY, "HTTP-Referer": "https://github.com/0xmortuex/Vex", "X-Title": "Vex AI History Index" },
          body: JSON.stringify({ model: "anthropic/claude-sonnet-4", max_tokens: 500, messages: msgs }),
        });
        if (!aiRes.ok) { const s = aiRes.status; return Response.json({ error: s === 429 ? "Rate limited" : "AI request failed" }, { status: s, headers: cors }); }
        const aiData = await aiRes.json();
        const aiContent = aiData.choices?.[0]?.message?.content;
        if (!aiContent) return Response.json({ error: "Empty AI response" }, { status: 502, headers: cors });
        return Response.json({ result: aiContent }, { status: 200, headers: cors });
      }

      // Phase 12: Semantic history search
      if (action === "search-history") {
        const { query, historyEntries, timeContext } = body;
        if (!query || !Array.isArray(historyEntries)) {
          return Response.json({ error: "Missing query or history" }, { status: 400, headers: cors });
        }
        const entries = historyEntries.slice(0, 200);
        const um = `User query: "${query}"\n\nCurrent time: ${timeContext || new Date().toISOString()}\n\nHistory entries (${entries.length} total):\n${JSON.stringify(entries, null, 2)}\n\nFind the most relevant matches.`;
        const msgs = [
          { role: "system", content: SYSTEM_PROMPTS["search-history"] },
          { role: "user", content: um }
        ];
        const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.OPENROUTER_API_KEY, "HTTP-Referer": "https://github.com/0xmortuex/Vex", "X-Title": "Vex AI History Search" },
          body: JSON.stringify({ model: "anthropic/claude-sonnet-4", max_tokens: 2000, messages: msgs }),
        });
        if (!aiRes.ok) { const s = aiRes.status; return Response.json({ error: s === 429 ? "Rate limited" : "AI request failed" }, { status: s, headers: cors }); }
        const aiData = await aiRes.json();
        const aiContent = aiData.choices?.[0]?.message?.content;
        if (!aiContent) return Response.json({ error: "Empty AI response" }, { status: 502, headers: cors });
        return Response.json({ result: aiContent }, { status: 200, headers: cors });
      }

      // Phase 16: Tab clustering
      if (action === "group-tabs") {
        const { tabs } = body;
        if (!Array.isArray(tabs) || tabs.length < 3) {
          return Response.json({ error: "Need at least 3 tabs to suggest groupings" }, { status: 400, headers: cors });
        }
        const compact = tabs.slice(0, 50).map(t => ({
          id: t.id,
          title: String(t.title || '').substring(0, 120),
          url: t.url,
          summary: String(t.summary || '').substring(0, 160)
        }));
        const msgs = [
          { role: "system", content: SYSTEM_PROMPTS["group-tabs"] },
          { role: "user", content: `Cluster these ${compact.length} open tabs:\n\n${JSON.stringify(compact, null, 2)}` }
        ];
        const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.OPENROUTER_API_KEY, "HTTP-Referer": "https://github.com/0xmortuex/Vex", "X-Title": "Vex AI Group Tabs" },
          body: JSON.stringify({ model: "anthropic/claude-sonnet-4", max_tokens: 2500, temperature: 0.3, messages: msgs })
        });
        if (!aiRes.ok) { const s = aiRes.status; return Response.json({ error: s === 429 ? "Rate limited" : "AI request failed" }, { status: s, headers: cors }); }
        const aiData = await aiRes.json();
        const aiContent = aiData.choices?.[0]?.message?.content;
        if (!aiContent) return Response.json({ error: "Empty AI response" }, { status: 502, headers: cors });
        return Response.json({ result: aiContent }, { status: 200, headers: cors });
      }

      let userMessage = "";

      if (action === "chat") {
        let context = "";
        if (pageContext) {
          context = `\n\n[PAGE CONTEXT]\nURL: ${pageContext.url}\nTitle: ${pageContext.title}\nContent (truncated):\n${(pageContext.text || "").substring(0, 8000)}\n[END PAGE CONTEXT]\n\n`;
        }
        userMessage = `${context}User question: ${message}`;
      } else if (action === "summarize") {
        userMessage = `Summarize this webpage:\n\nURL: ${pageContext?.url || "unknown"}\nTitle: ${pageContext?.title || "unknown"}\n\nContent:\n${(pageContext?.text || "").substring(0, 20000)}`;
      } else if (action === "translate") {
        userMessage = `Translate the following text to ${targetLanguage || "English"}:\n\n${selectedText || pageContext?.text || ""}`;
      } else if (action === "explain") {
        userMessage = `The user selected this text from a webpage and wants it explained:\n\nSelected text: "${selectedText}"\n\nPage URL: ${pageContext?.url || "unknown"}\nPage title: ${pageContext?.title || "unknown"}`;
      }

      // Phase 15: persona overrides the default system prompt + temperature for
      // chat/summarize/translate/explain. Structured prompts still return JSON
      // because the persona's prompt (for built-ins) already specifies it.
      const personaSystemPrompt = body.personaSystemPrompt;
      const personaTemperature = body.personaTemperature;
      const systemPrompt = (action === "chat" && personaSystemPrompt)
        ? personaSystemPrompt
        : SYSTEM_PROMPTS[action];

      const messages = [{ role: "system", content: systemPrompt }];

      if (action === "chat" && Array.isArray(conversationHistory)) {
        messages.push(...conversationHistory.slice(-10));
      }

      messages.push({ role: "user", content: userMessage });

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://github.com/0xmortuex/Vex",
          "X-Title": "Vex AI",
        },
        body: JSON.stringify({
          model: "anthropic/claude-sonnet-4",
          max_tokens: 4000,
          ...(typeof personaTemperature === "number" ? { temperature: personaTemperature } : {}),
          messages
        }),
      });

      if (!response.ok) {
        const s = response.status;
        let msg = "AI request failed";
        if (s === 401) msg = "AI not configured — add OPENROUTER_API_KEY";
        if (s === 429) msg = "Rate limited — try again in a moment";
        return Response.json({ error: msg }, { status: s, headers: cors });
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        return Response.json({ error: "Empty response from AI" }, { status: 502, headers: cors });
      }

      return Response.json({ result: content }, { status: 200, headers: cors });
    } catch (err) {
      return Response.json({ error: err.message || "Internal error" }, { status: 500, headers: cors });
    }
  },
};

// Named export for unit tests (no effect on the Worker runtime).
export { aiRateLimited };
