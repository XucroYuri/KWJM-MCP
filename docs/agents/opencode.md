# OpenCode 接入 kwjm-mcp

OpenCode 通过配置文件注册 MCP 服务器。编辑 `~/.config/opencode/opencode.json`（macOS/Linux）或 `%USERPROFILE%\.config\opencode\opencode.json`（Windows）：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "kwjm-mcp": {
      "type": "local",
      "command": ["npx", "kwjm-mcp"],
      "environment": {
        "KWJM_API_KEY": "sk-你的平台令牌",
        "KWJM_API_KEY_ID": "你的数字 Key ID"
      }
    }
  }
}
```

重启 OpenCode 后可看到 `kwjm-mcp` 服务器及其工具。

### 使用

- 对话中请求 `list_models` 查看能力与默认模型。
- 调用 `generate_video` 生视频后，用 `get_video_result` 轮询任务 id。
- 指名歧义模型时按候选清单选定。
