# zcode 接入 kwjm-mcp

zcode 通过配置文件注册 MCP 服务器（具体路径因发行版而异，通常为 `~/.config/zcode/`）。在 MCP 配置中加入：

```json
{
  "mcpServers": {
    "kwjm-mcp": {
      "command": "npx",
      "args": ["kwjm-mcp"],
      "env": {
        "KWJM_API_KEY": "sk-你的平台令牌",
        "KWJM_API_KEY_ID": "你的数字 Key ID"
      }
    }
  }
}
```

> 若 zcode 使用其他配置格式（如 TOML/YAML），将上述字段对应到其 MCP 服务器 schema 即可，三者一致：`command` / `args` / `env`。

### 使用

- 先 `list_models` 了解能力；`refresh_models` 可拉取实时模型。
- 文本用 `chat_completions` 或 `messages`；图像/视频用对应的生成工具。
- 多模态视频记得用 `get_video_result` 轮询。
