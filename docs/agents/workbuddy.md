# Workbuddy 接入 kwjm-mcp

Workbuddy 通过配置注册 MCP 服务器。在其 MCP 配置中加入：

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

### 使用

- `list_models` 查看能力与默认模型；`refresh_models` 拉取实时模型。
- `chat_completions` / `messages` 文本；`generate_image` / `generate_video` 多模态。
- 歧义模型依据候选清单决策。
