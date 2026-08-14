/** 开物基模官方文档声明的 API Base URL。 */
export const DEFAULT_BASE_URL = 'https://kwjm.com';

export interface RuntimeConfig {
  apiKey: string;
  apiKeyId: string;
  baseUrl: string;
}

/**
 * 读取公开运行时配置契约。
 *
 * 环境变量名是本 npm 包自己的稳定接口，不继承平台文档里的 shell 示例命名。
 */
export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    apiKey: env.KWJM_API_KEY ?? '',
    apiKeyId: env.KWJM_API_KEY_ID?.trim() ?? '',
    baseUrl: DEFAULT_BASE_URL,
  };
}
