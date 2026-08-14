# Trae 接入 kwjm-mcp

Trae 通过设置添加 MCP 服务器：**设置 → MCP 服务器 → 添加**，选择「命令行」类型：

- **名称**: `kwjm-mcp`
- **命令**: `npx kwjm-mcp`
- **环境变量**:
  - `KWJM_API_KEY = sk-你的平台令牌`
  - `KWJM_API_KEY_ID = 你的数字 Key ID`

或编辑 Trae 的 MCP 配置文件（`~/.trae/` 或项目 `.trae/mcp.json`）：

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

- 谈话中让助手 `list_models` 了解可用模型与默认项。
- `generate_image` / `generate_video` 创作多模态内容。
- 视频记得用 `get_video_result` 轮询任务 id。
