#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registry } from './core/registry.js';
import { KwjmClient } from './core/client.js';
import { readRuntimeConfig } from './core/config.js';
import { type ToolHandlerExtra, type ToolRegistrar } from './handlers/result.js';
import { registerDiscovery } from './handlers/discovery.js';
import { registerText } from './handlers/text.js';
import { registerImage } from './handlers/image.js';
import { registerVideo } from './handlers/video.js';
import { registerUsage } from './handlers/usage.js';

/** 惰性创建客户端：到首次真正调用工具时才解析环境变量，并缓存。 */
let client: KwjmClient | undefined;
const runtimeConfig = readRuntimeConfig();
function getClient(): KwjmClient {
  if (!client) {
    client = new KwjmClient(runtimeConfig);
  }
  return client;
}

const server = new McpServer({
  name: 'kwjm-mcp',
  version: '1.0.0',
});

// 将 Handler 侧简约签名适配到 SDK 的 tool()。
// schema 为 zod raw shape，handler 返回 ToolResult（与 SDK CallToolResult 结构兼容）。
// 此处用受控的 any 桥接，避免 SDK 复杂重载与 Handler 简约类型之间的体操。
const register: ToolRegistrar = (name, description, schema, handler) => {
  (server.tool as (
    name: string,
    description: string,
    schema: Record<string, import('zod').ZodTypeAny>,
    callback: (args: any, extra?: ToolHandlerExtra) => Promise<{ content: unknown[]; isError: boolean }>
  ) => void)(name, description, schema, handler);
};

registerDiscovery({ tool: register }, registry, getClient);
registerText({ tool: register }, registry, getClient);
registerImage({ tool: register }, registry, getClient);
registerVideo({ tool: register }, registry, getClient);
registerUsage({ tool: register }, getClient, () => runtimeConfig.apiKeyId);

const transport = new StdioServerTransport();
await server.connect(transport);
