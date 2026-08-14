/** MCP 工具统一返回形态（与 SDK CallToolResult 兼容子集） */
export type ToolResult = { content: { type: 'text'; text: string }[]; isError: boolean };

export interface ToolHandlerExtra {
  _meta?: { progressToken?: string | number; [key: string]: unknown };
  sendNotification?: (notification: {
    method: 'notifications/progress';
    params: { progressToken: string | number; progress: number; total?: number; message?: string };
  }) => Promise<void>;
}

/** 各 handler 依赖的最小注册接口 */
export type ToolRegistrar = (
  name: string,
  description: string,
  schema: Record<string, import('zod').ZodTypeAny>,
  handler: (args: any, extra?: ToolHandlerExtra) => Promise<ToolResult>
) => void;

/** 统一的 MCP 文本结果封装 */
export function toTextContent(data: unknown, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

/** 从执行中捕获 KwjmError 等，转成 MCP 错误文本（含结构化解释与引导） */
export function asToolError(err: unknown): ToolResult {
  if (err instanceof Error) {
    // KwjmError 带结构化解释（性质/解释/下一步），透出给 Agent 便于向用户解释引导
    const kwjm = err as { explanation?: { nature: string; explanation: string; plain: string; nextStep: string; retryable: boolean }; status?: number; code?: string };
    if (kwjm.explanation) {
      return toTextContent(
        {
          error: err.message,
          status: kwjm.status,
          code: kwjm.code,
          nature: kwjm.explanation.nature,
          explanation: kwjm.explanation.explanation,
          plain: kwjm.explanation.plain,
          nextStep: kwjm.explanation.nextStep,
          retryable: kwjm.explanation.retryable,
        },
        true
      );
    }
    return toTextContent({ error: err.message }, true);
  }
  return toTextContent({ error: String(err) }, true);
}
