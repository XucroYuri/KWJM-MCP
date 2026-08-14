import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KwjmClient } from '../src/core/client.js';
import { ModelRegistry } from '../src/core/registry.js';
import { registerVideo } from '../src/handlers/video.js';
import { hasCostAck, parseToolResult, readLiveConfig, toolHandler } from './live-support.js';

const config = readLiveConfig();
const maybe = config && hasCostAck('video-reference') ? test : test.skip;

maybe('live video reference: kw-video-v2-mini 图生视频与参考视频生成', async () => {
  const registrations: any[] = [];
  const client = new KwjmClient(config!);
  registerVideo(
    { tool: ((...args: any[]) => registrations.push(args)) as any },
    new ModelRegistry(),
    () => client
  );
  const generate = toolHandler(registrations, 'generate_video');
  const status = toolHandler(registrations, 'get_video_result');

  const imageTask = await generate({
    model: 'kw-video-v2-mini',
    content: [
      { type: 'text', text: 'the blue frame remains still' },
      { type: 'image_url', image_url: { url: solidBmpDataUrl(512, 512) }, role: 'first_frame' },
    ],
    duration: 4,
    ratio: '1:1',
    resolution: '480p',
    generate_audio: false,
  });
  assert.equal(imageTask.isError, false);
  const imageTaskId = parseToolResult(imageTask).taskId;
  assert.ok(imageTaskId);
  const imageResult = await waitForVideo(status, imageTaskId);
  const videoUrl = findVideoUrl(imageResult);
  assert.ok(videoUrl);

  const referenceTask = await generate({
    model: 'kw-video-v2-mini',
    content: [
      { type: 'text', text: 'keep the reference composition unchanged' },
      { type: 'video_url', video_url: { url: videoUrl }, role: 'reference_video' },
    ],
    duration: 4,
    ratio: '1:1',
    resolution: '480p',
    generate_audio: false,
  });
  assert.equal(referenceTask.isError, false);
  const referenceTaskId = parseToolResult(referenceTask).taskId;
  assert.ok(referenceTaskId);
  const referenceResult = await waitForVideo(status, referenceTaskId);
  assert.ok(findVideoUrl(referenceResult));
});

async function waitForVideo(status: (args: any) => Promise<any>, id: string): Promise<any> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const result = await status({ id, model: 'kw-video-v2-mini' });
    assert.equal(result.isError, false);
    const payload = parseToolResult(result).result;
    const state = String(payload?.status ?? '').toLowerCase();
    if (state === 'succeeded' || state === 'completed') return payload;
    if (['failed', 'expired', 'cancelled', 'canceled'].includes(state)) {
      throw new Error(`视频任务未成功，终态为 ${state}。`);
    }
    await delay(5_000);
  }
  throw new Error('视频任务在 7.5 分钟内未完成。');
}

function findVideoUrl(result: any): string | undefined {
  const candidates = [result?.content?.video_url, result?.video_url, result?.data?.video_url];
  return candidates.find((value) => typeof value === 'string');
}

function solidBmpDataUrl(width: number, height: number): string {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowBytes * height;
  const file = Buffer.alloc(54 + pixelBytes, 0);
  file.write('BM', 0, 2, 'ascii');
  file.writeUInt32LE(file.length, 2);
  file.writeUInt32LE(54, 10);
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(width, 18);
  file.writeInt32LE(height, 22);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  file.writeUInt32LE(pixelBytes, 34);
  for (let offset = 54; offset < file.length; offset += 3) {
    file[offset] = 255;
  }
  return `data:image/bmp;base64,${file.toString('base64')}`;
}
