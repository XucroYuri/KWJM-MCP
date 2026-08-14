import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KwjmClient } from '../src/core/client.js';
import { ModelRegistry } from '../src/core/registry.js';
import { registerImage } from '../src/handlers/image.js';
import { hasCostAck, parseToolResult, readLiveConfig, toolHandler } from './live-support.js';

const config = readLiveConfig();
const maybe = config && hasCostAck('image') ? test : test.skip;

maybe('live image: gpt-image-2 最低档生成并编辑', async () => {
  const registrations: any[] = [];
  const client = new KwjmClient(config!);
  registerImage(
    { tool: ((...args: any[]) => registrations.push(args)) as any },
    new ModelRegistry(),
    () => client
  );
  const generate = toolHandler(registrations, 'generate_image');
  const edit = toolHandler(registrations, 'edit_image');

  const generated = await generate({
    model: 'gpt-image-2',
    prompt: 'a single blue dot on white background',
    size: '1024x1024',
    quality: 'low',
    n: 1,
  });
  assert.equal(generated.isError, false);
  const generatedPayload = parseToolResult(generated);
  const item = generatedPayload.result?.data?.[0];
  assert.ok(item);

  let dataUrl: string;
  if (typeof item.b64_json === 'string') {
    dataUrl = `data:image/png;base64,${item.b64_json}`;
  } else if (typeof item.url === 'string') {
    const response = await fetch(item.url);
    assert.ok(response.ok);
    const mime = response.headers.get('content-type')?.split(';')[0] || 'image/png';
    const bytes = Buffer.from(await response.arrayBuffer());
    dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
  } else {
    throw new Error('图片生成结果没有 b64_json 或 url。');
  }

  const edited = await edit({
    model: 'gpt-image-2',
    prompt: 'change the dot to red',
    image: dataUrl,
    size: '1024x1024',
    quality: 'low',
    n: 1,
  });
  assert.equal(edited.isError, false);
  const editedPayload = parseToolResult(edited);
  assert.ok(Array.isArray(editedPayload.result?.data));
});
