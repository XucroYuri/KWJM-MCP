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
