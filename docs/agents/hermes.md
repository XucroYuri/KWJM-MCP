# Hermes Agent 接入 kwjm-mcp

Hermes Agent 通过 MCP 配置添加服务器（路径因安装方式而异，通常在 `~/.hermes/` 或项目配置）。加入：

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

- `list_models` 查看能力与默认模型；`get_model_capabilities` 查看单模型边界。
- `chat_completions` / `messages` 处理文本；`generate_image` / `generate_video` + `get_video_result` 处理多模态。
- 指名歧义模型时，依据返回候选清单决策。
