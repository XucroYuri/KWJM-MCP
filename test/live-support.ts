import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface LiveConfig {
  apiKey: string;
  apiKeyId: string;
  baseUrl: string;
}

/** 从进程环境或本地忽略文件读取 live 配置；绝不输出配置值。 */
export function readLiveConfig(): LiveConfig | undefined {
  const envKey = process.env.KWJM_API_KEY?.trim();
  if (envKey) {
    return { apiKey: envKey, apiKeyId: process.env.KWJM_API_KEY_ID?.trim() ?? '', baseUrl: 'https://kwjm.com' };
  }

  try {
    const raw = JSON.parse(readFileSync(resolve(process.cwd(), '.mcp.json'), 'utf8')) as any;
    const env = raw?.mcpServers?.['kwjm-mcp']?.env;
    const apiKey = typeof env?.KWJM_API_KEY === 'string' ? env.KWJM_API_KEY.trim() : '';
    if (!apiKey) return undefined;
    return {
      apiKey,
      apiKeyId: typeof env?.KWJM_API_KEY_ID === 'string' ? env.KWJM_API_KEY_ID.trim() : '',
      baseUrl: 'https://kwjm.com',
    };
  } catch {
    return undefined;
  }
}

export function hasCostAck(kind: 'image' | 'video' | 'video-reference'): boolean {
  const ack = process.env.KWJM_LIVE_COST_ACK;
  return ack === kind || ack === 'all';
}

export function toolHandler(registrations: any[], name: string): (args: any, extra?: any) => Promise<any> {
  const handler = registrations.find((entry) => entry[0] === name)?.[3];
  if (!handler) throw new Error(`未注册工具 ${name}`);
  return handler;
}

export function parseToolResult(result: any): any {
  const text = result?.content?.find((item: any) => item?.type === 'text')?.text;
  if (typeof text !== 'string') throw new Error('工具未返回文本结果。');
  return JSON.parse(text);
}
