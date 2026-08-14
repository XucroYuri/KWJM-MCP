# 开物基模 (kwjm.com) MCP 服务设计

- 日期：2026-08-13
- 状态：已批准；2026-08-14 按实时模型证据修订
- 语言：本次开发沟通使用中文

## 1. 目标

基于 kwjm.com（API Provider AKA「开物基模」）的 API 能力，搭建一个可被多种 Agent 工具（Codex、Claude Code、Opencode、zcode、Cursor、Hermes Agent、OpenClaw、Trae、Workbuddy）复用的 MCP 服务。Agent 只需配置 kwjm 平台的 API Key，即可调用文本、图像、视频模型，并能清晰看到每个模型的可用范围与能力边界。

关键附加需求（用户指定）：
1. 以后开发沟通使用中文（长期）。
2. 模型大类上增加规则约束，防止用户误判或语义不明确导致的错误调用：
   - 不同类型的模型具有「默认 / 备选 / 非指明不调用」分级。
   - 指明模型但语义不准确/有歧义（如 deepseek 不同版本、gpt 不同版本）→ 进入问询选择环节。
   - `/v1/models` 返回的精确模型 ID 是最终权威；别名只能补充用户入口，不能把同名实时 ID 改写成其他模型。
   - 同类工作需求，默认由 Agent 在上下文中确定首先使用什么模型（不强制每次问询）。

## 2. kwjm API 调研结论

- 认证：所有请求头带 `Authorization: Bearer YOUR_API_KEY`。
- 基础 URL：固定为官方 `https://kwjm.com`，端点拼为 `{base}/v1/...`；不允许运行时改写凭据目的地。
- 文本（OpenAI 兼容）：`POST /v1/chat/completions`、`POST /v1/responses`。
- 文本（Anthropic Messages）：`POST /v1/messages`（需头 `anthropic-version: 2023-06-01`）。
- 图像：`POST /v1/images/generations`、`POST /v1/images/edits`。
- 视频（异步任务）：`POST /v1/videos/generations`，`GET /v1/videos/generations/{id}` 轮询结果。
- 视频（kling 专属）：`POST /v1/videos/text2video`、`POST /v1/videos/image2video`、`POST /v1/image/generation`。
- 模型族：OpenAI(gpt-5/5.2 等)、火山引擎(Seed/Seedance/Seedream/sd-2)、DeepSeek、MiniMax、Qwen(生文/生图/生视频)、Google(gemini/sora/veo)、Anthropic(claude-sonnet/haiku/opus)、快手可灵(kling)。
- kwjm 已提供 Agent 接入文档（Claude Code/Cursor/Trae/OpenCode/OpenClaw/Workbuddy），但均为「配置 baseURL+Key」的模型端点方式，无 MCP 封装能力。

## 3. 技术栈与配置

- TypeScript / Node（`@modelcontextprotocol/sdk` 官方 SDK），stdio 传输，兼容所有列出的 MCP Agent。
- 环境变量：
  - `KWJM_API_KEY`（必填）：kwjm 令牌，通过各 Agent 的 MCP env 块注入。
  - `KWJM_API_KEY_ID`（当前 Key 日结查询必需）：用于从账户日结列表精确绑定当前成员 Key。
- 运行时 >= Node 18（使用全局 `fetch`）。

## 4. 架构与目录

```
src/
  core/
    types.ts        # 类型：ModelCapability、SelectionLevel、Alias 等
    registry.ts     # 策展能力表 + 别名表 + ambiguous 标记 + refresh 实时合并
    client.ts       # kwjmFetch 封装：鉴权、baseUrl、错误归一化 KwjmError
  handlers/
    discovery.ts    # list_models / get_model_capabilities / refresh_models
    text.ts         # chat_completions / messages
    image.ts        # generate_image / edit_image
    video.ts        # generate_video / get_video_result（含 kling/seedance 路径分派）
  index.ts          # MCP Server 引导，注册全部工具
```

边界清晰：registry 负责「能力与选择规则」，client 负责「传输」，handlers 负责「工具语义」，index 负责「装配」。每单元可独立理解与测试。

## 5. 模型能力表与选择规则

`registry.ts` 维护 `CapabilityMap: Record<string, ModelCapability>`。

`ModelCapability` 字段（核心）：
- `id`: 模型 ID（请求体中使用的值）。
- `family`: 所属模型族（openai/seed/seedance/deepseek/qwen/gemini/anthropic/kling/...）。
- `modality`: `'text' | 'image' | 'video'`（可多值）。
- `endpoint`: 该模型经由的端点模式（chat/messages/images-generations/images-edits/videos-generations/kling-text2video/kling-image2video/...）。
- `selectionLevel`: `'default' | 'fallback' | 'off-by-default'`。
  - `default`：该类型/功能的首选模型，同类任务 Agent 优先采用。
  - `fallback`：备选；仅当 default 不可用/不合适时使用。
  - `off-by-default`：非指明不调用；仅用户明确指名才允许，绝不默认触碰。
- `aliases`: `Record<string,string> | undefined`：可选的辅助入口 → 真实模型 ID 映射；若平台实时列表存在同名精确 ID，则精确 ID 优先。
- `ambiguous`: `boolean`：该模型名是否存在版本歧义（如多版本 gpt/deepseek），需要问询确认。
- `contextWindow`, `costTier`, `notes`: 能力边界补充信息，用于能力发现展示。

### 5.1 分级（示例）

按「类型/功能」为每组设定独立 default：
- 文本 default：`gpt-5.2-pro-2025-12-11`；fallback：`gpt-5.2`、`deepseek` 系列、`claude-sonnet` 系列。
- 生图 default：`gpt-image-2`（或 `gpt-image-1.5`）；fallback：`qwen` 生图、`sd-2`。
- 生视频 default：`kw-video-v2`；fallback：`kw-video-v2-fast`、`kw-video-v2-mini`、`kw-video-v2.5`、`MiniMax-H3`、`kling` 系列。

（具体 ID 以 kwjm 当前 /v1/models 返回与文档为准，由 refresh 合并校准。）

### 5.2 实时 ID 与别名优先级

权威顺序为：`/v1/models` 精确 ID > 静态能力元数据 > 别名。`kw-video-v2`、`kw-video-v2-fast`、`kw-video-v2-mini` 和 `kw-video-v2.5` 均为独立精确 ID，必须原样透传；`seedance-2.0` 等兼容名只解析到其各自的 dreamina 模型。

### 5.3 歧义问询

`ambiguous: true` 的模型（如 deepseek 多版本、gpt 多版本）在调用时若入参未唯一确定 → 返回候选清单（各候选的 id/能力/层级），交由用户主动选择，或由 Agent 基于准确上下文选定后再调用；工具层绝不擅自猜测。

## 6. 工具清单

| 工具 | 说明 | 端点 |
|---|---|---|
| `list_models` | 列出全部模型 + 能力元数据（modality/family/层级），含别名解析 | registry |
| `get_model_capabilities` | 单个模型能力深挖（boundary 明细） | registry |
| `refresh_models` | 调用 kwjm `/v1/models` 实时合并到 registry，标记未知 ID | `GET /v1/models` |
| `chat_completions` | OpenAI 兼容文本生成 | `POST /v1/chat/completions` |
| `messages` | Anthropic Messages 文本生成 | `POST /v1/messages` |
| `generate_image` | 文生图 | `POST /v1/images/generations` |
| `edit_image` | 图生图/编辑 | `POST /v1/images/edits` |
| `generate_video` | 文/图生视频，提交异步任务；按模型分派 seedance/`/v1/videos/generations` 或 kling 路径 | `POST /v1/videos/generations` etc. |
| `get_video_result` | 轮询视频任务结果 | `GET /v1/videos/generations/{id}` |

每个工具在调用前校验 `model` 存在于 registry；精确 ID 直接使用，只有未命中精确 ID 时才解析别名；命中 `ambiguous` 且未唯一确定时返回候选清单；`off-by-default` 未显式指名时给出不可用提示。工具描述中嵌入该模型 modality/层级，使 Agent 调用前即可见边界。

## 7. 错误处理与流式

- 非 2xx：归一化为 `KwjmError{status, message, code}`，以 MCP 工具错误文本返回，透传 kwjm 信息。
- 文本工具逐块消费 kwjm 的 `stream: true` SSE；客户端提供 MCP `progressToken` 时逐事件发送 `notifications/progress`，最终只返回有界摘要，不回传整段原始 SSE。发现/图像/视频为非流式。
- 视频：`generate_video` 返回任务 `id`；`get_video_result` 轮询 `status`（submitted/processing/succeeded/failed）与结果 URL。

## 8. 测试

- 单元：registry 的层级/别名/歧义解析逻辑；工具入参校验。
- 实时集成（`KWJM_API_KEY` 存在才运行）：文本 chat + 图像 generate 各一例；视频提交真实任务并轮询。
- 工程验证：`npm run build`（tsc 编译通过）、`npm test` 绿。

## 9. Agent 配置文档

提供 README + 各 Agent 接入指南（Codex/Claude Code/OpenCode/zcode/Cursor/Hermes Agent/OpenClaw/Trae/Workbuddy）：每种工具如何把 `KWJM_API_KEY` 注入 MCP 服务器，并给出命令/配置片段。

## 10. 范围 / 非目标

- 目标：本 MCP 服务端实现 + 可用 + 测试 + 各 Agent 接入文档。
- 非目标（本期不做）：计费/账单、客户端 App、图形界面、多租户权限。
