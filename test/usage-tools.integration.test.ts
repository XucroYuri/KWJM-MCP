import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KwjmClient } from '../src/core/client.js';
import { registerUsage } from '../src/handlers/usage.js';

type Registered = { name: string; handler: (args: any) => Promise<any> };

function captureUsage(fakeClient: Partial<KwjmClient>, keyId = '102'): Registered[] {
  const tools: Registered[] = [];
  registerUsage(
    { tool: ((name: string, _description: string, _schema: unknown, handler: Registered['handler']) => tools.push({ name, handler })) as any },
    () => fakeClient as KwjmClient,
    () => keyId
  );
  return tools;
}

function parsed(result: any): any {
  return JSON.parse(result.content[0].text);
}

const rows = [
  { report_date: '2026-08-13', api_key_id: 101, api_key_name: 'member-a', request_count: 2, amount_origin: 0.5, amount: 0.375 },
  { report_date: '2026-08-13', api_key_id: 102, api_key_name: 'member-b', request_count: 3, amount_origin: 0.25, amount: 0.2 },
];

test('当前 Key 日结按 KWJM_API_KEY_ID 精确过滤', async () => {
  const paths: string[] = [];
  const tools = captureUsage({ get: async (path: string) => { paths.push(path); return { list: rows }; } });
  const tool = tools.find((item) => item.name === 'get_current_key_daily_cost');
  assert.ok(tool);

  const result = await tool.handler({ report_date: '2026-08-13' });
  const body = parsed(result);
  assert.equal(result.isError, false);
  assert.equal(paths[0], '/api/v1/user/statistics/day/keys?report_date=2026-08-13');
  assert.equal(body.scope, 'current_key');
  assert.equal(body.apiKeyId, '102');
  assert.deepEqual(body.rows, [rows[1]]);
  assert.deepEqual(body.totals, { requestCount: 3, amountOrigin: 0.25, amount: 0.2 });
});

test('当前 Key 日结缺少权威 Key ID 时拒绝查询而不猜测', async () => {
  let requested = false;
  const tools = captureUsage({ get: async () => { requested = true; return { list: rows }; } }, '');
  const tool = tools.find((item) => item.name === 'get_current_key_daily_cost');
  assert.ok(tool);

  const result = await tool.handler({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /KWJM_API_KEY_ID/);
  assert.equal(requested, false);
});

test('账户跨 Key 日结必须显式 all_keys=true', async () => {
  let requests = 0;
  const tools = captureUsage({ get: async () => { requests += 1; return { list: rows }; } });
  const tool = tools.find((item) => item.name === 'get_account_daily_costs');
  assert.ok(tool);

  const denied = await tool.handler({});
  assert.equal(denied.isError, true);
  assert.equal(requests, 0);

  const allowed = await tool.handler({ all_keys: true });
  const body = parsed(allowed);
  assert.equal(allowed.isError, false);
  assert.equal(requests, 1);
  assert.equal(body.scope, 'account_all_keys');
  assert.deepEqual(body.rows, rows);
  assert.deepEqual(body.totals, { requestCount: 5, amountOrigin: 0.75, amount: 0.575 });
});

test('钱包工具调用官方只读端点', async () => {
  const paths: string[] = [];
  const tools = captureUsage({ get: async (path: string) => { paths.push(path); return { balance: 9.5 }; } });
  const tool = tools.find((item) => item.name === 'get_wallet_balance');
  assert.ok(tool);

  const result = await tool.handler({});
  assert.equal(result.isError, false);
  assert.equal(paths[0], '/api/v1/user/wallet');
  assert.equal(parsed(result).wallet.balance, 9.5);
});
