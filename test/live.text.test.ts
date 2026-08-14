import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KwjmClient } from '../src/core/client.js';
import { ModelRegistry } from '../src/core/registry.js';
import { registerText } from '../src/handlers/text.js';
import { parseToolResult, readLiveConfig, toolHandler } from './live-support.js';

const config = readLiveConfig();
const maybe = config ? test : test.skip;

function liveTextTool(name: 'chat_completions' | 'messages') {
  const registrations: any[] = [];
  registerText(
    { tool: ((...args: any[]) => registrations.push(args)) as any },
    new ModelRegistry(),
    () => new KwjmClient(config!)
  );
  return toolHandler(registrations, name);
}

maybe('live text: deepseek-v4-flash 普通对话最低输出', async () => {
  const call = liveTextTool('chat_completions');
  const result = await call({
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'Reply with one digit: 1' }],
    max_tokens: 1,
  });
  assert.equal(result.isError, false);
  const parsed = parseToolResult(result);
  assert.ok(Array.isArray(parsed.result?.choices));
  assert.ok(parsed.result?.usage);
});

maybe('live text: deepseek-v4-flash 流式逐事件完成', async () => {
  const call = liveTextTool('chat_completions');
  const notifications: any[] = [];
  const result = await call(
    {
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Reply with one digit: 1' }],
      max_tokens: 1,
      stream: true,
    },
    {
      _meta: { progressToken: 'live-stream' },
      sendNotification: async (notification: unknown) => notifications.push(notification),
    }
  );
  assert.equal(result.isError, false);
  const parsed = parseToolResult(result);
  assert.ok(parsed.stream?.eventCount > 0);
  assert.equal(parsed.sse, undefined);
  assert.ok(notifications.length > 0);
});

maybe('live text: deepseek-v4-flash 强制工具调用', async () => {
  const call = liveTextTool('chat_completions');
  const result = await call({
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'Call ping with value 1.' }],
    tools: [{
      type: 'function',
      function: {
        name: 'ping',
        description: 'Return a number.',
        parameters: {
          type: 'object',
          properties: { value: { type: 'integer' } },
          required: ['value'],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: { type: 'function', function: { name: 'ping' } },
    parallel_tool_calls: false,
    max_tokens: 64,
  });
  assert.equal(result.isError, false);
  const parsed = parseToolResult(result);
  const calls = parsed.result?.choices?.[0]?.message?.tool_calls;
  assert.ok(Array.isArray(calls) && calls.length > 0);
  assert.equal(calls[0]?.function?.name, 'ping');
});

maybe('live text: gpt-5.6-terra 图片理解', async () => {
  const call = liveTextTool('chat_completions');
  const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const result = await call({
    model: 'gpt-5.6-terra',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Reply only OK if an image is attached.' },
        { type: 'image_url', image_url: { url: onePixelPng } },
      ],
    }],
    max_tokens: 8,
  });
  assert.equal(result.isError, false);
  const parsed = parseToolResult(result);
  assert.ok(Array.isArray(parsed.result?.choices));
});

maybe('live text: Anthropic Messages 真实路由', async () => {
  const call = liveTextTool('messages');
  const result = await call({
    model: 'claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: 'Reply with one digit: 1' }],
    max_tokens: 1,
  });
  assert.equal(result.isError, false);
  const parsed = parseToolResult(result);
  assert.ok(Array.isArray(parsed.result?.content));
  assert.ok(parsed.result?.usage);
});
