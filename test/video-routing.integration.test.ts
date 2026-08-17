import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KwjmClient } from '../src/core/client.js';
import { ModelRegistry } from '../src/core/registry.js';
import { registerVideo } from '../src/handlers/video.js';

async function submittedPath(args: Record<string, unknown>): Promise<string> {
  const paths: string[] = [];
  const registrations: any[] = [];
  registerVideo(
    { tool: ((...entry: any[]) => registrations.push(entry)) as any },
    new ModelRegistry(),
    () => ({ post: async (path: string) => { paths.push(path); return { id: 'task' }; } }) as unknown as KwjmClient
  );
  const generate = registrations.find((entry) => entry[0] === 'generate_video')?.[3];
  const result = await generate(args);
  assert.equal(result.isError, false);
  return paths[0];
}

async function submittedRequest(args: Record<string, unknown>): Promise<{ path: string; payload: Record<string, unknown>; result: any }> {
  const requests: { path: string; payload: Record<string, unknown> }[] = [];
  const registrations: any[] = [];
  registerVideo(
    { tool: ((...entry: any[]) => registrations.push(entry)) as any },
    new ModelRegistry(),
    () => ({
      post: async (path: string, payload: Record<string, unknown>) => {
        requests.push({ path, payload });
        return { id: 'task' };
      },
    }) as unknown as KwjmClient
  );
  const generate = registrations.find((entry) => entry[0] === 'generate_video')?.[3];
  const result = await generate(args);
  assert.equal(result.isError, false);
  return { ...requests[0], result };
}

test('Kling 文生视频选择 text2video 端点', async () => {
  assert.equal(await submittedPath({ model: 'kling-v3.0-pro', prompt: 'x' }), '/v1/videos/text2video');
});

test('Kling 图生视频选择 image2video 端点', async () => {
  assert.equal(await submittedPath({
    model: 'kling-v3.0-pro',
    prompt: 'x',
    content: [{ type: 'image_url', image_url: { url: 'https://example.test/image.png' } }],
  }), '/v1/videos/image2video');
});

test('Kling 视频编辑选择 video2video 端点', async () => {
  assert.equal(await submittedPath({
    model: 'kling-video-o1-pro',
    prompt: 'x',
    content: [{ type: 'video_url', video_url: { url: 'https://example.test/video.mp4' } }],
  }), '/v1/videos/video2video');
});

test('Seedance 2.0 裸语义要求先确认 kw-video 三档候选', async () => {
  const registrations: any[] = [];
  registerVideo(
    { tool: ((...entry: any[]) => registrations.push(entry)) as any },
    new ModelRegistry(),
    () => ({ post: async () => ({ id: 'task' }) }) as unknown as KwjmClient
  );
  const generate = registrations.find((entry) => entry[0] === 'generate_video')?.[3];
  const result = await generate({ model: 'Seedance 2.0', prompt: 'x' });
  assert.equal(result.isError, true);
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.ambiguous, true);
  assert.deepEqual(parsed.candidates.map((c: { id: string }) => c.id), ['kw-video-v2', 'kw-video-v2-fast', 'kw-video-v2-mini']);
});

test('Seedance 2.0 fast 语义提交到 kw-video-v2-fast', async () => {
  const req = await submittedRequest({ model: 'seedance-2.0-fast', prompt: 'x', duration: 4, ratio: '16:9' });
  assert.equal(req.path, '/v3/contents/generations/tasks');
  assert.equal(req.payload.model, 'kw-video-v2-fast');
});

test('Seedance 2.0 mini 语义提交到 kw-video-v2-mini', async () => {
  const req = await submittedRequest({ model: 'seedance-2.0-mini', prompt: 'x', duration: 4, ratio: '16:9' });
  assert.equal(req.path, '/v3/contents/generations/tasks');
  assert.equal(req.payload.model, 'kw-video-v2-mini');
});

test('Seedance 2.5 语义提交到 kw-video-v2.5', async () => {
  const req = await submittedRequest({ model: 'Seedance 2.5', prompt: 'x', duration: 4, ratio: '16:9' });
  assert.equal(req.path, '/v3/contents/generations/tasks');
  assert.equal(req.payload.model, 'kw-video-v2.5');
});
