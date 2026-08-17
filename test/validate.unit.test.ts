import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelRegistry } from '../src/core/registry.js';
import { checkConstraints, validateForModel } from '../src/handlers/validate.js';

test('Seedance 2.0 预检返回推荐型号并要求用户确认', () => {
  const result = validateForModel(new ModelRegistry(), 'Seedance 2.0', {
    duration: 4,
    resolution: '720p',
    ratio: '16:9',
  });
  assert.equal(result.pass, false);
  assert.equal(result.requiresUserConfirmation, true);
  assert.equal(result.recommended, 'kw-video-v2');
  assert.match(result.violations?.[0]?.fix ?? '', /推荐 kw-video-v2/);
});

test('禁止单独音频规则不应拦截纯文本视频请求', () => {
  const model = new ModelRegistry().byRealId('kw-video-v2-mini');
  assert.ok(model);
  const result = checkConstraints(model, {
    content: [{ type: 'text', text: 'a dot' }],
    duration: 4,
    resolution: '480p',
    ratio: '1:1',
  });
  assert.equal(result.pass, true);
  assert.deepEqual(result.violations, []);
});

test('禁止单独音频规则仍拦截只有音频的请求', () => {
  const model = new ModelRegistry().byRealId('kw-video-v2-mini');
  assert.ok(model);
  const result = checkConstraints(model, {
    content: [{ type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,AA==' } }],
  });
  assert.equal(result.pass, false);
  assert.ok(result.violations.some((violation) => violation.field === 'hardFail'));
});
