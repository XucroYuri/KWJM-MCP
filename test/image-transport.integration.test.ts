import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KwjmClient } from '../src/core/client.js';
import { ModelRegistry } from '../src/core/registry.js';
import { registerImage } from '../src/handlers/image.js';

test('edit_image 按官方契约提交 multipart/form-data 文件', async () => {
  const calls: Array<{ path: string; form: FormData }> = [];
  const fakeClient: Partial<KwjmClient> = {
    postForm: async (path: string, form: FormData) => {
      calls.push({ path, form });
      return { created: 1, data: [{ b64_json: 'redacted' }] };
    },
  };
  const registered: any[] = [];
  registerImage(
    { tool: ((...args: any[]) => registered.push(args)) as any },
    new ModelRegistry(),
    () => fakeClient as KwjmClient
  );
  const edit = registered.find((args) => args[0] === 'edit_image')?.[3];
  assert.ok(edit);

  const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const result = await edit({
    model: 'gpt-image-2',
    prompt: 'make it blue',
    image: onePixelPng,
    size: '1024x1024',
    quality: 'low',
    n: 1,
  });

  assert.equal(result.isError, false);
  assert.equal(calls[0].path, '/v1/images/edits');
  assert.equal(calls[0].form.get('model'), 'gpt-image-2');
  assert.equal(calls[0].form.get('prompt'), 'make it blue');
  assert.equal(calls[0].form.get('size'), '1024x1024');
  assert.equal(calls[0].form.get('quality'), 'low');
  assert.equal(calls[0].form.get('n'), '1');
  const image = calls[0].form.get('image[]');
  assert.ok(image instanceof Blob);
  assert.equal(image.type, 'image/png');
  assert.ok(image.size > 0);
});

test('edit_image 拒绝无法安全转换为文件的远程 URL', async () => {
  const registered: any[] = [];
  registerImage(
    { tool: ((...args: any[]) => registered.push(args)) as any },
    new ModelRegistry(),
    () => ({ postForm: async () => ({}) }) as unknown as KwjmClient
  );
  const edit = registered.find((args) => args[0] === 'edit_image')?.[3];
  const result = await edit({
    model: 'gpt-image-2',
    prompt: 'edit',
    image: 'https://example.com/source.png',
    quality: 'low',
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /data URL/);
});

test('edit_image 在解码前拒绝超过 10 MiB 的图片 data URL', async () => {
  let uploaded = false;
  const registered: any[] = [];
  registerImage(
    { tool: ((...args: any[]) => registered.push(args)) as any },
    new ModelRegistry(),
    () => ({
      postForm: async () => {
        uploaded = true;
        return {};
      },
    }) as unknown as KwjmClient
  );
  const edit = registered.find((args) => args[0] === 'edit_image')?.[3];
  const oversized = `data:image/png;base64,${'A'.repeat(14 * 1024 * 1024)}`;
  const result = await edit({ model: 'gpt-image-2', prompt: 'edit', image: oversized, quality: 'low' });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /10 MiB/);
  assert.equal(uploaded, false);
});
