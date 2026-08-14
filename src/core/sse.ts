export interface SseSummary {
  eventCount: number;
  text: string;
  truncated: boolean;
  finishReason?: string;
  usage?: unknown;
}

export interface ConsumeSseOptions {
  maxEvents?: number;
  maxTextChars?: number;
  maxBufferChars?: number;
  onEvent?: (event: { index: number; data: unknown; deltaText: string }) => Promise<void> | void;
}

/** 逐块消费 SSE，并只保留有界的结构化摘要。 */
export async function consumeSse(response: Response, options: ConsumeSseOptions = {}): Promise<SseSummary> {
  if (!response.body) throw new Error('流式响应没有可读取的 body。');

  const maxEvents = options.maxEvents ?? 2048;
  const maxTextChars = options.maxTextChars ?? 64 * 1024;
  const maxBufferChars = options.maxBufferChars ?? 1024 * 1024;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventCount = 0;
  let text = '';
  let truncated = false;
  let finishReason: string | undefined;
  let usage: unknown;

  const acceptData = async (rawData: string): Promise<boolean> => {
    const value = rawData.trim();
    if (!value) return true;
    if (value === '[DONE]') return false;
    if (eventCount >= maxEvents) {
      truncated = true;
      return false;
    }

    let data: unknown = value;
    try {
      data = JSON.parse(value);
    } catch {
      // 保留非 JSON event 的存在性，但不把任意原文拼进最终结果。
    }
    eventCount += 1;
    const deltaText = extractDeltaText(data);
    if (deltaText) {
      const available = Math.max(0, maxTextChars - text.length);
      text += deltaText.slice(0, available);
      if (deltaText.length > available) truncated = true;
    }
    const meta = extractMeta(data);
    finishReason = meta.finishReason ?? finishReason;
    usage = meta.usage ?? usage;
    await options.onEvent?.({ index: eventCount, data, deltaText });
    return !truncated;
  };

  const drain = async (final: boolean): Promise<boolean> => {
    while (true) {
      const boundary = buffer.search(/\r?\n\r?\n/);
      if (boundary < 0) break;
      const block = buffer.slice(0, boundary);
      const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
      buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!(await acceptData(data))) return false;
    }
    if (final && buffer.trim()) {
      const data = buffer
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      buffer = '';
      return acceptData(data);
    }
    return true;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > maxBufferChars) {
        await reader.cancel();
        throw new Error(`SSE 原始缓冲区超过上限 ${maxBufferChars} 字符。`);
      }
      if (!(await drain(done))) {
        await reader.cancel();
        break;
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }

  return { eventCount, text, truncated, finishReason, usage };
}

function extractDeltaText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, any>;
  const openAi = d.choices?.[0]?.delta?.content;
  if (typeof openAi === 'string') return openAi;
  const anthropic = d.delta?.text ?? d.content_block?.text;
  return typeof anthropic === 'string' ? anthropic : '';
}

function extractMeta(data: unknown): { finishReason?: string; usage?: unknown } {
  if (!data || typeof data !== 'object') return {};
  const d = data as Record<string, any>;
  const finishReason = d.choices?.[0]?.finish_reason ?? d.delta?.stop_reason;
  return {
    finishReason: typeof finishReason === 'string' ? finishReason : undefined,
    usage: d.usage,
  };
}
