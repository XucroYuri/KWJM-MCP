import { DEFAULT_BASE_URL } from './config.js';
import { resolveError, type ErrorExplanation } from './errors.js';

/** kwjm 请求错误（归一化后的形态，透传平台信息 + 结构化解释） */
export class KwjmError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;
  /** 结构化的错误解释（性质/解释/下一步） */
  readonly explanation: ErrorExplanation;

  constructor(status: number, message: string, body?: unknown, code?: string) {
    super(message);
    this.name = 'KwjmError';
    this.status = status;
    this.body = body;
    this.code = code;
    this.explanation = resolveError(status, code);
  }
}

export interface KwjmClientConfig {
  /** 平台令牌 */
  apiKey: string;
  /** 基础地址，默认 https://kwjm.com */
  baseUrl?: string;
  /** 单次请求（含流式消费）的总时限，默认 120 秒。 */
  requestTimeoutMs?: number;
  /** JSON 成功响应的最大字节数，默认 64 MiB。 */
  maxResponseBytes?: number;
  /** JSON 请求体的最大字节数，默认 32 MiB。 */
  maxRequestBytes?: number;
}

/**
 * 平台 HTTP 客户端：统一注入 Authorization、组装 /v1 端点、归一化错误。
 * 仅做「传输」，不含模型语义（语义在 registry/handlers）。
 */
export class KwjmClient {
  readonly baseUrl: string;
  private config: KwjmClientConfig;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxRequestBytes: number;

  constructor(config: KwjmClientConfig) {
    if (!config.apiKey) {
      throw new KwjmError(401, '缺少 KWJM_API_KEY，请配置平台令牌。');
    }
    const candidate = new URL(config.baseUrl ?? DEFAULT_BASE_URL);
    if (
      candidate.origin !== DEFAULT_BASE_URL ||
      candidate.pathname !== '/' ||
      candidate.username ||
      candidate.password ||
      candidate.search ||
      candidate.hash
    ) {
      throw new KwjmError(400, `API Base URL 只允许 ${DEFAULT_BASE_URL}。`);
    }
    this.config = config;
    this.baseUrl = DEFAULT_BASE_URL;
    this.requestTimeoutMs = positiveLimit(config.requestTimeoutMs, 120_000, 'requestTimeoutMs');
    this.maxResponseBytes = positiveLimit(config.maxResponseBytes, 64 * 1024 * 1024, 'maxResponseBytes');
    this.maxRequestBytes = positiveLimit(config.maxRequestBytes, 32 * 1024 * 1024, 'maxRequestBytes');
  }

  private endpoint(path: string): string {
    // registry 中路径已是完整路径（/v1/… /v3/… /v1beta/… /api/v1/… 等），直接拼接
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${p}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  private requestSafety(): Pick<RequestInit, 'redirect' | 'signal'> {
    return {
      redirect: 'error',
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    };
  }

  private async readTextBounded(res: Response, maxBytes: number): Promise<string> {
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new KwjmError(502, `平台响应体超过上限 ${maxBytes} 字节。`);
    }
    if (!res.body) return '';

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new KwjmError(502, `平台响应体超过上限 ${maxBytes} 字节。`);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return text;
    } finally {
      reader.releaseLock();
    }
  }

  private async readJsonBounded(res: Response, maxBytes = this.maxResponseBytes): Promise<unknown> {
    return JSON.parse(await this.readTextBounded(res, maxBytes));
  }

  private serializePayload(payload: unknown): string {
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body, 'utf8') > this.maxRequestBytes) {
      throw new KwjmError(413, `平台请求体超过上限 ${this.maxRequestBytes} 字节。`);
    }
    return body;
  }

  private async parseError(res: Response): Promise<KwjmError> {
    let body: unknown;
    try {
      const raw = await this.readTextBounded(res, Math.min(this.maxResponseBytes, 1024 * 1024));
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    } catch {
      body = undefined;
    }
    const msg = extractErrorMessage(body) || `平台请求失败：HTTP ${res.status}`;
    const code = extractErrorCode(body);
    return new KwjmError(res.status, msg, body, code);
  }

  /** JSON 请求（非流式） */
  async post(path: string, payload: unknown, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    const body = this.serializePayload(payload);
    const res = await fetch(this.endpoint(path), {
      method: 'POST',
      headers: this.headers(extraHeaders),
      body,
      ...this.requestSafety(),
    });
    if (!res.ok) throw await this.parseError(res);
    return this.readJsonBounded(res);
  }

  /** GET 请求 */
  async get(path: string, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    const res = await fetch(this.endpoint(path), {
      method: 'GET',
      headers: this.headers(extraHeaders),
      ...this.requestSafety(),
    });
    if (!res.ok) throw await this.parseError(res);
    return this.readJsonBounded(res);
  }

  /** multipart/form-data 请求。不要手工设置 Content-Type，运行时负责生成 boundary。 */
  async postForm(path: string, form: FormData, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    const res = await fetch(this.endpoint(path), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        ...extraHeaders,
      },
      body: form,
      ...this.requestSafety(),
    });
    if (!res.ok) throw await this.parseError(res);
    return this.readJsonBounded(res);
  }

  /** 流式请求：返回原始 Response，调用方消费 SSE */
  async postStream(path: string, payload: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const body = this.serializePayload(payload);
    const res = await fetch(this.endpoint(path), {
      method: 'POST',
      headers: this.headers(extraHeaders),
      body,
      ...this.requestSafety(),
    });
    if (!res.ok) throw await this.parseError(res);
    return res;
  }
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new KwjmError(400, `${name} 必须是正整数。`);
  }
  return resolved;
}

/** 从错误响应体中提取人类可读的 message */
function extractErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.error === 'object' && b.error) {
    const e = b.error as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    if (typeof e.error === 'object' && e.error && typeof (e.error as Record<string, unknown>).message === 'string') {
      return (e.error as Record<string, unknown>).message as string;
    }
  }
  if (typeof b.message === 'string') return b.message;
  if (typeof b.error === 'string') return b.error;
  return undefined;
}

function extractErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.error === 'object' && b.error) {
    const e = b.error as Record<string, unknown>;
    if (typeof e.code === 'string') return e.code;
  }
  if (typeof b.code === 'string') return b.code;
  return undefined;
}
