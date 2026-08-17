import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

/**
 * 端到端测试：真正启动编译后的 MCP server（stdio），确认工具注册与「防误判」规则在协议层生效。
 * 用任意占位 key（不触发网络，因 list_models/歧义/off-by-default 不请求平台）。
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function launchServer(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [join(root, 'dist', 'index.js')],
    env: { ...process.env, KWJM_API_KEY: 'test-placeholder-key' },
  });
  const client = new Client({ name: 'e2e-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

test('e2e: 服务器启动并注册全部工具', async () => {
  const client = await launchServer();
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'chat_completions',
      'edit_image',
      'generate_image',
      'generate_video',
      'get_account_daily_costs',
      'get_current_key_daily_cost',
      'get_model_capabilities',
      'get_video_result',
      'get_wallet_balance',
      'list_models',
      'messages',
      'refresh_models',
      'suggest_model',
      'validate_request',
    ]);
  } finally {
    await client.close();
  }
});

test('e2e: list_models 返回能力元数据（含默认/层级/别名）', async () => {
  const client = await launchServer();
  try {
    const res = await client.callTool({ name: 'list_models', arguments: {} });
    const text = res.content[0].type === 'text' ? (res.content[0] as { text: string }).text : '';
    const parsed = JSON.parse(text);
    assert.ok(parsed.models.length > 0, '应有模型');
    assert.ok(parsed.counts.text >= 1);
    assert.ok(parsed.selection.length >= 1);
    // 应包含视频能力与 kw-video 精确模型
    const video = parsed.models.find((m: any) => m.modality === 'video');
    assert.ok(video, '应有视频模型');
  } finally {
    await client.close();
  }
});

test('e2e: kw-video-v2 保留平台精确 ID', async () => {
  const client = await launchServer();
  try {
    const res = await client.callTool({ name: 'get_model_capabilities', arguments: { model: 'kw-video-v2' } });
    const text = res.content[0].type === 'text' ? (res.content[0] as { text: string }).text : '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.resolvedFrom, undefined);
    assert.equal(parsed.id, 'kw-video-v2');
  } finally {
    await client.close();
  }
});

test('e2e: Seedance 2.0 返回推荐型号并要求用户确认', async () => {
  const client = await launchServer();
  try {
    const res = await client.callTool({
      name: 'generate_video',
      arguments: {
        model: 'Seedance 2.0',
        prompt: '角色抬头并眨眼',
        duration: 4,
        ratio: '16:9',
        resolution: '720p',
      },
    });
    assert.equal(res.isError, true);
    const text = res.content[0].type === 'text' ? (res.content[0] as { text: string }).text : '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.requiresUserConfirmation, true);
    assert.equal(parsed.recommended.id, 'kw-video-v2');
    assert.deepEqual(parsed.candidates.map((candidate: { id: string }) => candidate.id), [
      'kw-video-v2',
      'kw-video-v2-fast',
      'kw-video-v2-mini',
    ]);
  } finally {
    await client.close();
  }
});

test('e2e: Seedance 2.5 唯一解析到 kw-video-v2.5', async () => {
  const client = await launchServer();
  try {
    const res = await client.callTool({ name: 'get_model_capabilities', arguments: { model: 'Seedance 2.5' } });
    const text = res.content[0].type === 'text' ? (res.content[0] as { text: string }).text : '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.id, 'kw-video-v2.5');
    assert.equal(parsed.resolvedFrom, 'Seedance 2.5');
  } finally {
    await client.close();
  }
});

test('e2e: chat_completions schema 暴露工具调用字段与 tool role', async () => {
  const client = await launchServer();
  try {
    const tools = await client.listTools();
    const chat = tools.tools.find((tool) => tool.name === 'chat_completions');
    assert.ok(chat);
    const properties = (chat.inputSchema as any).properties;
    assert.ok(properties.tools);
    assert.ok(properties.tool_choice);
    assert.ok(properties.parallel_tool_calls);
    const roles = properties.messages.items.properties.role.enum;
    assert.ok(roles.includes('tool'));
    assert.ok(roles.includes('developer'));
  } finally {
    await client.close();
  }
});

test('e2e: 歧义模型（deepseek）触发候选问询而非直接调用', async () => {
  const client = await launchServer();
  try {
    const res = await client.callTool({
      name: 'chat_completions',
      arguments: { model: 'wan', messages: [{ role: 'user', content: 'hi' }] },
    });
    assert.equal(res.isError, true, '歧义应视为需要确认的错误反馈');
    const text = res.content[0].type === 'text' ? (res.content[0] as { text: string }).text : '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.ambiguous, true);
    assert.ok(parsed.candidates && parsed.candidates.length >= 2, '应给出候选清单');
  } finally {
    await client.close();
  }
});

test('e2e: off-by-default 模型未显式指名 → 不可调用', async () => {
  const client = await launchServer();
  try {
    const res = await client.callTool({
      name: 'messages',
      arguments: { model: 'claude-opus-4-8', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] },
    });
    assert.equal(res.isError, true);
    const text = res.content[0].type === 'text' ? (res.content[0] as { text: string }).text : '';
    assert.match(text, /非指明不调用/);
  } finally {
    await client.close();
  }
});

test('e2e: 未配置 key 启动时，仅调用网络工具才报错（list_models 仍可用）', async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [join(root, 'dist', 'index.js')],
    env: { ...process.env, KWJM_API_KEY: '' },
  });
  const client = new Client({ name: 'e2e-test2', version: '1.0.0' });
  await client.connect(transport);
  try {
    const res = await client.callTool({ name: 'list_models', arguments: {} });
    const text = res.content[0].type === 'text' ? (res.content[0] as { text: string }).text : '';
    assert.ok(JSON.parse(text).models.length > 0, 'list_models 不依赖网络仍可用');
  } finally {
    await client.close();
  }
});

test('e2e: 无 key 时 refresh_models 返回明确错误且不崩溃', async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [join(root, 'dist', 'index.js')],
    env: { ...process.env, KWJM_API_KEY: '' },
  });
  const client = new Client({ name: 'e2e-test3', version: '1.0.0' });
  await client.connect(transport);
  try {
    const res = await client.callTool({ name: 'refresh_models', arguments: {} });
    assert.equal(res.isError, true, '应报错');
    const text = res.content[0].type === 'text' ? (res.content[0] as { text: string }).text : '';
    assert.match(text, /缺少 KWJM_API_KEY|KWJM_API_KEY/);
    // 服务器仍存活，可继续调用非网络工具
    const again = await client.callTool({ name: 'list_models', arguments: {} });
    assert.equal(again.isError, false);
  } finally {
    await client.close();
  }
});

test('e2e: suggest_model 按任务返回默认/备选/非指明分级', async () => {
  const client = await launchServer();
  try {
    const res = await client.callTool({ name: 'suggest_model', arguments: { task: '帮我生一段产品宣传视频' } });
    const text = res.content[0].type === 'text' ? (res.content[0] as { text: string }).text : '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.inferredModality, 'video');
    assert.ok(parsed.recommended.default?.id, '应有默认首选');
    assert.ok(Array.isArray(parsed.recommended.fallback));
    assert.ok(Array.isArray(parsed.doNotCallUnlessExplicit));
    // 视频差异化引导：可选能力
    assert.ok(parsed.guidance.some((g: string) => g.includes('可选能力')), '视频应提示可选能力');
    assert.ok(parsed.guidance.some((g: string) => g.includes('Seedance 2.0') && g.includes('kw-video-v2')), '视频应提示 Seedance 2.0 外壳语义');
    assert.ok(parsed.guidance.some((g: string) => g.includes('Seedance 2.5') && g.includes('kw-video-v2.5')), '视频应提示 Seedance 2.5 直达语义');
  } finally {
    await client.close();
  }
});

test('e2e: suggest_model 文本任务提示能力补位语义', async () => {
  const client = await launchServer();
  try {
    const res = await client.callTool({ name: 'suggest_model', arguments: { task: '帮我识别这张图片里的文字' } });
    const text = res.content[0].type === 'text' ? (res.content[0] as { text: string }).text : '';
    const parsed = JSON.parse(text);
    // 「识别图片」是图相关，可能推断为 image；这里用纯文本任务验证 text 指引
    const res2 = await client.callTool({ name: 'suggest_model', arguments: { modality: 'text' } });
    const p2 = JSON.parse(res2.content[0].text);
    assert.equal(p2.inferredModality, 'text');
    assert.ok(p2.guidance.some((g: string) => g.includes('能力补位') || g.includes('多模态')), '文本应提示能力补位语义');
  } finally {
    await client.close();
  }
});

test('e2e: validate_request 拦截参考图超限（gpt-image-2-gp ≤16）', async () => {
  const client = await launchServer();
  try {
    const images = Array.from({ length: 20 }, (_, i) => ({ image_url: `http://x.com/${i}.png` }));
    const res = await client.callTool({
      name: 'validate_request',
      arguments: { model: 'gpt-image-2-gp', args: { prompt: '换背景', images } },
    });
    assert.equal(res.isError, true, '超限应判为失败');
    const text = res.content[0].type === 'text' ? (res.content[0] as { text: string }).text : '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.pass, false);
    assert.ok(parsed.violations.some((v: any) => v.field === 'images'), '应报告 images 越界');
    assert.ok(parsed.violations[0].fix, '应给修正建议');
  } finally {
    await client.close();
  }
});

test('e2e: generate_image 主动拦截超限输入（不发起请求）', async () => {
  const client = await launchServer();
  try {
    const images = Array.from({ length: 20 }, (_, i) => ({ image_url: `http://x.com/${i}.png` }));
    const res = await client.callTool({
      name: 'generate_image',
      arguments: { model: 'gpt-image-2-gp', prompt: '换背景', images, explicit: true },
    });
    assert.equal(res.isError, true, '超限应拦截');
    const text = res.content[0].type === 'text' ? (res.content[0] as { text: string }).text : '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.blocked, true);
    assert.ok(parsed.violations.length >= 1);
  } finally {
    await client.close();
  }
});
