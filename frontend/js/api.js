async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch { /* keep statusText */ }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  status:   () => fetch('/api/status').then(r => r.json()),
  examples: () => fetch('/api/examples').then(r => r.json()),
  trace:    (code, input, title) => post('/api/trace', { code, input, title }),
  explain:  (traceId, title) => post('/api/explain', { trace_id: traceId, title }),

  /** Server-sent stream of tutor tokens. */
  async chat(traceId, messages, step, onChunk) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trace_id: traceId, messages, step }),
    });
    if (!res.ok) throw new Error(`Chat failed: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const data = JSON.parse(payload);
          if (data.error) throw new Error(data.error);
          if (data.text) onChunk(data.text);
        } catch (err) {
          if (err instanceof SyntaxError) continue;
          throw err;
        }
      }
    }
  },
};
