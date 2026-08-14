# Claude Code 接入 kwjm-mcp

通过 Claude Code 的 MCP 配置添加服务器。

### 项目级（推荐）

编辑 `.mcp.json`（项目根目录）：

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

### 用户级

编辑 `~/.claude.json` 中的 `mcpServers` 段，结构同上。

> 提示：Claude Code 也可将模型端点直接指向开物基模（`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`）作为「模型层」接入；本 MCP 服务则提供「工具层」接入，两者可同时启用——工具层适合在对话中按需调用平台的能力发现与图像/视频工具。

### 使用

- 首次可让助手 `list_models` 了解可用模型。
- 调用 `messages` 走 claude 系模型、`chat_completions` 走 OpenAI 系模型。
- 需要确认模型能力时调用 `get_model_capabilities kw-video-v2`；返回的请求模型 ID 仍是精确的 `kw-video-v2`。
