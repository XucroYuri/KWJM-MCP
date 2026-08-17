# 开物基模 MCP 服务（kwjm-mcp）

基于 [开物基模 (kwjm.com)](https://kwjm.com) API 的 **MCP 服务**。让任何一种支持 MCP 的 Agent 工具只需配置一次平台 API Key，即可调用 **文本 / 图像 / 视频** 模型，且清楚看到每个模型的可用范围与能力边界。

> 平台本质：开物基模是 AI 模型聚合代理（API Provider）。你持有平台令牌后，即可通过本服务调用各模型族（OpenAI、Seed/Seedance、DeepSeek、Qwen、Gemini、Anthropic、快手可灵等）。

---

## 特性

- **一次配置，到处可用**：设置 `KWJM_API_KEY` 即可调用模型；再配置非密钥字段 `KWJM_API_KEY_ID`，即可把默认日结查询精确绑定到当前成员 Key。
- **能力发现**：`list_models` / `get_model_capabilities` 让 Agent 在调用前看到每个模型的 modality、家族、选择层级、别名、能力边界。
- **多模态调用**：文本（OpenAI `/v1/chat/completions` 与 Anthropic `/v1/messages`）、图像（`/v1/images/generations`、`/v1/images/edits`）、视频（异步任务含 `/v1`、`/v2`、`/v3` 与 kling 专属端点）。
- **防误判规则**（核心设计）：
  - **默认/备选/非指明不调用**分级：`default` 同类任务优先、`fallback` 备选、`off-by-default` 仅显式指名，绝不默认触碰未知模型。
  - **歧义问询**：指明模型但存在版本/同名歧义（如 `deepseek` 家族）时，返回候选清单，交用户或 Agent 依据准确上下文选定，不擅自猜测。
  - **实时精确 ID 优先**：`/v1/models` 返回的精确 ID 是最终请求值；别名仅作为辅助入口，不能覆盖同名实时 ID。例如 `kw-video-v2*` 必须原样传给平台。
  - **Seedance 语义锁定**：用户说 `Seedance 2.0` 时，对应 `kw-video-v2`、`kw-video-v2-fast`、`kw-video-v2-mini` 三档候选，最匹配 `kw-video-v2`，但需确认后再调用；用户说 `Seedance 2.5` 时，对应 `kw-video-v2.5`。
  - **同类工作默认决策**：同类任务由 Agent 依据上下文决定使用哪个 default 模型，不强制每次问询。
- **能力边界预检 + 主动拦截**：`validate_request` 在调用前校验用户输入（参考图数量上限、尺寸/分辨率/比例/时长枚举、必现错误），越界时主动提醒并给修正建议；`suggest_model` 按任务给出默认/备选/非指明分级。
- **错误码「说人话」**：`401/403/429/500/503` 等错误码内化为「问题性质 + 原版含义 + 通俗解释 + 下一步引导」四段结构，Agent 不再只吐状态码，而是用普通人听得懂的话解释「发生了什么、为什么、该怎么办」。

---

## 快速开始

### 1. 安装

```bash
npm install -g kwjm-mcp
```

也可以不全局安装，直接让 MCP 客户端通过 `npx` 启动：

```bash
npx -y kwjm-mcp
```

### 2. 配置 API Key

在任何 MCP 客户端的 server 配置里，通过 `env` 传入令牌：

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `KWJM_API_KEY` | 是 | 开物基模平台令牌（控制台 → API令牌） |
| `KWJM_API_KEY_ID` | 日结必填 | 当前令牌的数字 ID；仅用于 `get_current_key_daily_cost` 精确过滤，不是密钥 |

API Base URL 固定为官方 `https://kwjm.com`，不接受环境变量覆盖，避免 bearer token 被误发到其他来源。

### 3. 以 `npx` 作为 server 命令示例

```bash
npx -y kwjm-mcp
# 源码开发：npm install && npm run build && node dist/index.js
```

---

## 工具总览

| 工具 | 说明 | 端点 |
|---|---|---|
| `list_models` | 列出全部模型与能力元数据（modality/层级/别名） | registry |
| `get_model_capabilities` | 单模型能力深挖与别名解析 | registry |
| `refresh_models` | 调 `/v1/models` 实时并入 registry，未知模型标为非指明不调用 | `GET /v1/models` |
| `chat_completions` | OpenAI 兼容文本生成 | `POST /v1/chat/completions` |
| `messages` | Anthropic Messages 文本生成（claude 系） | `POST /v1/messages` |
| `generate_image` | 文生图（端点随模型分派：`/v1/images/generations`、-gp 异步、DashScope、gemini） | 分派 |
| `edit_image` | 图生图/编辑 | `POST /v1/images/edits` |
| `generate_video` | 文/图/参考生视频，端点随模型族分派（/v1、/v3、/v2、DashScope、kling） | 分派 |
| `get_video_result` | 轮询视频/图像任务结果（queryPath 随模型族） | 分派 |
| `get_current_key_daily_cost` | 默认查询当前 `KWJM_API_KEY_ID` 的日结成本；日期缺省为平台定义的前一天 | `GET /api/v1/user/statistics/day/keys` |
| `get_account_daily_costs` | 仅在显式传入 `all_keys=true` 时查询同账户全部 Key 日结 | `GET /api/v1/user/statistics/day/keys` |
| `get_wallet_balance` | 查询当前账户钱包余额 | `GET /api/v1/user/wallet` |

### 能力原子化（内化真实文档）

模型能力表已基于平台 62 个 API 文档页逐条内化，覆盖真实端到端体系：

- **文本**：`/v1/chat/completions`、`/v1/responses`、`/v1/messages`（gpt-5.2/5.4、deepseek-v3.2、qwen3、doubao-seed、gemini、claude 系列）
- **图像**：`/v1/images/generations`、`/v1/images/edits`、`/v1/images/generations/tasks`（异步，`-gp` 后缀）、DashScope 等效、gemini `generateContent`
- **视频**（多端点体系，异步任务轮询）：
  - `/v1/videos/generations`（doubao-seedance、wan 系列）
  - `/v3/contents/generations/tasks`（`kw-video-v2*` 精确模型与 dreamina-seedance 兼容模型）
  - `/v1/videos/text2video|image2video|video2video|reference`（kling 系列）
  - `/v1/videos/create`（veo3.1、sora-2-sp）、`/v1/videos`（sora-2）
  - `/v2/video_generation`（MiniMax-H3）、DashScope `/api/v1/services/aigc/video-generation/video-synthesis`（wan2.7）
- **精确 ID 规则**：`kw-video-v2`、`kw-video-v2-fast`、`kw-video-v2-mini`、`kw-video-v2.5` 均为独立平台 ID，不映射为 dreamina ID。自然语言 `Seedance 2.0` 返回前三者候选并推荐 `kw-video-v2`；自然语言 `Seedance 2.5` 映射到 `kw-video-v2.5`。

### 关于选择规则（很重要）

- **默认模型**：文本 `gpt-5.2-pro-2025-12-11`；图像 `gpt-image-2`；视频 `kw-video-v2`。同类任务不指名时由 Agent 默认采用。
- **歧义**：入参命中多个候选（如 `wan`、`kling` 等多版本家族）→ 工具返回候选清单，需确定后再调用。
- **Seedance 2.0**：视为 `kw-video-v2`、`kw-video-v2-fast`、`kw-video-v2-mini` 三档候选；默认建议 `kw-video-v2`，但调用前必须让用户确认具体档位。
- **Seedance 2.5**：视为 `kw-video-v2.5`。
- **非指明不调用**：`claude-opus-4-8`、`gpt-image-2-gp`（异步）、`grok-imagine` 等已标记的模型，未显式指名(`explicit: true`)不会调用。

---

## 测试

```bash
npm test          # 单元 + 端到端（无需平台 key；e2e 验证防误判规则在协议层生效）
npm run test:live # 只读实时模型校验；不会触发生成
npm run test:live:text
KWJM_LIVE_COST_ACK=image npm run test:live:image
KWJM_LIVE_COST_ACK=video npm run test:live:video
KWJM_LIVE_COST_ACK=video-reference npm run test:live:video-reference
```

日结接口只提供账户维度的 Key 列表；因此默认的当前成员查询必须用 `KWJM_API_KEY_ID` 做精确绑定。`get_account_daily_costs` 还要求显式传入 `all_keys=true`，避免普通成本查询意外扩展到同账户其他成员。

---

## Agent 接入指南

- [Codex](docs/agents/codex.md)
- [Claude Code](docs/agents/claude-code.md)
- [OpenCode](docs/agents/opencode.md)
- [zcode](docs/agents/zcode.md)
- [Cursor](docs/agents/cursor.md)
- [Hermes Agent](docs/agents/hermes.md)
- [OpenClaw](docs/agents/openclaw.md)
- [Trae](docs/agents/trae.md)
- [Workbuddy](docs/agents/workbuddy.md)

---

## 设计文档

- [设计 spec](docs/superpowers/specs/2026-08-13-kwjm-mcp-design.md)
- [1.0 发布收口审计](docs/audits/2026-08-14-release-closure.md)

## 目录结构

```
src/
  core/
    types.ts      类型：能力/层级/别名
    registry.ts   策展能力表 + 选择规则 + 别名映射 + refresh 合并
    client.ts     HTTP 封装（鉴权/错误归一化）
  handlers/
    result.ts     MCP 结果/错误封装
    guard.ts      防误判守卫（歧义/off-by-default）
    discovery.ts  list_models / get_model_capabilities / refresh_models
    text.ts       chat_completions / messages
    image.ts      generate_image / edit_image
    video.ts      generate_video / get_video_result
    usage.ts      当前 Key / 全账户日结与钱包查询
  index.ts        MCP Server 引导
test/             单元 / 端到端 / 实时集成测试
```
