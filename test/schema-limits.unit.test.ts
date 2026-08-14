import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ZodTypeAny } from 'zod';
import type { KwjmClient } from '../src/core/client.js';
import { ModelRegistry } from '../src/core/registry.js';
import { registerText } from '../src/handlers/text.js';
import { registerImage } from '../src/handlers/image.js';
import { registerVideo } from '../src/handlers/video.js';

function captureSchemas(): Map<string, Record<string, ZodTypeAny>> {
  const schemas = new Map<string, Record<string, ZodTypeAny>>();
  const server = {
    tool: ((name: string, _description: string, schema: Record<string, ZodTypeAny>) => {
      schemas.set(name, schema);
    }) as any,
  };
  const registry = new ModelRegistry();
  const client = () => ({}) as KwjmClient;
  registerText(server, registry, client);
  registerImage(server, registry, client);
  registerVideo(server, registry, client);
  return schemas;
}

test('文本 schema 拒绝过高 token 上限和过长消息列表', () => {
  const chat = captureSchemas().get('chat_completions');
  assert.ok(chat);
  assert.equal(chat.max_tokens.safeParse(131_073).success, false);
  assert.equal(chat.messages.safeParse(Array.from({ length: 257 }, () => ({ role: 'user', content: 'x' }))).success, false);
});

test('图片 schema 将单次生成数量限制为 4', () => {
  const image = captureSchemas().get('generate_image');
  assert.ok(image);
  assert.equal(image.n.safeParse(5).success, false);
  assert.equal(image.n.safeParse(4).success, true);
});

test('视频 schema 拒绝过长内容列表和超过 60 秒的请求', () => {
  const video = captureSchemas().get('generate_video');
  assert.ok(video);
  assert.equal(video.content.safeParse(Array.from({ length: 17 }, () => ({ type: 'text', text: 'x' }))).success, false);
  assert.equal(video.duration.safeParse(61).success, false);
});
