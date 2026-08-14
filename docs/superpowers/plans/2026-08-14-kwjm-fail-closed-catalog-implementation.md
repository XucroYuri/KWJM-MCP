# KWJM 失败关闭模型目录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立以实时精确模型 ID 为存在性真相、以操作级契约为执行授权的失败关闭目录，彻底删除未知模型自动落入 `/v1/chat/completions` 的不安全行为，并固化异步图片协议与版本化价格快照。

**Architecture:** 新增独立 `catalog/` 边界，把实时快照、策展档案、协议档案、价格快照、解析与授权分开；旧 `core/registry.ts` 在本阶段末仅保留兼容导出，不再拥有模型真相。所有现有生成 handler 在触网前必须携带 `OperationId` 请求授权，只有 `documented` 或 `verified` 的精确模型/操作契约才能取得协议档案；价格只作为按精确 ID 与操作查询的时间点证据，不参与本阶段的网络调用或结算。

**Tech Stack:** TypeScript 5.6、Node.js 18+、Zod、Node test runner、`@modelcontextprotocol/sdk` 1.x。

**Spec:** `docs/superpowers/specs/2026-08-14-kwjm-full-model-protocol-design.md`。

## Global Constraints

- 生产 API Base URL 固定为 `https://kwjm.com`；不得恢复 JWMP 域名、环境变量或兼容回退。
- `GET /v1/models` 只证明精确 ID 的存在性；实时字段不得推断模态、操作、协议或价格。
- 精确 ID 原样透传；实时同名 ID 优先于别名，任何层都不得把 `openai/gpt-image-2` 静默改写成 `gpt-image-2`。
- 未知或证据不足模型必须可发现但不可执行；`explicit: true` 只能解除 `off_by_default`，不能绕过缺失契约。
- `gpt-image-2-gp` 与 `gemini-3.1-flash-image-preview-gp` 使用官方统一异步协议：`POST /v1/images/generations/tasks`、`GET /v1/images/generations/tasks/{task_id}`、状态 `WAIT/RUN/DONE/FAIL`。
- 异步图片协议支持 `images` 参考图列表；本阶段不得推断其支持未文档化的 `mask`。精确 mask/multipart 编辑继续绑定同步 `/v1/images/edits`。
- 图片稳定性选择为：GPT 生成/参考图 `gpt-image-2-gp` → `gpt-image-2-hq` → `gpt-image-2` → `gpt-image-2-sp`；Gemini 3.1 生成/参考图 `-gp` → `-hq` → `-wc`。
- `gpt-image-2-sp`、`gemini-3.1-flash-image-preview-wc` 和 `openai/gpt-image-2` 为 `off_by_default`；排序不授权失败后静默换模型重试。
- 版本化价格按精确模型 ID × 单一操作记录；金额使用十进制字符串，不从别名、后缀或家族继承，不把页面观察价写成实际结算金额。
- 默认选模顺序是能力硬条件 → 操作/协议 → 参数支持 → 稳定性 → 可比较预计成本；本阶段只提供价格事实，不实现跨计费单位自动比较。
- 本阶段不发起任何付费生成调用；只允许本地测试和显式执行的 `/v1/models` 只读刷新。
- 本阶段不调用日结、钱包或网页控制台，不实现单任务成本回执；日结聚合和本地成本缓存属于独立后续计划。
- 测试夹具、矩阵、错误、日志和审计收据不得记录或输出 `KWJM_API_KEY`、提示词、messages、工具实参、
  生成内容、媒体字节、媒体 URL 或完整上游响应。
- 不新增依赖；禁止新增无边界 `any`、`z.any()` 或由名称/厂商猜路由的分支。

---

## File Structure

### 新建文件

- `src/catalog/types.ts`：目录、操作、证据、协议和授权结果的稳定类型。
- `src/catalog/operations.ts`：全部 `OperationId` 常量及操作到工具语义的映射。
- `src/catalog/protocol-profiles.ts`：固定方法、路径、状态和重试语义的协议档案。
- `src/catalog/model-profiles.ts`：策展模型档案；只声明有证据的操作契约。
- `src/catalog/pricing.ts`：按精确模型 ID × 操作保存带日期的价格观察，不含结算金额或截图路径。
- `src/catalog/live-snapshot.ts`：实时 `/v1/models` 响应的有界解析与存在性快照。
- `src/catalog/catalog.ts`：精确 ID/别名解析、实时合并、分页列表和操作授权。
- `src/catalog/matrix.ts`：从快照和策展目录生成确定性的审计矩阵。
- `src/catalog/index.ts`：目录边界的公共导出。
- `src/cli/verify-matrix.ts`：比较或更新已提交矩阵的无凭据命令行入口。
- `test/fixtures/kwjm/models-2026-08-14.json`：已脱敏的 109 模型只读快照。
- `test/catalog-live-snapshot.unit.test.ts`：实时响应解析和边界测试。
- `test/catalog-resolution.unit.test.ts`：精确 ID、别名、未知模型与歧义解析测试。
- `test/catalog-authorization.unit.test.ts`：操作级失败关闭和跨协议误用测试。
- `test/catalog-image-priority.unit.test.ts`：图片变体排序与异步协议契约测试。
- `test/catalog-pricing.unit.test.ts`：价格方案、精确 ID 隔离、十进制金额和不可继承测试。
- `test/catalog-matrix.unit.test.ts`：109 模型矩阵覆盖和确定性测试。
- `test/catalog-handler-guard.integration.test.ts`：证明操作授权拒绝发生在任何 HTTP 调用之前。
- `docs/audits/model-contract-matrix.json`：逐模型、逐操作的可复现审计矩阵。

### 修改文件

- `src/core/types.ts`：改为从 `catalog/types.ts` 兼容导出仍被旧 handler 使用的类型。
- `src/core/registry.ts`：删除 834 行单体目录，改为 `ModelCatalog` 的兼容导出；删除未知模型默认 Chat 路由。
- `src/handlers/guard.ts`：守卫从模态级选择改为精确 `OperationId` 授权。
- `src/handlers/discovery.ts`：展示存在性、契约状态、操作和阻塞原因，不再宣称未知模型可 Chat。
- `src/handlers/text.ts`：分别以 `text.chat` 和 `text.messages` 请求授权。
- `src/handlers/image.ts`：分别以 `image.generate` 和 `image.edit` 请求授权。
- `src/handlers/video.ts`：按文本生视频、图生视频、视频编辑和任务查询请求授权。
- `src/handlers/validate.ts`：读取目标操作的约束，而不是读取单值模态能力。
- `test/registry.unit.test.ts`：保留兼容面回归测试，删除“未知实时模型可显式执行”的旧假设。
- `test/e2e.test.ts`：验证服务器级发现结果包含契约状态和空操作列表，不发起外部请求。
- `test/live.readonly.test.ts`：核心清单更新为设计中的 22 个精确 ID，只验证存在性和精确 ID 保留。
- `package.json`：增加 `test:catalog` 和 `verify:matrix`，并把目录测试加入 `npm test`。

## Interfaces

以下接口在 Task 1 固定，后续任务不得自行改名：

```ts
export type OperationId =
  | 'text.chat'
  | 'text.responses'
  | 'text.messages'
  | 'text.gemini_generate'
  | 'image.generate'
  | 'image.edit'
  | 'video.text_to_video'
  | 'video.image_to_video'
  | 'video.video_to_video'
  | 'video.reference_to_video'
  | 'video.regenerate'
  | 'task.get'
  | 'audio.text_to_speech'
  | 'audio.list_custom_voices'
  | 'video.enhance'
  | 'video.erase_subtitle'
  | 'asset.create_group'
  | 'asset.list_groups'
  | 'asset.get_group'
  | 'asset.update_group'
  | 'asset.delete_group'
  | 'asset.create'
  | 'asset.list'
  | 'asset.get'
  | 'asset.update'
  | 'asset.delete';

export type SupportStatus = 'verified' | 'documented' | 'unverified_variant' | 'blocked';
export type SelectionLevel = 'default' | 'fallback' | 'off_by_default';
export type Availability = 'available' | 'missing' | 'unknown';
export type CostRisk = 'low' | 'medium' | 'high' | 'unknown';
export type NormalizedTaskStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
export type Modality = 'text' | 'image' | 'video' | 'audio' | 'asset' | 'enhance';

export type ProtocolProfileId =
  | 'openai_chat_v1'
  | 'openai_responses_v1'
  | 'anthropic_messages_v1'
  | 'gemini_native_v1beta'
  | 'openai_image_sync_generate_v1'
  | 'openai_image_sync_edit_v1'
  | 'kwjm_image_async_v1'
  | 'kling_image_async_v1'
  | 'kwjm_video_v1'
  | 'content_task_v3'
  | 'doubao_video_v1'
  | 'kling_video_v1'
  | 'video_create_v1'
  | 'openai_video_v1'
  | 'minimax_video_v2'
  | 'video_enhance_v3'
  | 'subtitle_erase_v3'
  | 'tts_v1'
  | 'asset_v3'
  | 'dashscope_compat_v1';

export interface OperationContract {
  protocolProfile: ProtocolProfileId;
  supportStatus: SupportStatus;
  selectionLevel: SelectionLevel;
  costRisk: CostRisk;
  costFactors: readonly string[];
  requirements: readonly string[];
  evidence: readonly EvidenceRef[];
  pricingSnapshots: readonly PricingSnapshot[];
  constraints?: Constraints;
}

export type PriceScheme =
  | { kind: 'token_pair'; inputCnyPerMillionTokens: string; outputCnyPerMillionTokens: string; imageInputToTextMultiplier?: string }
  | { kind: 'resolution_tier'; unit: 'per_output_image'; tiersCny: Readonly<Record<string, string>> }
  | { kind: 'fixed_output'; amountCny: string; scope: 'platform_standard_price_unspecified_resolution' }
  | { kind: 'unknown' };

export interface PricingSnapshot {
  exactId: string;
  operation: OperationId;
  currency: 'CNY';
  scheme: PriceScheme;
  observedAt: string;
  evidence: EvidenceRef;
  observationStatus: 'observed_only' | 'superseded' | 'unknown';
}

export interface ModelProfile {
  exactId: string;
  family: string;
  modalities: readonly Modality[];
  availability: Availability;
  catalogStatus: SupportStatus;
  operationContracts: Partial<Record<OperationId, OperationContract>>;
  aliases?: readonly string[];
}

export interface LiveModelEntry {
  id: string;
  object?: string;
  ownedBy?: string;
}

export interface LiveModelSnapshot {
  observedAt: string;
  models: readonly LiveModelEntry[];
}

export interface Constraints {
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
  size?: readonly string[] | { pattern?: string; note?: string };
  resolution?: readonly string[];
  ratio?: readonly string[];
  duration?: readonly string[] | { min?: number; max?: number; note?: string };
  quality?: readonly string[];
  outputFormat?: readonly string[];
  hardFail?: readonly string[];
}

export type ModelResolution =
  | { status: 'resolved'; model: ModelProfile; resolvedFrom?: string }
  | { status: 'ambiguous'; input: string; candidates: readonly ModelProfile[] }
  | { status: 'not_found'; input: string };

export type AuthorizationDecision =
  | { ok: true; model: ModelProfile; operation: OperationId; contract: OperationContract; protocol: ProtocolProfile }
  | { ok: false; code: 'MODEL_NOT_FOUND' | 'MODEL_AMBIGUOUS' | 'MODEL_NOT_AVAILABLE' | 'OPERATION_NOT_CONTRACTED' | 'OPERATION_BLOCKED' | 'EXPLICIT_SELECTION_REQUIRED'; message: string; candidates?: readonly string[] };
```

## Scope Decomposition

本文件只执行正式设计的阶段 0，并形成后续计划依赖的稳定目录接口。阶段 0 完成后按顺序分别编写并执行：

1. 现代 MCP `registerTool`、结构化输出、规划器与选模策略。
2. 单日日结聚合、`KWJM_API_KEY_ID` 过滤、安全缓存与人工测试回执。
3. Chat、Responses、Messages、Gemini Native 与协议专属流式实现。
4. 图片、视频、音频、处理、资产和异步任务账本。
5. 协议族代表实测、核心模型门禁测试、npm/GitHub 发布收口。

后续计划不得修改本阶段的精确 ID、失败关闭、价格证据或不自动重试不变量；若确需修改，必须先更新正式设计并重新评审。

---

### Task 1: 锁定目录领域类型和操作词表

**Files:**

- Create: `src/catalog/types.ts`
- Create: `src/catalog/operations.ts`
- Create: `src/catalog/index.ts`
- Test: `test/catalog-authorization.unit.test.ts`

**Interfaces:**

- Consumes: 正式设计第 5、6、8、9 节的状态与操作定义。
- Produces: 上述 `OperationId`、`ModelProfile`、`OperationContract`、`AuthorizationDecision` 和只读常量 `OPERATIONS`。

- [ ] **Step 1: 写类型级失败测试**

在 `test/catalog-authorization.unit.test.ts` 创建最小运行时断言，确保操作词表没有重复且包含现有工具需要的操作：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPERATION_IDS } from '../src/catalog/operations.js';

test('操作 ID 唯一且覆盖现有生成入口', () => {
  assert.equal(new Set(OPERATION_IDS).size, OPERATION_IDS.length);
  for (const id of ['text.chat', 'text.messages', 'image.generate', 'image.edit', 'video.text_to_video', 'task.get']) {
    assert.ok(OPERATION_IDS.includes(id as (typeof OPERATION_IDS)[number]), id);
  }
});
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `npx tsx --test test/catalog-authorization.unit.test.ts`

Expected: FAIL，错误包含 `Cannot find module '../src/catalog/operations.js'`。

- [ ] **Step 3: 实现稳定类型和操作常量**

在 `src/catalog/operations.ts` 用 `as const satisfies readonly OperationId[]` 导出完整操作列表；在
`src/catalog/types.ts` 实现本计划 Interfaces 中的类型，并补充下列证据类型。`PricingSnapshot` 的金额字段
只能是十进制字符串；`OperationContract.pricingSnapshots` 必须存在，未知价格使用空数组，不用
`undefined` 暗示可继承价格。

```ts
export type EvidenceKind =
  | 'live_list'
  | 'official_doc'
  | 'operator_observation'
  | 'contract_test'
  | 'representative_live'
  | 'exact_live'
  | 'platform_ui_snapshot'
  | 'manual_console_receipt';

export interface EvidenceRef {
  kind: EvidenceKind;
  source: string;
  observedAt: string;
  operation?: OperationId;
}

export interface ProtocolProfile {
  id: ProtocolProfileId;
  operations: readonly OperationId[];
  request: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    retry: 'never' | 'safe_get_only';
  };
  query?: {
    method: 'GET';
    path: string;
    retry: 'safe_get_only';
    taskIdField: string;
    requestIdField?: string;
  };
  async: boolean;
  rawStatuses?: readonly string[];
  statusMap?: Readonly<Record<string, NormalizedTaskStatus>>;
}
```

- [ ] **Step 4: 导出目录公共面并验证绿灯**

Run: `npx tsx --test test/catalog-authorization.unit.test.ts && npm run build`

Expected: PASS，TypeScript 无隐式 `any`。

- [ ] **Step 5: 提交**

```bash
git add src/catalog/types.ts src/catalog/operations.ts src/catalog/index.ts test/catalog-authorization.unit.test.ts
git commit -m "ref(catalog): Define operation contracts"
```

### Task 2: 固化 109 模型快照并严格解析实时响应

**Files:**

- Create: `src/catalog/live-snapshot.ts`
- Create: `test/fixtures/kwjm/models-2026-08-14.json`
- Create: `test/catalog-live-snapshot.unit.test.ts`

**Interfaces:**

- Consumes: `LiveModelEntry`、`Availability`。
- Produces: `parseLiveModels(input: unknown, observedAt: string): LiveModelSnapshot`；只保留 `id`、`object`、`ownedBy` 和抓取时间。

- [ ] **Step 1: 从只读响应生成脱敏夹具**

只执行 `GET /v1/models`；转换脚本不得打印 Authorization 或原始响应，仅将允许字段写入临时文件，人工确认后通过 `apply_patch` 加入仓库：

```ts
const data = Array.isArray(response) ? response : response.data;
const fixture = {
  observedAt: '2026-08-14T05:49:46.965Z',
  source: 'GET https://kwjm.com/v1/models',
  models: data.map(({ id, object, owned_by }) => ({ id, object, owned_by })),
};
```

验收：`models.length === 109`，每个 `id` 非空且唯一，文件中不含 `api_key`、`authorization`、`prompt`、`content`、`url`。

- [ ] **Step 2: 写严格解析失败测试**

覆盖数组/`{data}` 两种合法外壳、重复 ID、空 ID、非数组 `data`、额外未知字段和超出 1000 项上限。非法输入必须抛出有界错误，不把原始对象序列化进错误消息。

- [ ] **Step 3: 运行测试并确认红灯**

Run: `npx tsx --test test/catalog-live-snapshot.unit.test.ts`

Expected: FAIL，缺少 `parseLiveModels`。

- [ ] **Step 4: 实现有界解析**

`parseLiveModels` 最多接受 1000 项；用 `unknown`、类型守卫和 `Map` 去重，按精确 ID 排序返回不可变数组。`owned_by` 只映射为展示字段 `ownedBy`，不得用于协议推断。

- [ ] **Step 5: 验证夹具与解析器**

Run: `npx tsx --test test/catalog-live-snapshot.unit.test.ts`

Expected: PASS，基线断言为 109 个唯一精确 ID。

- [ ] **Step 6: 提交**

```bash
git add src/catalog/live-snapshot.ts test/fixtures/kwjm/models-2026-08-14.json test/catalog-live-snapshot.unit.test.ts
git commit -m "test(catalog): Freeze live model snapshot"
```

### Task 3: 建立协议档案并锁定异步图片统一契约

**Files:**

- Create: `src/catalog/protocol-profiles.ts`
- Create: `test/catalog-image-priority.unit.test.ts`

**Interfaces:**

- Consumes: `ProtocolProfile`、`ProtocolProfileId`。
- Produces: `PROTOCOL_PROFILES` 和 `getProtocolProfile(id)`；本阶段至少实现 `openai_chat_v1`、
  `anthropic_messages_v1`、`openai_image_sync_generate_v1`、`openai_image_sync_edit_v1`、
  `kwjm_image_async_v1`、`kwjm_video_v1`、`content_task_v3`。

- [ ] **Step 1: 写异步图片协议失败测试**

```ts
test('异步图片协议固定创建、查询和状态契约', () => {
  const p = getProtocolProfile('kwjm_image_async_v1');
  assert.deepEqual(p.operations, ['image.generate', 'task.get']);
  assert.deepEqual(p.request, {
    method: 'POST',
    path: '/v1/images/generations/tasks',
    retry: 'never',
  });
  assert.deepEqual(p.query, {
    method: 'GET',
    path: '/v1/images/generations/tasks/{task_id}',
    retry: 'safe_get_only',
    taskIdField: 'task_id',
    requestIdField: 'request_id',
  });
  assert.deepEqual(p.rawStatuses, ['WAIT', 'RUN', 'DONE', 'FAIL']);
  assert.deepEqual(p.statusMap, {
    WAIT: 'queued',
    RUN: 'processing',
    DONE: 'succeeded',
    FAIL: 'failed',
  });
});
```

同时断言协议档案中没有 `mask` 能力；`openai_image_sync_edit_v1` 单独绑定 `/v1/images/edits`。

- [ ] **Step 2: 运行测试并确认红灯**

Run: `npx tsx --test test/catalog-image-priority.unit.test.ts`

Expected: FAIL，缺少 `protocol-profiles.ts`。

- [ ] **Step 3: 实现协议档案**

以 [KWJM 异步图片官方文档](https://kwjm.com/docs/modelhub/openai/images-generations-async.html) 为
`kwjm_image_async_v1` 的 `official_doc` 来源。所有路径以 `/` 开头；付费 POST 固定
`request.retry = never`，查询 GET 固定 `query.retry = safe_get_only`，具体退避由后续 transport 计划实现。文档的路径和
示例使用 `task_id`，返回字段说明同时提到 `request_id`；目录必须把前者作为查询绑定字段、后者作为请求
追踪字段，禁止在缺少 `task_id` 时自动拿 `request_id` 猜测查询。

- [ ] **Step 4: 验证路径模板和状态全集**

Run: `npx tsx --test test/catalog-image-priority.unit.test.ts && npm run build`

Expected: PASS；测试中找不到 `/v1/videos/` 或通用任务查询回退。

- [ ] **Step 5: 提交**

```bash
git add src/catalog/protocol-profiles.ts test/catalog-image-priority.unit.test.ts
git commit -m "feat(catalog): Define async image protocol"
```

### Task 4: 策展核心模型和图片稳定性排序

**Files:**

- Create: `src/catalog/model-profiles.ts`
- Modify: `test/catalog-image-priority.unit.test.ts`
- Test: `test/catalog-resolution.unit.test.ts`

**Interfaces:**

- Consumes: `PROTOCOL_PROFILES`、22 个核心精确模型 ID、证据分层。
- Produces: `CURATED_MODEL_PROFILES`、`IMAGE_SELECTION_POLICIES` 和 `getCuratedProfile(exactId)`。

- [ ] **Step 1: 写精确 ID 与稳定性排序失败测试**

断言：

```ts
assert.deepEqual(IMAGE_SELECTION_POLICIES.gpt_reference_transform, [
  'gpt-image-2-gp',
  'gpt-image-2-hq',
  'gpt-image-2',
  'gpt-image-2-sp',
]);
assert.deepEqual(IMAGE_SELECTION_POLICIES.gemini_3_1_reference_transform, [
  'gemini-3.1-flash-image-preview-gp',
  'gemini-3.1-flash-image-preview-hq',
  'gemini-3.1-flash-image-preview-wc',
]);
assert.equal(getCuratedProfile('gpt-image-2-gp')?.operationContracts['image.generate']?.protocolProfile, 'kwjm_image_async_v1');
assert.equal(getCuratedProfile('gemini-3.1-flash-image-preview-gp')?.operationContracts['image.generate']?.protocolProfile, 'kwjm_image_async_v1');
assert.equal(getCuratedProfile('gpt-image-2-sp')?.operationContracts['image.generate']?.selectionLevel, 'off_by_default');
assert.equal(getCuratedProfile('openai/gpt-image-2')?.operationContracts['image.generate']?.selectionLevel, 'off_by_default');
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `npx tsx --test test/catalog-image-priority.unit.test.ts test/catalog-resolution.unit.test.ts`

Expected: FAIL，缺少策展档案。

- [ ] **Step 3: 实现策展档案**

把 22 个核心 ID 逐个写为精确键。只有精确官方文档或已经存在的脱敏 `exact_live` 收据可以支撑
`documented`/`verified` 可执行契约；`contract_test` 只能验证本地实现与既有契约一致，不能单独升级能力。
`operator_observation` 只影响选择排序。只有 `live_list` 的单元保持 `unverified_variant`，
`operationContracts` 为空；不得从 `owned_by`、后缀或相邻模型复制端点。
Task 4 创建的每个 `OperationContract` 先显式设置 `pricingSnapshots: []`，使类型完整且不隐式继承价格；
Task 5 再按精确 ID 与操作注入已验证的价格观察。

核心精确 ID 常量必须完整写成：

```ts
export const CORE_MODEL_IDS = [
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-image-2-hq',
  'gpt-image-2-sp',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'grok-4.5',
  'kw-video-v2-mini',
  'kw-video-v2.5',
  'openai/gpt-5.5',
  'openai/gpt-image-2',
  'gpt-image-2',
  'gpt-image-2-gp',
  'sd-video-enhance-ext',
  'gemini-2.5-flash-image-hq',
  'gemini-3-pro-image-preview-hq',
  'gemini-3.1-flash-image-preview-gp',
  'gemini-3.1-flash-image-preview-hq',
  'gemini-3.1-flash-image-preview-wc',
  'gemini-3.5-flash',
  'MiniMax-M3',
] as const;
```

- [ ] **Step 4: 固化异步图片约束**

`gpt-image-2-gp` 设置 `maxReferenceImages: 16`、`quality: low|medium|high`；
`gemini-3.1-flash-image-preview-gp` 设置 `maxReferenceImages: 11`。两者的 `official_doc` 均指向用户提供的
异步图片页面，`operator_observation` 只影响选择排序，不升级 `supportStatus`。

- [ ] **Step 5: 验证精确 ID 不互相改写**

Run: `npx tsx --test test/catalog-image-priority.unit.test.ts test/catalog-resolution.unit.test.ts`

Expected: PASS；`openai/gpt-image-2` 与 `gpt-image-2` 返回不同档案对象和不同 `exactId`。

- [ ] **Step 6: 提交**

```bash
git add src/catalog/model-profiles.ts test/catalog-image-priority.unit.test.ts test/catalog-resolution.unit.test.ts
git commit -m "feat(catalog): Curate priority model profiles"
```

### Task 5: 固化版本化价格观察并禁止继承

**Files:**

- Create: `src/catalog/pricing.ts`
- Create: `test/catalog-pricing.unit.test.ts`
- Modify: `src/catalog/model-profiles.ts`
- Modify: `src/catalog/index.ts`

**Interfaces:**

- Consumes: `PricingSnapshot`、`EvidenceRef`、`OperationId`。
- Produces: `PRICING_SNAPSHOTS`、`getPricingSnapshots(exactId, operation)` 和
  `assertPricingSnapshots(snapshots)`。

- [ ] **Step 1: 写价格快照失败测试**

在 `test/catalog-pricing.unit.test.ts` 锁定 14 个精确 ID、18 条逐操作记录和字符串金额：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPricingSnapshots, PRICING_SNAPSHOTS } from '../src/catalog/pricing.js';

test('价格观察按精确模型和单一操作存储', () => {
  assert.equal(new Set(PRICING_SNAPSHOTS.map((item) => item.exactId)).size, 14);
  assert.equal(PRICING_SNAPSHOTS.length, 18);
  assert.deepEqual(
    getPricingSnapshots('gpt-image-2-gp', 'image.generate')[0]?.scheme,
    { kind: 'token_pair', inputCnyPerMillionTokens: '58', outputCnyPerMillionTokens: '222' },
  );
  assert.deepEqual(getPricingSnapshots('gpt-image-2-gp', 'image.edit'), []);
  assert.notDeepEqual(
    getPricingSnapshots('openai/gpt-image-2', 'image.generate'),
    getPricingSnapshots('gpt-image-2', 'image.generate'),
  );
});
```

再断言全部 `currency === 'CNY'`、`observationStatus === 'observed_only'`、证据类型为
`platform_ui_snapshot`、`observedAt` 是 2026-08-14 的 ISO 时间，所有金额匹配
`/^(0|[1-9]\d*)(\.\d+)?$/`，且任何证据 `source` 都不含本地截图路径。

- [ ] **Step 2: 运行测试并确认红灯**

Run: `npx tsx --test test/catalog-pricing.unit.test.ts`

Expected: FAIL，缺少 `src/catalog/pricing.ts`。

- [ ] **Step 3: 实现完整价格观察表**

按下表生成逐操作 `PricingSnapshot`。列出 `image.generate,image.edit` 的行必须展开成两条记录；其他行只
绑定 `image.generate`。`source` 固定为 `KWJM model center UI`，不保存截图文件名或路径。

| 精确 ID | 操作 | `PriceScheme` |
|---|---|---|
| `gemini-2.5-flash-image-gp` | `image.generate` | `resolution_tier`：1K `0.30`、2K `0.38`、4K `0.46` |
| `gemini-2.5-flash-image-hq` | `image.generate` | `fixed_output`：`0.21`，分辨率范围未说明 |
| `gemini-2.5-flash-image` | `image.generate` | `fixed_output`：`0.45`，分辨率范围未说明 |
| `gemini-3-pro-image-preview-gp` | `image.generate` | `token_pair`：输入 `14.8`、输出 `888` / 1M tokens |
| `gemini-3-pro-image-preview-hq` | `image.generate` | `resolution_tier`：1K/2K `0.495`、4K `0.8274` |
| `gemini-3.1-flash-image-preview-gp` | `image.generate` | `token_pair`：输入 `3.7`、输出 `444` / 1M tokens |
| `gemini-3.1-flash-image-preview-hq` | `image.generate` | `resolution_tier`：1K `0.49`、2K `0.73`、4K `1.10` |
| `gemini-3.1-flash-image-preview` | `image.generate` | `fixed_output`：`0.7474`，分辨率范围未说明 |
| `gemini-3.1-flash-image-preview-wc` | `image.generate` | `resolution_tier`：1K `0.49`、2K `0.73`、4K `1.10` |
| `openai/gpt-image-2` | `image.generate,image.edit` | `token_pair`：输入 `37`、输出 `222`、图片输入倍数 `1.6` |
| `gpt-image-2` | `image.generate,image.edit` | `token_pair`：输入 `37`、输出 `222`、图片输入倍数 `1.6` |
| `gpt-image-2-hq` | `image.generate,image.edit` | `token_pair`：输入 `37`、输出 `222`、图片输入倍数 `1.6` |
| `gpt-image-2-sp` | `image.generate,image.edit` | `token_pair`：输入 `37`、输出 `222`、图片输入倍数 `1.6` |
| `gpt-image-2-gp` | `image.generate` | `token_pair`：输入 `58`、输出 `222`；没有图片输入倍数证据 |

`fixed_output.scope` 必须是 `platform_standard_price_unspecified_resolution`。`assertPricingSnapshots` 拒绝
重复的 `exactId + operation + observedAt`、非十进制金额、未知币种、缺证据或给 `gpt-image-2-gp` 添加
`imageInputToTextMultiplier`。

- [ ] **Step 4: 把快照连接到操作契约但不升级授权**

`model-profiles.ts` 为每个已有操作调用 `getPricingSnapshots(exactId, operation)`。只有价格证据但没有能力
契约的模型仍保持 `unverified_variant` 或 `blocked`；价格快照不得创建 operation、protocol 或
`documented` 状态。`openai/gpt-image-2` 和 `gpt-image-2` 返回内容相同但对象、`exactId` 与查询键不同。

- [ ] **Step 5: 运行价格与目录测试**

Run:

```bash
npx tsx --test test/catalog-pricing.unit.test.ts test/catalog-image-priority.unit.test.ts test/catalog-authorization.unit.test.ts
npm run build
```

Expected: PASS；`getPricingSnapshots('unknown-model', 'image.generate')` 返回空数组，且任何价格查询都不会
改变 `ModelCatalog.authorize` 的结果。

- [ ] **Step 6: 提交**

```bash
git add src/catalog/pricing.ts src/catalog/model-profiles.ts src/catalog/index.ts test/catalog-pricing.unit.test.ts
git commit -m "feat(catalog): Add versioned price observations"
```

### Task 6: 实现实时合并、解析和操作级失败关闭授权

**Files:**

- Create: `src/catalog/catalog.ts`
- Modify: `test/catalog-resolution.unit.test.ts`
- Modify: `test/catalog-authorization.unit.test.ts`

**Interfaces:**

- Consumes: `LiveModelSnapshot`、`CURATED_MODEL_PROFILES`、`PROTOCOL_PROFILES`。
- Produces: `ModelCatalog.mergeLive(snapshot)`、`resolve(input)`、`authorize(exactId, operation, options)`、`list(query)`。

- [ ] **Step 1: 写未知模型失败关闭测试**

```ts
const catalog = new ModelCatalog([]);
catalog.mergeLive({ observedAt: '2026-08-14T00:00:00.000Z', models: [{ id: 'brand-new-model-z9' }] });
const profile = catalog.getExact('brand-new-model-z9');
assert.equal(profile?.availability, 'available');
assert.equal(profile?.catalogStatus, 'unverified_variant');
assert.deepEqual(profile?.operationContracts, {});
assert.equal(catalog.authorize('brand-new-model-z9', 'text.chat', { explicit: true }).ok, false);
```

再覆盖：精确 ID 优先于别名、歧义别名返回候选、不可用策展模型拒绝、缺操作拒绝、blocked 拒绝、
off_by_default 无 explicit 拒绝、off_by_default 有 explicit 且已有 documented/verified 契约才允许。

- [ ] **Step 2: 运行测试并确认红灯**

Run: `npx tsx --test test/catalog-resolution.unit.test.ts test/catalog-authorization.unit.test.ts`

Expected: FAIL，缺少 `ModelCatalog`。

- [ ] **Step 3: 实现目录合并不变量**

实时刷新只更新 `availability` 和展示元数据。未知 ID 创建 `unverified_variant` 空档案；已策展但实时缺失的
模型标为 `missing`；任何实时 ID 若与别名同名，删除该别名解析边而保留精确 ID。

- [ ] **Step 4: 实现操作授权**

授权顺序固定为：解析精确模型 → 检查 availability → 查找目标 operation → 检查 supportStatus → 检查
selectionLevel → 取得 protocol profile。任何失败返回机器错误码，不返回原始请求或上游数据。

- [ ] **Step 5: 运行目录测试**

Run: `npx tsx --test test/catalog-resolution.unit.test.ts test/catalog-authorization.unit.test.ts`

Expected: PASS，所有拒绝路径均在构造 `KwjmClient` 之前完成。

- [ ] **Step 6: 提交**

```bash
git add src/catalog/catalog.ts test/catalog-resolution.unit.test.ts test/catalog-authorization.unit.test.ts
git commit -m "feat(catalog): Fail closed by operation"
```

### Task 7: 将现有工具迁移到操作级授权

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/registry.ts`
- Modify: `src/handlers/guard.ts`
- Modify: `src/handlers/discovery.ts`
- Modify: `src/handlers/text.ts`
- Modify: `src/handlers/image.ts`
- Modify: `src/handlers/video.ts`
- Modify: `src/handlers/validate.ts`
- Modify: `test/registry.unit.test.ts`
- Modify: `test/e2e.test.ts`
- Create: `test/catalog-handler-guard.integration.test.ts`

**Interfaces:**

- Consumes: `ModelCatalog.authorize`。
- Produces: `guardOperation(catalog, modelInput, operation, options)`；旧 `guardModel` 删除。

- [ ] **Step 1: 写 handler 集成失败测试证明未知模型不触网**

在 `test/catalog-handler-guard.integration.test.ts` 中直接注册 `registerText`，传入含
`brand-new-model-z9` 的 `ModelCatalog` 和一个每次方法调用都递增计数后抛错的 fake client。以
`explicit: true` 调用捕获到的 `chat_completions` handler，断言 `isError === true`、错误码为
`OPERATION_NOT_CONTRACTED`，且 fake client 调用计数为 0。

- [ ] **Step 2: 写跨协议负向测试**

覆盖 `gpt-image-2-gp` 调用 Chat、`deepseek-v4-flash` 调用 Image、仅同步编辑契约调用异步任务查询、
Messages 契约误进 Chat。每个案例都断言本地拒绝且网络计数为 0。

- [ ] **Step 3: 运行测试并确认红灯**

Run: `npx tsx --test test/registry.unit.test.ts test/catalog-handler-guard.integration.test.ts test/e2e.test.ts`

Expected: 至少“未知模型 explicit”测试 FAIL，因为旧 `mergeLive` 仍注入 Chat 端点。

- [ ] **Step 4: 替换 handler 守卫调用**

`chat_completions` 传 `text.chat`，`messages` 传 `text.messages`，`generate_image` 传 `image.generate`，
`edit_image` 传 `image.edit`。视频工具依据输入模式传具体视频操作；查询工具只接受本地任务绑定，旧的
“找不到就猜通用查询端点”逻辑删除。

- [ ] **Step 5: 收窄发现结果**

`list_models` 和 `get_model_capabilities` 返回 `availability`、`catalogStatus`、`operations`、证据类型和
阻塞码；未知实时模型显示为空操作列表。删除“未知模型非指明不调用即可执行”的文案。

- [ ] **Step 6: 保留兼容导出并删除单体真相**

`src/core/registry.ts` 只重导出新的默认 `catalog`、必要的兼容类型和薄适配方法，不保留 `SEED`、
`mergeLive` 的默认 Chat 注入或第二份模型表。

- [ ] **Step 7: 验证所有本地行为**

Run: `npm run build && npm test`

Expected: PASS；源码扫描 `rg -n "modality: 'text'.*chat/completions|能力未策展；非指明不调用" src` 无命中。

- [ ] **Step 8: 提交**

```bash
git add src/core src/handlers test/registry.unit.test.ts test/catalog-handler-guard.integration.test.ts test/e2e.test.ts
git commit -m "ref: Authorize tools by model operation"
```

### Task 8: 生成并验证全部模型契约矩阵

**Files:**

- Create: `src/catalog/matrix.ts`
- Create: `src/cli/verify-matrix.ts`
- Create: `test/catalog-matrix.unit.test.ts`
- Create: `docs/audits/model-contract-matrix.json`
- Modify: `package.json`
- Modify: `test/live.readonly.test.ts`

**Interfaces:**

- Consumes: 固定快照、策展档案、协议档案。
- Produces: `buildContractMatrix(snapshot, catalog): ContractMatrix`；`verify:matrix` 在漂移时非零退出。

- [ ] **Step 1: 写矩阵覆盖失败测试**

断言每个快照 ID 恰有一条记录，并包含 `existence`、`contract`、`representativeLive`、`exactLive`、
`operations`、`pricingSnapshots`、`blockers` 和 `evidenceObservedAt`。对仅实时存在的 ID，`contract` 必须是
`unverified_variant` 且 `operations` 为空。

- [ ] **Step 2: 运行测试并确认红灯**

Run: `npx tsx --test test/catalog-matrix.unit.test.ts`

Expected: FAIL，缺少 `buildContractMatrix`。

- [ ] **Step 3: 实现确定性矩阵**

按 `exactId` 排序，证据按 `kind/source/observedAt` 排序；JSON 使用两个空格缩进并以换行结尾。
`--write` 仅写 `docs/audits/model-contract-matrix.json`，默认模式比较内存结果与已提交文件并在漂移时退出 1。
矩阵从 `PRICING_SNAPSHOTS` 独立关联价格，因此即使某模型没有可执行 `operationContracts`，其已有的
`platform_ui_snapshot` 价格观察仍可展示；显示价格不得改变 `contract`、`operations` 或授权结果。

- [ ] **Step 4: 增加可重复命令**

在 `package.json` 添加：

```json
{
  "test:catalog": "npx tsx --test test/catalog-live-snapshot.unit.test.ts test/catalog-resolution.unit.test.ts test/catalog-authorization.unit.test.ts test/catalog-image-priority.unit.test.ts test/catalog-pricing.unit.test.ts test/catalog-handler-guard.integration.test.ts test/catalog-matrix.unit.test.ts",
  "verify:matrix": "npm run build && node dist/cli/verify-matrix.js"
}
```

同时把六个目录测试加入 `npm test` 的本地测试清单。

- [ ] **Step 5: 更新核心只读存在性基线**

`test/live.readonly.test.ts` 使用设计中的 22 个核心 ID：同时保留彼此独立的 `openai/gpt-image-2` 与
`gpt-image-2`，并包含稳定默认入口 `gpt-image-2-gp` 和 `gemini-3.1-flash-image-preview-gp`；只断言实时
存在和精确 ID 保留，不断言能力可执行。

- [ ] **Step 6: 生成矩阵并验证**

Run:

```bash
npm run build
node dist/cli/verify-matrix.js --write
npm run test:catalog
npm run verify:matrix
npm test
```

Expected: 全部 PASS；矩阵模型总数为 109，核心 22 个均存在，未知模型无可执行操作；14 个价格模型共
18 条逐操作观察，矩阵不包含截图路径或实际结算金额。

- [ ] **Step 7: 提交**

```bash
git add src/catalog/matrix.ts src/cli/verify-matrix.ts test/catalog-matrix.unit.test.ts test/live.readonly.test.ts docs/audits/model-contract-matrix.json package.json package-lock.json
git commit -m "test(catalog): Verify full model contract matrix"
```

### Task 9: 阶段 0 对抗性收口

**Files:**

- Modify: `docs/audits/2026-08-14-release-closure.md`
- Modify: `docs/audits/2026-08-14-release-closure.json`
- Modify: `README.md`

**Interfaces:**

- Consumes: 阶段 0 的测试、矩阵和 Git 差异。
- Produces: 不含凭据的阶段收据；不得把阶段 0 完成表述为 npm 稳定版可发布。

- [ ] **Step 1: 运行完整本地验证**

```bash
npm run build
npm run test:catalog
npm run verify:matrix
npm test
npm audit
npm pack --dry-run
```

Expected: 构建、目录测试、矩阵、全量测试通过；审计与包清单结果逐项记录，不能只写“通过”。

- [ ] **Step 2: 执行秘密和危险默认扫描**

```bash
rg -n --hidden 'JWMP|api\.jwmp|JWMP_API_KEY|Authorization:\s*Bearer\s+[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{16,}' src package.json package-lock.json README.md docs/agents
rg -n "z\.any\(|:\s*any\b|as any\b" src
rg -n "unknown.*chat/completions|能力未策展；非指明不调用" src
git ls-files | rg 'codex-clipboard|\.(png|jpg|jpeg|webp)$'
rg -n '/var/folders|codex-clipboard|kwf_[A-Za-z0-9_-]+' src test docs/audits README.md
```

Expected: 第一、第三、第四和第五条无命中；第二条不得出现新增无边界类型，既有命中必须在后续 MCP
契约阶段列为待清理而不能被本阶段扩散。价格证据只包含抽象来源名与日期，不包含用户截图或完整任务 ID。

- [ ] **Step 3: 更新收口文档**

记录阶段 0 的 commit、109 模型矩阵摘要、22 核心模型存在性、18 条价格观察、未知模型失败关闭测试和
剩余阶段 1–5。
README 只更新当前目录语义，不宣称全部协议或稳定版完成。

- [ ] **Step 4: 独立审阅差异**

审阅重点：实时刷新是否可能创建端点、`explicit` 是否能越权、图片 `-gp` 是否绑定精确任务查询、
`openai/gpt-image-2` 是否被改写、任何错误/矩阵是否含内容或凭据。

- [ ] **Step 5: 最终验证并提交**

```bash
git diff --check
git status --short
git add README.md docs/audits/2026-08-14-release-closure.md docs/audits/2026-08-14-release-closure.json
git commit -m "docs(audit): Close fail-closed catalog phase"
git status --short --branch
```

Expected: 最终工作树干净；发布闸门仍为 `blocked_remaining_protocol_phases`。

## Self-Review Results

- **Spec coverage:** 本计划完整覆盖正式设计阶段 0，并为阶段 1–5 提供稳定的目录、操作和协议接口；现代
  `registerTool`、协议专属 SSE、规划 HMAC、账本、完整媒体/资产工具和真实生成验证明确不在本阶段冒充完成。
- **Async image authority:** 用户提供的官方页面直接约束创建、查询、状态、参考图上限和 GPT quality；未把
  `mask`、自动重试或自动模型回退加入契约。
- **Type consistency:** `OperationId`、`ProtocolProfileId`、`ModelProfile`、`OperationContract` 和
  `AuthorizationDecision`、`PriceScheme`、`PricingSnapshot` 在 Task 1 定义，后续任务只消费这些名称。
- **Price boundary:** Task 5 完整覆盖 14 个截图模型的 18 条逐操作观察；价格不能授权操作、不能从后缀
  继承，也不保存截图路径、账户折扣或实际扣款。
- **Safety:** 阶段内唯一允许的外部调用是显式只读 `/v1/models`；没有付费测试、发布、推送或密钥写盘。

## Stop Condition

阶段 0 只有在未知实时模型可发现但无法通过任何生成工具触网、109 模型矩阵可重复生成、22 个核心 ID
原样存在、14 个价格模型的 18 条逐操作观察可复现、两个 `-gp` 图片模型绑定同一异步协议档案、全部本地
测试与安全扫描通过时才完成。任何一项未满足，不得进入现代 MCP 工具迁移或真实生成验证。
