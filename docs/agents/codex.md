# Codex 接入 kwjm-mcp

Codex 支持通过配置添加 MCP 服务器。在 `~/.codex/config.toml`（或项目 `codex.toml`）中追加 `mcp_servers`：

```toml
[mcp_servers.kwjm-mcp]
command = "npx"
args = ["kwjm-mcp"]
env = { KWJM_API_KEY = "sk-你的平台令牌", KWJM_API_KEY_ID = "你的数字 Key ID" }
```

> 确保已 `npm link` 或 `npx kwjm-mcp` 可达；若未发布 npm 包，可用 `args = ["node", "/绝对路径/dist/index.js"]` 指向本地编译产物。

### 使用

重启 Codex 后，模型工具已注册。常用做法：

- 先 `list_models` 查看能力边界与默认模型。
- 直接请求文本：`chat_completions`（OpenAI 系）或 `messages`（claude 系）。
- 生图 `generate_image`、生视频 `generate_video` + `get_video_result`。
- 指名歧义模型（如 `deepseek`）时，先看返回的候选清单再选定。
