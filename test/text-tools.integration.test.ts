import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KwjmClient } from '../src/core/client.js';
import { ModelRegistry } from '../src/core/registry.js';
import { registerText } from '../src/handlers/text.js';

type Registered = {
  name: string;
  schema: Record<string, unknown>;
  handler: (args: any, extra?: any) => Promise<any>;
};

function textRegistry(): ModelRegistry {
  return new ModelRegistry([
    {
      id: 'deepseek-v4-flash',
      family: 'deepseek',
      modality: 'text',
      endpoints: [{ path: '/v1/chat/completions', method: 'POST', async: false }],
      selectionLevel: 'fallback',
    },
    {
      id: 'claude-sonnet-test',
      family: 'anthropic',
      modality: 'text',
      endpoints: [{ path: '/v1/messages', method: 'POST', async: false }],
      selectionLevel: 'fallback',
    },
  ]);
}

function captureTextTools(fakeClient: Partial<KwjmClient>): Registered[] {
  const registered: Registered[] = [];
  registerText(
    {
      tool: ((name: string, _description: string, schema: Record<string, unknown>, handler: Registered['handler']) => {
        registered.push({ name, schema, handler });
      }) as any,
    },
    textRegistry(),
    () => fakeClient as KwjmClient
  );
  return registered;
}

test('chat_completions 暴露并原样传递工具调用字段', async () => {
  const calls: Array<{ path: string; payload: any }> = [];
  const tools = captureTextTools({
    post: async (path: string, payload: unknown) => {
      calls.push({ path, payload });
      return { id: 'chatcmpl-test', choices: [] };
    },
  });
  const chat = tools.find((entry) => entry.name === 'chat_completions');
  assert.ok(chat);
  assert.ok('tools' in chat.schema);
  assert.ok('tool_choice' in chat.schema);
  assert.ok('parallel_tool_calls' in chat.schema);

  const toolDefinition = {
    type: 'function',
    function: {
      name: 'lookup_weather',
      description: '查询天气',
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    },
  };
  const assistantToolCall = {
    id: 'call_1',
    type: 'function',
    function: { name: 'lookup_weather', arguments: '{"city":"上海"}' },
  };

  const result = await chat.handler({
    model: 'deepseek-v4-flash',
    explicit: true,
    messages: [
      { role: 'user', content: '上海天气如何？' },
      { role: 'assistant', content: null, tool_calls: [assistantToolCall] },
      { role: 'tool', tool_call_id: 'call_1', name: 'lookup_weather', content: '{"weather":"sunny"}' },
    ],
    tools: [toolDefinition],
    tool_choice: { type: 'function', function: { name: 'lookup_weather' } },
    parallel_tool_calls: false,
    max_tokens: 1,
  });

  assert.equal(result.isError, false);
  assert.equal(calls[0].path, '/v1/chat/completions');
  assert.deepEqual(calls[0].payload.tools, [toolDefinition]);
  assert.deepEqual(calls[0].payload.tool_choice, { type: 'function', function: { name: 'lookup_weather' } });
  assert.equal(calls[0].payload.parallel_tool_calls, false);
  assert.deepEqual(calls[0].payload.messages[1].tool_calls, [assistantToolCall]);
  assert.equal(calls[0].payload.messages[2].tool_call_id, 'call_1');
});

test('messages 使用完整 /v1/messages 路径', async () => {
  const paths: string[] = [];
  const tools = captureTextTools({
    post: async (path: string) => {
      paths.push(path);
      return { id: 'msg-test', content: [] };
    },
  });
  const messages = tools.find((entry) => entry.name === 'messages');
  assert.ok(messages);
  const result = await messages.handler({
    model: 'claude-sonnet-test',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
  });
  assert.equal(result.isError, false);
  assert.equal(paths[0], '/v1/messages');
});

test('stream=true 逐事件通知进度且最终结果不包含原始 SSE', async () => {
  const encoder = new TextEncoder();
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"O"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"K"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );
  const tools = captureTextTools({ postStream: async () => response });
  const chat = tools.find((entry) => entry.name === 'chat_completions');
  assert.ok(chat);
  const notifications: any[] = [];
  const result = await chat.handler(
    {
      model: 'deepseek-v4-flash',
      explicit: true,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
      stream: true,
    },
    {
      _meta: { progressToken: 'stream-test' },
      sendNotification: async (notification: unknown) => notifications.push(notification),
    }
  );

  assert.equal(result.isError, false);
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.sse, undefined);
  assert.equal(parsed.stream.eventCount, 2);
  assert.equal(parsed.stream.text, 'OK');
  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].method, 'notifications/progress');
  assert.equal(notifications[0].params.progressToken, 'stream-test');
  assert.equal(notifications[0].params.message, '已接收流式事件 1');
});

test('messages stream 同样发送 MCP progress 且不返回原始 SSE', async () => {
  const encoder = new TextEncoder();
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: content_block_delta\ndata: {"delta":{"text":"A"}}\n\n'));
        controller.enqueue(encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );
  const tools = captureTextTools({ postStream: async () => response });
  const messages = tools.find((entry) => entry.name === 'messages');
  assert.ok(messages);
  const notifications: any[] = [];
  const result = await messages.handler(
    {
      model: 'claude-sonnet-test',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
      stream: true,
    },
    {
      _meta: { progressToken: 'messages-stream' },
      sendNotification: async (notification: unknown) => notifications.push(notification),
    }
  );
  assert.equal(result.isError, false);
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.sse, undefined);
  assert.equal(parsed.stream.text, 'A');
  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].params.progressToken, 'messages-stream');
  assert.equal(notifications[0].params.message, '已接收流式事件 1');
});
