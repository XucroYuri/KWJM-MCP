import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KwjmClient } from '../src/core/client.js';
import { ModelRegistry } from '../src/core/registry.js';
import { registerVideo } from '../src/handlers/video.js';
import { hasCostAck, parseToolResult, readLiveConfig, toolHandler } from './live-support.js';

const config = readLiveConfig();
const maybe = config && hasCostAck('video') ? test : test.skip;

maybe('live video: kw-video-v2-mini 4 秒 480p 无音频提交并查询状态', async () => {
  const registrations: any[] = [];
  const client = new KwjmClient(config!);
  registerVideo(
    { tool: ((...args: any[]) => registrations.push(args)) as any },
    new ModelRegistry(),
    () => client
  );
  const generate = toolHandler(registrations, 'generate_video');
  const status = toolHandler(registrations, 'get_video_result');

  const submitted = await generate({
    model: 'kw-video-v2-mini',
    content: [{ type: 'text', text: 'a blue dot stays still on a white background' }],
    duration: 4,
    ratio: '1:1',
    resolution: '480p',
    generate_audio: false,
  });
  assert.equal(submitted.isError, false);
  const submittedPayload = parseToolResult(submitted);
  assert.ok(submittedPayload.taskId);
  assert.equal(submittedPayload.endpoint, '/v3/contents/generations/tasks');

  const queried = await status({ id: submittedPayload.taskId, model: 'kw-video-v2-mini' });
  assert.equal(queried.isError, false);
  const queriedPayload = parseToolResult(queried);
  assert.equal(queriedPayload.queryPath, `/v3/contents/generations/tasks/${encodeURIComponent(submittedPayload.taskId)}`);
  assert.ok(queriedPayload.result?.status);
});
