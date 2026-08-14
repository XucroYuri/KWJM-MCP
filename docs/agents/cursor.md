# Cursor 接入 kwjm-mcp

Cursor 支持 MCP 服务器。在设置中：**Settings → Features → MCP Servers → Add new MCP server**，选择 Command 类型，填入：

- **Name**: `kwjm-mcp`
- **Type**: `command`
- **Command**: `npx kwjm-mcp`
- **Environment variables**:
  - `KWJM_API_KEY = sk-你的平台令牌`
  - `KWJM_API_KEY_ID = 你的数字 Key ID`

或直接编辑 `~/.cursor/mcp.json`：

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

重启 Cursor 后，在 Composer 中即可调用其工具。

### 使用

- Agent 可自动 `list_models` 定位合适模型。
- `generate_image` / `generate_video` 支持多模态创作。
- 遇到歧义模型会收到候选清单，确认后再调用。
