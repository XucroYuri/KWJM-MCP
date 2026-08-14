import { z } from 'zod';
import type { ModelRegistry } from '../core/registry.js';
import type { KwjmClient } from '../core/client.js';
import { asToolError, toTextContent, type ToolRegistrar } from './result.js';
import { guardModel } from './guard.js';
import { OPERATIONS } from '../core/operations.js';
import { consumeSse } from '../core/sse.js';

const toolCallSchema = z.object({
  id: z.string().max(512),
  type: z.literal('function'),
  function: z.object({ name: z.string().max(256), arguments: z.string().max(1024 * 1024) }),
});

const chatMessageSchema = z.object({
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
  content: z.union([z.string().max(1024 * 1024), z.array(z.any()).max(64), z.null()]),
  name: z.string().max(256).optional(),
  tool_call_id: z.string().max(512).optional(),
  tool_calls: z.array(toolCallSchema).max(128).optional(),
});

const chatSchema = {
  model: z.string().describe('模型 id 或别名。如 gpt-5.2-pro-2025-12-11；歧义时返回候选清单。'),
  messages: z
    .array(
      chatMessageSchema
    ).min(1).max(256)
    .describe('OpenAI 兼容消息列表'),
  temperature: z.number().optional(),
  max_tokens: z.number().int().min(1).max(131_072).optional(),
  tools: z.array(z.any()).max(128).optional().describe('OpenAI 兼容工具定义'),
  tool_choice: z.any().optional().describe('auto/none/required 或指定 function'),
  parallel_tool_calls: z.boolean().optional(),
  stream: z.boolean().optional().describe('逐事件消费上游 SSE；客户端提供 progressToken 时发送 MCP 进度通知'),
  explicit: z.boolean().optional().describe('true = 用户确指，允许调用 off-by-default 模型'),
};

const messagesSchema = {
  model: z.string().describe('Anthropic Messages 模型 id 或别名'),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.union([z.string().max(1024 * 1024), z.array(z.any()).max(64)]) })).min(1).max(256),
  max_tokens: z.number().int().min(1).max(131_072).describe('生成上限'),
  system: z.string().max(1024 * 1024).optional(),
  temperature: z.number().optional(),
  stream: z.boolean().optional(),
  explicit: z.boolean().optional(),
};

export function registerText(
  server: { tool: ToolRegistrar },
  registry: ModelRegistry,
  client: () => KwjmClient
) {
  server.tool(
    'chat_completions',
    'OpenAI 兼容的文本生成（/v1/chat/completions），用于 gpt / deepseek / qwen / gemini 等文本模型。',
    chatSchema,
    async (args, extra) => {
      const guard = guardModel(registry, args.model, { explicit: args.explicit });
      if (!guard.ok) return guard.payload;
      const { model } = guard;
      if (model.modality !== 'text') {
        return toTextContent({ error: `「${model.id}」是 ${model.modality} 模型，不适用文本生成。` }, true);
      }
      const payload: Record<string, unknown> = {
        model: model.id,
        messages: args.messages,
      };
      if (args.temperature !== undefined) payload.temperature = args.temperature;
      if (args.max_tokens !== undefined) payload.max_tokens = args.max_tokens;
      if (args.tools !== undefined) payload.tools = args.tools;
      if (args.tool_choice !== undefined) payload.tool_choice = args.tool_choice;
      if (args.parallel_tool_calls !== undefined) payload.parallel_tool_calls = args.parallel_tool_calls;
      if (args.stream) payload.stream = true;

      try {
        if (args.stream) {
          const res = await client().postStream(OPERATIONS.chatCompletions, payload);
          const stream = await consumeSse(res, {
            onEvent: async ({ index }) => {
              const progressToken = extra?._meta?.progressToken;
              if (progressToken === undefined || !extra?.sendNotification) return;
              await extra.sendNotification({
                method: 'notifications/progress',
                params: {
                  progressToken,
                  progress: index,
                  message: `已接收流式事件 ${index}`,
                },
              });
            },
          });
          return toTextContent({ id: model.id, resolvedFrom: guard.resolvedFrom, stream }, false);
        }
        const data = await client().post(OPERATIONS.chatCompletions, payload);
        return toTextContent({ id: model.id, resolvedFrom: guard.resolvedFrom, result: data });
      } catch (err) {
        return asToolError(err);
      }
    }
  );

  server.tool(
    'messages',
    'Anthropic Messages API 兼容的文本生成（/v1/messages），用于 claude-sonnet / claude-opus / claude-haiku 系列。',
    messagesSchema,
    async (args, extra) => {
      const guard = guardModel(registry, args.model, { explicit: args.explicit });
      if (!guard.ok) return guard.payload;
      const { model } = guard;
      if (model.modality !== 'text') {
        return toTextContent({ error: `「${model.id}」是 ${model.modality} 模型，不适用消息文本生成。` }, true);
      }
      const payload: Record<string, unknown> = {
        model: model.id,
        max_tokens: args.max_tokens,
        messages: args.messages,
      };
      if (args.system !== undefined) payload.system = args.system;
      if (args.temperature !== undefined) payload.temperature = args.temperature;
      if (args.stream) payload.stream = true;

      try {
        const headers = { 'anthropic-version': '2023-06-01' };
        if (args.stream) {
          const res = await client().postStream(OPERATIONS.messages, payload, headers);
          const stream = await consumeSse(res, {
            onEvent: async ({ index }) => {
              const progressToken = extra?._meta?.progressToken;
              if (progressToken === undefined || !extra?.sendNotification) return;
              await extra.sendNotification({
                method: 'notifications/progress',
                params: {
                  progressToken,
                  progress: index,
                  message: `已接收流式事件 ${index}`,
                },
              });
            },
          });
          return toTextContent({ id: model.id, resolvedFrom: guard.resolvedFrom, stream });
        }
        const data = await client().post(OPERATIONS.messages, payload, headers);
        return toTextContent({ id: model.id, resolvedFrom: guard.resolvedFrom, result: data });
      } catch (err) {
        return asToolError(err);
      }
    }
  );
}
