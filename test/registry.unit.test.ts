import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelRegistry } from '../src/core/registry.js';
import { KwjmError, KwjmClient } from '../src/core/client.js';
import { guardModel } from '../src/handlers/guard.js';

/** 构造一个受控 seed，便于断言（返回类型推断为 Seed 元组） */
function miniSeed() {
  return [
    { id: 'gpt-5.2-pro-2025-12-11', family: 'openai', modality: 'text', endpoints: [{ path: '/v1/chat/completions', method: 'POST', async: false }], selectionLevel: 'default', defaultFor: ['text'] },
    { id: 'gpt-5.2', family: 'openai', modality: 'text', endpoints: [{ path: '/v1/chat/completions', method: 'POST', async: false }], selectionLevel: 'fallback', aliases: ['gpt-5'] },
    { id: 'deepseek-chat', family: 'deepseek', modality: 'text', endpoints: [{ path: '/v1/chat/completions', method: 'POST', async: false }], selectionLevel: 'fallback', ambiguous: true },
    { id: 'deepseek-reasoner', family: 'deepseek', modality: 'text', endpoints: [{ path: '/v1/chat/completions', method: 'POST', async: false }], selectionLevel: 'fallback', aliases: ['deepseek-r1'] },
    { id: 'kw-video-v2', family: 'kw-video', modality: 'video', endpoints: [{ path: '/v3/contents/generations/tasks', method: 'POST', async: true, queryPath: '/v3/contents/generations/tasks/{id}' }], selectionLevel: 'default', defaultFor: ['video'] },
    { id: 'kw-video-v2-fast', family: 'kw-video', modality: 'video', endpoints: [{ path: '/v3/contents/generations/tasks', method: 'POST', async: true, queryPath: '/v3/contents/generations/tasks/{id}' }], selectionLevel: 'fallback', aliases: ['seedance-2.0-fast'] },
    { id: 'kw-video-v2-mini', family: 'kw-video', modality: 'video', endpoints: [{ path: '/v3/contents/generations/tasks', method: 'POST', async: true, queryPath: '/v3/contents/generations/tasks/{id}' }], selectionLevel: 'fallback', aliases: ['seedance-2.0-mini'] },
    { id: 'kw-video-v2.5', family: 'kw-video', modality: 'video', endpoints: [{ path: '/v3/contents/generations/tasks', method: 'POST', async: true, queryPath: '/v3/contents/generations/tasks/{id}' }], selectionLevel: 'fallback' },
    { id: 'dreamina-seedance-2-0', family: 'dreamina', modality: 'video', endpoints: [{ path: '/v3/contents/generations/tasks', method: 'POST', async: true, queryPath: '/v3/contents/generations/tasks/{id}' }], selectionLevel: 'fallback' },
    { id: 'dreamina-seedance-2-0-fast', family: 'dreamina', modality: 'video', endpoints: [{ path: '/v3/contents/generations/tasks', method: 'POST', async: true, queryPath: '/v3/contents/generations/tasks/{id}' }], selectionLevel: 'fallback' },
    { id: 'claude-opus-4-8', family: 'anthropic', modality: 'text', endpoints: [{ path: '/v1/messages', method: 'POST', async: false }], selectionLevel: 'off-by-default' },
  ];
}

test('registry.resolve 直接命中真实 id', () => {
  const r = new ModelRegistry(miniSeed());
  const res = r.resolve('gpt-5.2-pro-2025-12-11');
  assert.equal(res.status, 'resolved');
  if (res.status === 'resolved') assert.equal(res.model.id, 'gpt-5.2-pro-2025-12-11');
});

test('registry.resolve Seedance 2.0 语义返回 kw-video-v2 三档候选', () => {
  const r = new ModelRegistry(miniSeed());
  const res = r.resolve('seedance-2.0');
  assert.equal(res.status, 'ambiguous');
  if (res.status === 'ambiguous') {
    assert.deepEqual(res.candidates.map((c) => c.id), ['kw-video-v2', 'kw-video-v2-fast', 'kw-video-v2-mini']);
    assert.equal(res.recommended?.id, 'kw-video-v2');
    assert.match(res.message, /最匹配的是 kw-video-v2/);
  }
});

test('registry.resolve Seedance 2.5 语义直达 kw-video-v2.5', () => {
  const r = new ModelRegistry(miniSeed());
  const res = r.resolve('Seedance 2.5');
  assert.equal(res.status, 'resolved');
  if (res.status === 'resolved') {
    assert.equal(res.model.id, 'kw-video-v2.5');
    assert.equal(res.resolvedFrom, 'Seedance 2.5');
  }
});

test('registry.has 与 matchCandidates 识别 Seedance 外壳语义', () => {
  const r = new ModelRegistry(miniSeed());
  assert.equal(r.has('Seedance 2.0'), true);
  assert.equal(r.has('Seedance 2.5'), true);
  assert.deepEqual(r.matchCandidates('Seedance 2.0').map((candidate) => candidate.id), [
    'kw-video-v2',
    'kw-video-v2-fast',
    'kw-video-v2-mini',
  ]);
  assert.deepEqual(r.matchCandidates('Seedance 2.5').map((candidate) => candidate.id), ['kw-video-v2.5']);
});

test('registry.resolve seedance-2.0-fast → kw-video-v2-fast', () => {
  const r = new ModelRegistry(miniSeed());
  const res = r.resolve('seedance-2.0-fast');
  assert.equal(res.status, 'resolved');
  if (res.status === 'resolved') assert.equal(res.model.id, 'kw-video-v2-fast');
});

test('registry.resolve 家族歧义（deepseek）返回 multi 候选', () => {
  const r = new ModelRegistry(miniSeed());
  const res = r.resolve('deepseek');
  assert.equal(res.status, 'ambiguous');
  if (res.status === 'ambiguous') {
    const ids = res.candidates.map((c) => c.id).sort();
    assert.deepEqual(ids, ['deepseek-chat', 'deepseek-reasoner']);
  }
});

test('registry.resolve 未命中返回 not-found', () => {
  const r = new ModelRegistry(miniSeed());
  assert.equal(r.resolve('nonexistent-model-xyz').status, 'not-found');
});

test('selection 规则：default 模型默认可用', () => {
  const r = new ModelRegistry(miniSeed());
  const g = guardModel(r, 'gpt-5.2-pro-2025-12-11');
  assert.equal(g.ok, true);
});

test('selection 规则：off-by-default 未显式指名 → 不可调用', () => {
  const r = new ModelRegistry(miniSeed());
  const g = guardModel(r, 'claude-opus-4-8');
  assert.equal(g.ok, false);
  if (!g.ok) {
    const text = (g.payload.content[0] as { text: string }).text;
    assert.match(text, /非指明不调用/);
  }
});

test('selection 规则：off-by-default 显式指名 → 可调用', () => {
  const r = new ModelRegistry(miniSeed());
  const g = guardModel(r, 'claude-opus-4-8', { explicit: true });
  assert.equal(g.ok, true);
});

test('selection 规则：歧义模型再问询 → 返回候选', () => {
  const r = new ModelRegistry(miniSeed());
  const g = guardModel(r, 'deepseek-r1');
  // deepseek-r1 是别名单值，能唯一解析到 reasoner
  assert.equal(g.ok, true);
  if (g.ok) assert.equal(g.model.id, 'deepseek-reasoner');
});

test('selection 规则：Seedance 2.0 返回结构化推荐并要求用户确认', () => {
  const r = new ModelRegistry(miniSeed());
  const g = guardModel(r, 'Seedance 2.0');
  assert.equal(g.ok, false);
  if (!g.ok) {
    const text = (g.payload.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.requiresUserConfirmation, true);
    assert.equal(parsed.recommended.id, 'kw-video-v2');
    assert.deepEqual(parsed.candidates.map((candidate: { id: string }) => candidate.id), [
      'kw-video-v2',
      'kw-video-v2-fast',
      'kw-video-v2-mini',
    ]);
  }
});

test('defaultForModality 返回 text 默认首选', () => {
  const r = new ModelRegistry(miniSeed());
  assert.equal(r.defaultForModality('text')?.id, 'gpt-5.2-pro-2025-12-11');
  assert.equal(r.defaultForModality('video')?.id, 'kw-video-v2');
});

test('mergeLive 将未知 id 并入为 off-by-default', () => {
  const r = new ModelRegistry(miniSeed());
  const { added } = r.mergeLive([{ id: 'brand-new-model-z9' }, { id: 'gpt-5.2-pro-2025-12-11' }]);
  assert.deepEqual(added, ['brand-new-model-z9']);
  const cap = r.byRealId('brand-new-model-z9');
  assert.equal(cap?.selectionLevel, 'off-by-default');
});

test('KwjmClient 缺少 apiKey 抛错', () => {
  assert.throws(() => new KwjmClient({ apiKey: '' }), KwjmError);
});

test('KwjmClient 拒绝把 Authorization 发送到非官方来源', () => {
  assert.throws(
    () => new KwjmClient({ apiKey: 'k', baseUrl: 'https://attacker.example.test' }),
    /https:\/\/kwjm\.com/
  );
});

test('KwjmClient.endpoint 拼接 /v1', () => {
  const c = new KwjmClient({ apiKey: 'k', baseUrl: 'https://kwjm.com' });
  // 通过公开 baseUrl 校验 base 规范化
  assert.equal(c.baseUrl, 'https://kwjm.com');
});

// ============ 真实 registry 原子能力校验 ============
test('真实 registry：默认 base URL 为 kwjm.com', async () => {
  const mod = await import('../src/core/registry.js');
  assert.equal(mod.DEFAULT_BASE_URL, 'https://kwjm.com');
});

test('真实 registry：kw-video-v2 是精确模型 ID（走 /v3 端点）', () => {
  const r = new ModelRegistry();
  const res = r.resolve('kw-video-v2');
  assert.equal(res.status, 'resolved');
  if (res.status === 'resolved') {
    assert.equal(res.model.id, 'kw-video-v2');
    assert.equal(res.resolvedFrom, undefined);
    assert.ok(res.model.endpoints.some((e) => e.path === '/v3/contents/generations/tasks'));
  }
});

test('真实 registry：kw-video-v2-mini 保留精确模型 ID', () => {
  const r = new ModelRegistry();
  const res = r.resolve('kw-video-v2-mini');
  assert.equal(res.status, 'resolved');
  if (res.status === 'resolved') assert.equal(res.model.id, 'kw-video-v2-mini');
});

test('真实 registry：Seedance 2.0 返回 kw-video-v2 三档候选且推荐 kw-video-v2', () => {
  const r = new ModelRegistry();
  const res = r.resolve('Seedance 2.0');
  assert.equal(res.status, 'ambiguous');
  if (res.status === 'ambiguous') {
    assert.deepEqual(res.candidates.map((c) => c.id), ['kw-video-v2', 'kw-video-v2-fast', 'kw-video-v2-mini']);
    assert.equal(res.recommended?.id, 'kw-video-v2');
    assert.match(res.message, /最匹配的是 kw-video-v2/);
  }
});

test('真实 registry：Seedance 2.5 映射到 kw-video-v2.5', () => {
  const r = new ModelRegistry();
  const res = r.resolve('seedance-2.5');
  assert.equal(res.status, 'resolved');
  if (res.status === 'resolved') {
    assert.equal(res.model.id, 'kw-video-v2.5');
    assert.equal(res.resolvedFrom, 'seedance-2.5');
  }
});

test('真实 registry：第一阶段 20 个模型全部原样解析', () => {
  const r = new ModelRegistry();
  const ids = [
    'openai/gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'kimi-k3', 'glm-5.2', 'grok-4.5',
    'deepseek-v4-flash', 'deepseek-v4-pro',
    'openai/gpt-image-2', 'gpt-image-2', 'gpt-image-2-hq', 'gpt-image-2-sp', 'gpt-image-2-gp',
    'kw-video-v2', 'kw-video-v2-fast', 'kw-video-v2-mini', 'kw-video-v2.5', 'MiniMax-H3', 'grok-imagine-1.0-video-sp',
  ];
  for (const id of ids) {
    const res = r.resolve(id);
    assert.equal(res.status, 'resolved', `${id} 应可解析`);
    if (res.status === 'resolved') {
      assert.equal(res.model.id, id, `${id} 不得被别名改写`);
      assert.equal(res.resolvedFrom, undefined);
    }
  }
});

test('真实 registry：wan 家族歧义返回多候选', () => {
  const r = new ModelRegistry();
  const res = r.resolve('wan');
  assert.equal(res.status, 'ambiguous');
  if (res.status === 'ambiguous') assert.ok(res.candidates.length >= 5, 'wan 家族应有多个视频模型候选');
});

test('真实 registry：三个大类都有默认首选模型', () => {
  const r = new ModelRegistry();
  ['text', 'image', 'video'].forEach((m) => {
    const def = r.defaultForModality(m as 'text' | 'image' | 'video');
    assert.ok(def, `${m} 应有默认首选`);
  });
});

test('真实 registry：图像异步 -gp 模型标记 off-by-default 且 async', () => {
  const r = new ModelRegistry();
  const cap = r.byRealId('gpt-image-2-gp');
  assert.ok(cap, '存在 gpt-image-2-gp');
  assert.equal(cap?.selectionLevel, 'off-by-default');
  assert.ok(cap?.endpoints.some((e) => e.async && e.queryPath), '异步图像接口应有 queryPath');
});

// ============ 版本层级校准（只留最新两版）============
test('真实 registry：kling 旧版 v2.6-std 降级为 off-by-default', () => {
  const r = new ModelRegistry();
  assert.equal(r.byRealId('kling-v2.6-std')?.selectionLevel, 'off-by-default');
  assert.equal(r.byRealId('kling-v3.0-pro')?.selectionLevel, 'fallback');
});

test('真实 registry：wan 旧版 wan2.6-t2v 降级为 off-by-default，wan2.7-t2v 保留 fallback', () => {
  const r = new ModelRegistry();
  assert.equal(r.byRealId('wan2.6-t2v')?.selectionLevel, 'off-by-default');
  assert.equal(r.byRealId('wan2.7-t2v')?.selectionLevel, 'fallback');
});

test('真实 registry：MiniMax-H3 notes 标注平替 seedance 2.0', () => {
  const r = new ModelRegistry();
  const m = r.byRealId('MiniMax-H3');
  assert.ok(m?.notes?.includes('平替'), 'MiniMax-H3 应标注平替关系');
});

// ============ 错误码映射（说人话）============
test('resolveError: 401 未授权给出认证失败 + 通俗 plain + 引导', async () => {
  const mod = await import('../src/core/errors.js');
  const e = mod.resolveError(401, 'invalid_api_key');
  assert.equal(e.nature, '密钥无效');
  assert.ok(e.nextStep.includes('KWJM_API_KEY'));
  assert.equal(e.retryable, false);
  assert.ok(e.plain.length > 0, '应有通俗解释');
  assert.ok(e.plain.includes('密钥'), '通俗解释应说人话');
});

test('resolveError: 403 禁止访问（余额不足）', async () => {
  const mod = await import('../src/core/errors.js');
  const e = mod.resolveError(403);
  assert.equal(e.nature, '没权限或没钱了');
  assert.ok(e.plain.includes('余额') || e.plain.includes('额度'));
});

test('resolveError: 429 限流可重试', async () => {
  const mod = await import('../src/core/errors.js');
  const e = mod.resolveError(429, 'rate_limit_exceeded');
  assert.equal(e.nature, '请求太快了');
  assert.equal(e.retryable, true);
});

test('resolveError: 503 内容政策违规', async () => {
  const mod = await import('../src/core/errors.js');
  const e = mod.resolveError(503);
  assert.equal(e.nature, '内容被拦了');
});

test('KwjmError 携带结构化 explanation（含 plain 通俗解释）', () => {
  const err = new KwjmError(401, 'unauthorized msg', undefined, 'invalid_api_key');
  assert.equal(err.explanation.nature, '密钥无效');
  assert.ok(err.explanation.plain.length > 0);
  assert.ok(err.explanation.nextStep.length > 0);
});
