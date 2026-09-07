// Shared bounded HTTP transport for first-party UI and main-process requests.
(function () {
  function createBoundedFetch(fetchImpl) {
    return async function boundedFetch(url, options = {}) {
      const { maxBytes = 32 * 1024 * 1024, maxRequestBytes = 16 * 1024 * 1024, timeoutMs = 30000, stream = false, ...init } = options;
      if (!Number.isFinite(maxBytes) || maxBytes < 1 || !Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('Invalid request limits');
      if (typeof init.body === 'string' && new TextEncoder().encode(init.body).byteLength > maxRequestBytes) throw new Error('Request too large');
      if (init.body?.byteLength > maxRequestBytes || init.body?.size > maxRequestBytes) throw new Error('Request too large');
      const controller = new AbortController();
      const abort = () => controller.abort(init.signal.reason || new Error('Request cancelled'));
      let rejectAbort;
      const aborted = new Promise((_, reject) => { rejectAbort = reject; });
      aborted.catch(() => {});
      const onAbort = () => rejectAbort(controller.signal.reason || new Error('Request cancelled'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
      if (init.signal?.aborted) abort(); else init.signal?.addEventListener('abort', abort, { once: true });
      let reader, completed = false;
      const cleanup = () => { clearTimeout(timer); init.signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onAbort); };
      const cancel = reason => { try { Promise.resolve(reader?.cancel(reason)).catch(() => {}); } catch {} cleanup(); };
      try {
        if (controller.signal.aborted) throw controller.signal.reason;
        const response = await Promise.race([fetchImpl(url, { ...init, signal: controller.signal }), aborted]);
        if (!response.body) { cleanup(); return response; }
        reader = response.body.getReader();
        if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Response too large');
        let size = 0;
        const read = async () => {
          const part = await Promise.race([reader.read(), aborted]);
          if (!part.done) { size += part.value.byteLength; if (size > maxBytes) throw new Error('Response too large'); }
          return part;
        };
        const headers = new Headers(response.headers);
        headers.delete('content-encoding'); headers.delete('content-length');
        let body;
        if (stream) {
          body = new ReadableStream({
            async pull(sink) {
              try {
                const part = await read();
                if (part.done) { cleanup(); reader.releaseLock(); sink.close(); }
                else sink.enqueue(part.value);
              } catch (error) { cancel(error); sink.error(error); }
            },
            cancel,
          });
          aborted.catch(cancel);
        } else {
          const chunks = [];
          for (;;) { const part = await read(); if (part.done) break; chunks.push(part.value); }
          body = new Uint8Array(size);
          let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
          cleanup(); reader.releaseLock();
        }
        const output = new Response(body, { status: response.status, statusText: response.statusText, headers });
        for (const name of ['url', 'redirected', 'type']) Object.defineProperty(output, name, { value: response[name] });
        completed = true;
        return output;
      } finally { if (!completed) cancel(); }
    };
  }
  if (typeof window !== 'undefined') window.VexNet = { createBoundedFetch, fetch: createBoundedFetch((...args) => fetch(...args)) };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createBoundedFetch };
})();
