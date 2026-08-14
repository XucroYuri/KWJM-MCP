import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KwjmClient } from '../src/core/client.js';

test('HTTP 请求在配置的总时限到达后中止', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (!init?.signal) throw new Error('missing deadline');
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  }) as typeof fetch;

  try {
    const client = new KwjmClient({ apiKey: 'test-key', requestTimeoutMs: 5 });
    await assert.rejects(client.get('/v1/models'), /aborted/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JSON 响应超过字节上限时在解析前拒绝', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{"value":"too long"}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;

  try {
    const client = new KwjmClient({ apiKey: 'test-key', maxResponseBytes: 8 });
    await assert.rejects(client.get('/v1/models'), /响应体.*上限/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JSON 请求超过字节上限时不发送网络请求', async () => {
  const originalFetch = globalThis.fetch;
  let sent = false;
  globalThis.fetch = (async () => {
    sent = true;
    return Response.json({ ok: true });
  }) as typeof fetch;

  try {
    const client = new KwjmClient({ apiKey: 'test-key', maxRequestBytes: 8 });
    await assert.rejects(client.post('/v1/chat/completions', { value: 'too long' }), /请求体.*上限/);
    assert.equal(sent, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
