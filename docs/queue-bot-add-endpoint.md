# Letting Vex add an item to the Queue (queue-bot)

Vex can send a task to your personal Queue panel ("Unread to task" > "Also add it to my Queue"), but the
deployed queue-bot Worker (github.com/0xmortuex/queue-bot, `src/worker.js`) only accepts items from Telegram:
its routes are `POST /webhook`, `GET /queue`, `POST /queue/<id>/done` and `DELETE /queue/<id>`. There is no
route that adds an item from Vex. Vex does **not** deploy or change that Worker, so this switch stays off until
you add the route below and deploy it yourself (`wrangler deploy` in the queue-bot repo).

Vex calls `POST <queueUrl>/queue?secret=<queueSecret>` with `Content-Type: application/json` and the body
`{"text": "...", "source": "vex"}`. It expects `200` or `201`. A `404` or `405` is reported as "your queue bot
has no way to add items yet"; a `403` as a wrong secret. The secret is the one already in your local
`sidebar-config.json`; it is sent only to the `queueUrl` you configured.

## The change to queue-bot

In `src/worker.js`, next to `handleGetQueue`:

```js
async function handleAdd(request, env, url) {
  if (!requireQueueSecret(env, url)) return json({ error: 'forbidden' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'body must be JSON' }, 400); }
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
  if (!text) return json({ error: 'text is required' }, 400);
  const item = {
    id: crypto.randomUUID(),
    text,
    timestamp: new Date().toISOString(),
    status: 'pending',
    source: body.source === 'vex' ? 'vex' : 'api',
  };
  await putItem(env, item);
  return json(item, 201);
}
```

and in `route()`, before the `GET /queue` branch:

```js
  if (pathname === '/queue' && request.method === 'POST') {
    return handleAdd(request, env, url);
  }
```

`putItem`, `json`, `requireQueueSecret` and `crypto.randomUUID()` already exist or are available in the Worker
runtime. Add a test next to `test/queue.test.mjs` for a missing secret (403), an empty text (400) and a good
add (201, then it appears in `GET /queue`). The existing 50-reads-an-hour limit applies only to reads; if you
want a cap on adds, count them the same way `checkRateLimit` does.
