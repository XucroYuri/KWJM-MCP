import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPERATIONS } from '../src/core/operations.js';

test('operation adapter 保留 KWJM 完整公共路径', () => {
  assert.deepEqual(OPERATIONS, {
    models: '/v1/models',
    chatCompletions: '/v1/chat/completions',
    messages: '/v1/messages',
    imageGenerations: '/v1/images/generations',
    imageEdits: '/v1/images/edits',
    wallet: '/api/v1/user/wallet',
    dailyCostsByKey: '/api/v1/user/statistics/day/keys',
  });
});
