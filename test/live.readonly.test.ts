import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KwjmClient } from '../src/core/client.js';
import { OPERATIONS } from '../src/core/operations.js';
import { ModelRegistry } from '../src/core/registry.js';
import { registerDiscovery } from '../src/handlers/discovery.js';
import { registerUsage } from '../src/handlers/usage.js';
import { parseToolResult, readLiveConfig, toolHandler } from './live-support.js';

const config = readLiveConfig();
const maybe = config ? test : test.skip;
const maybeCurrentKey = config?.apiKeyId ? test : test.skip;

maybe('live readonly: /v1/models 返回并保留 20 个第一阶段精确 ID', async () => {
  const client = new KwjmClient(config!);
  const response = (await client.get(OPERATIONS.models)) as any;
  const entries = Array.isArray(response) ? response : response?.data;
  assert.ok(Array.isArray(entries));
  const liveIds = new Set(entries.map((entry: any) => entry?.id).filter(Boolean));
  const priority = [
    'openai/gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'kimi-k3', 'glm-5.2', 'grok-4.5',
    'deepseek-v4-flash', 'deepseek-v4-pro',
    'openai/gpt-image-2', 'gpt-image-2', 'gpt-image-2-hq', 'gpt-image-2-sp', 'gpt-image-2-gp',
    'kw-video-v2', 'kw-video-v2-fast', 'kw-video-v2-mini', 'kw-video-v2.5', 'MiniMax-H3', 'grok-imagine-1.0-video-sp',
  ];
  for (const id of priority) assert.ok(liveIds.has(id), `${id} 不在平台实时模型列表`);

  const registry = new ModelRegistry();
  registry.mergeLive(entries);
  for (const id of priority) {
    const resolved = registry.resolve(id);
    assert.equal(resolved.status, 'resolved', `${id} 未解析`);
    if (resolved.status === 'resolved') assert.equal(resolved.model.id, id, `${id} 被改写`);
  }

  const registrations: any[] = [];
  registerDiscovery(
    { tool: ((...args: any[]) => registrations.push(args)) as any },
    new ModelRegistry(),
    () => client
  );
  const refresh = toolHandler(registrations, 'refresh_models');
  const result = await refresh({});
  assert.equal(result.isError, false);
  const refreshed = parseToolResult(result);
  assert.equal(refreshed.refreshed, true);
  assert.equal(refreshed.count, entries.length);
});

maybe('live readonly: 钱包和跨 Key 日结端点可用', async () => {
  const client = new KwjmClient(config!);
  const registrations: any[] = [];
  registerUsage(
    { tool: ((...args: any[]) => registrations.push(args)) as any },
    () => client,
    () => config!.apiKeyId
  );

  const wallet = await toolHandler(registrations, 'get_wallet_balance')({});
  assert.equal(wallet.isError, false);
  assert.equal(typeof parseToolResult(wallet).wallet, 'object');

  const costs = await toolHandler(registrations, 'get_account_daily_costs')({ all_keys: true });
  assert.equal(costs.isError, false);
  const parsed = parseToolResult(costs);
  assert.equal(parsed.scope, 'account_all_keys');
  assert.ok(Array.isArray(parsed.rows));
});

maybeCurrentKey('live readonly: 当前 Key 日结按 KWJM_API_KEY_ID 绑定', async () => {
  const client = new KwjmClient(config!);
  const registrations: any[] = [];
  registerUsage(
    { tool: ((...args: any[]) => registrations.push(args)) as any },
    () => client,
    () => config!.apiKeyId
  );
  const result = await toolHandler(registrations, 'get_current_key_daily_cost')({});
  assert.equal(result.isError, false);
  const parsed = parseToolResult(result);
  assert.equal(parsed.scope, 'current_key');
  assert.equal(parsed.apiKeyId, config!.apiKeyId);
});
