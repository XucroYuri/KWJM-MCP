# KWJM MCP 外部模型可用性审计（2026-08-14，修复后）

## 结论

本轮已经打通端点路由、实时模型注册、工具调用 schema、上游 SSE 消费与 MCP 进度通知，并完成低成本代表性实测：文本普通对话、流式、强制工具调用、图片理解、图片生成、图片编辑、视频生成和任务状态查询全部通过。

当前仍不满足首个稳定版发布条件。阻断项已经从“核心路由不可用”收敛为：优先模型尚未逐类完成代表性调用矩阵，`messages` 仅通过本地传输模拟，图生视频和视频编辑尚未真实提交，图片/视频费用尚未进入日结。

机器可读证据见 [2026-08-14-external-model-availability.json](./2026-08-14-external-model-availability.json)。

## 安全与成本边界

- API Key 只从环境变量或本机忽略文件 `.mcp.json` 读取；未写入测试、审计或构建产物。
- 未记录测试提示词、生成文本、图片内容或视频内容。
- 图片只运行 1 次 `gpt-image-2` 的 `1024x1024 + low + n=1` 生成，并复用结果运行 1 次同规格编辑。
- 视频只运行 1 次 `kw-video-v2-mini` 的 `4 秒 + 480p + 1:1 + 无音频` 文生视频，并立即查询一次状态；没有下载视频，也没有提交第二个视频任务。
- 当天日结接口按模型、按 Key 查询均返回 200、0 行。官方文档说明日结默认查询前一天，因此本轮只能标记“费用待日结”，不能据此宣称零成本。参考：[日结接口](https://kwjm.com/docs/guide/api-statistics-day.html)。

## 修复结果

| 问题 | 修复后状态 | 证据 |
| --- | --- | --- |
| 端点漏 `/v1` | 已修复 | operation adapter 集中定义 `/v1/models`、`/v1/chat/completions`、`/v1/messages`、`/v1/images/generations`、`/v1/images/edits` |
| `kw-video-v2*` 被别名改写 | 已修复 | 20/20 第一阶段模型均按平台精确 ID 原样解析 |
| `tools` / `tool_choice` 缺失 | 已修复 | schema 支持工具定义、工具选择、并行开关、assistant tool calls 与 tool result 消息回环 |
| 流式先完整缓冲 SSE | 已修复 | 逐块解析 SSE；有 `progressToken` 时发送 `notifications/progress`；最终结果不含原始 SSE |
| 图片编辑错误发送 JSON | 已修复 | 按官方文档使用 `multipart/form-data` 的 `image[]` 文件字段；不手工设置 boundary |
| live 测试混合收费能力 | 已修复 | 拆分 `readonly`、`text`、`image`、`video`；图片和视频需要独立 `KWJM_LIVE_COST_ACK` |
| 视频纯文本请求被无条件 `hardFail` 拦截 | 已修复 | “不可单独输入音频”只在只有音频且无图/视频时生效 |

图片生成的最低有效参数依据官方 `gpt-image-2` 文档：`POST /v1/images/generations`，`quality=low`、`n=1`、最小列出尺寸 `1024x1024`。图片编辑依据官方 multipart 文档：[生成](https://kwjm.com/docs/modelhub/openai/gpt-image-2-image-generations.html)、[编辑](https://kwjm.com/docs/modelhub/openai/gpt-image-2-image-edit.html)。

视频最低测试参数依据 `kw-video-v2` 文档：`duration` 范围 4–15 秒、`resolution` 支持 480p，且可关闭同步音频；提交和查询端点分别为 `/v3/contents/generations/tasks` 与 `/v3/contents/generations/tasks/{id}`。参考：[kw-video-v2](https://kwjm.com/docs/modelhub/sp/kw-video-v2.html)。

## 真实接口与模型注册

| 验证项 | 状态 | 脱敏结果 |
| --- | --- | --- |
| `GET /v1/models` | 通过 | 109 个模型；20/20 优先模型存在 |
| MCP `refresh_models` | 通过 | 到达 `/v1/models` 并成功合并 |
| 精确 ID 解析 | 通过 | 20/20 原样解析；不再改写 `kw-video-v2*` |
| 当天日结按模型 | 待日结 | HTTP 200，0 行 |
| 当天日结按 Key | 待日结 | HTTP 200，0 行 |

`:codex-annotation{index="1"}` 模型 ID 的权威顺序现为：真实 `/v1/models` 精确 ID > 静态能力元数据 > 别名。静态注册表只能补充模态、端点和约束，不能覆盖平台实时返回的同名 ID。

## 真实能力验证

| 能力 | 代表模型/参数 | 结果 | 备注 |
| --- | --- | --- | --- |
| 普通对话 | `deepseek-v4-flash`, `max_tokens=1` | 通过 | 返回 choices 与 usage；未记录内容 |
| 流式 | `deepseek-v4-flash`, `max_tokens=1` | 通过 | 逐事件解析，产生 MCP progress 通知，无原始 SSE 回传 |
| 工具调用 | `deepseek-v4-flash`, 强制 `ping` | 通过 | 返回 `tool_calls`，函数名正确 |
| 图片理解 | `gpt-5.6-terra`, 1 张极小 PNG | 通过 | 初次 2 token 因输出上限返回 400；改为 8 token 后通过 |
| 文生图 | `gpt-image-2`, low/1024/n=1 | 通过 | 仅在内存中使用结果 |
| 图生图/编辑 | `gpt-image-2`, low/1024/n=1 | 通过 | 复用上一张图，经 multipart `/v1/images/edits` 成功 |
| 文生视频 | `kw-video-v2-mini`, 4s/480p/无音频 | 通过 | 返回真实任务 ID；未记录 ID 值 |
| 视频任务查询 | 同一任务 | 通过 | 到达模型对应 `/v3` 查询端点并返回状态 |
| 图生视频 | — | 未运行 | 需要新增收费任务，留待后续独立门禁 |
| 视频编辑 | — | 未运行 | 需要输入视频并新增收费任务，留待后续独立门禁 |
| Anthropic Messages | 本地模拟 | 路由通过，实调未运行 | 已锁定 `/v1/messages` 与 header；尚未选定代表性模型实调 |

## 测试与门禁

本地完整回归在最终交付前重新运行。当前新增覆盖包括：

- operation adapter 路径常量；
- 20 个第一阶段精确模型 ID；
- 工具调用 schema 与消息回环；
- SSE 分块解析和 MCP progress；
- 图片 multipart 上传；
- 条件化视频约束；
- live 分组与显式收费确认。

安全脚本：

```bash
npm run test:live:readonly
npm run test:live:text
KWJM_LIVE_COST_ACK=image npm run test:live:image
KWJM_LIVE_COST_ACK=video npm run test:live:video
```

`npm run test:live` 只指向只读组，不会隐式触发图片或视频任务。

## 剩余发布阻断项

1. **P0：第一阶段代表模型矩阵未完成。** 目前是“每类代表模型打通”，不是所有优先模型逐个真实生成验证；其他 ID 仅完成 `/v1/models` 存在性。
2. **P0：图生视频、视频编辑未实测。** 视频工具只验证了文生视频与状态查询。
3. **P1：Messages 未真实调用。** 路由和 header 有本地模拟证据，但没有平台成功回执。
4. **P1：日结费用未闭环。** 当天接口尚无行；需下一日回查模型和当前 Key 的成本归属。
5. **P1：工具 annotations/结构化输出仍未统一。** 不影响本轮四项修复，但稳定版前应按 MCP 最佳实践补齐。

## 当前发布判定

**仍为 BLOCKED，但核心调用链已可用。** 可继续下一阶段的模型代表性矩阵与高成本能力分批验证；尚不能发布首个稳定版。
