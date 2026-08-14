# OpenClaw 接入 kwjm-mcp

OpenClaw 通过配置注册 MCP 服务器。在其 MCP 配置（`~/.openclaw/` 或项目配置）中加入：

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

- `list_models` 查看能力边界（modality/层级/别名）。
- 文本用 `chat_completions` / `messages`；图像 `generate_image`；视频 `generate_video` + `get_video_result`。
- 指名歧义模型时按候选清单决策；`off-by-default` 模型需显式指名。
