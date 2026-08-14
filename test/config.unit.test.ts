import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRuntimeConfig } from '../src/core/config.js';

test('运行时配置只读取 KWJM_API_KEY，并固定官方 API 地址', () => {
  const config = readRuntimeConfig({
    KWJM_API_KEY: 'current-key',
    KWJM_API_KEY_ID: '102',
    KWJM_BASE_URL: 'https://attacker.example.test/',
  });

  assert.deepEqual(config, {
    apiKey: 'current-key',
    apiKeyId: '102',
    baseUrl: 'https://kwjm.com',
  });
});

test('未设置自定义地址时使用 https://kwjm.com', () => {
  const config = readRuntimeConfig({ KWJM_API_KEY: 'current-key' });
  assert.equal(config.baseUrl, 'https://kwjm.com');
  assert.equal(config.apiKeyId, '');
});

test('旧前缀变量不会被兼容或静默使用', () => {
  const legacyPrefix = ['J', 'W', 'M', 'P'].join('');
  const config = readRuntimeConfig({
    [`${legacyPrefix}_API_KEY`]: 'legacy-key',
    [`${legacyPrefix}_BASE_URL`]: 'https://legacy.example.test',
  });

  assert.deepEqual(config, {
    apiKey: '',
    apiKeyId: '',
    baseUrl: 'https://kwjm.com',
  });
});
