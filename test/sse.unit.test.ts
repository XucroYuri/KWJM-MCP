import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeSse } from '../src/core/sse.js';

test('SSE 在未分帧原始缓冲超过上限时取消并拒绝', async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: 123456789'));
    },
    cancel() {
      canceled = true;
    },
  });

  await assert.rejects(
    consumeSse(new Response(body), { maxBufferChars: 8 }),
    /SSE.*缓冲区.*上限/
  );
  assert.equal(canceled, true);
});
