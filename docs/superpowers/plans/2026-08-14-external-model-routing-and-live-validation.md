# KWJM 外部模型路由与低成本实测实施计划

> **状态：** 历史阶段计划，已经执行并形成审计收据。新架构实施不得从本文件继续；以
> `2026-08-14-kwjm-fail-closed-catalog-implementation.md` 为当前入口。

> 执行方式：当前会话内按测试驱动逐项完成；不初始化 Git，不提交任何凭据、提示词或生成内容。

**目标：** 修复端点、实时模型注册、工具调用和流式传输四个阻塞点，然后以最低有效参数完成文本、图片和视频代表模型的真实可用性验证。

**事实来源：** 运行时模型 ID 以 `GET https://kwjm.com/v1/models` 为最终依据；静态能力元数据只负责端点、模态和约束，不能覆盖或改写实时返回的精确 ID。

**技术栈：** TypeScript、Node.js 18+、`@modelcontextprotocol/sdk` 1.30、Zod、Node test runner。

## 全局验收约束

- 所有公共 KWJM 端点均保留完整前缀（例如 `/v1/chat/completions`、`/v1/images/edits`、`/v3/contents/generations/tasks`）。
- `/v1/models` 中存在的精确 ID 必须原样解析；别名只在没有同名实时 ID 时生效。
- 文本工具完整传递 `tools`、`tool_choice`、`parallel_tool_calls`、assistant `tool_calls` 和 tool result 消息字段。
- `stream: true` 逐事件消费 SSE；客户端提供 `progressToken` 时发送 MCP `notifications/progress`，最终结果只返回有界摘要，不返回整段原始 SSE。
- 真实测试不落盘 API Key、提示词、生成文本、图片内容或视频内容；仅记录状态、模型、时间、usage/成本字段存在性和任务 ID 的脱敏摘要。
- 真实测试拆成只读、低成本文本、图片、视频四组；图片/视频仍需显式环境门禁，避免未来误跑。
- 最低实测参数：文本 `deepseek-v4-flash` 且 `max_tokens=1`；图片 `gpt-image-2`、`1024x1024`、`quality=low`、`n=1`；视频优先 `kw-video-v2-mini`，`duration=4`、`resolution=480p`、`generate_audio=false`。

## 任务 1：端点操作适配器

**文件：**

- 新增 `src/core/operations.ts`
- 新增 `test/operations.unit.test.ts`
- 修改 `src/handlers/discovery.ts`
- 修改 `src/handlers/text.ts`
- 修改 `src/handlers/image.ts`

**步骤：**

1. 先写失败测试，断言 models/chat/messages/image edits 的完整路径。
2. 新增集中式端点常量，避免 handler 继续手写缺少 `/v1` 的路径。
3. 替换四处错误路由。
4. 运行目标测试，确认由红转绿。

## 任务 2：实时模型注册表与精确 ID 优先

**文件：**

- 修改 `src/core/registry.ts`
- 修改 `test/registry.unit.test.ts`
- 修改 `test/e2e.test.ts`

**步骤：**

1. 先把旧的 `kw-video-v2 -> dreamina-*` 断言改为精确 ID 断言并观察失败。
2. 为 20 个第一阶段模型补充最小静态能力元数据。
3. 移除会劫持 `kw-video-v2*` 精确 ID 的旧别名。
4. 调整合并顺序：实时 exact ID 的优先级高于任何别名；未知实时模型保持 `off-by-default`。
5. 增加 `/v1/models` 模拟响应 E2E，验证 20 个 ID 全部原样可解析。

## 任务 3：工具调用 schema 与消息回环

**文件：**

- 修改 `src/handlers/text.ts`
- 新增 `test/text-tools.integration.test.ts`

**步骤：**

1. 用本地 HTTP 服务器写失败测试，捕获 MCP 发往 KWJM 的请求体。
2. 扩展 chat schema：`tools`、`tool_choice`、`parallel_tool_calls`。
3. 扩展消息 schema：`developer`/`tool` role、`tool_call_id`、`name`、assistant `tool_calls`。
4. 原样传递这些字段，测试工具定义、工具选择、assistant tool call 和 tool result 的完整回环。

## 任务 4：有界 SSE 解析与 MCP 进度通知

**文件：**

- 新增 `src/core/sse.ts`
- 修改 `src/handlers/result.ts`
- 修改 `src/handlers/text.ts`
- 新增 `test/streaming.integration.test.ts`

**步骤：**

1. 本地服务器分块发送 SSE，先写失败测试证明当前实现会整段缓冲并泄露原始 SSE。
2. 扩展 ToolRegistrar handler 签名，使其接收 SDK request extra。
3. 逐事件读取 `Response.body`，解析 `data:`；限制事件数和累计文本大小。
4. 如果存在 `_meta.progressToken`，每个有效事件发送 `notifications/progress`；没有 token 时仍逐块读取，但只返回最终有界摘要。
5. 断言最终工具结果不包含 `sse` 原文，并验证 progress 通知顺序。

## 任务 5：图片编辑传输契约

**文件：**

- 修改 `src/core/client.ts`
- 修改 `src/handlers/image.ts`
- 新增 `test/image-transport.integration.test.ts`

**步骤：**

1. 根据 KWJM 官方文档写失败测试，锁定 `/v1/images/edits` 的实际 Content-Type 和字段形态。
2. 若官方端点接受 JSON data URL，则保持 JSON；若要求 multipart，则新增 `postForm`，且禁止手工设置 multipart boundary。
3. 本地模拟验证 URL/data URL 输入不会错误序列化，也不会污染日志。

## 任务 6：分级 live 测试门禁

**文件：**

- 拆分 `test/live.integration.test.ts`
- 新增 `test/live.readonly.test.ts`
- 新增 `test/live.text.test.ts`
- 新增 `test/live.image.test.ts`
- 新增 `test/live.video.test.ts`
- 修改 `package.json`

**步骤：**

1. 增加 `test:live:readonly`、`test:live:text`、`test:live:image`、`test:live:video`。
2. 图片测试要求 `KWJM_LIVE_COST_ACK=image`；视频测试要求 `KWJM_LIVE_COST_ACK=video`。
3. 所有 live 断言只检查 HTTP/MCP 成功、usage 字段或 task id/status；输出只记录脱敏摘要。
4. 防止 `npm test`、`npm run test:live:readonly` 意外触发收费请求。

## 任务 7：真实低成本验收与审计回填

**文件：**

- 修改 `docs/audits/2026-08-14-external-model-availability.md`
- 修改 `docs/audits/2026-08-14-external-model-availability.json`

**步骤：**

1. 运行 build、unit、E2E 和本地模拟集。
2. 运行只读模型刷新，确认 20/20 精确 ID。
3. 运行低成本文本普通对话、流式、工具调用；不保存文本内容。
4. 运行最低档图片文生图；仅在生成成功后，用该次输出做一次最低档图片编辑，避免额外素材来源。
5. 运行最低档视频文生视频并轮询任务状态；图生视频/视频编辑若需要新增收费任务，作为独立能力记录，不由同一命令隐式触发。
6. 用日结接口记录调用前后已脱敏的成本变化；若平台日结存在延迟，明确写成“已提交但费用待日结”，不伪造闭环。
7. 更新审计报告，逐项标记 `verified`、`failed`、`not-run` 及直接证据。

## 最终验证命令

```bash
npm run build
npm test
npm run test:live:readonly
npm run test:live:text
KWJM_LIVE_COST_ACK=image npm run test:live:image
KWJM_LIVE_COST_ACK=video npm run test:live:video
```

收费测试严格串行：先读结果，再决定是否继续下一项；任何请求参数校验失败、余额不足、价格不明或任务异常都立即停止该收费分支。
