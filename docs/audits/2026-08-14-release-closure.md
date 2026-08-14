# KWJM MCP 1.0 发布收口审计

日期：2026-08-14

## 结论

代码、真实调用和发布安全边界已经达到首个稳定版候选标准：本地完整回归 68/68 通过；文本、图片、视频和日结/钱包均有代表性真实接口证据；20 个第一阶段模型 ID 仍以 `/v1/models` 的精确值为权威。

当前只剩两个外部输入，不属于代码缺陷：

1. 本机尚未配置 `KWJM_API_KEY_ID`，因此“当前 Key 日结”已完成精确过滤单测，但线上只读用例按设计跳过，未猜测 Key 归属。
2. GitHub 目标仓库尚不存在，创建前必须确定公开或私有可见性。

## 第一性原理验收

系统必须守住四个不变量：

- bearer token 只能发送到官方 `https://kwjm.com`；
- 一个调用不能无限占用内存、时间或生成额度；
- 当前成员成本只能由 `KWJM_API_KEY_ID` 精确归属，跨成员查询必须显式扩大范围；
- Git 和 npm 发布物不得包含本地 Key、提示词、生成内容或 Agent 运行状态。

## 真实能力证据

| 能力 | 代表验证 | 结果 |
| --- | --- | --- |
| 实时模型注册 | `GET /v1/models` | 109 个模型；第一阶段 20/20 精确 ID 存在并原样解析 |
| 普通文本 | `deepseek-v4-flash` | 通过 |
| SSE 流式 | `deepseek-v4-flash` | 通过；MCP progress 只发送事件序号，不携带生成文本 |
| 工具调用 | `deepseek-v4-flash` 强制函数调用 | 通过 |
| 图片理解 | `gpt-5.6-terra` | 通过 |
| Anthropic Messages | `claude-haiku-4-5-20251001`，1 token | 通过 |
| 文生图 | `gpt-image-2`，low/1024/n=1 | 通过 |
| 图片编辑 | `gpt-image-2` multipart | 通过 |
| 文生视频 | `kw-video-v2-mini`，4s/480p/无音频 | 通过 |
| 图生视频 | 同模型、内存 BMP 首帧 | 通过并取得最终视频 URL |
| 视频参考再生成 | 同模型、上一任务 URL 作为 `reference_video` | 通过并取得最终视频 URL |
| 视频任务查询 | `/v3/contents/generations/tasks/{id}` | 通过，轮询到成功终态 |
| Kling 端点分派 | text/image/video 输入 | 本地回归分别锁定 `text2video` / `image2video` / `video2video` |
| 钱包 | `GET /api/v1/user/wallet` | 线上只读通过 |
| 全账户 Key 日结 | `GET /api/v1/user/statistics/day/keys` | 线上只读通过；工具要求 `all_keys=true` |
| 当前 Key 日结 | 同一日结端点 + Key ID 精确过滤 | 单元/集成通过；线上待本机补 `KWJM_API_KEY_ID` |

真实验证不保存 API Key、任务 ID、提示词、生成文本、图片或视频；测试只断言状态、结构、usage 和脱敏计数。

## 对抗性安全审计与修复

发布前标准安全扫描在原始快照确认 6 个中等级问题，均已在候选版本修复：

| 原问题 | 修复 |
| --- | --- |
| 自定义 Base URL 可改变密钥目的地 | 运行时固定 `https://kwjm.com`；客户端再次校验来源并拒绝 redirect |
| HTTP 无超时/响应上限 | 总时限 120 秒；JSON 请求 32 MiB、响应 64 MiB、错误体 1 MiB 上限 |
| SSE 未分帧缓冲可无限增长 | 原始缓冲默认上限 1 MiB，超限立即 cancel |
| 图片 data URL 可无限解码 | schema 与解析器双重限制，解码后最大 10 MiB |
| 工具输入/生成参数无全局上限 | 限制 messages、tools、content、token、n、duration，并在序列化前限制 JSON 字节数 |
| `.omx/.omc` 可能进入 Git | 发布前加入 ignore，并要求按 staged tree 扫描 |

附加加固：流式 progress 不再复制生成文本；依赖锁文件改回 `registry.npmjs.org` 并保留 integrity；npm audit 为 0 漏洞。

## 成本查询边界

- `get_current_key_daily_cost`：默认只返回 `KWJM_API_KEY_ID` 对应行；无 ID 时失败关闭，不按 Key 名称、金额或请求数猜测。
- `get_account_daily_costs`：只有显式 `all_keys=true` 才返回同账户全部 Key。
- 平台日结 `report_date` 缺省为前一天，且只允许最近 30 天；MCP 保留这一官方语义。
- 当前版本不宣称逐任务成本闭环，也不保存本地提示词/生成内容账本。

## 发布前最后闸门

- [x] 完整回归 68/68
- [x] 低成本文本真实验证
- [x] 图片生成与编辑真实验证
- [x] 文/图/视频参考生成与终态查询真实验证
- [x] 钱包和全账户日结线上只读验证
- [x] 依赖审计与安全加固
- [ ] 补入本机 `KWJM_API_KEY_ID` 并运行当前 Key 日结只读用例
- [ ] 确认 GitHub 仓库可见性后创建并推送 `main`
