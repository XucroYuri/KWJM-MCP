/**
 * KWJM 公共操作端点。
 *
 * handler 只能引用这里或模型注册表中的完整路径，避免 base URL 与 `/v1`
 * 前缀分别散落在不同层后再次产生双加/漏加。
 */
export const OPERATIONS = {
  models: '/v1/models',
  chatCompletions: '/v1/chat/completions',
  messages: '/v1/messages',
  imageGenerations: '/v1/images/generations',
  imageEdits: '/v1/images/edits',
  wallet: '/api/v1/user/wallet',
  dailyCostsByKey: '/api/v1/user/statistics/day/keys',
} as const;
